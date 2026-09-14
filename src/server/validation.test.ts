import { describe, expect, test } from 'vitest';
import type { Command } from '@/domain/types';
import { initialState, transition } from '@/domain/engine';
import { ORIGINAL_TASKS } from '@/domain/scenarios';
import { groundExplicitLimitedScope, parseAction, validateInterpretation, type ModelInterpretation } from './validation';

type Acknowledgement = 'replace_visual' | 'limited_scope' | 'defer_new';
function candidate(text: string, item: Acknowledgement, proposal = true) {
  const command: Command = proposal
    ? { type: 'propose', taskIds: ['B1', 'B2', 'B3', 'B4'], acknowledgements: [item] }
    : { type: 'acknowledge', items: [item] };
  return validateInterpretation({ commands: [command], evidence: [{ commandIndex: 0, quote: text }] }, text);
}

describe('complete-utterance grounding of development acknowledgement synonyms', () => {
  // Actual development examples only. Task feasibility is deliberately not
  // tested here: these checks must not decide the schedule or actor acceptance.
  test.each<[Acknowledgement, string]>([
    ['replace_visual', '把视觉精修从本次范围中拿掉，基础照做，问答内容测试、界面状态与接入验收一起完成。'],
    ['limited_scope', '我提议基础、视觉精修都保留，再做静态引导；向大家明确，它不会回答自由输入的问题。'],
    ['defer_new', '按原来基础加精修交付，新增需求本次暂缓，尚未解决的问题明确记录下来，不承诺下次完成。'],
    ['defer_new', '今晚只做原有基础与精修，把新需求列为待评估。我接受本次不处理它，留一小时缓冲。'],
    ['defer_new', '这次保留基础和全部精修，剩余开发时间留作缓冲。我知道新生入口问题还没有解决。'],
  ])('%s retains a directly stated development tradeoff: %s', (item, text) => {
    const result = candidate(text, item);
    expect(result.clarification).toBeUndefined();
    expect(result.commands).toHaveLength(1);
    expect(result.evidence).toEqual([{ commandIndex: 0, quote: text }]);
  });

  test.each<[Acknowledgement, string]>([
    ['replace_visual', '视觉精修从本次范围中拿掉。'],
    ['replace_visual', '我接受将视觉精修移除，基础可读性保留。'],
    ['limited_scope', '静态引导只展示三个导航入口，不会回答自由输入的问题。'],
    ['limited_scope', '仅做三个导航入口，不能回答自由输入的内容。'],
    ['defer_new', '新增问题本次不处理，列入待评估。'],
  ])('%s also grounds explicit standalone acknowledgement: %s', (item, text) => {
    expect(candidate(text, item, false).clarification).toBeUndefined();
  });

  test.each<[Acknowledgement, string]>([
    ['replace_visual', '不要把视觉精修从本次范围中拿掉，基础照做，问答需要再评估。'],
    ['replace_visual', '视觉精修不能从本次范围中拿掉。'],
    ['replace_visual', '我没有把视觉精修从本次范围中拿掉。'],
    ['replace_visual', '我不打算将视觉精修移除，基础可读性必须保留。'],
    ['replace_visual', '如果大家同意，把视觉精修从本次范围中拿掉。'],
    ['replace_visual', '视觉精修移除后有什么代价？'],
    ['replace_visual', '把视觉精修从范围拿掉是什么意思？'],
    ['replace_visual', '视觉精修保留，新增需求本次不做。'],
    ['limited_scope', '静态引导只做三个入口，但不是不会回答自由输入的问题。'],
    ['limited_scope', '静态引导只做三个入口，它没有不支持自由问答。'],
    ['limited_scope', '静态引导只做三个入口，它不会不支持自由问答。'],
    ['limited_scope', '静态引导只展示三个导航入口，不要说它不会回答自由输入的问题。'],
    ['limited_scope', '静态引导不止三个入口，它不会回答自由输入的问题。'],
    ['limited_scope', '只做三个入口，不支持自由问答，但也可以自由聊天。'],
    ['limited_scope', '只做三个入口，不支持自由问答，但也能自由聊天。'],
    ['limited_scope', '本次做静态引导，共有四个入口，不会回答自由输入的问题。'],
    ['limited_scope', '本次做静态引导，共有13个导航入口，不支持自由问答。'],
    ['limited_scope', '如果大家接受，我提议只做静态引导，它不会回答自由输入的问题。'],
    ['limited_scope', '静态引导不会回答自由输入的问题，这是什么意思？'],
    ['defer_new', '不把新需求列为待评估，本次必须处理完。'],
    ['defer_new', '新需求已经解决，不要再列为待评估。'],
    ['defer_new', '新需求不能暂缓，这次必须处理完。'],
    ['defer_new', '我不接受本次不处理新需求，也不同意列为待评估。'],
    ['defer_new', '如果负责人同意，把新需求列为待评估，我接受本次不处理它。'],
    ['defer_new', '把新需求列为待评估是什么意思？'],
    ['defer_new', '我不接受新生入口问题还没有解决。'],
    ['defer_new', '我没有说新生入口问题还没有解决。'],
    ['defer_new', '如果新生入口问题还没有解决，就先保留原来的安排。'],
    ['defer_new', '新生入口问题还没有解决是什么意思？'],
    ['defer_new', '新生入口问题不是还没有解决，而是已经解决了。'],
    ['defer_new', '新增需求已经解决，基础问题还没有解决。'],
    ['defer_new', '尚未解决的是基础问题，新增需求已经解决。'],
  ])('%s cannot commit a negated, conditional or informational statement: %s', (item, text) => {
    for (const proposal of [true, false]) {
      const result = candidate(text, item, proposal);
      expect(result.commands).toEqual([]);
      expect(result.clarification).toBeTruthy();
    }
  });

  test.each<[Acknowledgement, string]>([
    ['limited_scope', '今晚先保留原有基础和精修，新增三个导航入口就够了，只做报到、报修、校园卡的有限引导。'],
    ['defer_new', '尚未解决的问题明确记录下来，留待后续评估。'],
    ['defer_new', '我接受本次不处理它，留一小时缓冲。'],
    ['defer_new', '入口问题还没有解决。'],
  ])('%s still clarifies an absent capability boundary or unresolved referent: %s', (item, text) => {
    const result = candidate(text, item);
    expect(result.commands).toEqual([]);
    expect(result.clarification).toBeTruthy();
  });
});

