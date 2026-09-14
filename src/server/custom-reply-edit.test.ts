import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { activeCustomBranch, customActionSchema, CUSTOM_SCENE_GUIDE, type CustomBranch, type CustomTurn } from '@/domain/custom-practice';
import { formatCustomPracticeText } from '@/domain/custom-export';
import { CustomPracticeService } from './custom-service';
import { LocalCustomStore } from './custom-store';
import { customConversationContext, type CustomModel } from './custom-model';
import { checkedGoalProgress, type CustomGoalAssessment } from './custom-goal-review';
import { replyModelContext } from './reply-options-model';

const root = path.resolve('.local'); const owner = 'synthetic-edit-owner'; const date = '2026-09-14T00:00:00Z';
let directory: string; let store: LocalCustomStore;
const model: CustomModel = { setup: vi.fn(), reply: vi.fn(), reviewGoal: vi.fn() };
const slots = { acquireModel: vi.fn(async () => true), releaseModel: vi.fn(async () => undefined) };
const turn = (): CustomTurn => ({ id: randomUUID(), userText: '我们先核对计划，再讨论时间，可以吗？', reply: '我想先听听你希望改哪一部分。', reflection: '原模型思考问题', supportedQuote: '原模型支持片段', sourceId: 'old-source', createdAt: date, generatedBy: { provider: 'deepseek', model: 'synthetic' } });
async function fixture() {
  const first = turn(); const latest = turn(); const sceneId = randomUUID(); latest.sceneId = sceneId;
  const progress = { status: 'achieved' as const, summary: '旧评估', evidence: [], agreements: [], openQuestions: [], evaluatedThroughTurnId: latest.id, evaluatedAt: date };
  latest.goalProgress = progress;
  const branch: CustomBranch = { id: randomUUID(), label: '首次尝试', parentId: null, accepted: true, finished: false, createdAt: date,
    setup: { title: '和朋友商量计划', userRole: '学生', counterpartRole: '朋友', goal: '约定核对计划', userFacts: [], assumptions: [], openingLine: '你想怎么谈？' },
    turns: [first, latest], scenes: [{ id: sceneId, label: '接着讨论', openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE, turnIndex: 1, createdAt: date }],
    goalProgress: progress, sourceContext: { match: 'none', questions: [], version: 'synthetic', note: '无来源合成测试' } };
  const id = randomUUID();
  await store.create({ owner, creationHash: 'synthetic-edit', actions: {}, view: { id, version: 7, topic: branch.setup.title, createdAt: date, updatedAt: date, expiresAt: '2099-01-01T00:00:00Z', activeBranchId: branch.id, branches: [branch], generating: false, sourceVersion: 'synthetic', pendingAction: null } });
  const action = { kind: 'edit_counterpart_reply' as const, actionId: randomUUID(), expectedVersion: 7, turnId: latest.id, reply: '我同意这个安排。' };
  return { id, branch, latest, action, service: new CustomPracticeService(store, model, slots, false) };
}
beforeEach(async () => { await mkdir(root, { recursive: true }); directory = await mkdtemp(path.join(root, 'custom-reply-edit-test-')); store = new LocalCustomStore(directory); vi.clearAllMocks(); });
afterEach(async () => { if (directory && path.resolve(directory).startsWith(`${root}${path.sep}custom-reply-edit-test-`)) await rm(directory, { recursive: true, force: true }); });

