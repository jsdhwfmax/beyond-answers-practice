import type { GameState } from '@/domain/types';
import type { ModelInterpretation } from './validation';

const unknownScopeQuestion = '你说的“新版本”具体要增加什么：三个入口引导，还是限定范围问答？先说清范围，才能核对你的检查点和回退安排；原有约定继续保留。';
function hasUndefinedNewScope(text: string, state: GameState) {
  const vagueNewScope = /新版本|新版|新功能|新方案|新东西|改版/.test(text);
  const specifiedNewScope = /问答|精修|静态|(?:三个|3个|报到|报修|校园卡)[^。；;\n]{0,15}(?:入口|引导)|(?:入口|引导)[^。；;\n]{0,15}(?:报到|报修|校园卡)/.test(text);
  const refersToKnownProposal = state.proposal !== null && /这(?:个|份|套)|刚才|上述|刚刚|原提议/.test(text);
  return vagueNewScope && !specifiedNewScope && !refersToKnownProposal;
}

/** A known missing scope needs one question, not a model-generated guess. */
export function preflightPracticeClarification(text: string, state: GameState): ModelInterpretation | undefined {
  if (state.scenario === 'campus' && /保留|修改|动手|增加|尝试|改版/.test(text) && /如果|假如|要是|前提|否则|不然/.test(text) && hasUndefinedNewScope(text, state)) return { commands: [], evidence: [], clarification: unknownScopeQuestion };
}

/** A finish candidate needs an explicit intent to leave the exercise, not a task's completion. */
export function explicitlyEndsPractice(text: string): boolean {
  const normalized = text.trim().replace(/[！!。\s]+$/g, '');
  if (/^(?:(?:我)?(?:同意|决定)|请|先)?(?:结束|停止)(?:吧|了)?$/.test(normalized)) return true;
  if (/如果|假如|假设|要是|只有|除非|(?:完成|做完|核对|验收|答完)[^。；;\n]{0,8}(?:后|再|才)/.test(normalized)) return false;
  const clauses = normalized.split(/[。；;，,\n]/).map(clause => clause.trim());
  return clauses.some(clause => {
    if (/如果|假如|假设|要是|只有|除非|(?:不|没|未|别|不能|不要|不想|不准备|不是要|不会)[^。；;，,\n]{0,8}(?:结束|停止|收束|保存|回看)|[？?]|吗|是否|能否|可不可以|能不能|要不要|如何|怎么|怎样|想知道|请解释|举例|比如|例如|(?:他|她|你|队友)(?:说|建议)/.test(clause)) return false;
    return /(?:结束|停止|收束)[^。；;，,\n]{0,10}(?:练习|演练|主篇|角色扮演|模拟对话)|(?:练习|演练|主篇|角色扮演|模拟对话)[^。；;，,\n]{0,10}(?:到这里|结束|停止|收束)|(?:保存|查看|回看)[^。；;，,\n]{0,10}(?:复盘|练习记录|练习结果|本次记录|这次结果)|(?:我)?(?:就|先)?带着[^。；;，,\n]{1,22}(?:问题|未定事项)[^。；;，,\n]{0,5}结束/.test(clause);
  });
}

/** Keep unknown scope and outcome-dependent plans out of fixed task commitments. */
export function guardPracticeIntent(value: ModelInterpretation, text: string, state: GameState, history: { actor: string; text: string }[] = []): ModelInterpretation {
  if (value.clarification) return value;
  const clarify = (clarification: string): ModelInterpretation => ({ commands: [], evidence: [], clarification });
  if (value.commands.some(command => command.type === 'finish') && !explicitlyEndsPractice(text)) return clarify('你是在说项目做到这里就可以，还是想结束这段练习、回看记录？练习仍然保留，你可以接着说。');
  if (state.scenario !== 'campus' || !value.commands.some(command => command.type === 'propose')) return value;
  if (hasUndefinedNewScope(text, state)) return clarify(unknownScopeQuestion);
  const lastQuestion = history.at(-1);
  const previousUserText = history.findLast(item => item.actor === 'user')?.text;
  const explicitlyWithdrawsAllConditions = /(?:取消|撤回|不再保留)[^。；;，,\n]{0,10}(?:全部|所有)(?:附加)?(?:条件|前提)|(?:全部|所有)(?:附加)?(?:条件|前提)[^。；;，,\n]{0,10}(?:取消|撤回|不再保留)/.test(text);
  const explicitlyWithdrawsProposal = /(?:撤回|取消|撤销)[^。；;，,\n]{0,10}(?:提议|方案|建议)|(?:提议|方案|建议)[^。；;，,\n]{0,10}(?:撤回|取消|撤销)/.test(text);
  if (explicitlyWithdrawsAllConditions && !explicitlyWithdrawsProposal && value.commands.filter(command => command.type === 'propose').length === 1 && value.commands.some(command => command.type === 'withdraw')) {
    // Removing conditions is already represented by the replacement proposal.
    // It does not authorize withdrawing that new proposal afterwards.
    const kept = value.commands.map((command, index) => ({ command, index })).filter(item => item.command.type !== 'withdraw');
    return guardPracticeIntent({ ...value, commands: kept.map(item => item.command), evidence: kept.map((item, commandIndex) => ({ commandIndex, quote: value.evidence.find(evidence => evidence.commandIndex === item.index)!.quote })) }, text, state, history);
  }
  // This is a response to a stored scope question, not a new independent plan.
  // Restoring the user's verbatim condition can only keep the proposal pending;
  // it never creates an acceptance or invents a new condition.
  if (lastQuestion?.actor === 'system' && /新版本|新版|增加什么|新增.*范围/.test(lastQuestion.text) && previousUserText && /新版本|新版/.test(previousUserText) && !explicitlyWithdrawsAllConditions) {
    const conditionStart = previousUserText.search(/如果|假如|要是|前提/);
    if (conditionStart >= 0 && value.commands.some(command => command.type === 'propose' && !command.conditions?.length)) {
      const originalCondition = previousUserText.slice(conditionStart);
      if (originalCondition.length > 500) return clarify('新范围已经补充。你刚才提出的检查点和回退条件还需要保留哪些？请简短说明，原约定继续有效。');
      return { ...value, commands: value.commands.map(command => command.type === 'propose' && !command.conditions?.length ? { ...command, conditions: [originalCondition] } : command) };
    }
  }
  const conditional = /如果|假如|要是|倘若|前提|否则|不然|只有[^。；;\n]{0,60}才/.test(text);
  if (conditional && value.commands.some(command => command.type === 'propose' && !command.conditions?.length)) return clarify('你的安排带有前提和后续选择。请说明要先核对的条件，以及条件不成立时保留的范围；这些条件还没有变成已确认约定。');
  return value;
}
