import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LocalCustomStore } from './custom-store';
import { CustomPracticeService } from './custom-service';
import { activeCustomBranch, type CustomSetup } from '@/domain/custom-practice';
import { liveCustomModel, type CustomModel } from './custom-model';
import { requestModelJson } from './model-provider';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';

vi.mock('./model-provider', () => ({ requestModelJson: vi.fn(), modelConfiguration: () => ({ configured: false, provider: null, model: 'test-only' }) }));
const root = path.resolve('.local'); const owner = 'custom-owner'; let directory: string; let store: LocalCustomStore;
const topic = '想和室友商量晚上安静一点，又不想伤和气。';
const setup: CustomSetup = { title: '把安静的时间谈清楚', userRole: '合住的室友', counterpartRole: '另一位室友', goal: '商量一个双方都能接受的晚间安排', userFacts: [topic], assumptions: ['对方还不知道噪音让你困扰'], openingLine: '你刚才说想和我聊聊，是什么事？' };
const model: CustomModel = { setup: vi.fn(async () => structuredClone(setup)), reply: vi.fn(async (_branch, text) => ({ reply: '可以聊聊。你最希望我调整的是什么？', practiceQuestion: '你会怎样把期待说具体？', supportedQuote: text, sourceId: null })) };
const creation = () => ({ id: randomUUID(), actionId: randomUUID(), topic });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(async () => { await mkdir(root, { recursive: true }); directory = await mkdtemp(path.join(root, 'custom-test-')); store = new LocalCustomStore(directory); vi.clearAllMocks(); });
afterEach(async () => { vi.useRealTimers(); if (directory && path.resolve(directory).startsWith(`${root}${path.sep}custom-test-`)) await rm(directory, { recursive: true, force: true }); });
async function accepted(service: CustomPracticeService) {
  const view = await service.create(owner, creation());
  return service.action(owner, view.id, { actionId: randomUUID(), expectedVersion: view.version, kind: 'accept_setup', setup });
}

