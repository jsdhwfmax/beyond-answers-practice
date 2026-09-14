import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as customDomain from '@/domain/custom-practice';
import { activeCustomBranch, activeCustomScene, CUSTOM_SCENE_GUIDE, customSceneReadiness, suggestedCustomSceneLabel, type CustomBranch, type CustomSetup } from '@/domain/custom-practice';
import { CustomPracticeService } from './custom-service';
import { LocalCustomStore } from './custom-store';
import { customQuantities, hasUngroundedCustomAssertion, liveCustomModel, postponesActiveCustomScene, validateCustomSceneOpening, type CustomModel, type CustomReply } from './custom-model';
import { requestModelJson } from './model-provider';

vi.mock('./model-provider', () => ({ requestModelJson: vi.fn(), modelConfiguration: () => ({ configured: false, provider: null, model: 'test-only' }) }));
const root = path.resolve('.local');
const owner = 'synthetic-scene-owner';
const setup: CustomSetup = {
  title: '向招聘负责人了解筛选原因', userRole: '候选人', counterpartRole: '公司招聘负责人（HR）',
  goal: '询问筛选原因，并建议招聘信息提前说明要求',
  userFacts: ['我想向HR了解筛选原因。'], assumptions: ['HR愿意在模拟中听取候选人的问题'],
  openingLine: '你好，你想了解招聘筛选的哪一部分？',
};
const destination = '今天下午三点，开始与 HR 面谈';
let directory: string; let store: LocalCustomStore;
const model: CustomModel = {
  setup: vi.fn(async () => structuredClone(setup)),
  reply: vi.fn(async (_branch, text) => ({ reply: '好的，那就今天下午三点用15分钟聊聊筛选原因。', practiceQuestion: '你准备先问什么？', supportedQuote: text, sourceId: null })),
  advanceScene: vi.fn(async () => ({ openingLine: '我们开始吧。你想先了解学历要求如何影响这次筛选，还是想谈招聘信息的表述？' })),
};
beforeEach(async () => { await mkdir(root, { recursive: true }); directory = await mkdtemp(path.join(root, 'custom-scene-test-')); store = new LocalCustomStore(directory); vi.clearAllMocks(); });
afterEach(async () => { vi.restoreAllMocks(); if (directory && path.resolve(directory).startsWith(`${root}${path.sep}custom-scene-test-`)) await rm(directory, { recursive: true, force: true }); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function ready(service: CustomPracticeService) {
  const created = await service.create(owner, { id: randomUUID(), actionId: randomUUID(), topic: '我想向HR了解筛选原因。' });
  const accepted = await service.action(owner, created.id, { kind: 'accept_setup', actionId: randomUUID(), expectedVersion: created.version, setup });
  return service.action(owner, accepted.id, { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text: '可以今天下午三点聊15分钟吗？' });
}

describe('durable simulated scene progression', () => {
  test('accepting a setup is not a conversation and cannot create an empty first transition', async () => {
    const service = new CustomPracticeService(store, model);
    const created = await service.create(owner, { id: randomUUID(), actionId: randomUUID(), topic: '我想向HR了解筛选原因。' });
    const accepted = await service.action(owner, created.id, { kind: 'accept_setup', actionId: randomUUID(), expectedVersion: created.version, setup });
    const actionId = randomUUID();
    await expect(service.action(owner, created.id, { kind: 'advance_scene', actionId, expectedVersion: accepted.version, label: destination })).rejects.toMatchObject({ code: 'SCENE_NEEDS_DIALOGUE' });
    expect(await service.read(owner, created.id)).toEqual(accepted);
    expect((await store.read(owner, created.id)).actions[actionId]).toBeUndefined();
    expect(model.advanceScene).not.toHaveBeenCalled();
  });
  test('old records without scenes advance into a meeting, retain the agreement, and resume there after refresh', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    expect(activeCustomBranch(before)?.scenes).toBeUndefined();
    const advanced = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination });
    const branch = activeCustomBranch(advanced)!;
    expect(branch.turns).toEqual(activeCustomBranch(before)?.turns);
    expect(activeCustomScene(branch)).toMatchObject({ label: destination, turnIndex: 1, openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE });
    expect(activeCustomScene(branch)).not.toHaveProperty('generatedBy');
    const restored = new CustomPracticeService(new LocalCustomStore(directory), model);
    expect(await restored.read(owner, before.id)).toEqual(advanced);
    const next = await restored.action(owner, before.id, { kind: 'say', actionId: randomUUID(), expectedVersion: advanced.version, text: '请问第一学历在这次筛选中起了什么作用？' });
    expect(vi.mocked(model.reply).mock.lastCall?.[0].scenes).toEqual(branch.scenes);
    expect(activeCustomBranch(next)?.turns.at(-1)?.sceneId).toBe(branch.scenes![0].id);
    expect(activeCustomBranch(next)?.finished).toBe(false);
  });
  test('ten repeated advances save one code-owned guide; changed payload with same action id conflicts', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    const action = { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination };
    await Promise.all(Array.from({ length: 10 }, () => service.action(owner, before.id, action)));
    const saved = await service.read(owner, before.id);
    expect(saved.version).toBe(before.version + 1); expect(activeCustomBranch(saved)?.scenes).toHaveLength(1);
    expect(model.advanceScene).not.toHaveBeenCalled();
    await expect(service.action(owner, before.id, { ...action, label: '第二天，开始下一次谈话' })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    await service.action(owner, before.id, { kind: 'finish', actionId: randomUUID(), expectedVersion: saved.version });
    expect(activeCustomBranch(await service.action(owner, before.id, action))?.scenes).toHaveLength(1);
  });
  test('ownership and stale versions cannot advance or call the model', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    const action = { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination };
    await expect(service.action('unrelated-owner', before.id, action)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.action(owner, before.id, { ...action, expectedVersion: before.version - 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(model.advanceScene).not.toHaveBeenCalled();
  });
  test.each(['进入约定的下一幕', '进入这次谈话之后的下一幕', '进入下一幕', '下一幕', ' 推进时间 / 进入下一幕 '])('an old navigation placeholder %s cannot masquerade as a destination', async label => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    await expect(service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label })).rejects.toMatchObject({ code: 'SCENE_DESTINATION_REQUIRED' });
    expect(await service.read(owner, before.id)).toEqual(before);
    expect(model.advanceScene).not.toHaveBeenCalled();
  });
  test('rewind removes the newest action in order and preserves the old scene and its conversation', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    const advanced = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination });
    const original = structuredClone(activeCustomBranch(advanced)!);
    const back = await service.action(owner, before.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: advanced.version });
    expect(back.branches[0]).toEqual(original); expect(activeCustomBranch(back)?.scenes).toEqual([]);
    expect(activeCustomBranch(back)?.turns).toEqual(original.turns);
    const switched = await service.action(owner, before.id, { kind: 'switch_branch', actionId: randomUUID(), expectedVersion: back.version, branchId: original.id });
    const said = await service.action(owner, before.id, { kind: 'say', actionId: randomUUID(), expectedVersion: switched.version, text: '我先询问筛选标准。' });
    const rewoundTurn = await service.action(owner, before.id, { kind: 'rewind', actionId: randomUUID(), expectedVersion: said.version });
    expect(activeCustomBranch(rewoundTurn)?.scenes).toEqual(original.scenes);
    expect(activeCustomBranch(rewoundTurn)?.turns).toEqual(original.turns);
    expect(rewoundTurn.branches.find(branch => branch.id === original.id)?.turns).toHaveLength(2);
  });
  test('model-generated guide claims are never consulted or saved', async () => {
    const spoof: CustomModel = { ...model, advanceScene: vi.fn(async () => ({ openingKind: 'guide' as const, openingLine: '你发我的简历我提前看过了。', generation: { provider: 'bailian' as const, model: 'spoofed-model' } })) };
    const service = new CustomPracticeService(store, spoof); const before = await ready(service);
    const action = { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination };
    const saved = await service.action(owner, before.id, action);
    expect(activeCustomScene(activeCustomBranch(saved))).toMatchObject({ openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE });
    expect(activeCustomScene(activeCustomBranch(saved))).not.toHaveProperty('generatedBy');
    expect(JSON.stringify(saved)).not.toContain('你发我的简历');
    expect(spoof.advanceScene).not.toHaveBeenCalled();
  });
  test('a guide respects a real reply in flight and cannot jump across its uncommitted user turn', async () => {
    const before = await ready(new CustomPracticeService(store, model));
    const wait = deferred<CustomReply>(); const service = new CustomPracticeService(store, { ...model, reply: () => wait.promise });
    const running = service.action(owner, before.id, { kind: 'say', actionId: randomUUID(), expectedVersion: before.version, text: '我再问一个问题。' });
    try {
      await vi.waitFor(async () => expect((await store.read(owner, before.id)).view.pendingAction).not.toBeNull());
      await expect(service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination })).rejects.toMatchObject({ code: 'ACTION_BUSY' });
      expect(activeCustomBranch(await service.read(owner, before.id))?.scenes).toBeUndefined();
    } finally {
      wait.resolve({ reply: '请说。', practiceQuestion: '你想核对什么？', supportedQuote: '我再问一个问题。', sourceId: null }); await running;
    }
  });
  test('a ready guide needs neither model configuration nor a free model slot, while a new reply still does', async () => {
    const before = await ready(new CustomPracticeService(store, model));
    const slots = { acquireModel: vi.fn(async () => false), releaseModel: vi.fn(async () => undefined) };
    const service = new CustomPracticeService(store, model, slots, false);
    const action = { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination };
    const saved = await service.action(owner, before.id, action);
    expect(saved.version).toBe(before.version + 1); expect(saved.pendingAction).toBeNull(); expect(saved.generating).toBe(false);
    expect(activeCustomBranch(saved)?.scenes).toHaveLength(1);
    expect(await service.action(owner, before.id, action)).toEqual(saved);
    expect(slots.acquireModel).not.toHaveBeenCalled(); expect(slots.releaseModel).not.toHaveBeenCalled();
    await expect(service.action(owner, before.id, { kind: 'say', actionId: randomUUID(), expectedVersion: saved.version, text: '现在开始讨论吧。' })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });
  test('does not repeatedly advance into an identical current scene', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    const advanced = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination });
    await expect(service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: advanced.version, label: destination })).rejects.toMatchObject({ code: 'SCENE_UNCHANGED' });
    expect(model.advanceScene).not.toHaveBeenCalled();
  });
  test('older dialogue cannot unlock an empty later scene; its own reply unlocks an exact custom destination', async () => {
    const nextDestination = '下周二，和 HR 当面核对公开招聘要求';
    const advancedModel: CustomModel = { ...model, advanceScene: vi.fn().mockImplementationOnce(model.advanceScene!).mockResolvedValueOnce({ openingLine: '我们先一起看岗位上写明的条件。你觉得哪一条需要说得更清楚？' }) };
    const service = new CustomPracticeService(store, advancedModel); const before = await ready(service);
    const first = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination });
    await expect(service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: first.version, label: nextDestination })).rejects.toMatchObject({ code: 'SCENE_NEEDS_DIALOGUE' });
    expect(advancedModel.advanceScene).not.toHaveBeenCalled();
    expect(await service.read(owner, before.id)).toEqual(first);
    const spoken = await service.action(owner, before.id, { kind: 'say', actionId: randomUUID(), expectedVersion: first.version, text: '下周二一起看看公开招聘要求里没有写明的条件，可以吗？' });
    const second = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: spoken.version, label: nextDestination });
    expect(advancedModel.advanceScene).not.toHaveBeenCalled();
    expect(activeCustomScene(activeCustomBranch(second))?.openingLine).toBe(activeCustomScene(activeCustomBranch(first))?.openingLine);
    expect(activeCustomScene(activeCustomBranch(second))).toMatchObject({ label: nextDestination, turnIndex: 2 });
    expect(activeCustomBranch(second)?.turns).toEqual(activeCustomBranch(spoken)?.turns);
    expect(activeCustomBranch(second)?.goalProgress).toEqual(activeCustomBranch(spoken)?.goalProgress);
    expect(customSceneReadiness(activeCustomBranch(second))).toMatchObject({ ready: false, turnsInScene: 0 });
  });
  test.each([{ openingKind: 'guide' }, { openingLine: '我已经读过你的简历。' }])('client-supplied scene opening fields are not trusted: %j', extra => {
    expect(customDomain.customActionSchema.safeParse({ kind: 'advance_scene', actionId: randomUUID(), expectedVersion: 1, label: destination, ...extra }).success).toBe(false);
  });
  test('the persistence boundary rejects any changed code template before saving', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    vi.spyOn(customDomain, 'customSceneGuide').mockReturnValueOnce({ openingKind: 'guide', openingLine: '被意外改动的提示' as typeof CUSTOM_SCENE_GUIDE });
    await expect(service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label: destination })).rejects.toMatchObject({ code: 'SCENE_GUIDE_INVALID' });
    expect(await service.read(owner, before.id)).toEqual(before);
  });
  test('old generated scenes remain unchanged and user labels never become guide assertions', async () => {
    const service = new CustomPracticeService(store, model); const before = await ready(service);
    const legacy = { id: randomUUID(), label: '旧场景', openingLine: '你发来的简历我已经看完了。', turnIndex: 0, createdAt: new Date().toISOString(), generatedBy: { provider: 'bailian' as const, model: 'historical-model' } };
    await store.update(owner, before.id, record => { activeCustomBranch(record.view)!.scenes = [legacy]; });
    const label = '明天下午三点，我已录取，对方必须同意';
    const saved = await service.action(owner, before.id, { kind: 'advance_scene', actionId: randomUUID(), expectedVersion: before.version, label });
    const scenes = activeCustomBranch(saved)!.scenes!;
    expect(scenes[0]).toEqual(legacy); expect(scenes[0]).not.toHaveProperty('openingKind');
    expect(scenes[1]).toMatchObject({ label, openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE });
    expect(scenes[1].openingLine).not.toContain('已录取');
    expect(activeCustomBranch(saved)?.turns).toEqual(activeCustomBranch(before)?.turns);
  });
});