describe('each model-interpreted short-practice plan step needs positive user evidence', () => {
  const interpretPlan = (text: string, steps: string[]) => validateInterpretation({ commands: [{ type: 'transfer_plan', steps }], evidence: [{ commandIndex: 0, quote: text }] }, text);

  test('post-holdout safety regression: an unmentioned verification cannot enter the first plan', () => {
    // Discovered in the first held-out run; the original 80-case results are
    // retained. This offline regression is not a new held-out model evaluation.
    const text = '我决定先找更多好看的参考，再发出页面。';
    const input: ModelInterpretation = { commands: [{ type: 'transfer_plan', steps: ['references', 'publish', 'verify'] }], evidence: [{ commandIndex: 0, quote: text }] };
    const snapshot = structuredClone(input);
    const result = validateInterpretation(input, text);
    expect(result.commands).toEqual([]);
    expect(result.clarification).toBeTruthy();
    expect(input).toEqual(snapshot);
    const untouched = result.commands.reduce((state, command) => transition(state, command).state, initialState('transfer'));
    expect(untouched.transfer.firstPlan).toBeNull();
    expect(untouched.transfer.plan).toEqual([]);

    const faithful = interpretPlan(text, ['references', 'publish']);
    expect(faithful.clarification).toBeUndefined();
    const recorded = transition(initialState('transfer'), faithful.commands[0]).state;
    expect(recorded.transfer.firstPlan).toEqual(['references', 'publish']);
    expect(recorded.transfer.elapsed).toBe(0);
  });

  test.each<[string, string[]]>([
    ['我的计划是先发布预览，再运行提交并核对记录。', ['publish', 'verify']],
    ['先花二十分钟收集参考，再发布。', ['references', 'publish']],
    ['先核对记录，然后再发布预览。', ['verify', 'publish']],
    ['我只是想发布，没有说已经发布完成。', ['publish']],
    ['我要先发布、再检查，额外参考这次不收集。', ['publish', 'verify']],
    ['把页面发出去，然后核验模拟提交的记录。', ['publish', 'verify']],
    ['上线预览，并验证提交结果。', ['publish', 'verify']],
    ['先搜集视觉素材，再发布网页，最后验收。', ['references', 'publish', 'verify']],
    ['先寻找好看的设计案例，然后发出页面。', ['references', 'publish']],
    ['先检查，再发布。', ['verify', 'publish']],
    ['我决定发布预览，之后核对记录。', ['publish', 'verify']],
  ])('retains stated steps and order without completing or correcting the lesson: %s', (text, steps) => {
    const result = interpretPlan(text, steps);
    expect(result.clarification).toBeUndefined();
    expect(result.commands).toEqual([{ type: 'transfer_plan', steps }]);
    expect(result.evidence).toEqual([{ commandIndex: 0, quote: text }]);
  });

  test.each<[string, string[]]>([
    ['先发布，再收集参考。', ['publish', 'references', 'verify']],
    ['先核对记录，再收集参考。', ['verify', 'references', 'publish']],
    ['先发布，再核对记录。', ['publish', 'verify', 'references']],
    ['我决定先收集参考。', ['publish']],
    ['我决定先发布预览。', ['verify']],
    ['我决定先核对记录。', ['references']],
    ['先做一个可以交付的小结果。', ['publish']],
    ['发布按钮已经画好了。', ['publish']],
    ['先检查文案，再发布。', ['verify', 'publish']],
    ['先核对参考，再发布。', ['verify', 'publish']],
    ['核对记录是验收要求。', ['verify']],
    ['我要先发布、再检查，额外参考这次不收集。', ['publish', 'verify', 'references']],
    ['我不想发布预览。', ['publish']],
    ['这次不收集参考。', ['references']],
    ['先发布，再不检查。', ['publish', 'verify']],
    ['先发布，再核对记录；后来决定不检查。', ['publish', 'verify']],
    ['如果还有时间，先发布，再核对记录。', ['publish', 'verify']],
    ['我可以先发布再核对记录吗？', ['publish', 'verify']],
    ['先发布，然后要不要核对记录？', ['publish', 'verify']],
    ['题目要求发布和检查，我决定收集参考。', ['publish', 'verify', 'references']],
  ])('clarifies the whole plan when a step is missing, denied, conditional or only mentioned: %s', (text, steps) => {
    const result = interpretPlan(text, steps);
    expect(result.commands).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.clarification).toBeTruthy();
  });

  test('explicit structured operations do not require invented natural-language evidence', () => {
    const command: Command = { type: 'transfer_plan', steps: ['references', 'publish', 'verify'] };
    const action = parseAction({ actionId: 'b56f29ce-4db4-401d-af1a-adb43cbd6f3c', expectedVersion: 0, command });
    expect(action.command).toEqual(command);
    expect(transition(initialState('transfer'), action.command!).state.transfer.firstPlan).toEqual(command.steps);
  });
});

