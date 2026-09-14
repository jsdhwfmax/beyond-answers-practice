import type { GameEvent, GameState } from './types';
export { neededAcknowledgements } from './acknowledgements';

export interface PracticeGuidance {
  stage: 'orient' | 'clarify' | 'negotiate' | 'agreed' | 'execute' | 'complete' | 'ended';
  title: string;
  detail: string;
  suggestedPrompts: string[];
  canReview: boolean;
  isEnded: boolean;
}

/** Derived from saved facts. Agreement is a conversational milestone, not an exit. */
export function derivePracticeGuidance(state: GameState, events: Pick<GameEvent, 'kind' | 'text'>[] = []): PracticeGuidance {
  const guidance = (stage: PracticeGuidance['stage'], title: string, detail: string, suggestedPrompts: string[] = []): PracticeGuidance => ({ stage, title, detail, suggestedPrompts, canReview: state.agreement.status === 'confirmed' || events.some(event => event.kind === 'input'), isEnded: stage === 'ended' });
  if (state.phase === 'ended') return guidance('ended', '这段尝试已保存', '可以回看约定和未定事项，或保留这份记录、换一种做法再练。');
  const last = events.at(-1);
  if (last?.kind === 'clarification') return guidance('clarify', '接着回答这个小问题', last.text);
  if (state.scenario === 'transfer') {
    if (state.transfer.verified) return guidance('complete', '模拟发布和检查都完成了', '这次已经形成可检查的小闭环。你可以说说准备怎样用于自己的事情，再选择何时回看记录。');
    if (state.transfer.published) return guidance('execute', '已经发布，下一步检查结果', '请模拟提交一次并核对记录。看到记录后，才知道这份预览能否真的使用。', ['现在模拟提交一次，并核对提交记录。']);
    if (state.transfer.plan.length) return guidance('execute', '计划写好了，接着亲手做一步', '排好计划还不算执行。先操作计划中的发布，再检查模拟提交；你也可以调整计划。', ['现在发布可用预览。']);
    return guidance('orient', '先选出你准备做的下一步', '你有 30 分钟，目标是让招新预览可用。先写出自己的行动顺序，收到反馈后再实际操作。');
  }
  if (state.scenario === 'workplace') {
    if (state.workplace.issues.length) return guidance('negotiate', '继续协调这个冲突', `${state.workplace.issues[0]} 你可以改变顺序，或向负责人提出具体的截止调整。`, ['请帮我确认两项任务的截止和谁有权调整。']);
    if (state.workplace.managerAccepted) return guidance('agreed', '安排谈妥了，可以带走这次经验了', '新旧截止已保存，工作尚未执行。点击下方回看表达、取舍和下一步；还有想问的，也可以继续聊。', ['请再核对一下两项工作的交付要求。']);
    return guidance('orient', '先向负责人问清一个冲突', '你是刚入职的实习生：新摘要和旧竞品表都要处理。可以先问截止与调整权限，再提出自己的先后顺序。', ['两项工作的截止分别是什么，谁可以调整？']);
  }
  if (state.proposal?.status === 'rejected') return guidance('negotiate', '这份安排遇到了一个具体限制', `${state.proposal.issues[0] ?? '还需要核对任务安排。'} 原有约定仍在，你可以改范围、负责人或时间后再提议。`, ['每个人具体有哪些可用时间和能力？']);
  if (state.proposal?.status === 'pending') {
    if (state.proposal.conditions.length) {
      const scheduleQuestion = last?.kind === 'proposal_pending' ? last.text.match(/按这份安排，[\s\S]+$/)?.[0] : undefined;
      return guidance('negotiate', scheduleQuestion ? '这个检查点与排期对不上' : '你的前提还在，接着把它说清', scheduleQuestion ?? `待核对：${state.proposal.conditions[0]}。安排被接受不等于工作已完成；先说清检查什么、条件不成立时保留什么。`);
    }
    return guidance('negotiate', '接着回应队友的顾虑', `${state.proposal.issues[0] ?? '还有一项范围需要说清。'} 你可以补充，也可以修改提议；当前安排还没有替换原约定。`);
  }
  if (state.agreement.status === 'confirmed') return guidance('agreed', '安排谈妥了，可以带走这次经验了', '排期和取舍已保存，工作尚未执行。点击下方回看这次改变，或重试另一种安排；还有想问的，也可以继续聊。', ['请再核对一下这份安排保留了什么，还有什么没有解决？']);
  if (!state.revealed.includes('feedback')) return guidance('orient', '先问问：为什么突然想加功能？', '你是协调者，不需要写代码。先向队友了解新增需求，再决定今晚保留什么、改变什么。', ['试用的人具体遇到了什么问题？']);
  return guidance('negotiate', '已经了解问题，试着提出一个安排', '用自己的话说出今晚做什么、暂不做什么，以及要向谁核对。没有唯一标准方案，队友会回应具体的取舍。', ['现成的问答组件能做什么，需要哪些工作？']);
}