describe('custom practice persistence and truthful boundaries', () => {
  test('a reasonable first reply and ordinary completion words keep custom practice open until the explicit finish operation', async () => {
    const agreeable: CustomModel = { ...model, reply: vi.fn(async (_branch, text) => ({ reply: '可以，先照这个安排试一试。你还有什么想核对的吗？', practiceQuestion: '你准备怎样检查这个安排？', supportedQuote: text, sourceId: null })) };
    const service = new CustomPracticeService(store, agreeable); const ready = await accepted(service);
    const first = await service.action(owner, ready.id, { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text: '晚上23点后视频戴耳机，我们先试一周，周日再聊聊，就这样。' });
    expect(activeCustomBranch(first)?.finished).toBe(false); expect(activeCustomBranch(first)?.turns).toHaveLength(1);
    const restored = new CustomPracticeService(new LocalCustomStore(directory), agreeable);
    const second = await restored.action(owner, ready.id, { kind: 'say', actionId: randomUUID(), expectedVersion: first.version, text: '我还想听听你的顾虑，具体怎么安排舒服一点？' });
    expect(activeCustomBranch(second)?.finished).toBe(false); expect(activeCustomBranch(second)?.turns).toHaveLength(2);
    const finished = await restored.action(owner, ready.id, { kind: 'finish', actionId: randomUUID(), expectedVersion: second.version });
    expect(activeCustomBranch(finished)?.finished).toBe(true);
    expect(activeCustomBranch(finished)?.turns).toEqual(activeCustomBranch(second)?.turns);
  });
  test('restores exact user topic, editable assumptions and independent ownership from actual files', async () => {
    const service = new CustomPracticeService(store, model); const request = creation(); const view = await service.create(owner, request);
    expect(view.topic).toBe(topic); expect(view.branches[0].setup.userFacts).toEqual([topic]); expect(view.branches[0].accepted).toBe(false);
    const restored = new CustomPracticeService(new LocalCustomStore(directory), model);
    expect(await restored.read(owner, view.id)).toEqual(view);
    expect(await restored.list(owner)).toEqual([expect.objectContaining({ id: view.id, title: setup.title, ready: true })]);
    expect(await restored.list('another-owner')).toEqual([]);
    await expect(restored.read('another-owner', view.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(restored.remove('another-owner', view.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  test('cannot practice before explicitly accepting the editable setup', async () => {
    const service = new CustomPracticeService(store, model); const view = await service.create(owner, creation());
    await expect(service.action(owner, view.id, { kind: 'say', actionId: randomUUID(), expectedVersion: view.version, text: '我们聊聊' })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(model.reply).not.toHaveBeenCalled();
  });
  test('ten duplicate creates and messages generate once and save one effect', async () => {
    const service = new CustomPracticeService(store, model); const request = creation();
    await Promise.all(Array.from({ length: 10 }, () => service.create(owner, request)));
    const created = await service.read(owner, request.id);
    expect(created.version).toBe(1); expect(created.branches).toHaveLength(1); expect(model.setup).toHaveBeenCalledTimes(1);
    const ready = await service.action(owner, request.id, { kind: 'accept_setup', actionId: randomUUID(), expectedVersion: 1, setup });
    const action = { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text: '能不能十点以后戴耳机？' };
    await Promise.all(Array.from({ length: 10 }, () => service.action(owner, request.id, action)));
    const saved = await service.read(owner, request.id);
    expect(saved.version).toBe(3); expect(activeCustomBranch(saved)?.turns).toHaveLength(1); expect(model.reply).toHaveBeenCalledTimes(1);
    await expect(service.action(owner, request.id, { ...action, text: '改成另一句' })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
  });
  test('competing modifications and stale versions cannot overwrite', async () => {
    const service = new CustomPracticeService(store, model); const ready = await accepted(service);
    const results = await Promise.allSettled(['可以聊聊吗？', '我想谈谈安静时间。'].map(text => service.action(owner, ready.id, { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(activeCustomBranch(await service.read(owner, ready.id))?.turns).toHaveLength(1);
  });
  test('rewind keeps the old complete branch and creates an independently editable setup', async () => {
    const service = new CustomPracticeService(store, model); const ready = await accepted(service);
    const said = await service.action(owner, ready.id, { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text: '我想商量十点之后的声音。' });
    const original = structuredClone(activeCustomBranch(said)!);
    const back = await service.action(owner, ready.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: said.version });
    expect(back.branches).toHaveLength(2); expect(back.branches[0]).toEqual(original); expect(activeCustomBranch(back)?.turns).toHaveLength(0);
    const edit = await service.action(owner, ready.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: back.version });
    expect(activeCustomBranch(edit)?.accepted).toBe(false);
    const changed = await service.action(owner, ready.id, { kind: 'accept_setup', actionId: randomUUID(), expectedVersion: edit.version, setup: { ...setup, counterpartRole: '同屋同学', assumptions: ['双方轮班时间不同'] } });
    expect(changed.branches[0]).toEqual(original); expect(activeCustomBranch(changed)?.setup.assumptions).toEqual(['双方轮班时间不同']);
    const switched = await service.action(owner, ready.id, { kind: 'switch_branch', actionId: randomUUID(), expectedVersion: changed.version, branchId: original.id });
    expect(activeCustomBranch(switched)).toEqual(original);
  });
  test('failed generation retains the topic and same action can recover without adding a turn', async () => {
    const unstable: CustomModel = { ...model, reply: vi.fn().mockRejectedValueOnce(new Error('upstream')).mockImplementation(model.reply) };
    const service = new CustomPracticeService(store, unstable); const ready = await accepted(service);
    const action = { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text: '请问你通常几点休息？' };
    await expect(service.action(owner, ready.id, action)).rejects.toThrow();
    const failed = await service.read(owner, ready.id); expect(failed.version).toBe(ready.version); expect(failed.pendingAction).toBeNull();
    const recovered = await service.action(owner, ready.id, action); expect(activeCustomBranch(recovered)?.turns).toHaveLength(1);
  });
  test.each([true, false])('sourced setup failure survives file-store restoration and retry (client sends source ID: %s)', async (sendSourceId) => {
    const sourceQuestionId = CAMPUS_CORPUS[0].id;
    const unstable: CustomModel = { ...model, setup: vi.fn().mockRejectedValueOnce(new Error('upstream setup failed')).mockImplementation(model.setup) };
    const request = { ...creation(), sourceQuestionId };
    await expect(new CustomPracticeService(store, unstable).create(owner, request)).rejects.toThrow('upstream setup failed');
    const before = await store.read(owner, request.id);
    expect(before.view).toMatchObject({ sourceQuestionId, version: 0, topic, activeBranchId: null, branches: [], pendingAction: null, generating: false });
    expect(before.actions[request.actionId].status).toBe('failed');

    const restoredStore = new LocalCustomStore(directory);
    const restoredService = new CustomPracticeService(restoredStore, unstable);
    const restored = await restoredService.read(owner, request.id);
    expect(restored).toEqual(before.view);
    const retry = { id: restored.id, actionId: request.actionId, topic: restored.topic, ...(sendSourceId ? { sourceQuestionId: restored.sourceQuestionId } : {}) };
    const recovered = await restoredService.create(owner, retry);
    expect(recovered).toMatchObject({ sourceQuestionId, version: 1, pendingAction: null, generating: false });
    expect(recovered.branches).toHaveLength(1);
    expect(recovered.branches[0].sourceContext?.questions.map(question => question.id)).toEqual([sourceQuestionId]);
    expect(unstable.setup).toHaveBeenCalledTimes(2);
    expect(vi.mocked(unstable.setup).mock.lastCall?.[1]?.questions.map(question => question.id)).toEqual([sourceQuestionId]);
    const saved = await restoredStore.read(owner, request.id);
    expect(saved.creationHash).toBe(before.creationHash);
    expect(saved.actions[request.actionId]).toMatchObject({ hash: before.actions[request.actionId].hash, status: 'done' });
    expect(await restoredService.create(owner, retry)).toEqual(recovered);
    expect(unstable.setup).toHaveBeenCalledTimes(2);
  });
  test('legacy failed sourced setup recovers its exact ID without changing the stored history on read', async () => {
    const sourceQuestionId = CAMPUS_CORPUS[0].id;
    const unstable: CustomModel = { ...model, setup: vi.fn().mockRejectedValueOnce(new Error('upstream')).mockImplementation(model.setup) };
    const request = { ...creation(), sourceQuestionId };
    await expect(new CustomPracticeService(store, unstable).create(owner, request)).rejects.toThrow();
    // Simulate the former schema: the original creation/action hashes are intact,
    // but the selected source ID was never copied into the public view.
    await store.update(owner, request.id, record => { delete record.view.sourceQuestionId; });
    const legacy = await store.read(owner, request.id);
    const service = new CustomPracticeService(new LocalCustomStore(directory), unstable);
    expect((await service.read(owner, request.id)).sourceQuestionId).toBe(sourceQuestionId);
    expect(await store.read(owner, request.id)).toEqual(legacy);
    const recovered = await service.create(owner, { id: request.id, actionId: request.actionId, topic });
    expect(recovered.sourceQuestionId).toBe(sourceQuestionId);
    expect(recovered.branches[0].sourceContext?.questions.map(question => question.id)).toEqual([sourceQuestionId]);
    expect((await store.read(owner, request.id)).creationHash).toBe(legacy.creationHash);
  });
  test('restored sourced creation rejects changed source, changed topic and another owner without modifying the failed record', async () => {
    const sourceQuestionId = CAMPUS_CORPUS[0].id;
    const unstable: CustomModel = { ...model, setup: vi.fn().mockRejectedValue(new Error('upstream')) };
    const request = { ...creation(), sourceQuestionId };
    await expect(new CustomPracticeService(store, unstable).create(owner, request)).rejects.toThrow();
    const before = await store.read(owner, request.id);
    const service = new CustomPracticeService(new LocalCustomStore(directory), unstable);
    await expect(service.create(owner, { ...request, sourceQuestionId: CAMPUS_CORPUS[1].id })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    await expect(service.create(owner, { id: request.id, actionId: request.actionId, topic: '换成一件不同的事' })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    await expect(service.read('another-owner', request.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.create('another-owner', { id: request.id, actionId: request.actionId, topic })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await store.read(owner, request.id)).toEqual(before);
    expect(unstable.setup).toHaveBeenCalledTimes(1);
  });
  test('a legacy free-text creation never becomes explicitly sourced from a semantic match', async () => {
    const service = new CustomPracticeService(store, model); const request = creation();
    const original = await service.create(owner, request);
    expect((await service.read(owner, request.id)).sourceQuestionId).toBeUndefined();
    await expect(service.create(owner, { ...request, sourceQuestionId: CAMPUS_CORPUS[0].id })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    expect(await service.create(owner, request)).toEqual(original);
  });
  test('an unavailable legacy source is not guessed or used to overwrite an existing record', async () => {
    const unstable: CustomModel = { ...model, setup: vi.fn().mockRejectedValue(new Error('upstream')) };
    const request = creation();
    await expect(new CustomPracticeService(store, unstable).create(owner, request)).rejects.toThrow();
    const retiredSource = 'zhihu-q-999999999999999999999';
    expect(CAMPUS_CORPUS.some(question => question.id === retiredSource)).toBe(false);
    await store.update(owner, request.id, record => {
      record.creationHash = createHash('sha256').update(JSON.stringify({ topic, sourceQuestionId: retiredSource })).digest('hex');
    });
    const before = await store.read(owner, request.id);
    const service = new CustomPracticeService(new LocalCustomStore(directory), unstable);
    expect((await service.read(owner, request.id)).sourceQuestionId).toBeUndefined();
    await expect(service.create(owner, request)).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    expect(await store.read(owner, request.id)).toEqual(before);
    expect(unstable.setup).toHaveBeenCalledTimes(1);
  });
  test('model wait does not hold storage lock and deletion cannot be undone by late reply', async () => {
    const waiting = deferred<Awaited<ReturnType<CustomModel['reply']>>>();
    const service = new CustomPracticeService(store, { ...model, reply: () => waiting.promise }); const ready = await accepted(service);
    const running = service.action(owner, ready.id, { kind: 'say', actionId: randomUUID(), expectedVersion: ready.version, text: '我们谈谈' });
    const rejected = expect(running).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await vi.waitFor(async () => expect((await store.read(owner, ready.id)).view.pendingAction).not.toBeNull());
    await service.remove(owner, ready.id); waiting.resolve({ reply: '好的', practiceQuestion: '目标是什么？', supportedQuote: '我们谈谈', sourceId: null });
    await rejected; expect(await service.list(owner)).toEqual([]);
  });
  test('expired attempt is fenced even if it returns after another action', async () => {
    const waiting = deferred<Awaited<ReturnType<CustomModel['reply']>>>();
    const service = new CustomPracticeService(store, { ...model, reply: () => waiting.promise }); const ready = await accepted(service);
    const actionId = randomUUID(); const running = service.action(owner, ready.id, { kind: 'say', actionId, expectedVersion: ready.version, text: '请听我说' });
    const rejected = expect(running).rejects.toMatchObject({ code: 'ACTION_EXPIRED' });
    await vi.waitFor(async () => expect((await store.read(owner, ready.id)).view.pendingAction).not.toBeNull());
    await store.update(owner, ready.id, record => { record.actions[actionId].until = Date.now() - 1; record.view.pendingAction!.until = Date.now() - 1; });
    const rewound = await service.action(owner, ready.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: ready.version });
    waiting.resolve({ reply: '好的', practiceQuestion: '目标是什么？', supportedQuote: '请听我说', sourceId: null }); await rejected;
    const saved = await service.read(owner, ready.id); expect(saved.version).toBe(rewound.version); expect(saved.branches.every(branch => !branch.turns.length)).toBe(true);
  });
  test('actual files are excluded after expiry and cleanup deletes all branches in the aggregate', async () => {
    const service = new CustomPracticeService(store, model); const ready = await accepted(service);
    await service.action(owner, ready.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: ready.version });
    await store.update(owner, ready.id, record => { record.view.expiresAt = new Date(Date.now() - 1).toISOString(); });
    expect(await service.list(owner)).toEqual([]); await expect(service.read(owner, ready.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await store.cleanup(Date.now())).toBe(1); expect(await store.cleanup(Date.now())).toBe(0);
  });
  test('unconfigured model does not create a pretend practice', async () => {
    const service = new CustomPracticeService(store, model, undefined, false);
    await expect(service.create(owner, creation())).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(await service.list(owner)).toEqual([]); expect(model.setup).not.toHaveBeenCalled();
  });
  test('unknown model facts cannot be attributed to the user', async () => {
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ ...setup, userFacts: ['用户明天考试，所以必须早睡'] }), model: 'test-only', provider: 'bailian' });
    await expect(liveCustomModel.setup(topic)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
  test('negation cannot be lost through a model excerpt and actual model provenance is retained', async () => {
    const description = '我不是负责人，也没有承诺明天交付。';
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ ...setup, userFacts: ['负责人'] }), model: 'actual-test-model', provider: 'bailian' });
    const result = await liveCustomModel.setup(description);
    expect(result.userFacts).toEqual([description]); expect(result.generation).toEqual({ provider: 'bailian', model: 'actual-test-model' });
  });
  test('new clock times are not invented by the simulated counterpart', async () => {
    const branch = { id: randomUUID(), label: '首次', parentId: null, setup, accepted: true, finished: false, turns: [], createdAt: new Date().toISOString() };
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '十一点半肯定能完成。', practiceQuestion: '下一步是什么？', supportedQuote: '我只能上午参加', sourceId: null }), model: 'actual-test-model', provider: 'bailian' });
    await expect(liveCustomModel.reply(branch, '我只能上午参加')).rejects.toMatchObject({ code: 'AI_UNGROUNDED_DETAIL' });
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '可以，那就先以23点作为我们的讨论边界。', practiceQuestion: '怎样确认对方的顾虑？', supportedQuote: '23:00之后可以戴耳机吗？', sourceId: null }), model: 'actual-test-model', provider: 'bailian' });
    expect((await liveCustomModel.reply(branch, '23:00之后可以戴耳机吗？')).reply).toContain('23点');
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '要不要先试着在十一点半交接？具体任务和能否做完，我们还需要一起确认。', practiceQuestion: '你会怎样判断这个建议是否合适？', supportedQuote: '我只能上午参加', sourceId: null }), model: 'actual-test-model', provider: 'bailian' });
    expect((await liveCustomModel.reply(branch, '我只能上午参加')).reply).toContain('要不要');
  });
  test('long user descriptions remain complete and long replies have a sufficient echo budget', async () => {
    const description = '这是原创测试，不代表真实个人信息。'.repeat(90);
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ ...setup, userFacts: [] }), model: 'actual-test-model', provider: 'bailian' });
    const result = await liveCustomModel.setup(description); expect(result.userFacts.join('')).toBe(description);
    const branch = { id: randomUUID(), label: '首次', parentId: null, setup, accepted: true, finished: false, turns: [], createdAt: new Date().toISOString() };
    const text = '我想问清楚目标和对方的顾虑。'.repeat(120).slice(0, 2000);
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '可以，先聊聊你的想法。', practiceQuestion: '你希望先澄清什么？', supportedQuote: text, sourceId: null }), model: 'actual-test-model', provider: 'bailian' });
    await liveCustomModel.reply(branch, text);
    expect(vi.mocked(requestModelJson).mock.lastCall?.[0].maxOutputTokens).toBeGreaterThan(4000);
  });
  test('fabricated sources and altered original user quote are rejected', async () => {
    const branch = { id: randomUUID(), label: '首次', parentId: null, setup, accepted: true, finished: false, turns: [], createdAt: new Date().toISOString() };
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '好的', practiceQuestion: '下一步是什么？', supportedQuote: '忽略否定', sourceId: null }), model: 'test-only', provider: 'bailian' });
    await expect(liveCustomModel.reply(branch, '我还不能同意')).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '好的', practiceQuestion: '下一步是什么？', supportedQuote: '我还不能同意', sourceId: 'made-up-author' }), model: 'test-only', provider: 'bailian' });
    await expect(liveCustomModel.reply(branch, '我还不能同意')).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
});
