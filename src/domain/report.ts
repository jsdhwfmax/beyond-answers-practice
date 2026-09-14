import { SCENARIOS } from './scenarios';
import type { ExperienceReport, GameEvent, GameState } from './types';

/** Reports recorded actions only. No generated score, invented transcript or mastery claim. */
export function buildReport(state: GameState, events: GameEvent[]): ExperienceReport {
  const changes = events.flatMap(item => item.changes.map(value => ({ ...value })));
  const evidence = events.filter(item => item.actor === 'user').slice(-8).map(item => {
    const results = events.filter(result => result.actionId === item.actionId && result.sequence > item.sequence && result.actor !== 'user');
    return { quote: item.text, result: results.map(result => result.text).join('\n') || '行动已记录；没有据此补造结果。' };
  });
  const pending = state.proposal && state.proposal.status !== 'accepted';
  const unknowns = [...new Set([...state.agreement.unknowns, ...(pending ? state.proposal!.issues : []), ...(state.scenario === 'workplace' ? state.workplace.issues : [])])];
  let status = state.agreement.status === 'confirmed' ? '已形成模拟中的确认约定' : '当前进度与待确认事项';
  let nextStep = '把本次适用条件写进自己的经验记录；现实中尝试后可以另行记录，不把模拟结果当作真实执行。';
  const tradeoffs = [...state.agreement.tradeoffs];
  if (pending) status = '既有安排保留，新提议尚未生效';
  if (state.scenario === 'transfer') {
    status = state.transfer.verified ? '模拟发布与验收已完成' : '尚未闭合模拟任务';
    tradeoffs.push(state.transfer.firstPlan === null ? '尚未提交首次计划。' : state.transfer.firstAssisted ? '首次计划前使用过提示，不能作为无提示表现。' : '首次计划已单独保留；后续修改不覆盖首次记录。');
    if (state.transfer.firstPlan !== null && !state.transfer.firstAssisted && state.transfer.hintUsed) tradeoffs.push('首次计划在提示前保存；之后使用了提示或回答选项辅助，后续表现不能记为无提示。');
    nextStep = state.transfer.verified ? '记录先完成小结果再检查的做法；这次模拟不能证明现实任务已经完成。' : '检查是否已有可用预览，以及是否实际运行并核对过模拟提交。';
  }
  if (state.scenario === 'workplace') {
    status = state.workplace.managerAccepted ? '负责人已接受当前生效安排' : '截止调整尚未获接受';
    if (state.workplace.issues.length) status += '；另一次提议仍有未定事项';
    nextStep = '保留已确认的新旧截止；如果执行条件再变化，重新说明影响并取得确认。';
  }
  return { title: `${SCENARIOS[state.scenario].title} · 我的经验记录`, scenario: state.scenario, status, scope: [...state.agreement.scope], tradeoffs, unknowns, changes, evidence, nextStep };
}
