import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { activeCustomBranch, type CustomBranch, type CustomSetup } from '@/domain/custom-practice';
import { liveCustomModel, type CustomModel } from './custom-model';
import { requestModelJson } from './model-provider';
import { CustomPracticeService } from './custom-service';
import { LocalCustomStore } from './custom-store';
import { AppError } from './errors';

vi.mock('./model-provider', () => ({ requestModelJson: vi.fn(), modelConfiguration: () => ({ configured: false, provider: null, model: 'test-only' }) }));
const text = '你明天下午三点方便一起看我的简历吗？';
const setup: CustomSetup = { title: '向学姐请教简历', userRole: '学生', counterpartRole: '学姐', goal: '询问是否方便一起看简历', userFacts: [text], assumptions: [], openingLine: '你想先看简历里的哪部分？' };
const unknown = '我已经确定有999小时，保证能做完。';
const valid = '我们先看看项目经历，哪一段最让你拿不准怎么写？';
const owner = 'synthetic-reply-recovery-owner';
const root = path.resolve('.local');
let directory: string;
function branch(): CustomBranch { return { id: randomUUID(), label: '首次尝试', parentId: null, setup: structuredClone(setup), accepted: true, finished: false, turns: [], createdAt: new Date().toISOString() }; }
function wire(reply: string, overrides: Record<string, unknown> = {}) { return { text: JSON.stringify({ reply, practiceQuestion: '你准备先问哪一处？', supportedQuote: text, sourceId: null, ...overrides }), model: 'recovery-test-model', provider: 'bailian' as const }; }
async function prepared(currentSetup = setup, topic = text) {
  const store = new LocalCustomStore(directory);
  const model: CustomModel = { setup: async () => structuredClone(currentSetup), reply: liveCustomModel.reply };
  const service = new CustomPracticeService(store, model);
  const created = await service.create(owner, { id: randomUUID(), actionId: randomUUID(), topic });
  const accepted = await service.action(owner, created.id, { kind: 'accept_setup', actionId: randomUUID(), expectedVersion: created.version, setup: currentSetup });
  return { service, store, accepted };
}
beforeEach(async () => { vi.mocked(requestModelJson).mockReset(); await mkdir(root, { recursive: true }); directory = await mkdtemp(path.join(root, 'custom-recovery-test-')); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); if (directory && path.resolve(directory).startsWith(`${root}${path.sep}custom-recovery-test-`)) await rm(directory, { recursive: true, force: true }); });

