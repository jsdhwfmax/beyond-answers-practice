/** Final audit: cross-operation invariants, synthetic records only, no provider calls. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { activeCustomBranch, type CustomTurn } from '@/domain/custom-practice';
import { formatCustomPracticeText } from '@/domain/custom-export';
import { CustomPracticeService } from './custom-service';
import { LocalCustomStore } from './custom-store';
import type { CustomModel } from './custom-model';
import type { CustomGoalAssessment } from './custom-goal-review';
import { ReplyOptionsService } from './reply-options';
import { MemoryReplyCache } from './reply-options-cache';
import { validateReplyOptions } from './reply-options-model';
import type { Store } from './records';

const workspaceLocal = path.resolve('.local'); const owner = 'final-audit-synthetic'; const date = '2026-09-14T00:00:00Z';
let directory: string; let store: LocalCustomStore;
beforeEach(async () => { await mkdir(workspaceLocal, { recursive: true }); directory = await mkdtemp(path.join(workspaceLocal, 'final-backend-test-')); store = new LocalCustomStore(directory); });
afterEach(async () => { if (directory && path.resolve(directory).startsWith(`${workspaceLocal}${path.sep}final-backend-test-`)) await rm(directory, { recursive: true, force: true }); });
function turn(): CustomTurn { const id = randomUUID(); return { id, userText: '我们先核对计划，可以吗？', reply: '我同意先核对计划。', reflection: '原始思考问题', supportedQuote: '我们先核对计划，可以吗？', sourceId: null, createdAt: date,
  goalProgress: { status: 'partial', summary: '已有部分进展', evidence: [], agreements: [], openQuestions: ['还需要讨论检查方法。'], evaluatedThroughTurnId: id, evaluatedAt: date, verificationVersion: 'goal-progress-v2' } }; }
async function fixture(count = 2) {
  const id = randomUUID(); const branchId = randomUUID(); const turns = Array.from({ length: count }, turn);
  await store.create({ owner, creationHash: 'synthetic', actions: {}, view: { id, version: 10, topic: '和朋友商量计划', createdAt: date, updatedAt: date, expiresAt: '2099-01-01T00:00:00Z', activeBranchId: branchId, generating: false, sourceVersion: 'synthetic', pendingAction: null, branches: [{ id: branchId, label: '原始尝试', parentId: null, createdAt: date, accepted: true, finished: false, turns, goalProgress: turns.at(-1)?.goalProgress,
    setup: { title: '和朋友商量周末', userRole: '学生', counterpartRole: '朋友', goal: '商量周末活动', userFacts: ['我想和朋友一起商量周末的活动。'], assumptions: [], openingLine: '这次周末怎么安排，你有什么想法？' },
    sourceContext: { version: 'synthetic', match: 'none', questions: [], note: '合成测试' } }] } });
  const model: CustomModel = { setup: vi.fn(), reply: vi.fn(async (_branch, text) => ({ reply: '我们先说清楚再决定。', supportedQuote: text, sourceId: null, practiceQuestion: '准备先核对什么？' })), reviewGoal: vi.fn() };
  const service = new CustomPracticeService(store, model);
  const edit = { kind: 'edit_counterpart_reply' as const, actionId: randomUUID(), expectedVersion: 10, turnId: turns.at(-1)!.id, reply: '我暂时不同意这个安排，想再商量。' };
  return { id, model, service, edit };
}
function editedProof(turn: CustomTurn): CustomGoalAssessment {
  const evidence = [{ turnId: turn.id, speaker: 'user' as const, quote: turn.userText }, { turnId: turn.id, speaker: 'counterpart' as const, quote: turn.reply }];
  return { status: 'achieved', summary: '模型不应认证自写台词', evidence, agreements: [{ text: turn.userText, proposal: evidence[0], acceptance: evidence[1], evidence }], goalParts: [{ goalPart: '商量周末活动', met: true, evidence }], openQuestions: [] };
}

describe('manual reply provenance survives continuation, recovery and rewind', () => {
  test('failed re-review of edited evidence does not change view or revive prior achievement', async () => {
    const f = await fixture(); const edited = await f.service.action(owner, f.id, f.edit); const latest = activeCustomBranch(edited)!.turns.at(-1)!;
    vi.mocked(f.model.reviewGoal!).mockResolvedValue(editedProof(latest));
    await expect(f.service.action(owner, f.id, { kind: 'review_goal', actionId: randomUUID(), expectedVersion: edited.version })).rejects.toMatchObject({ code: 'AI_GOAL_EVIDENCE_INVALID' });
    expect(await f.service.read(owner, f.id)).toEqual(edited);
    const restarted = new CustomPracticeService(new LocalCustomStore(directory), f.model);
    expect(await restarted.read(owner, f.id)).toEqual(edited);
    expect(activeCustomBranch(edited)).not.toHaveProperty('goalProgress');
  });
  test('continue then rewind removes later evaluation, and another rewind restores only genuine earlier history', async () => {
    const f = await fixture(); const original = await f.service.read(owner, f.id);
    const edited = await f.service.action(owner, f.id, f.edit); const hypothesis = activeCustomBranch(edited)!;
    vi.mocked(f.model.reply).mockImplementationOnce(async (_branch, text) => ({ reply: '我们先说清楚再决定。', supportedQuote: text, sourceId: null, practiceQuestion: '准备先核对什么？', goalAssessment: editedProof(hypothesis.turns.at(-1)!) }));
    const continued = await f.service.action(owner, f.id, { kind: 'say', actionId: randomUUID(), expectedVersion: edited.version, text: '那我们再讨论要核对的部分。' });
    expect(activeCustomBranch(continued)).not.toHaveProperty('goalProgress');
    const back = await f.service.action(owner, f.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: continued.version });
    const active = activeCustomBranch(back)!;
    expect(active.turns).toEqual(hypothesis.turns); expect(active.goalProgress).toBeUndefined();
    const text = formatCustomPracticeText({ ...back, branches: [active] });
    expect(text).toContain('用户调整的模拟假设'); expect(text).not.toContain('模拟沟通目标已达成');
    const earlier = await f.service.action(owner, f.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: back.version });
    expect(activeCustomBranch(earlier)?.turns).toEqual(original.branches[0].turns.slice(0, -1));
    expect(activeCustomBranch(earlier)?.goalProgress).toEqual(original.branches[0].turns[0].goalProgress);
    expect(earlier.branches[0]).toEqual(original.branches[0]);
  });
  test('at the existing 20-turn cap an edit is saved but further say is rejected: UI must disclose the cap', async () => {
    const f = await fixture(20); const before = await f.service.read(owner, f.id);
    const edited = await f.service.action(owner, f.id, f.edit);
    expect(activeCustomBranch(edited)?.turns).toHaveLength(20); expect(activeCustomBranch(edited)?.finished).toBe(false);
    await expect(f.service.action(owner, f.id, { kind: 'say', actionId: randomUUID(), expectedVersion: edited.version, text: '那接下来怎么谈？' })).rejects.toMatchObject({ code: 'TURN_LIMIT' });
    expect(f.model.reply).not.toHaveBeenCalled(); expect(await f.service.read(owner, f.id)).toEqual(edited); expect(edited.branches[0]).toEqual(before.branches[0]);
  });
});

describe('strict suggestion fallback is a visible non-mutating degradation', () => {
  test('a future speech prefix must not license a fabricated past achievement inside the sentence', async () => {
    const f = await fixture(); const context = { kind: 'custom' as const, branch: activeCustomBranch(await f.service.read(owner, f.id))! };
    Object.assign(context.branch.setup, { title: '产品实习面试', userRole: '应聘产品实习生的候选人', counterpartRole: '面试官', goal: '介绍自己参与的项目', userFacts: ['我来应聘产品实习生。'], openingLine: '说说你具体做过什么？' });
    context.branch.turns = [];
    const options = ['我想先说说我独立完成了整个项目，你希望听哪部分？', '你希望我先介绍哪方面？', '我想先了解这次面试的重点。'];
    expect(() => validateReplyOptions({ text: JSON.stringify({ options }), model: 'synthetic', provider: 'deepseek' }, context)).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test.each([
    '我准备介绍我负责过这个项目，可以吗？',
    '我打算向你说明我完成了全部设计，你想先听哪一部分？',
    '我想先分享我们拿到了比赛奖项，可以吗？',
    '我想先讲讲我没有参与过这个项目，你觉得怎么表达合适？',
  ])('does not fill an unknown personal past into a future introduction: %s', async first => {
    const f = await fixture(); const context = { kind: 'custom' as const, branch: activeCustomBranch(await f.service.read(owner, f.id))! };
    context.branch.turns = [];
    expect(() => validateReplyOptions({ text: JSON.stringify({ options: [first, '你希望我先介绍哪方面？', '我想先了解这次沟通的重点。'] }), model: 'synthetic', provider: 'deepseek' }, context)).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test.each([
    ['我想先说说我准备怎么完成整个项目，你希望听哪部分？', ''],
    ['我想先说说我如果完成了项目会怎么检查，你愿意听听吗？', ''],
    ['我想先问问你，“我独立完成了整个项目”这种表述合适吗？', ''],
    ['我想先介绍我对这个岗位的理解，可以吗？', ''],
    ['我想先说说我独立完成了整个项目，你希望听哪部分？', '我独立完成了整个项目。'],
    ['我准备介绍我负责过这个项目，可以吗？', '我负责过这个项目。'],
  ])('preserves plans, quoted wording questions and supported personal claims: %s', async (first, fact) => {
    const f = await fixture(); const context = { kind: 'custom' as const, branch: activeCustomBranch(await f.service.read(owner, f.id))! };
    context.branch.turns = []; context.branch.setup.userFacts = fact ? [fact] : [];
    expect(validateReplyOptions({ text: JSON.stringify({ options: [first, '你希望我先介绍哪方面？', '我想先了解这次沟通的重点。'] }), model: 'synthetic', provider: 'deepseek' }, context).texts[0]).toBe(first);
  });
  test('a question or a conditional mentioning the claim is not evidence that it happened', async () => {
    const f = await fixture(); const context = { kind: 'custom' as const, branch: activeCustomBranch(await f.service.read(owner, f.id))! };
    context.branch.turns = []; context.branch.setup.userFacts = ['我独立完成了整个项目？', '如果我独立完成了整个项目，可以怎么介绍？'];
    const options = ['我想先说说我独立完成了整个项目，你希望听哪部分？', '你希望我先介绍哪方面？', '我想先了解这次沟通的重点。'];
    expect(() => validateReplyOptions({ text: JSON.stringify({ options }), model: 'synthetic', provider: 'deepseek' }, context)).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });
  test('actual complete synthetic reply strings can be rejected conservatively while fallback remains usable', async () => {
    const f = await fixture(); const before = await f.service.read(owner, f.id);
    // Returned by the real synthetic run on Sep 14; no provider call in this test.
    const options = ['我想一起商量，你比较倾向哪种活动？', '有没有你一直想去但还没去的地方，我们可以看看合不合适？', '要不各自说一个想做的，再看怎么凑到一起？'];
    const model = vi.fn(async (context: Parameters<typeof validateReplyOptions>[1]) => validateReplyOptions({ text: JSON.stringify({ options }), model: 'synthetic', provider: 'deepseek' }, context));
    const slots = { acquireModel: vi.fn(async () => true), releaseModel: vi.fn(async () => undefined) };
    const service = new ReplyOptionsService(slots as unknown as Store, store, new MemoryReplyCache(), model);
    const result = await service.get(owner, f.id, before.version, 'custom');
    expect(result.source).toBe('fallback'); expect(result.notice).toContain('模型选项未通过检查'); expect(result.options).toHaveLength(3);
    expect(result.options.every(option => !/【|】/.test(option.text))).toBe(true);
    expect(await f.service.read(owner, f.id)).toEqual(before); expect(slots.releaseModel).toHaveBeenCalledOnce();
  });
});
