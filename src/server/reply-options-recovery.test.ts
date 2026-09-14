import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CustomBranch } from '@/domain/custom-practice';
import { initialState } from '@/domain/engine';
import { AppError } from './errors';
import { requestModelJson } from './model-provider';
import { buildReplyOptionsRequest, fallbackReplyTexts, liveReplyOptionsModel, validateReplyOptions, type ReplyContext } from './reply-options-model';

vi.mock('./model-provider', () => ({ requestModelJson: vi.fn() }));
function intern(): CustomBranch { return { id: 'synthetic-intern', label: '首次尝试', parentId: null, accepted: true, finished: false, createdAt: '2026-09-14T00:00:00Z', turns: [], setup: { title: '实习临时加班', userRole: '在校实习生', counterpartRole: '带教前辈', goal: '问清整理重点，商量能做的部分', userFacts: ['我在实习，晚上还有学校作业要交。'], assumptions: [], openingLine: '这些整理挺简单的，你今晚加个班弄完吧，明天我要用。' } }; }
const response = (options: string[]) => ({ text: JSON.stringify({ options }), provider: 'deepseek' as const, model: 'synthetic-flash' });
const invalid = ['我还没做完整理，学校那边有作业要交。', '我最近天天加班，能不能换个人？', '这件事本来不归我负责，你找别人吧。'];
const valid = ['你明天要用这些整理做什么？我想先弄清重点。', '我想先看材料，再和你核对今晚能做到哪一步，可以吗？', '如果先做明天要用的部分，其余内容能再商量时间吗？'];
beforeEach(() => { vi.mocked(requestModelJson).mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('contextual custom suggestions', () => {
  test('intern backup drafts address the actual request without supplying a personal excuse', () => {
    const branch = intern(); const before = structuredClone(branch);
    const context: ReplyContext = { kind: 'custom', branch }; const texts = fallbackReplyTexts(context);
    expect(texts.join('')).toMatch(/整理/);
    expect(texts.join('')).not.toMatch(/交付|负责人|已经|做不完|加班太多|身体|学校作业/);
    expect(new Set(texts).size).toBe(3);
    expect(validateReplyOptions(response(texts), context).texts).toEqual(texts);
    expect(branch).toEqual(before);
  });
  test('no date or material is invented for an unspecified extra task', () => {
    const branch = intern(); branch.setup.openingLine = '临时加了一项工作，需要你加班处理。';
    const texts = fallbackReplyTexts({ kind: 'custom', branch });
    expect(texts.join('')).not.toMatch(/明天|今晚|整理|报表|摘要/);
    expect(texts.join('')).toContain('这项工作');
  });
  test('the next set follows the newly stated priority and not the initial generic scope question', () => {
    const branch = intern(); branch.turns.push({ id: 'one', userText: '哪些内容最重要？', reply: '先保留要给同事看的重点，其余再商量。', supportedQuote: '哪些内容最重要？', reflection: '', sourceId: null, createdAt: branch.createdAt });
    expect(fallbackReplyTexts({ kind: 'custom', branch })[0]).toContain('你刚说的重点');
  });
  test.each([
    ['学生', '指导老师', '论文修改', '先说说论文卡在哪儿。', /论文/u],
    ['女儿', '母亲', '和妈妈商量休学', '我担心你休学后不好再回来。', /休学/u],
    ['候选人', '面试官', '岗位面试', '请先自我介绍。', /介绍|经历/u],
    ['住校学生', '室友', '商量宿舍关灯', '关灯时间咱们可以商量。', /关灯|大灯/u],
  ])('%s 与 %s 的备用内容采用对应话题', (userRole, counterpartRole, title, openingLine, expected) => {
    const branch = intern(); Object.assign(branch.setup, { userRole, counterpartRole, title, openingLine, goal: title, userFacts: [title] });
    const texts = fallbackReplyTexts({ kind: 'custom', branch });
    expect(texts.join('')).toMatch(expected);
    expect(texts.join('')).not.toMatch(/交付|负责人/);
    expect(texts.every(text => text.length < 90)).toBe(true);
  });
  test('the request assigns suggested first-person speech to the user, opposite to the NPC reply', () => {
    const request = buildReplyOptionsRequest({ kind: 'custom', branch: intern() });
    expect(request.scope).toBe('custom');
    expect(JSON.parse(request.user).roleOwnership).toMatchObject({ speaker: { id: 'user', role: '在校实习生' }, listener: { id: 'counterpart', role: '带教前辈' } });
  });
});

describe('custom options have a single bounded correction while fixed options retain one request', () => {
  test('coaching instructions use the same bounded correction and return only corrected speech', async () => {
    const coaching = ['先解释自己的处境，再询问对方的具体要求。', '请先用委婉的语气说明自己的困难。', '询问任务的验收标准？'];
    vi.mocked(requestModelJson).mockResolvedValueOnce(response(coaching)).mockResolvedValueOnce(response(valid));
    expect((await liveReplyOptionsModel({ kind: 'custom', branch: intern() }, new AbortController().signal)).texts).toEqual(valid);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
  });
  test('one invalid group can be corrected without weakening the factual guard or changing the branch', async () => {
    const branch = intern(); const before = structuredClone(branch); const context: ReplyContext = { kind: 'custom', branch };
    vi.mocked(requestModelJson).mockResolvedValueOnce(response(invalid)).mockResolvedValueOnce(response(valid));
    expect((await liveReplyOptionsModel(context, new AbortController().signal)).texts).toEqual(valid);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(requestModelJson).mock.calls;
    const correction = JSON.parse(calls[1][0].user);
    expect(correction.rejectedDraft).toBe(JSON.stringify({ options: invalid }));
    expect(correction.context.userSuppliedFactsOnly).not.toContain(invalid[0]);
    expect(calls[1][0].signal).toBe(calls[0][0].signal);
    expect(calls[1][0].timeoutMs).toBeLessThanOrEqual(calls[0][0].timeoutMs!);
    expect(branch).toEqual(before);
  });
  test('two invalid groups still fail, allowing the service to label its contextual fallback', async () => {
    vi.mocked(requestModelJson).mockResolvedValue(response(invalid));
    await expect(liveReplyOptionsModel({ kind: 'custom', branch: intern() }, new AbortController().signal)).rejects.toMatchObject({ code: 'OPTIONS_INVALID' });
    expect(requestModelJson).toHaveBeenCalledTimes(2);
  });
  test('fixed mode does not acquire the custom correction or custom model scope', async () => {
    vi.mocked(requestModelJson).mockResolvedValue(response(['无效', '无效', '无效']));
    await expect(liveReplyOptionsModel({ kind: 'fixed', state: initialState('campus'), events: [] }, new AbortController().signal)).rejects.toMatchObject({ code: 'OPTIONS_INVALID' });
    expect(requestModelJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestModelJson).mock.calls[0][0].scope).toBeUndefined();
  });
  test('provider failure and pre-cancelled requests do not spend a correction call', async () => {
    vi.mocked(requestModelJson).mockRejectedValue(new AppError('AI_TIMEOUT', 'timeout', 503));
    await expect(liveReplyOptionsModel({ kind: 'custom', branch: intern() }, new AbortController().signal)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(requestModelJson).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(liveReplyOptionsModel({ kind: 'custom', branch: intern() }, controller.signal)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(requestModelJson).toHaveBeenCalledTimes(1);
  });
  test('both calls share a hard twenty-second deadline, even for an unresponsive provider', async () => {
    vi.useFakeTimers(); const start = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
    vi.mocked(requestModelJson).mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(response(invalid)), 12_000))).mockImplementationOnce(() => new Promise(() => undefined));
    const failure = expect(liveReplyOptionsModel({ kind: 'custom', branch: intern() }, new AbortController().signal)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(requestModelJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestModelJson).mock.calls[1][0].timeoutMs).toBe(8_000);
    await vi.advanceTimersByTimeAsync(8_000); await failure;
    expect(vi.mocked(requestModelJson).mock.calls[1][0].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