describe('one bounded correction for a grounded-schema reply with unsupported numbers', () => {
  test('a legal first candidate needs one call and no correction context', async () => {
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(valid));
    expect((await liveCustomModel.reply(branch(), text)).reply).toBe(valid);
    expect(requestModelJson).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(requestModelJson).mock.calls[0][0].user)).not.toHaveProperty('rejectedDraft');
    expect(JSON.parse(vi.mocked(requestModelJson).mock.calls[0][0].user)).not.toHaveProperty('rejectedSentences');
  });
  test('only the corrected candidate is saved once under the original action id', async () => {
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(unknown)).mockResolvedValueOnce(wire(valid));
    const { service, store, accepted } = await prepared();
    const action = { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text };
    const result = await service.action(owner, accepted.id, action);
    const saved = activeCustomBranch(result)!;
    expect(saved.turns).toHaveLength(1); expect(saved.turns[0]).toMatchObject({ id: action.actionId, userText: text, reply: valid });
    expect(JSON.stringify(result)).not.toContain(unknown);
    expect(result.version).toBe(accepted.version + 1); expect(result.pendingAction).toBeNull();
    expect((await store.read(owner, result.id)).actions[action.actionId].status).toBe('done');
    expect(await service.action(owner, result.id, action)).toEqual(result);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(requestModelJson).mock.calls;
    const correction = JSON.parse(calls[1][0].user);
    expect(correction.rejectedDraft).toBe(unknown); expect(correction.history).toEqual([]);
    expect(correction.rejectedSentences).toEqual([unknown]);
    expect(correction.userText).toBe(text); expect(calls[1][0].signal).toBe(calls[0][0].signal);
  });
  test('a second ungrounded candidate fails without saving either draft or leaving a pending action', async () => {
    vi.mocked(requestModelJson).mockResolvedValue(wire(unknown));
    const { service, accepted } = await prepared();
    await expect(service.action(owner, accepted.id, { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text })).rejects.toMatchObject({ code: 'AI_UNGROUNDED_DETAIL' });
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    expect(await service.read(owner, accepted.id)).toEqual(accepted);
  });
  test('the correction receives only the actually rejected sentences, without turning them into known facts', async () => {
    const estimate = '三点我正好在开会诶，估计得四点多才结束。';
    const tentative = '要不你先发一段给我看看，我开完会帮你瞅瞅，或者咱们约五点左右也行。';
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(`${estimate}你想先改哪段？${tentative}`)).mockResolvedValueOnce(wire(valid));
    expect((await liveCustomModel.reply(branch(), text)).reply).toBe(valid);
    const correctionRequest = vi.mocked(requestModelJson).mock.calls[1][0];
    const correction = JSON.parse(correctionRequest.user);
    expect(correction.rejectedSentences).toEqual([estimate]);
    expect(correction.rejectedDraft).toContain(tentative);
    expect(correction.history).toEqual([]); expect(correction.acceptedSetup).toEqual(setup);
    expect(correctionRequest.system).toContain('第二次不得再引入任何已知情境和用户原话以外的新具体时钟、日期、时长、人数或金额');
    expect(correctionRequest.system).toContain('估计…左右');
    expect(correctionRequest.system).toContain('在结尾加问号');
    expect(requestModelJson).toHaveBeenCalledTimes(2);
  });
  test('the two exact observed drafts cannot save an unsupported estimate even when the later proposal is valid', async () => {
    const first = '三点我还在会上，估计得四点多才结束。你说写得太空，具体是哪个项目呀？你先发一段给我看看，我开完会正好帮你瞅瞅。';
    const second = '三点我正好在开会诶，估计得四点多才结束。你说项目经历写得空，具体是哪个项目呀？要不你先发一段给我看看，我开完会帮你瞅瞅，或者咱们约五点左右也行。';
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(first)).mockResolvedValueOnce(wire(second));
    const { service, accepted } = await prepared();
    await expect(service.action(owner, accepted.id, { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text })).rejects.toMatchObject({ code: 'AI_UNGROUNDED_DETAIL' });
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    expect(await service.read(owner, accepted.id)).toEqual(accepted);
  });
  test.each([
    ['unknown source', { sourceId: 'made-up-source' }],
    ['changed user quote', { supportedQuote: '我已经同意了' }],
    ['illegal extra field', { acceptedAppointment: true }],
  ])('the corrected reply still rejects %s and cannot make a third call', async (_label, overrides) => {
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(unknown)).mockResolvedValueOnce(wire(valid, overrides));
    await expect(liveCustomModel.reply(branch(), text)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(requestModelJson).toHaveBeenCalledTimes(2);
  });
  test('current-scene checks still reject a corrected reply that postpones an already reached appointment', async () => {
    const current = branch(); current.scenes = [{ id: randomUUID(), label: '明天下午三点，和学姐一起讨论简历', openingLine: '我们开始看看简历。', turnIndex: 0, createdAt: new Date().toISOString() }];
    vi.mocked(requestModelJson).mockResolvedValueOnce(wire(unknown)).mockResolvedValueOnce(wire('我们等到下午三点再聊。'));
    await expect(liveCustomModel.reply(current, text)).rejects.toMatchObject({ code: 'AI_SCENE_MISMATCH' });
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(requestModelJson).mock.calls[1][0].user).currentScene).toEqual(current.scenes[0]);
  });
  test.each([
    ['malformed JSON', { text: '{' }],
    ['wrong source before number validation', wire(unknown, { sourceId: 'made-up-source' })],
    ['wrong quote before number validation', wire(unknown, { supportedQuote: '不是原话' })],
  ])('does not broaden correction to %s', async (_label, response) => {
    vi.mocked(requestModelJson).mockResolvedValueOnce({ model: 'recovery-test-model', provider: 'bailian', ...response });
    await expect(liveCustomModel.reply(branch(), text)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(requestModelJson).toHaveBeenCalledTimes(1);
  });
  test('a provider failure is not automatically retried', async () => {
    vi.mocked(requestModelJson).mockRejectedValueOnce(new AppError('AI_TIMEOUT', 'synthetic timeout', 503));
    await expect(liveCustomModel.reply(branch(), text)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(requestModelJson).toHaveBeenCalledTimes(1);
  });
});

