import { describe, expect, test } from 'vitest';
import type { CustomBranch } from '@/domain/custom-practice';
import { buildReplyOptionsRequest, fallbackReplyTexts, validateReplyOptions } from './reply-options-model';

function branch(): CustomBranch {
  return { id: 'sendable-synthetic', label: '首次尝试', parentId: null, accepted: true, finished: false,
    createdAt: '2026-09-14T00:00:00Z', turns: [], setup: { title: '和朋友商量一件事',
      userRole: '想沟通的同学', counterpartRole: '朋友', goal: '问清彼此的想法，再商量下一步',
      userFacts: [], assumptions: [], openingLine: '你希望我们怎么谈？' } };
}
const response = (options: string[]) => ({ text: JSON.stringify({ options }), provider: 'deepseek' as const, model: 'synthetic' });
const others = ['我想先听听你的想法，可以吗？', '如果暂时定不下来，我们先核对哪些信息？'];

describe('recommended replies are speech, not writing instructions', () => {
  test.each([
    '先解释自己的处境，再询问对方的具体要求。',
    '请先用委婉的语气说明自己的困难。',
    '询问任务的验收标准？',
    '我：能不能先明确任务范围？',
    '用户：请问最晚什么时候需要？',
    '想沟通的同学：你希望先聊哪一部分？',
    '可以这样说：我想先听听你的要求。',
    '你可以这样回复：我想先商量时间。',
    '核对事实：你想先了解哪些信息？',
    'A：我想先听听你的看法。',
    '我想先【一个能做到的小行动】，可以吗？',
    '我想先[填入自己的请求]，可以吗？',
  ])('rejects a coaching/scaffold artifact: %s', first => {
    expect(() => validateReplyOptions(response([first, ...others]), { kind: 'custom', branch: branch() }))
      .toThrow(expect.objectContaining({ code: 'OPTIONS_INVALID' }));
  });

  test.each([
    '我建议先把要讨论的内容说清楚，再商量时间。',
    '请你先说明最着急的是哪一部分。',
    '你觉得先讨论时间可以吗？',
    '你能先说说最在意什么吗？',
    '先核对要求，再商量时间。',
    '如果现在还不能决定，能否先说清要核对哪些信息？',
    '我想先说明自己的顾虑，再听听你的想法。',
    '我想问问你，“先明确自己的诉求”具体是什么意思？',
  ])('keeps natural direct speech without enforcing a first-person prefix: %s', first => {
    expect(validateReplyOptions(response([first, ...others]), { kind: 'custom', branch: branch() }).texts[0]).toBe(first);
  });

  test.each(['unknown-topic', 'interview-introduction'])('%s backups are three complete lines with no invented answer', kind => {
    const current = branch();
    if (kind === 'interview-introduction') Object.assign(current.setup, { title: '实习面试', userRole: '候选人', counterpartRole: '面试官', openingLine: '请先自我介绍。' });
    const before = structuredClone(current); const context = { kind: 'custom' as const, branch: current };
    const texts = fallbackReplyTexts(context);
    expect(texts).toHaveLength(3); expect(new Set(texts).size).toBe(3);
    expect(texts.join('')).not.toMatch(/【|】|填写|用户：|我已经|我的项目是|已经同意/);
    expect(validateReplyOptions(response(texts), context).texts).toEqual(texts);
    expect(current).toEqual(before);
  });

  test('the request asks for complete sendable lines and leaves delivery to the player', () => {
    const request = buildReplyOptionsRequest({ kind: 'custom', branch: branch() });
    expect(request.system).toContain('可直接向当前对方说出的完整下一句');
    expect(request.system).toContain('不自动发送');
    expect(request.system).toContain('未知事实不补造，也不留空位');
    expect(request.scope).toBe('custom');
  });
});
