import { describe, expect, test } from 'vitest';
import { initialState, transition } from '@/domain/engine';
import { ORIGINAL_TASKS } from '@/domain/scenarios';
import type { Command } from '@/domain/types';
import { explicitlyEndsPractice, guardPracticeIntent, preflightPracticeClarification } from './practice-intent';
import { validateInterpretation } from './validation';

const screenshot = '我们要不先保留基础版本，然后开始动手修改新版本，如果能在21：30前完成并且核对的话，我们就ok，不然就保留基础版本';
const candidate = (text: string, commands: Command[]) => ({ commands, evidence: commands.map((_, commandIndex) => ({ commandIndex, quote: text })) });

describe('the user decides when a practice ends', () => {
  test('a known unspecified conditional version asks one scope question before spending a model call', () => {
    expect(preflightPracticeClarification(screenshot, initialState('campus'))).toMatchObject({ commands: [], clarification: expect.stringContaining('新版本') });
    expect(preflightPracticeClarification('新版本指限定范围问答，如果同意我就这样安排。', initialState('campus'))).toBeUndefined();
    expect(preflightPracticeClarification('请介绍现成问答的新功能。', initialState('campus'))).toBeUndefined();
    expect(preflightPracticeClarification(screenshot, initialState('workplace'))).toBeUndefined();
  });
  test.each([screenshot, '就ok了', '那就这样', '我们完成核对就结束工作', '先保存基础版本，接着修改新版', '如果方案可行，我们就结束练习', '我不想结束练习', '可以结束练习吗？', '他建议结束练习', '本次练习还没有结束', '我想知道怎么结束练习', '等我核对完再结束练习'])('task language, conditions and negation do not end the practice: %s', text => {
    expect(explicitlyEndsPractice(text)).toBe(false);
    const result = validateInterpretation(candidate(text, [{ type: 'finish' }]), text);
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('接着说');
  });
  test.each(['结束', '我同意结束', '先结束这次练习，没谈妥的地方如实保留。', '我就带着这些待确认问题结束吧。', '保存这次结果并结束主篇。', '这次练习到这里。', '请保存本次练习记录。'])('explicit lesson closure remains available: %s', text => {
    expect(explicitlyEndsPractice(text)).toBe(true);
    expect(validateInterpretation(candidate(text, [{ type: 'finish' }]), text).commands).toEqual([{ type: 'finish' }]);
  });
  test('the screenshot proposal is clarified before a model can substitute original polish for unknown new functionality', () => {
    const state = initialState('campus');
    const output = candidate(screenshot, [{ type: 'propose', taskIds: [...ORIGINAL_TASKS], conditions: ['如果能在21:30前完成并且核对'], acknowledgements: [] }]);
    const result = guardPracticeIntent(output, screenshot, state);
    expect(result.commands).toEqual([]); expect(result.clarification).toContain('新版本');
    expect(state).toEqual(initialState('campus')); expect(output.commands).toHaveLength(1);
  });
  test('a model cannot drop a user condition while declaring a fully specified plan', () => {
    const text = '如果21:30前验收完成，我们保留基础和精修，再加三个静态入口，否则先保留原版。';
    const output = candidate(text, [{ type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: [], acknowledgements: [] }]);
    expect(guardPracticeIntent(output, text, initialState('campus')).commands).toEqual([]);
  });
  test('answering the scope question cannot erase the preceding checkpoint and fallback', () => {
    const text = '新版本是三个静态入口，保留基础和精修，不支持自由问答。';
    const output = candidate(text, [{ type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: [], acknowledgements: ['limited_scope'] }]);
    const history = [{ actor: 'user', text: screenshot }, { actor: 'system', text: '你说的新版本具体要增加什么？' }];
    const result = guardPracticeIntent(output, text, initialState('campus'), history);
    expect(result.commands[0]).toHaveProperty('conditions', ['如果能在21：30前完成并且核对的话，我们就ok，不然就保留基础版本']);
    expect(output.commands[0]).toHaveProperty('conditions', []);
    const pending = transition(initialState('campus'), result.commands[0]);
    expect(pending.state.agreement.status).toBe('original');
    expect(pending.events.at(-1)?.text).toContain('22:00');
    expect(pending.events.at(-1)?.text).toContain('21:30');
    expect(pending.state.phase).not.toBe('ended');
  });
  test('a user may explicitly withdraw all earlier conditions while answering the scope question', () => {
    const text = '取消刚才所有条件。新版本是三个静态入口，保留基础和精修，不支持自由问答。';
    const output = candidate(text, [{ type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: [], acknowledgements: ['limited_scope'] }]);
    expect(guardPracticeIntent(output, text, initialState('campus'), [{ actor: 'user', text: screenshot }, { actor: 'system', text: '你说的新版本具体要增加什么？' }])).toEqual(output);
  });
  test('canceling conditions does not authorize withdrawing the newly stated proposal', () => {
    const text = '取消刚才所有条件。今晚保留基础和视觉精修，加三个静态入口，不支持自由问答。';
    const propose: Command = { type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: [], acknowledgements: ['limited_scope'] };
    for (const commands of [[propose, { type: 'withdraw' }], [{ type: 'withdraw' }, propose]] as Command[][]) {
      const result = guardPracticeIntent(candidate(text, commands), text, initialState('campus'));
      expect(result.commands).toEqual([propose]); expect(result.evidence).toEqual([{ commandIndex: 0, quote: text }]);
    }
    const withdrawn = '撤回原提议并取消所有条件，再保留基础和精修。';
    expect(guardPracticeIntent(candidate(withdrawn, [{ type: 'withdraw' }, propose]), withdrawn, initialState('campus')).commands).toHaveLength(2);
  });
  test('a specified new scope retains its exact unmet outcome condition without becoming a deferred plan', () => {
    const text = '新增功能是三个静态入口，保留基础和精修；如果21:30前完成并核对就采用，否则保留基础版本。';
    const output = candidate(text, [{ type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: ['如果21:30前完成并核对就采用，否则保留基础版本'], acknowledgements: [] }]);
    const validated = guardPracticeIntent(output, text, initialState('campus'));
    expect(validated).toEqual(output);
    const result = transition(initialState('campus'), validated.commands[0]);
    expect(result.state.proposal?.conditions).toEqual(output.commands[0].type === 'propose' ? output.commands[0].conditions : []);
    expect(result.state.agreement.status).toBe('original');
    expect(result.events.some(event => event.kind === 'acceptance_pending' || event.kind === 'actor_acceptance' || event.kind === 'finished')).toBe(false);
  });
});
