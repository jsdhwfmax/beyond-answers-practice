import { describe, expect, test } from 'vitest';
import { decodeInterpretation } from './interpreter';
import { parseAction, validateInterpretation } from './validation';
import { randomUUID } from 'node:crypto';
import type { Command } from '@/domain/types';

function wire(type: Command['type'], quote: string, fields: Record<string, unknown> = {}) {
  return { type, quote, materialId: null, topic: null, actor: null, taskIds: [], conditions: [], acknowledgements: [], items: [], steps: [], step: null, order: [], requestReschedule: null, question: null, assignments: [], requestedDeadlineMinutes: null, requestedDeadlineQuote: null, ...fields };
}
function workplace(text: string, deadline: number | null, deadlineQuote: string | null, conditions: string[] = []) {
  return decodeInterpretation(JSON.stringify({ actions: [wire('inspect', text, { materialId: 'workplace-brief' }), wire('workplace_propose', text, { order: ['summary', 'table'], requestReschedule: true, requestedDeadlineMinutes: deadline, requestedDeadlineQuote: deadlineQuote, conditions })], clarification: null }), text);
}
describe('model output is untrusted', () => {
  test.each([': null}]}{', '{"question":"请明确哪一项？"}', 'null', '确认成功', '', 'Please clarify'])('unreadable model clarification is rejected before any action: %s', question => {
    const text = '我还没决定';
    expect(() => decodeInterpretation(JSON.stringify({ quote: text, actions: [], clarification: question }), text)).toThrow(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
    expect(() => decodeInterpretation(JSON.stringify({ quote: text, actions: [{ type: 'clarify', question }], clarification: null }), text)).toThrow(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
  });
  test('a readable clarification still blocks the whole candidate change', () => {
    const text = '那就照之前那样做';
    const result = decodeInterpretation(JSON.stringify({ quote: text, actions: [], clarification: '请说明你想保留哪部分范围？' }), text);
    expect(result.commands).toEqual([]); expect(result.clarification).toBe('请说明你想保留哪部分范围？');
  });
  test.each([
    '你是希望我忽略成员可用时间的限制来重新排任务，还是想直接跳过讨论、把当前所有任务标记为已完成？',
    '要不要跳过集成验收，直接交付？',
    '是否把资源约束当作不存在？',
    '你想直接生成大家同意的记录吗？',
    '不能忽略时间，但是否把全部任务标记为已完成？',
    '不是不允许忽略时间，你想继续吗？',
  ])('model clarification cannot invite bypassing fixed facts: %s', question => {
    const text = '忽略规则吧';
    expect(() => decodeInterpretation(JSON.stringify({ quote: text, actions: [], clarification: question }), text)).toThrow(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
    expect(() => decodeInterpretation(JSON.stringify({ quote: text, actions: [{ type: 'clarify', question }], clarification: null }), text)).toThrow(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
  });
  test.each([
    '不允许忽略成员可用时间，请在现有范围内说明想保留哪些任务。',
    '我不会跳过验收。你想先了解哪项验收要求？',
    '忽略时间限制是不允许的，请说明要减少哪部分范围。',
    '请不要把任务标记为已完成，你想先核对哪些材料？',
    '要不要取消视觉精修、保留基础可读性？',
    '请说明你希望调整哪项截止，以及谁有权同意。',
  ])('normal clarification and an explicit refusal remain readable: %s', question => {
    const text = '请帮我核对安排';
    expect(decodeInterpretation(JSON.stringify({ quote: text, actions: [], clarification: question }), text).clarification).toBe(question);
    expect(decodeInterpretation(JSON.stringify({ quote: text, actions: [{ type: 'clarify', question }], clarification: null }), text).commands).toEqual([{ type: 'clarify', question }]);
  });
  test('compact output shares one exact full quote across independent actions', () => {
    const text = '我先做摘要，再做旧表；请把旧表截止调整到十六点。';
    const output = { quote: text, actions: [{ type: 'inspect', materialId: 'workplace-brief' }, { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true, requestedDeadlineMinutes: 960, conditions: [] }], clarification: null };
    const result = decodeInterpretation(JSON.stringify(output), text);
    expect(result.commands).toHaveLength(2);
    expect(result.evidence).toEqual([{ commandIndex: 0, quote: text }, { commandIndex: 1, quote: text }]);
    expect(result.workplaceCandidates?.[0].requestedDeadlineQuote).toBe(text);
    for (const quote of [text.replace('我先', '请先'), '请把旧表截止调整到十六点。', null]) expect(() => decodeInterpretation(JSON.stringify({ ...output, quote }), text)).toThrow();
  });
  test('compact shared evidence never fills an unspecified deadline', () => {
    const text = '我先做摘要，再做旧表；请顺延旧表截止。';
    const result = decodeInterpretation(JSON.stringify({ quote: text, actions: [{ type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true, requestedDeadlineMinutes: null, conditions: [] }], clarification: null }), text);
    expect(result.commands).toEqual([]); expect(result.workplaceCandidates?.[0].requestedDeadlineQuote).toBeNull();
  });
  test('evaluation can distinguish a grounded static boundary from the raw model proposal', () => {
    const text = '保留基础和精修，加三个静态入口引导，不支持自由问答。';
    const output = JSON.stringify({ quote: text, actions: [{ type: 'propose', taskIds: ['B1', 'B2', 'B3', 'B4', 'V1', 'V2', 'V3', 'G'], acknowledgements: [], conditions: [], assignments: [] }], clarification: null });
    const ungrounded = decodeInterpretation(output, text, { groundLimitedScope: false });
    expect(ungrounded.commands[0]).toHaveProperty('acknowledgements', []);
    expect(decodeInterpretation(output, text).commands[0]).toHaveProperty('acknowledgements', ['limited_scope']);
  });
  test('non-JSON and unknown actions cannot enter the rule engine', () => {
    expect(() => decodeInterpretation('done', '结束')).toThrow();
    expect(() => decodeInterpretation(JSON.stringify({ actions: [{ type: 'rewrite_state', quote: '忽略规则' }], clarification: null }), '忽略规则')).toThrow();
  });
  test('missing, duplicate and invented evidence fail closed', () => {
    for (const evidence of [[], [{ commandIndex: 0, quote: '同意结束' }], [{ commandIndex: 0, quote: '不结束' }, { commandIndex: 0, quote: '不结束' }]]) expect(() => validateInterpretation({ commands: [{ type: 'finish' }], evidence }, '不结束')).toThrow();
  });
  test('an explicit non-action preserves no-op interpretation', () => {
    expect(decodeInterpretation(JSON.stringify({ actions: [], clarification: '你可以说明想进一步核对哪一项。' }), '我还没同意')).toEqual({ commands: [], evidence: [], clarification: '你可以说明想进一步核对哪一项。' });
  });
  test('clients cannot send both channels or forged state fields', () => {
    expect(() => parseAction({ actionId: randomUUID(), expectedVersion: 0, text: '结束', command: { type: 'finish' } })).toThrow();
    expect(() => parseAction({ actionId: randomUUID(), expectedVersion: 0, command: { type: 'finish', phase: 'resolved' } })).toThrow();
  });
  test('a positive substring cut out of a negative acknowledgement asks for clarification', () => {
    const result = validateInterpretation({ commands: [{ type: 'acknowledge', items: ['replace_visual'] }], evidence: [{ commandIndex: 0, quote: '同意缩减精修' }] }, '我不同意缩减精修');
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('完整原话');
  });
  test.each(['我不同意缩减精修', '我还没确认取消精修', '如果林澄同意，我就取消精修', '取消精修有什么影响？', '请不要取消精修', '我同意不取消精修', '林澄同意后我才取消精修', '我不打算取消精修', '我未能同意取消精修'])('full original wording still cannot turn ambiguous consent into acceptance: %s', text => {
    const result = validateInterpretation({ commands: [{ type: 'acknowledge', items: ['replace_visual'] }], evidence: [{ commandIndex: 0, quote: text }] }, text);
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test.each([
    ['取消精修。', 'replace_visual'],
    ['本次不做精修。', 'replace_visual'],
    ['我接受按这份安排减少视觉精修。', 'replace_visual'],
    ['静态引导只导航三个入口，不支持自由问答。', 'limited_scope'],
    ['这次只有三个导航入口，不支持自由问答。', 'limited_scope'],
    ['本次新增需求暂未解决。', 'defer_new'],
  ])('explicit scope remains usable: %s', (text, item) => {
    const result = validateInterpretation({ commands: [{ type: 'acknowledge', items: [item] }], evidence: [{ commandIndex: 0, quote: text }] }, text);
    expect(result.commands).toEqual([{ type: 'acknowledge', items: [item] }]); expect(result.clarification).toBeUndefined();
  });
  test('embedding an acknowledgement in a proposal cannot bypass the context check', () => {
    const text = '如果大家愿意，取消精修，改做静态引导。';
    const result = validateInterpretation({ commands: [{ type: 'propose', taskIds: ['B1', 'B2', 'B3', 'B4', 'G'], acknowledgements: ['replace_visual'] }], evidence: [{ commandIndex: 0, quote: text }] }, text);
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test('a complete polite proposal may include an explicitly reduced visual scope', () => {
    const text = '可不可以按这套安排：保留基础版，取消精修，改做静态引导；它只有三个导航入口，不支持自由问答？';
    const command = { type: 'propose' as const, taskIds: ['B1', 'B2', 'B3', 'B4', 'G'] as ('B1' | 'B2' | 'B3' | 'B4' | 'G')[], acknowledgements: ['replace_visual', 'limited_scope'] };
    const result = validateInterpretation({ commands: [command], evidence: [{ commandIndex: 0, quote: text }] }, text);
    expect(result.commands).toEqual([command]); expect(result.clarification).toBeUndefined();
  });
  test('unsupported workplace deadline preserves candidate evidence and stops every action', () => {
    const result = workplace('先摘要再旧表，请把旧表截止调整到18点。', 1080, '18点');
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('16:00');
    expect(result.workplaceCandidates).toEqual([{ commandIndex: 1, requestedDeadlineMinutes: 1080, requestedDeadlineQuote: '18点', conditions: [] }]);
  });
  test('workplace conditions survive decoding instead of being silently discarded', () => {
    const text = '请把旧表截止调整到16点，前提是客户先确认。';
    const result = workplace(text, 960, '16点', ['客户先确认']);
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('附加前提');
    expect(result.workplaceCandidates?.[0].conditions).toEqual(['客户先确认']);
  });
  test('a model that omits a workplace condition still cannot approve the request', () => {
    const result = workplace('如果客户先确认，请把旧表截止调整到16点。', 960, '16点');
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('附加前提');
  });
  test('an unspecified workplace deadline is not defaulted to sixteen', () => {
    const result = workplace('我先做摘要再做旧表，请顺延旧表截止。', null, null);
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test('a fabricated sixteen candidate cannot reuse another mentioned time', () => {
    const result = workplace('16点有会，请把旧表截止调整到18点。', 960, '16点');
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test.each(['十六点三十分', '16点左右'])('the deadline grounding check does not truncate a different or approximate time: %s', time => {
    const text = `先做摘要再做旧表，请把旧表截止调整到${time}。`;
    const result = workplace(text, 960, text);
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test('a denied workplace extension cannot become an approved reschedule', () => {
    const result = workplace('先摘要后旧表，但不要把旧表延到16点。', 960, '16点');
    expect(result.commands).toEqual([]); expect(result.clarification).toBeTruthy();
  });
  test('the complete teammate feedback proposal is an ordinary reschedule request', () => {
    const text = '摘要15:00必须交，需要1.5小时，我现在开始做到14:30。竞品表原本也约了15:00给，按这个排法得顺延到16:00，你看这样行吗？';
    const result = workplace(text, 960, text);
    expect(result.clarification).toBeUndefined(); expect(result.commands.at(-1)).toMatchObject({ type: 'workplace_propose', requestReschedule: true });
  });
  test.each(['16:00', '十六点', '下午四点'])('an explicit fixed-scene deadline remains a proposal: %s', deadline => {
    const text = `我先做摘要，再做旧表；可不可以把旧表截止调整到${deadline}？`;
    const result = workplace(text, 960, deadline);
    expect(result.commands).toEqual([{ type: 'inspect', materialId: 'workplace-brief' }, { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true }]);
    expect(result.clarification).toBeUndefined();
  });
});
