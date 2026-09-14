import { describe, expect, test } from 'vitest';
import type { CustomBranch } from '@/domain/custom-practice';
import { buildReplyOptionsRequest, fallbackReplyTexts, replyModelContext, validateReplyOptions } from './reply-options-model';

const date = '2026-09-13T10:00:00Z';
const goal = '礼貌而坚定地向 HR 了解因第一学历被拒的具体原因，并建议公司在招聘信息中提前说明学历要求，避免候选人浪费精力。';
function hiringBranch(): CustomBranch {
  return { id: 'synthetic-branch', label: '第一次', parentId: null, accepted: true, finished: false, createdAt: date, turns: [], setup: { title: '和 HR 沟通筛选依据', userRole: '候选人', counterpartRole: '公司招聘负责人（HR）', goal, userFacts: ['我想了解学历筛选的依据'], assumptions: ['双方正在模拟招聘沟通'], openingLine: '可以聊，你最希望先了解哪一部分？' } };
}
function addTurn(branch: CustomBranch, userText: string, reply: string) {
  branch.turns.push({ id: `turn-${branch.turns.length}`, userText, reply, supportedQuote: userText, sourceId: null, reflection: '接下来准备问什么？', createdAt: date });
}
function atMeeting() {
  const branch = hiringBranch();
  addTurn(branch, '我们可以约个时间详细聊吗？', '要不要今天下午三点通话，先用十五分钟把情况说清楚？');
  addTurn(branch, '好的，我接受这个安排。', '那就下午三点见，面谈时可以再讨论筛选依据。');
  branch.scenes = [{ id: 'meeting', label: '今天下午三点，开始与 HR 面谈', openingLine: '我们开始吧。你想先了解筛选依据，还是先讨论职位说明的写法？', turnIndex: 2, createdAt: date }];
  return branch;
}
const response = (options: string[]) => ({ text: JSON.stringify({ options }), model: 'synthetic-test', provider: 'bailian' as const });
const substantiveOptions = ['我想先了解学历筛选的具体依据，可以说清必要条件吗？', '如果学历是必要条件，能否在职位说明中提前写明？', '实际能力会怎样进入评估，哪些经历可以提供参考？'];

