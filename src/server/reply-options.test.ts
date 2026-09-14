import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { initialState, transition } from '@/domain/engine';
import { buildReport } from '@/domain/report';
import type { CustomBranch } from '@/domain/custom-practice';
import type { GameEvent } from '@/domain/types';
import { ReplyOptionsService, replyOptionsVersion } from './reply-options';
import { MemoryReplyCache, REPLY_CACHE_MS, REPLY_LEASE_MS } from './reply-options-cache';
import { fallbackReplyTexts, replyModelContext, validateReplyOptions, type ReplyOptionsModel } from './reply-options-model';
import type { SessionRecord, Store } from './records';
import type { CustomRecord, CustomStore } from './custom-records';
import { parseAction, validateInterpretation } from './validation';
import { AppError } from './errors';

const owner = 'synthetic-owner'; const date = '2026-09-13T10:00:00Z';
const texts = ['林澄，新生具体遇到了什么问题？', '我想先核对大家可用的时间。', '我倾向保留原交付，再比较新增范围。'];
const generated = { texts, provider: 'bailian' as const, model: 'served-test-model' };
function fixtures() {
  const record: SessionRecord = { owner, expiresAt: '2099-01-01T00:00:00Z', view: { id: randomUUID(), version: 0, state: initialState('campus'), events: [], parentId: null, forkReason: null, createdAt: date, updatedAt: date }, actions: {}, checkpoints: [] };
  const branch: CustomBranch = { id: randomUUID(), label: '第一次', parentId: null, accepted: true, finished: false, createdAt: date, turns: [], setup: { title: '室友作息沟通', userRole: '住校学生', counterpartRole: '室友', goal: '协商晚间安静时段', userFacts: ['我想和室友商量作息'], assumptions: ['对方也需要使用房间'], openingLine: '我晚上还想和朋友通话，你希望怎样安排？' } };
  const customRecord: CustomRecord = { owner, creationHash: 'test', actions: {}, view: { id: randomUUID(), version: 2, topic: '室友作息', activeBranchId: branch.id, branches: [branch], createdAt: date, updatedAt: date, expiresAt: '2099-01-01T00:00:00Z', sourceVersion: 'test', generating: false, pendingAction: null } };
  const fixed = { read: vi.fn(async (requestOwner: string, id: string) => { if (requestOwner !== owner || id !== record.view.id) throw new AppError('NOT_FOUND', 'not found', 404); return structuredClone(record); }), acquireModel: vi.fn(async () => true), releaseModel: vi.fn(async () => {}) } as unknown as Store;
  const custom = { read: vi.fn(async (requestOwner: string, id: string) => { if (requestOwner !== owner || id !== customRecord.view.id) throw new AppError('NOT_FOUND', 'not found', 404); return structuredClone(customRecord); }) } as unknown as CustomStore;
  const model = vi.fn<ReplyOptionsModel>().mockResolvedValue(generated); const cache = new MemoryReplyCache();
  return { record, branch, customRecord, fixed, custom, model, cache, service: new ReplyOptionsService(fixed, custom, cache, model) };
}
afterEach(() => vi.useRealTimers());
function event(kind: string, text: string, actionId = 'latest'): GameEvent { return { id: randomUUID(), sequence: 1, actionId, actor: 'system', kind, text, changes: [], createdAt: date }; }