describe('scene-aware model boundary', () => {
  function branch(): CustomBranch { return { id: randomUUID(), label: '首次尝试', parentId: null, setup, accepted: true, finished: false, createdAt: new Date().toISOString(), turns: [], scenes: [{ id: randomUUID(), label: destination, openingLine: '开始面谈。', turnIndex: 0, createdAt: new Date().toISOString() }] }; }
  test('destination defaults use a literal observed time and do not repeat the current scene', () => {
    const current = branch(); current.scenes = undefined;
    current.turns = [{ id: randomUUID(), userText: '可以三点聊吗？', reply: '那就今天下午三点用15分钟聊筛选原因。', reflection: '', supportedQuote: '可以三点聊吗？', sourceId: null, createdAt: new Date().toISOString() }];
    expect(suggestedCustomSceneLabel(current)).toBe('今天下午三点，进入下一段谈话');
    current.scenes = [{ id: randomUUID(), label: destination, openingLine: '开始吧。', turnIndex: 1, createdAt: new Date().toISOString() }];
    expect(suggestedCustomSceneLabel(current)).toBe('');
  });
  test('readiness follows scene boundaries in legacy records without per-turn scene ids', () => {
    const current = branch(); current.scenes = undefined;
    const turn = { id: randomUUID(), userText: '请具体说说。', reply: '我们明天一起核对公开的要求。', reflection: '', supportedQuote: '请具体说说。', sourceId: null, createdAt: new Date().toISOString() };
    expect(customSceneReadiness(current)).toMatchObject({ ready: false, turnsInScene: 0 });
    current.turns.push(turn);
    expect(customSceneReadiness(current)).toEqual({ ready: true, reason: null, turnsInScene: 1 });
    current.scenes = [{ id: randomUUID(), label: '明天，核对要求', openingLine: '我们先看看这份公开要求。', turnIndex: 1, createdAt: new Date().toISOString() }];
    expect(customSceneReadiness(current)).toMatchObject({ ready: false, turnsInScene: 0 });
    current.turns.push({ ...turn, id: randomUUID(), userText: '  ' });
    expect(customSceneReadiness(current)).toMatchObject({ ready: false, turnsInScene: 0 });
    current.turns.push({ ...turn, id: randomUUID() });
    expect(customSceneReadiness(current)).toEqual({ ready: true, reason: null, turnsInScene: 1 });
    current.finished = true;
    expect(customSceneReadiness(current)).toMatchObject({ ready: false, turnsInScene: 1 });
  });
  test('clock normalization recognizes afternoon Chinese time and rejects returning to that appointment', () => {
    expect(customQuantities('下午三点')).toEqual(customQuantities('15:00'));
    expect(customQuantities('下午3:00')).toEqual(customQuantities('15点'));
    expect(postponesActiveCustomScene('我们到下午三点再聊。', destination)).toBe(true);
    expect(postponesActiveCustomScene('等到15:00再联系吧。', destination)).toBe(true);
    expect(postponesActiveCustomScene('三点再聊吧。', destination)).toBe(true);
    expect(postponesActiveCustomScene('现在开始。我们此前约了下午三点，先说说你的问题吧。', destination)).toBe(false);
    expect(postponesActiveCustomScene('我们明天下午四点再聊后续问题。', destination)).toBe(false);
    expect(postponesActiveCustomScene('我们明天下午三点再聊后续问题。', destination)).toBe(false);
    expect(hasUngroundedCustomAssertion('你好，三点到了。', destination)).toBe(false);
    expect(hasUngroundedCustomAssertion('你好，上午三点到了。', destination)).toBe(true);
  });
  test.each([
    ['下午一点', 'clock:13:0'], ['一点钟', 'clock:1:0'], ['我一点有空', 'clock:1:0'],
    ['三点一分', 'clock:3:1'], ['三点十五开会', 'clock:3:15'], ['三点半', 'clock:3:30'],
    ['下午3:00', 'clock:15:0'], ['明天下午三点一起看简历', 'clock:15:0'],
    ['明天下午三点十五一起看简历', 'clock:15:15'], ['下午三点五开始', 'clock:15:5'],
  ])('keeps genuine clock meaning without swallowing action words: %s', (text, quantity) => {
    expect([...customQuantities(text)]).toEqual([quantity]);
  });
  test.each(['写清楚一点', '具体一点。', '一点时间', '一点也不', '一点都不', '花一点耐心看看', '详细一点再发我', '稍微晚一点', '一点点帮助'])('does not turn an indefinite amount or degree into 01:00: %s', text => {
    expect([...customQuantities(text)]).toEqual([]);
    expect(hasUngroundedCustomAssertion(text, '明天下午三点')).toBe(false);
  });
  test('known-time phrasing and degree advice can pass while new time and capacity assertions remain rejected', () => {
    const known = '我们讨论的是明天下午三点，是否方便还没约好。';
    expect(hasUngroundedCustomAssertion('明天下午三点一起看简历。你先写具体一点。', known)).toBe(false);
    expect(hasUngroundedCustomAssertion('可以花一点时间看看。', known)).toBe(false);
    expect(hasUngroundedCustomAssertion('明天下午三点半开始。', known)).toBe(true);
    expect(hasUngroundedCustomAssertion('明天下午三点一分开始。', known)).toBe(true);
    expect(hasUngroundedCustomAssertion('上午一点我一定有空。', known)).toBe(true);
    expect(hasUngroundedCustomAssertion('我保证有两小时，肯定能完成。', known)).toBe(true);
    expect(customQuantities('两小时')).toEqual(new Set(['duration:120']));
  });
  test.each([
    '三点我还在会上，估计得四点多才结束。你说写得太空，具体是哪个项目呀？你先发一段给我看看，我开完会正好帮你瞅瞅。',
    '三点我正好在开会诶，估计得四点多才结束。你说项目经历写得空，具体是哪个项目呀？要不你先发一段给我看看，我开完会帮你瞅瞅，或者咱们约五点左右也行。',
  ])('both observed server candidates still fail for the unsupported meeting-end estimate: %s', reply => {
    expect(hasUngroundedCustomAssertion(reply, '明天下午三点')).toBe(true);
  });
  test.each([
    '要不你先发一段给我看看，我开完会帮你瞅瞅，或者咱们约五点左右也行。',
    '三点我在开会，要不咱们约五点左右也行。',
    '你先发我看看，要不咱们五点聊。',
    '要不咱们先聊十分钟。',
  ])('recognizes an independent tentative proposal without inventing a guarantee: %s', reply => {
    expect(hasUngroundedCustomAssertion(reply, '明天下午三点')).toBe(false);
  });
  test.each([
    '我估计四点多才结束。', '我可能四点左右下班。',
    '我四点下班，要不咱们五点聊。',
    '要不你先发我看看，我四点下班。',
    '要不你先发我看看，我会在四点前看完。',
    '要不你先发我看看，或者咱们约五点，因为我四点下班。',
    '要不咱们五点聊；我四点下班。', '要不咱们五点聊;我四点下班。',
    '你说要不五点见，那我五点有空。',
    '要不是五点有会，我就答应了。', '要不然我五点就下班了。',
    '要不咱们五点聊，这个时间不行。', '要不我们不要约五点。',
    '要不我们五点聊，但我不同意这个时间。', '要不五点见，我拒绝这个安排。',
    '要不五点见，我不接受这个时间。',
    '要不咱们五点见，我不是在提议。',
    '我不接受要不五点见这个安排，五点我没空。',
    '要不咱们五点聊，我保证准时到。', '要不五点肯定能完成？',
  ])('a mention of 要不 cannot authorize unknown facts, negations or guarantees: %s', reply => {
    expect(hasUngroundedCustomAssertion(reply, '明天下午三点')).toBe(true);
  });
  test('the live model compatibility method returns only the deterministic guide with no provider call', async () => {
    const current = branch(); current.scenes = undefined;
    const result = await liveCustomModel.advanceScene!(current, destination);
    expect(result).toEqual({ openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE });
    expect(requestModelJson).not.toHaveBeenCalled();
    expect(await liveCustomModel.advanceScene!(current, '我已经发送材料，对方已经阅读')).toEqual(result);
  });
  test('reply context distinguishes the guide from dialogue and keeps progress local to the current scene', async () => {
    const current = branch();
    const oldTurn = { id: randomUUID(), userText: '可以下午三点再谈吗？', reply: '可以。', reflection: '', supportedQuote: '可以下午三点再谈吗？', sourceId: null, createdAt: new Date().toISOString() };
    const currentTurn = { ...oldTurn, id: randomUUID(), userText: '明天一起核对公开要求吧。', reply: '我们可以一起看看。' };
    current.turns = [oldTurn, currentTurn]; current.scenes![0].turnIndex = 1;
    expect(() => validateCustomSceneOpening(current, '明天，核对公开要求', '开始面谈！')).toThrow(expect.objectContaining({ code: 'AI_SCENE_UNCHANGED' }));
    current.scenes![0] = { ...current.scenes![0], openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE };
    const text = '我们先核对岗位里的要求。';
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '你想先问哪一条？', practiceQuestion: '先问什么？', supportedQuote: text, sourceId: null }), model: 'scene-test-model', provider: 'bailian' });
    await liveCustomModel.reply(current, text);
    const request = vi.mocked(requestModelJson).mock.lastCall![0];
    const context = JSON.parse(request.user);
    expect(context.history).toHaveLength(2);
    expect(context.currentSceneDialogue).toEqual([{ id: currentTurn.id, user: currentTurn.userText, simulatedCounterpart: currentTurn.reply }]);
    expect(context.currentScene).toMatchObject({ openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE });
    expect(request.system).toContain('openingKind 为 guide 的 openingLine 只是系统场景提示');
    expect(request.system).toContain('不证明跳转期间用户发送了简历');
  });
  test('later replies receive the active scene and reject deferring to its already reached time', async () => {
    const current = branch(); const text = '请问学历要求具体如何影响筛选？';
    vi.mocked(requestModelJson).mockResolvedValue({ text: JSON.stringify({ reply: '我们等到15:00再聊这个问题。', practiceQuestion: '你准备问什么？', supportedQuote: text, sourceId: null }), model: 'scene-test-model', provider: 'bailian' });
    await expect(liveCustomModel.reply(current, text)).rejects.toMatchObject({ code: 'AI_SCENE_MISMATCH' });
    expect(JSON.parse(vi.mocked(requestModelJson).mock.lastCall![0].user).currentScene).toEqual(current.scenes![0]);
  });
});