describe('custom replies follow the current conversation and scene', () => {
  test('legacy records without scenes keep the current line and do not invent a transition', () => {
    const branch = hiringBranch();
    const context = replyModelContext({ kind: 'custom', branch });
    expect(context).toMatchObject({ activeScene: null, currentQuestion: branch.setup.openingLine, latestDialogue: [], priorDialogue: [] });
  });

  test('entering the meeting makes its opening the current question while retaining prior agreement separately', () => {
    const branch = atMeeting(); const before = structuredClone(branch);
    const context = replyModelContext({ kind: 'custom', branch });
    expect(context).toMatchObject({ activeScene: { label: '今天下午三点，开始与 HR 面谈' }, latestDialogue: [], currentQuestion: branch.scenes![0].openingLine, avoidRepeatingTimeConfirmation: true });
    expect('priorDialogue' in context && context.priorDialogue).toHaveLength(2);
    expect(branch).toEqual(before);
    addTurn(branch, '我想先了解筛选依据。', '学历要求属于初筛条件，你想具体核对哪一项？');
    expect(replyModelContext({ kind: 'custom', branch })).toMatchObject({ latestDialogue: [{ user: '我想先了解筛选依据。', counterpart: '学历要求属于初筛条件，你想具体核对哪一项？' }], currentQuestion: '学历要求属于初筛条件，你想具体核对哪一项？' });
  });

  test('backup drafts are concise and substantive instead of quoting the entire goal or HR speech', () => {
    const branch = atMeeting();
    const texts = fallbackReplyTexts({ kind: 'custom', branch });
    expect(texts).toHaveLength(3); expect(new Set(texts).size).toBe(3);
    for (const text of texts) {
      expect(text.length).toBeLessThan(90);
      expect(text).not.toMatch(/你刚才提到|我希望谈成的是|双方愿意试|三点见|到时再聊/);
      expect(text).not.toContain(goal);
    }
    expect(texts[0]).toContain('筛选'); expect(texts[1]).toContain('能力'); expect(texts[2]).toContain('职位说明');
  });

  test('an unanswered invitation permits a draft accepting it; an accepted time is not reconfirmed', () => {
    const branch = hiringBranch();
    addTurn(branch, '可以约个时间聊吗？', '今天下午三点，你方便吗？');
    expect(fallbackReplyTexts({ kind: 'custom', branch })[0]).toContain('接受你提议的时间');
    addTurn(branch, '好的', '今天下午三点，你方便吗？');
    expect(replyModelContext({ kind: 'custom', branch })).toMatchObject({ avoidRepeatingTimeConfirmation: true });
    expect(fallbackReplyTexts({ kind: 'custom', branch }).join('')).not.toMatch(/接受你提议的时间|再敲定|先不确认/);
  });

  test('when HR asks for wording, backups offer actual wording structure rather than requesting the same help', () => {
    const branch = atMeeting();
    addTurn(branch, '我希望招聘信息能提前说明要求。', '你具体建议怎么写？');
    expect(fallbackReplyTexts({ kind: 'custom', branch })[0]).toContain('单列');
    expect(fallbackReplyTexts({ kind: 'custom', branch })[1]).toContain('必须满足和优先考虑分开');
  });

  test('a stated role boundary changes backups to available information or the responsible contact', () => {
    const branch = atMeeting();
    addTurn(branch, '你能帮我具体改简历吗？', '我不能替你提供简历修改建议，这超出我的职责。');
    const texts = fallbackReplyTexts({ kind: 'custom', branch });
    expect(texts[0]).toContain('你能说明'); expect(texts[1]).toContain('向谁询问');
    expect(texts.join('')).not.toContain('帮我改简历');
  });

  test('rejects the observed quoted-goal boilerplate and wholesale copied role question', () => {
    const branch = atMeeting();
    for (const copied of [`我希望谈成的是“${goal}”。我们先商量一个安排吗？`, `你刚才提到“${branch.scenes![0].openingLine}”，我想听听你在意什么。`]) {
      // Scene openings are also counterpart speech, not a user's answer.
      expect(() => validateReplyOptions(response([copied, ...substantiveOptions.slice(1)]), { kind: 'custom', branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    }
  });

  test('does not offer the same long user reply for resending', () => {
    const branch = atMeeting(); addTurn(branch, substantiveOptions[0], '我可以先说明初筛要求。');
    expect(() => validateReplyOptions(response(substantiveOptions), { kind: 'custom', branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    expect(fallbackReplyTexts({ kind: 'custom', branch })).not.toContain(substantiveOptions[0]);
  });

  test.each(['今天下午三点，开始与 HR 面谈', '今天15:00，开始与 HR 面谈'])('rejects returning to the same future appointment after %s', label => {
    const branch = atMeeting(); branch.scenes![0].label = label;
    expect(() => validateReplyOptions(response(['那就下午三点见，到时我们再聊筛选依据。', ...substantiveOptions.slice(1)]), { kind: 'custom', branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    expect(validateReplyOptions(response(substantiveOptions), { kind: 'custom', branch }).texts).toEqual(substantiveOptions);
  });

  test('an accepted time is not offered for reconfirmation even before scene advancement', () => {
    const branch = atMeeting(); delete branch.scenes;
    expect(() => validateReplyOptions(response(['行，下午三点见，到时候再说具体筛选依据。', ...substantiveOptions.slice(1)]), { kind: 'custom', branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });

  test('draft recruitment wording cannot silently fill an unknown degree threshold, but may ask about it', () => {
    const branch = atMeeting();
    expect(() => validateReplyOptions(response(['可以在岗位要求第一条直接写“需全日制本科及以上”，这样大家投之前就能判断。', ...substantiveOptions.slice(1)]), { kind: 'custom', branch })).toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
    expect(validateReplyOptions(response(['实际门槛是否要求全日制本科，能否先核对清楚？', ...substantiveOptions.slice(1)]), { kind: 'custom', branch }).texts).toHaveLength(3);
    branch.setup.userFacts.push('招聘方已经说明要求全日制本科及以上');
    expect(validateReplyOptions(response(['能否把已说明的要求写明为全日制本科及以上？', ...substantiveOptions.slice(1)]), { kind: 'custom', branch }).texts).toHaveLength(3);
  });

  test('new-scene request contains active question and explicit boundaries, without granting drafts state authority', () => {
    const branch = atMeeting(); const request = buildReplyOptionsRequest({ kind: 'custom', branch });
    const input = JSON.parse(request.user);
    expect(input.currentQuestion).toBe(branch.scenes![0].openingLine);
    expect(request.system).toContain('场景推进由用户明确操作保存');
    expect(request.system).toContain('不复述整段目标');
    expect(request.system).toContain('不替玩家编造');
  });
});