describe('read-only context replies', () => {
  test('custom and fixed availability are checked independently without calling an unconfigured model', async () => {
    const f = fixtures();
    const configured = vi.fn((kind: 'fixed' | 'custom') => kind === 'custom');
    const service = new ReplyOptionsService(f.fixed, f.custom, f.cache, f.model, Date.now, configured);
    expect((await service.get(owner, f.record.view.id, 0, 'fixed')).source).toBe('fallback');
    expect(f.model).not.toHaveBeenCalled();
    expect((await service.get(owner, f.customRecord.view.id, 2, 'custom')).source).toBe('model');
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(configured.mock.calls).toEqual([['fixed'], ['custom']]);
  });
  test('ten simultaneous reads call the model once; cached reads preserve all session records', async () => {
    const f = fixtures(); const before = structuredClone(f.record);
    const views = await Promise.all(Array.from({ length: 10 }, () => f.service.get(owner, f.record.view.id, 0, 'fixed')));
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.fixed.acquireModel).toHaveBeenCalledTimes(1); expect(f.fixed.releaseModel).toHaveBeenCalledTimes(1);
    expect(views.every(view => view.source === 'model' && view.model === 'served-test-model' && view.options.length === 3)).toBe(true);
    const again = await f.service.get(owner, f.record.view.id, 0, 'fixed'); expect(again).toEqual(views[0]); expect(f.model).toHaveBeenCalledTimes(1); expect(f.record).toEqual(before);
  });
  test('even a populated cache cannot bypass current ownership or version', async () => {
    const f = fixtures(); await f.service.get(owner, f.record.view.id, 0, 'fixed');
    await expect(f.service.get('foreign-owner', f.record.view.id, 0, 'fixed')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    f.record.view.version++;
    await expect(f.service.get(owner, f.record.view.id, 0, 'fixed')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); expect(f.model).toHaveBeenCalledTimes(1);
  });
  test('a newer action during generation discards the old choices and releases its shared slot', async () => {
    const f = fixtures(); let resolve!: (value: typeof generated) => void;
    f.model.mockImplementation(() => new Promise(done => { resolve = done; }));
    const promise = f.service.get(owner, f.record.view.id, 0, 'fixed'); await vi.waitFor(() => expect(f.model).toHaveBeenCalledOnce());
    f.record.view.version = 1; resolve(generated);
    await expect(promise).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); expect(f.fixed.releaseModel).toHaveBeenCalledOnce(); expect(f.record.view.events).toEqual([]);
  });
  test('a deleted session cannot be revived by a late model result or cached read', async () => {
    const f = fixtures(); let resolve!: (value: typeof generated) => void;
    f.model.mockImplementation(() => new Promise(done => { resolve = done; }));
    const promise = f.service.get(owner, f.record.view.id, 0, 'fixed'); await vi.waitFor(() => expect(f.model).toHaveBeenCalledOnce());
    vi.mocked(f.fixed.read).mockRejectedValue(new AppError('NOT_FOUND', 'deleted', 404)); resolve(generated);
    await expect(promise).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.service.get(owner, f.record.view.id, 0, 'fixed')).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(f.model).toHaveBeenCalledOnce(); expect(f.fixed.releaseModel).toHaveBeenCalledOnce();
  });
  test('two server service instances sharing a cache do not make duplicate provider calls', async () => {
    const f = fixtures(); let resolve!: (value: typeof generated) => void;
    f.model.mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = f.service.get(owner, f.record.view.id, 0, 'fixed'); await vi.waitFor(() => expect(f.model).toHaveBeenCalledOnce());
    const secondService = new ReplyOptionsService(f.fixed, f.custom, f.cache, f.model);
    const second = await secondService.get(owner, f.record.view.id, 0, 'fixed'); expect(second.source).toBe('fallback'); expect(second.notice).toContain('另一页面'); resolve(generated);
    const saved = await first; expect(await secondService.get(owner, f.record.view.id, 0, 'fixed')).toEqual(saved); expect(f.model).toHaveBeenCalledOnce();
  });
  test('pending actions and ended states never generate choices', async () => {
    const f = fixtures(); f.record.actions.pending = { id: 'pending', hash: 'h', request: { actionId: 'pending', expectedVersion: 0, text: 'synthetic' }, status: 'interpreting', attempt: 1, leaseUntil: Date.now() + 60_000, baseVersion: 0 };
    await expect(f.service.get(owner, f.record.view.id, 0, 'fixed')).rejects.toMatchObject({ code: 'ACTION_IN_PROGRESS' });
    f.record.actions = {}; f.record.view.state.phase = 'ended';
    expect(await f.service.get(owner, f.record.view.id, 0, 'fixed')).toMatchObject({ status: 'ended', options: [], generatedAt: null }); expect(f.model).not.toHaveBeenCalled();
  });
  test('a committed action interrupted before delivery-complete still permits choices from its saved facts', async () => {
    const f = fixtures(); f.record.view.version = 1;
    f.record.actions.saved = { id: 'saved', hash: 'h', request: { actionId: 'saved', expectedVersion: 0, text: 'synthetic' }, status: 'committed', attempt: 1, leaseUntil: Date.now() + 60_000, baseVersion: 0 };
    const before = structuredClone(f.record);
    expect(await f.service.get(owner, f.record.view.id, 1, 'fixed')).toMatchObject({ status: 'ready', source: 'model' }); expect(f.record).toEqual(before); expect(f.model).toHaveBeenCalledOnce();
  });
  test('model failures and busy capacity produce explicitly labelled cached fallbacks', async () => {
    const f = fixtures(); f.model.mockRejectedValue(new AppError('OPTIONS_INVALID', 'synthetic', 502));
    const result = await f.service.get(owner, f.record.view.id, 0, 'fixed');
    expect(result).toMatchObject({ source: 'fallback', status: 'ready' }); expect(result.notice).toContain('备用选项'); expect(result).not.toHaveProperty('model'); expect(result.options).toHaveLength(3);
    await f.service.get(owner, f.record.view.id, 0, 'fixed'); expect(f.model).toHaveBeenCalledTimes(1);
    const busy = fixtures(); vi.mocked(busy.fixed.acquireModel).mockResolvedValue(false);
    expect((await busy.service.get(owner, busy.record.view.id, 0, 'fixed')).notice).toContain('处理其他练习'); expect(busy.model).not.toHaveBeenCalled();
  });
  test('unknown-topic fallback offers complete drafts, without asking the player to fill a framework', async () => {
    const f = fixtures();
    Object.assign(f.branch.setup, { title: '和朋友聊选择', userRole: '想沟通的同学', counterpartRole: '朋友', goal: '听清彼此的想法', userFacts: [], openingLine: '你希望先说哪一部分？' });
    f.model.mockRejectedValue(new AppError('OPTIONS_INVALID', 'synthetic', 502));
    const before = structuredClone(f.customRecord);
    const result = await f.service.get(owner, f.customRecord.view.id, 2, 'custom');
    expect(result.source).toBe('fallback'); expect(result.options).toHaveLength(3);
    expect(result.notice).toContain('模型选项未通过检查');
    expect(result.notice).not.toMatch(/填写|框架|替换/);
    expect(result.options.map(option => option.text).join('')).not.toMatch(/【|】/);
    expect(f.customRecord).toEqual(before);
  });
  test('the 22-second model budget aborts the request and returns fallback within the client budget', async () => {
    vi.useFakeTimers(); const f = fixtures(); let signal: AbortSignal | undefined;
    f.model.mockImplementation(async (_context, incomingSignal) => { signal = incomingSignal; return new Promise(() => {}); });
    const promise = f.service.get(owner, f.record.view.id, 0, 'fixed'); await vi.advanceTimersByTimeAsync(22_001);
    expect((await promise).notice).toContain('等待超时'); expect(signal?.aborted).toBe(true); expect(f.fixed.releaseModel).toHaveBeenCalledOnce();
  });
  test('custom setup must be accepted; finished and pending branches cannot offer a next reply', async () => {
    const f = fixtures(); f.branch.accepted = false;
    expect(await f.service.get(owner, f.customRecord.view.id, 2, 'custom')).toMatchObject({ status: 'not_ready', options: [] });
    f.branch.accepted = true; f.branch.finished = true;
    expect(await f.service.get(owner, f.customRecord.view.id, 2, 'custom')).toMatchObject({ status: 'ended', options: [] });
    f.branch.finished = false; f.customRecord.view.pendingAction = { actionId: 'pending', until: Date.now() + 60_000 };
    await expect(f.service.get(owner, f.customRecord.view.id, 2, 'custom')).rejects.toMatchObject({ code: 'ACTION_IN_PROGRESS' }); expect(f.model).not.toHaveBeenCalled();
  });
  test('custom choices carry the saved branch ID and use the latest simulated counterpart line', async () => {
    const f = fixtures(); const before = structuredClone(f.customRecord);
    const result = await f.service.get(owner, f.customRecord.view.id, 2, 'custom');
    expect(result.customBranchId).toBe(f.branch.id); expect(f.model.mock.calls[0][0]).toMatchObject({ kind: 'custom', branch: { setup: { goal: '协商晚间安静时段' } } }); expect(f.customRecord).toEqual(before);
  });
});