describe('strict recovery of an explicit limited_scope omission', () => {
  const text = '我提议保留基础和全部视觉精修，再做三个静态引导入口。只导航到报到、报修、校园卡，不支持自由问答。';
  const proposal = (): Extract<Command, { type: 'propose' }> => ({ type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], conditions: [], acknowledgements: [] });
  const decoded = (inputText = text, command: Command = proposal()): ModelInterpretation => ({ commands: [command], evidence: [{ commandIndex: 0, quote: inputText }] });

  test('the actual A scope can retain the user’s already-stated limit without another turn', () => {
    const original = validateInterpretation(decoded(), text);
    const snapshot = structuredClone(original);
    const grounded = groundExplicitLimitedScope(original, text);
    expect(original).toEqual(snapshot);
    expect(grounded.commands).toEqual([{ ...proposal(), acknowledgements: ['limited_scope'] }]);
    expect(grounded.evidence).toEqual(original.evidence);
    expect(groundExplicitLimitedScope(grounded, text)).toBe(grounded);
    const result = transition(initialState('campus'), grounded.commands[0]);
    expect(result.state.proposal?.status).toBe('accepted');
    expect(result.state.proposal?.acceptedBy).toEqual(['lin', 'xu', 'zhou']);
    expect(result.state.taskIds).toEqual([...ORIGINAL_TASKS, 'G']);
  });

  test.each([
    '我提议保留基础和全部视觉精修，再做三个静态引导入口。',
    '我提议保留基础和全部视觉精修，只导航三个入口，不支持自由问答，这样可以吗？',
    '我不同意只做三个静态入口，也不同意不支持自由问答。',
    '如果大家同意，我提议只导航三个入口，不支持自由问答。',
    '林澄说只导航三个入口，不支持自由问答，我还没有决定。',
    '我只是在转述：只导航三个入口，不支持自由问答。',
  ])('does not supplement an absent boundary, question, negation, condition or reported statement: %s', inputText => {
    const value = validateInterpretation(decoded(inputText), inputText);
    expect(groundExplicitLimitedScope(value, inputText)).toBe(value);
  });

  test.each(['Q1', 'Q2', 'Q3'] as const)('does not supplement mixed static and %s work', taskId => {
    const command = proposal(); command.taskIds.push(taskId);
    const value = validateInterpretation(decoded(text, command), text);
    expect(groundExplicitLimitedScope(value, text)).toBe(value);
  });

  test('does not infer G, clear a condition or replace the other acknowledgements', () => {
    for (const command of [
      { ...proposal(), taskIds: ORIGINAL_TASKS },
      { ...proposal(), conditions: ['需得到外援确认'] },
      { ...proposal(), acknowledgements: ['limited_scope'] },
    ]) {
      const value = validateInterpretation(decoded(text, command), text);
      expect(groundExplicitLimitedScope(value, text)).toBe(value);
    }
    const unsupported = '我接受取消视觉精修，新需求暂缓。';
    const value = validateInterpretation(decoded(unsupported), unsupported);
    expect(groundExplicitLimitedScope(value, unsupported).commands).toEqual(value.commands);
    expect((value.commands[0] as Extract<Command, { type: 'propose' }>).acknowledgements).toEqual([]);
  });

  test('does not repair a partial quote, multiple intents or an existing clarification', () => {
    const partial = { ...decoded(), evidence: [{ commandIndex: 0, quote: '不支持自由问答' }] };
    expect(groundExplicitLimitedScope(partial, text)).toBe(partial);
    const invalid = validateInterpretation(partial, text);
    expect(invalid.clarification).toBeTruthy();
    expect(groundExplicitLimitedScope(invalid, text)).toBe(invalid);
    const multiple: ModelInterpretation = { commands: [proposal(), { type: 'inspect', materialId: 'members' }], evidence: [{ commandIndex: 0, quote: text }, { commandIndex: 1, quote: text }] };
    expect(groundExplicitLimitedScope(multiple, text)).toBe(multiple);
    const unclear = { ...decoded(), clarification: '还需要澄清具体范围。' };
    expect(groundExplicitLimitedScope(unclear, text)).toBe(unclear);
    const clarifyCommand: ModelInterpretation = { commands: [{ type: 'clarify', question: '具体指哪些任务？' }], evidence: [{ commandIndex: 0, quote: text }] };
    expect(groundExplicitLimitedScope(clarifyCommand, text)).toBe(clarifyCommand);
  });

  test('supplementing the limit cannot accept missing visual consent or an invalid schedule', () => {
    const withoutVisual = { ...proposal(), taskIds: ['B1', 'B2', 'B3', 'B4', 'G'] as Extract<Command, { type: 'propose' }>['taskIds'] };
    const grounded = groundExplicitLimitedScope(validateInterpretation(decoded(text, withoutVisual), text), text);
    expect((grounded.commands[0] as Extract<Command, { type: 'propose' }>).acknowledgements).toEqual(['limited_scope']);
    const pending = transition(initialState('campus'), grounded.commands[0]);
    expect(pending.state.proposal?.status).toBe('pending');
    expect(pending.state.taskIds).toEqual(ORIGINAL_TASKS);
    expect(pending.state.proposal?.issues).toEqual(expect.arrayContaining([expect.stringContaining('精修')]));
    expect(pending.state.proposal?.acceptedBy).not.toContain('xu');

    const impossible: Extract<Command, { type: 'propose' }> = { ...proposal(), assignments: [{ taskId: 'G', actor: 'zhou', start: 1080 }] };
    const invalid = groundExplicitLimitedScope(validateInterpretation(decoded(text, impossible), text), text);
    const refused = transition(initialState('campus'), invalid.commands[0]);
    expect(refused.state.agreement.status).not.toBe('confirmed');
    expect(refused.state.taskIds).toEqual(ORIGINAL_TASKS);
  });
});