describe('editing counterpart speech forks a durable hypothetical branch', () => {
  test('keeps the original byte-equivalent data, clears stale evaluation, and restores without a model', async () => {
    const f = await fixture(); const before = await store.read(owner, f.id);
    const view = await f.service.action(owner, f.id, f.action); const next = activeCustomBranch(view)!;
    expect(view.version).toBe(8); expect(view.branches).toHaveLength(2); expect(view.branches[0]).toEqual(before.view.branches[0]);
    expect(next.id).not.toBe(f.branch.id); expect(next.parentId).toBe(f.branch.id); expect(next.label).toContain('调整对方回应');
    expect(next.finished).toBe(false); expect(next.accepted).toBe(true); expect(next.scenes).toEqual(f.branch.scenes); expect(next.turns[0]).toEqual(f.branch.turns[0]);
    expect(next.turns[1]).toMatchObject({ id: f.action.actionId, userText: f.latest.userText, reply: f.action.reply, reflection: '', supportedQuote: '', sourceId: null, sceneId: f.latest.sceneId, replyOrigin: { kind: 'user_edit', branchId: f.branch.id, turnId: f.latest.id } });
    expect(next.turns[1]).not.toHaveProperty('generatedBy'); expect(next.turns[1]).not.toHaveProperty('goalProgress'); expect(next).not.toHaveProperty('goalProgress');
    expect(await new CustomPracticeService(new LocalCustomStore(directory), model, slots, false).read(owner, f.id)).toEqual(view);
    expect(model.reply).not.toHaveBeenCalled(); expect(model.reviewGoal).not.toHaveBeenCalled(); expect(slots.acquireModel).not.toHaveBeenCalled();
    const exported = formatCustomPracticeText(view);
    expect(exported).toContain('用户调整的模拟假设，不作为已达成依据'); expect(exported).toContain(f.latest.reply); expect(exported).toContain(f.action.reply);
  });
  test('ten duplicate requests create exactly one branch; changed payload conflicts even after completion', async () => {
    const f = await fixture(); await Promise.all(Array.from({ length: 10 }, () => f.service.action(owner, f.id, f.action)));
    const saved = await f.service.read(owner, f.id); expect(saved.branches).toHaveLength(2); expect(saved.version).toBe(8);
    await expect(f.service.action(owner, f.id, { ...f.action, reply: '另一句回应。' })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    const finished = await f.service.action(owner, f.id, { kind: 'finish', actionId: randomUUID(), expectedVersion: 8 });
    expect(await f.service.action(owner, f.id, f.action)).toEqual(finished);
  });
  test('a finished branch can be adjusted without reopening the original report', async () => {
    const f = await fixture(); await store.update(owner, f.id, record => { record.view.branches[0].finished = true; });
    const saved = await f.service.action(owner, f.id, f.action);
    expect(saved.branches[0].finished).toBe(true); expect(activeCustomBranch(saved)?.finished).toBe(false);
  });
  test('a second edit points to its immediate original and preserves both earlier branches', async () => {
    const f = await fixture(); const first = await f.service.action(owner, f.id, f.action); const edited = activeCustomBranch(first)!;
    const second = await f.service.action(owner, f.id, { ...f.action, actionId: randomUUID(), expectedVersion: first.version, turnId: edited.turns.at(-1)!.id, reply: '我还想讨论具体怎么核对。' });
    expect(second.branches.slice(0, 2)).toEqual(first.branches);
    expect(activeCustomBranch(second)?.turns.at(-1)?.replyOrigin).toEqual({ kind: 'user_edit', branchId: edited.id, turnId: f.action.actionId });
  });
  test.each(['foreign-owner', 'stale-version', 'earlier-turn', 'unknown-turn', 'empty-current-scene', 'unaccepted', 'empty-branch', 'whitespace-only-change', 'branch-limit', 'pending-action'])('%s cannot mutate the record', async kind => {
    const f = await fixture(); let requestOwner = owner; const action = { ...f.action };
    if (kind === 'foreign-owner') requestOwner = 'another-owner';
    if (kind === 'stale-version') action.expectedVersion--;
    if (kind === 'earlier-turn') action.turnId = f.branch.turns[0].id;
    if (kind === 'unknown-turn') action.turnId = randomUUID();
    if (kind === 'whitespace-only-change') action.reply = ` \n${f.latest.reply.split('').join(' ')}\t `;
    await store.update(owner, f.id, record => {
      const active = activeCustomBranch(record.view)!;
      if (kind === 'empty-current-scene') active.scenes!.push({ id: randomUUID(), label: '明天', turnIndex: active.turns.length, openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE, createdAt: date });
      if (kind === 'unaccepted') active.accepted = false;
      if (kind === 'empty-branch') active.turns = [];
      if (kind === 'branch-limit') record.view.branches.push(...Array.from({ length: 11 }, () => ({ ...structuredClone(active), id: randomUUID() })));
      if (kind === 'pending-action') record.view.pendingAction = { actionId: randomUUID(), until: Date.now() + 60_000 };
    });
    const before = await store.read(owner, f.id);
    await expect(f.service.action(requestOwner, f.id, action)).rejects.toHaveProperty('code');
    expect(await store.read(owner, f.id)).toEqual(before); expect(model.reply).not.toHaveBeenCalled(); expect(slots.acquireModel).not.toHaveBeenCalled();
  });
  test('strict input rejects empty/oversized replies, non-UUID targets and injected origin', async () => {
    const f = await fixture();
    for (const replacement of [{ reply: '  ' }, { reply: '字'.repeat(1201) }, { turnId: 'not-a-turn-id' }, { replyOrigin: { kind: 'model' } }]) expect(customActionSchema.safeParse({ ...f.action, ...replacement }).success).toBe(false);
    expect(customActionSchema.safeParse({ ...f.action, reply: '字'.repeat(1200) }).success).toBe(true);
  });
  test('a later real model turn retains the hypothesis history but has its own provenance', async () => {
    const f = await fixture(); const edited = await f.service.action(owner, f.id, f.action);
    vi.mocked(model.reply).mockImplementationOnce(async (_branch, text) => ({ reply: '可以先核对计划。', practiceQuestion: '准备怎么核对？', supportedQuote: text, sourceId: null, generation: { provider: 'deepseek', model: 'synthetic' } }));
    const service = new CustomPracticeService(store, model, slots, true);
    const saved = await service.action(owner, f.id, { kind: 'say', actionId: randomUUID(), expectedVersion: edited.version, text: '那我们先核对什么？' });
    expect(vi.mocked(model.reply).mock.lastCall?.[0].turns.at(-1)?.replyOrigin?.kind).toBe('user_edit');
    expect(activeCustomBranch(saved)?.turns.at(-1)?.replyOrigin).toBeUndefined();
    expect(saved.branches[0]).toEqual(edited.branches[0]);
  });
});

function agreementAssessment(proposal: CustomTurn, acceptance: CustomTurn): CustomGoalAssessment {
  const a = { turnId: proposal.id, speaker: 'user' as const, quote: proposal.userText };
  const b = { turnId: acceptance.id, speaker: 'counterpart' as const, quote: acceptance.reply };
  return { status: 'achieved', summary: '已谈妥', evidence: [a, b], agreements: [{ text: a.quote, evidence: [a, b], proposal: a, acceptance: b }], openQuestions: [], goalParts: [{ goalPart: '约定核对计划', met: true, evidence: [a, b] }] };
}
describe('user edits cannot certify a counterpart commitment', () => {
  test('immediate and later reviews cannot reuse the edited counterpart as proof', async () => {
    const f = await fixture(); const view = await f.service.action(owner, f.id, f.action); const branch = activeCustomBranch(view)!; const edited = branch.turns.at(-1)!;
    expect(checkedGoalProgress(branch, agreementAssessment(edited, edited))).toBeUndefined();
    const future = { ...turn(), reply: '我们可以继续谈。' };
    expect(checkedGoalProgress(branch, agreementAssessment(edited, edited), future)).toBeUndefined();
  });
  test('actual user words remain evidence and a later independent model acceptance can be certified', async () => {
    const f = await fixture(); const view = await f.service.action(owner, f.id, f.action); const branch = activeCustomBranch(view)!; const edited = branch.turns.at(-1)!;
    const future = { ...turn(), userText: '你愿意按这个安排试吗？', reply: '我同意这个安排。' };
    const result = checkedGoalProgress(branch, agreementAssessment(edited, future), future);
    expect(result?.status).toBe('achieved'); expect(result?.agreements).toHaveLength(1);
    expect(result?.agreements[0].certification?.acceptance.turnId).toBe(future.id);
  });
  test('both model contexts retain the edit mark; an edited invitation is not an accepted appointment shortcut', async () => {
    const f = await fixture(); const view = await f.service.action(owner, f.id, { ...f.action, reply: '今天下午三点，你方便吗？' }); const branch = activeCustomBranch(view)!;
    branch.turns.push({ ...turn(), userText: '好的', reply: '还需要再确认。' });
    const context = customConversationContext(branch);
    expect(context.history[1]).toHaveProperty('replyOrigin.kind', 'user_edit'); expect(context.currentSceneDialogue[0]).toHaveProperty('replyOrigin.kind', 'user_edit');
    expect(context).toHaveProperty('editedRepliesBoundary');
    const replies = replyModelContext({ kind: 'custom', branch });
    expect(replies).toMatchObject({ avoidRepeatingTimeConfirmation: false });
    expect('latestDialogue' in replies && replies.latestDialogue[0]).toHaveProperty('replyOrigin.kind', 'user_edit');
  });
});