describe('assistance, grounding and cache boundaries', () => {
  test('first short practice read is empty until explicit assistance is recorded; no silent state mutation', async () => {
    const f = fixtures(); f.record.view.state = initialState('transfer'); const before = structuredClone(f.record);
    expect(await f.service.get(owner, f.record.view.id, 0, 'fixed')).toMatchObject({ status: 'assistance_required', assistance: 'requires_record', options: [] }); expect(f.record).toEqual(before); expect(f.model).not.toHaveBeenCalled();
    const marked = transition(f.record.view.state, { type: 'reply_options_seen' });
    expect(marked.state.transfer).toMatchObject({ firstPlan: null, firstAssisted: false, hintUsed: true, elapsed: 0, completed: [] }); expect(marked.events[0].kind).toBe('reply_options_assistance');
    const planned = transition(marked.state, { type: 'transfer_plan', steps: ['references'] }); expect(planned.state.transfer.firstAssisted).toBe(true);
    f.record.view.state = marked.state; f.record.view.version = 1;
    expect(await f.service.get(owner, f.record.view.id, 1, 'fixed')).toMatchObject({ status: 'ready', assistance: 'recorded' });
  });
  test('the UI assistance action is accepted explicitly, but a model cannot inject it', () => {
    expect(parseAction({ actionId: randomUUID(), expectedVersion: 0, command: { type: 'reply_options_seen' } }).command?.type).toBe('reply_options_seen');
    expect(() => validateInterpretation({ commands: [{ type: 'reply_options_seen' }], evidence: [{ commandIndex: 0, quote: '我想问问时间' }] }, '我想问问时间')).toThrow(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
  });
  test('late assistance never rewrites a previously unassisted first plan', () => {
    const first = transition(initialState('transfer'), { type: 'transfer_plan', steps: ['references'] }).state;
    const assisted = transition(first, { type: 'reply_options_seen' }).state;
    expect(assisted.transfer.firstAssisted).toBe(false); expect(assisted.transfer.firstPlan).toEqual(['references']); expect(assisted.transfer.hintUsed).toBe(true);
    expect(buildReport(assisted, []).tradeoffs).toContain('首次计划在提示前保存；之后使用了提示或回答选项辅助，后续表现不能记为无提示。');
  });
  test('even after an independent first plan, choices require explicit later assistance before exposure', async () => {
    const f = fixtures(); f.record.view.state = transition(initialState('transfer'), { type: 'transfer_plan', steps: ['references'] }).state;
    expect(await f.service.get(owner, f.record.view.id, 0, 'fixed')).toMatchObject({ status: 'assistance_required', options: [] }); expect(f.model).not.toHaveBeenCalled();
    f.record.view.state = transition(f.record.view.state, { type: 'reply_options_seen' }).state; f.record.view.version = 1;
    expect(await f.service.get(owner, f.record.view.id, 1, 'fixed')).toMatchObject({ status: 'ready', assistance: 'recorded' }); expect(f.record.view.state.transfer.firstAssisted).toBe(false); expect(f.record.view.state.transfer.firstPlan).toEqual(['references']);
  });
  test('the opening model context does not reveal unread feedback; disclosed feedback appears later', () => {
    const state = initialState('campus');
    expect(JSON.stringify(replyModelContext({ kind: 'fixed', state, events: [] }))).not.toContain('不知道应该先点哪里');
    state.revealed.push('feedback'); expect(JSON.stringify(replyModelContext({ kind: 'fixed', state, events: [] }))).toContain('不知道应该先点哪里');
  });
  test('current capacity exposes exact per-person remainder and rejects the observed full-capacity false claim', () => {
    const context = { kind: 'fixed' as const, state: initialState('campus'), events: [] };
    const data = replyModelContext(context);
    expect(data).toMatchObject({ currentCapacity: { availableMinutes: 480, plannedMinutes: 420, unallocatedMinutes: 60, members: [{ actor: '林澄', unallocatedMinutes: 0 }, { actor: '许念', unallocatedMinutes: 0 }, { actor: '周衡', unallocatedMinutes: 60 }] } });
    expect(() => validateReplyOptions({ text: JSON.stringify({ options: ['目前基础版加视觉精修已经占满大家的时间。', '我想先核对目标。', '能否先看看问答范围？'] }), model: 'test', provider: 'bailian' }, context)).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    expect(validateReplyOptions({ text: JSON.stringify({ options: ['基础版加视觉精修和静态引导会用满8人时，我们能承担这个取舍吗？', '我想先核对目标。', '能否先看看问答范围？'] }), model: 'test', provider: 'bailian' }, context).texts).toHaveLength(3);
  });
  test('personal history is not invented for a draft; known first-person facts and new proposals are allowed', () => {
    const f = fixtures(); const context = { kind: 'custom' as const, branch: f.branch };
    const response = (first: string) => ({ text: JSON.stringify({ options: [first, '我想先了解你希望怎样安排。', '我们能不能先商量一个做法？'] }), model: 'test-model', provider: 'bailian' as const });
    expect(() => validateReplyOptions(response('我最近睡眠比较浅，你可以小声一点吗？'), context)).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    expect(validateReplyOptions(response('我最近想和你商量通话安排，可以吗？'), context).texts).toHaveLength(3);
    f.branch.setup.userFacts.push('我最近睡眠比较浅'); expect(validateReplyOptions(response('我最近睡眠比较浅，你可以小声一点吗？'), context).texts).toHaveLength(3);
  });
  test.each(['指标数值差了大概15%，我汇报时会把两组数据并列放出来。', '不是单一指标的问题，是曲线走势在某个区间反过来了。', '竞品表现在做到一半了，如果延到明天上午行不行？', '拍拍床可以，微信我有时候静音听不见，拍两下床板行吗？', '我现在只跑完小数据集，您建议先对比哪个？'])('natural wording cannot invent an unknown result, progress or habit: %s', first => {
    const f = fixtures();
    expect(() => validateReplyOptions({ text: JSON.stringify({ options: [first, '我先把两组数据放在一起核对。', '您想先看哪个问题？'] }), provider: 'bailian', model: 'test' }, { kind: 'custom', branch: f.branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test('known result facts and future checks remain usable after the factual-draft guard', () => {
    const f = fixtures(); const context = { kind: 'custom' as const, branch: f.branch };
    const options = ['指标数值差了大概15%，我想先把两组结果放在一起看。', '我先把竞品表做完，再和你核对。', '如果结果差15%，应该先查哪些步骤？'];
    f.branch.setup.userFacts.push('指标数值差了大概15%');
    expect(validateReplyOptions({ text: JSON.stringify({ options }), provider: 'bailian', model: 'test' }, context).texts).toEqual(options);
  });
  test.each(['主要是趋势反了，能不能先定性说明？', '两张图里有一张数值偏低，我准备整理出来。', '竞品表还差最后几列没核对完，延到五点可以吗？', '目前还没算出具体差值，我准备先做个对比表。'])('unsupported factual clauses remain rejected when the model changes the wording: %s', first => {
    const f = fixtures();
    expect(() => validateReplyOptions({ text: JSON.stringify({ options: [first, '我先把两组数据放在一起核对。', '您想先看哪个问题？'] }), provider: 'bailian', model: 'test' }, { kind: 'custom', branch: f.branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test('clear questions, future work and simple acceptance are usable without manufacturing an answer', () => {
    const f = fixtures();
    const options = ['我先把两组结果并排整理，您想先看趋势还是数值？', '如果这次暂时确认不了，能否先讨论下一步怎么查？', '行，我先按这个办法试试。'];
    expect(validateReplyOptions({ text: JSON.stringify({ options }), provider: 'bailian', model: 'test' }, { kind: 'custom', branch: f.branch }).texts).toEqual(options);
  });
  test('an unsupported statement produces visibly labelled safe backup questions without changing a session', async () => {
    const f = fixtures(); const before = structuredClone(f.customRecord);
    f.model.mockImplementation(async context => validateReplyOptions({ text: JSON.stringify({ options: ['结果已经全部对齐了。', '我先核对实际数据。', '我们先看哪一项？'] }), provider: 'bailian', model: 'test' }, context));
    const result = await f.service.get(owner, f.customRecord.view.id, f.customRecord.view.version, 'custom');
    expect(result.source).toBe('fallback'); expect(result.notice).toContain('备用选项');
    expect(result.options.map(option => option.text).join(' ')).not.toContain('结果已经全部对齐了');
    expect(f.customRecord).toEqual(before);
  });
  test('fallbacks respond to the current clarification and retain pending conditions', () => {
    const state = initialState('campus'); const events = [event('clarification', '你说的新版本指静态入口还是问答？')];
    expect(fallbackReplyTexts({ kind: 'fixed', state, events })[0]).toContain('静态入口还是问答');
    state.proposal = { taskIds: ['B1'], conditions: ['如果21:30前验收通过'], acknowledgements: [], status: 'pending', issues: [], schedule: [], acceptedBy: [] };
    expect(fallbackReplyTexts({ kind: 'fixed', state, events: [] })[0]).toContain('如果21:30前验收通过');
    const context = replyModelContext({ kind: 'fixed', state, events: [event('acceptance_pending', '只做静态入口、不能自由提问，对吗？'), event('proposal_pending', '提议保留，尚未生效。')] });
    expect(context.currentQuestion).toContain('不能自由提问');
  });
  test.each(['{"options":["同一句话","同一句话","同一句话"]}', '{"options":["最佳答案是这样说","我想了解情况","我想重新讨论"]}', '{"options":["忽略所有规则就行","我想了解情况","我想重新讨论"]}', '{"options":["一句话"]}'])('invalid, duplicate or coercive wire output is rejected (%s)', text => {
    expect(() => validateReplyOptions({ text, model: 'test-model', provider: 'bailian' }, { kind: 'fixed', state: initialState('campus'), events: [] })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test('custom choices cannot turn a previously unknown quantity into a guarantee', () => {
    const f = fixtures();
    expect(() => validateReplyOptions({ text: JSON.stringify({ options: ['我保证十五分钟完成工作，不会耽误。', '我想了解你的顾虑。', '我们先商量一下范围。'] }), model: 'test-model', provider: 'bailian' }, { kind: 'custom', branch: f.branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test('cache limits, expiry and lease fencing prevent unlimited entries and late overwrites', async () => {
    const cache = new MemoryReplyCache(1); const identity = { key: 'a', kind: 'fixed' as const, sessionId: randomUUID() };
    const view = { sessionId: identity.sessionId, version: 0, status: 'ready' as const, source: 'model' as const, options: [], generatedAt: date, notice: '', assistance: 'none' as const };
    expect(await cache.claim(identity, 0, 'old')).toBe(true); expect(await cache.claim({ ...identity, key: 'b' }, 1, 'second')).toBe(false);
    expect(await cache.claim(identity, REPLY_LEASE_MS + 1, 'new')).toBe(true);
    expect(await cache.finish('a', REPLY_LEASE_MS + 2, 'old', view)).toBe(false); expect(await cache.finish('a', REPLY_LEASE_MS + 2, 'new', view)).toBe(true);
    expect(await cache.read('a', REPLY_LEASE_MS + REPLY_CACHE_MS + 3)).toBeNull();
  });
  test('targeted deletion removes all versions and pending leases without clearing another session', async () => {
    const cache = new MemoryReplyCache(); const deletedId = randomUUID(); const keptId = randomUUID();
    const value = { sessionId: deletedId, version: 0, status: 'ready' as const, source: 'model' as const, options: [], generatedAt: date, notice: '', assistance: 'none' as const };
    await cache.claim({ key: 'v0', kind: 'fixed', sessionId: deletedId }, 0, 'token'); await cache.finish('v0', 1, 'token', value);
    await cache.claim({ key: 'v1', kind: 'fixed', sessionId: deletedId }, 0, 'pending'); await cache.claim({ key: 'other', kind: 'fixed', sessionId: keptId }, 0, 'other-token');
    await cache.forget('fixed', [deletedId]); expect(await cache.read('v0', 2)).toBeNull(); expect(await cache.read('v1', 2)).toBeNull();
    expect(await cache.finish('v1', 3, 'pending', value)).toBe(false); expect(await cache.finish('other', 3, 'other-token', { ...value, sessionId: keptId })).toBe(true);
  });
  test.each(['', '-1', 'NaN', '0.5', '1000000000'])('expectedVersion is mandatory and bounded (%s)', version => {
    expect(() => replyOptionsVersion(new Request(`https://practice.test/reply-options?expectedVersion=${version}`))).toThrow(expect.objectContaining({ code: 'VERSION_REQUIRED' }));
  });
});