describe('a role inversion cannot be saved as the counterpart speech', () => {
  const userText = '这次必须保住哪些交付，哪些内容可以再商量？';
  const intern: CustomSetup = { title: '实习时商量临时加班', userRole: '在校实习生', counterpartRole: '带教前辈', goal: '问清这份整理的重点，商量可完成的部分', userFacts: ['我在学校还有作业要交，今晚做不完全部整理。'], assumptions: [], openingLine: '这些整理挺简单的，你今晚加个班弄完吧，明天我要用。' };
  const inverted = '今晚我确实弄不完，学校那边有作业要交。我明天上班可以先帮你做其中一部分。';
  const response = (reply: string) => wire(reply, { supportedQuote: userText });
  const corrected = '你先说说目前有哪些材料，我和你一起看明天要用的部分，剩下的再商量时间。';
  test('only the corrected mentor speech commits, and a duplicate action cannot call the model again', async () => {
    vi.mocked(requestModelJson).mockResolvedValueOnce(response(inverted)).mockResolvedValueOnce(response(corrected));
    const { service, accepted } = await prepared(intern, userText);
    const action = { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text: userText };
    const saved = await service.action(owner, accepted.id, action);
    expect(activeCustomBranch(saved)?.turns).toHaveLength(1);
    expect(activeCustomBranch(saved)?.turns[0].reply).toBe(corrected);
    expect(JSON.stringify(saved)).not.toContain(inverted);
    expect(await service.action(owner, saved.id, action)).toEqual(saved);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    const correction = JSON.parse(vi.mocked(requestModelJson).mock.calls[1][0].user);
    expect(correction.rejectedRoleIssues).not.toEqual([]);
    expect(correction.roleOwnership.speaker.role).toBe('带教前辈');
    expect(correction.history).toEqual([]);
  });
  test('two inverted drafts fail explicitly without changing history or agreements', async () => {
    vi.mocked(requestModelJson).mockResolvedValue(response(inverted));
    const { service, accepted } = await prepared(intern, userText);
    await expect(service.action(owner, accepted.id, { kind: 'say', actionId: randomUUID(), expectedVersion: accepted.version, text: userText })).rejects.toMatchObject({ code: 'AI_ROLE_MISMATCH' });
    expect(await service.read(owner, accepted.id)).toEqual(accepted);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
  });
  test('a mentor can quote the user constraint and directly accept a concrete user proposal', async () => {
    const proposal = '我在学校还有作业要交。我提议先整理明天要用的部分，其余时间再商量，可以吗？';
    const statement = '你说“学校那边有作业要交”，那就按你提议的先整理明天要用的部分，其余时间再商量。';
    vi.mocked(requestModelJson).mockResolvedValue(wire(statement, { supportedQuote: proposal }));
    const current = branch(); current.setup = intern;
    expect((await liveCustomModel.reply(current, proposal)).reply).toBe(statement);
    expect(requestModelJson).toHaveBeenCalledTimes(1);
  });
});

describe('the entire reply shares one 35-second model deadline', () => {
  function fakeClock() { vi.useFakeTimers(); const start = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start); }
  test('a slow first rejection with less than 2500ms remaining does not launch a correction', async () => {
    fakeClock();
    vi.mocked(requestModelJson).mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(wire(unknown)), 33_000)));
    const running = liveCustomModel.reply(branch(), text);
    const failure = expect(running).rejects.toMatchObject({ code: 'AI_UNGROUNDED_DETAIL' });
    await vi.advanceTimersByTimeAsync(33_000); await failure;
    expect(requestModelJson).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  test('the correction receives only the remaining budget and shares the first deadline', async () => {
    fakeClock();
    vi.mocked(requestModelJson).mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(wire(unknown)), 20_000))).mockImplementationOnce(() => new Promise(() => undefined));
    const running = liveCustomModel.reply(branch(), text);
    const failure = expect(running).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(requestModelJson).mock.calls.map(call => call[0]);
    expect(first.timeoutMs).toBe(35_000); expect(second.timeoutMs).toBe(15_000); expect(second.signal).toBe(first.signal);
    await vi.advanceTimersByTimeAsync(14_999); expect(second.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await failure;
    expect(second.signal?.aborted).toBe(true); expect(requestModelJson).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  test('even an unresponsive provider promise is bounded and cannot trigger a second call', async () => {
    fakeClock(); vi.mocked(requestModelJson).mockImplementationOnce(() => new Promise(() => undefined));
    const running = liveCustomModel.reply(branch(), text); const failure = expect(running).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(35_000); await failure;
    expect(requestModelJson).toHaveBeenCalledTimes(1); expect(vi.mocked(requestModelJson).mock.calls[0][0].signal?.aborted).toBe(true);
  });
});
