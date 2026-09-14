import { buildExperienceBrief } from './experience-brief';
import { sourceVotesLabel } from './source-display-date';
import type { CustomBranch, CustomPracticeView } from './custom-practice';

const divider = '────────────────────────';
const list = (values: string[]) => values.length ? values.map(value => `• ${value}`).join('\n') : '尚未记录。';

function branchText(branch: CustomBranch, activeId: string | null, reflection?: string) {
  const lines = [divider, `${branch.label}${branch.id === activeId ? '（当前尝试）' : ''}`, branch.setup.title,
    `我的角色：${branch.setup.userRole}`, `模拟对方：${branch.setup.counterpartRole}`, `这次想练：${branch.setup.goal}`,
    `状态：${!branch.accepted ? '设定待确认' : branch.finished ? '已保存复盘' : '还可以继续练习'}`,
    '', '我提供的情况', list(branch.setup.userFacts), '', '仅用于模拟的假设', list(branch.setup.assumptions), '', '完整对话',
    `${branch.setup.counterpartRole}（模拟开场）：\n${branch.setup.openingLine}`];
  for (let index = 0; index <= branch.turns.length; index++) {
    for (const scene of branch.scenes?.filter(value => value.turnIndex === index) ?? []) {
      if (scene.openingKind === 'guide') lines.push('', `用户选定情境：${scene.label}`, `场景提示：\n${scene.openingLine}`);
      else lines.push('', `进入下一幕：${scene.label}`, `${branch.setup.counterpartRole}（模拟）：\n${scene.openingLine}`);
    }
    const turn = branch.turns[index];
    if (turn) lines.push('', `第 ${index + 1} 轮 · 我：\n${turn.userText}`, `${branch.setup.counterpartRole}（${turn.replyOrigin?.kind === 'user_edit' ? '用户调整的模拟假设，不作为已达成依据' : '模拟'}）：\n${turn.reply}`);
  }
  const progress = branch.goalProgress;
  const current = progress && progress.evaluatedThroughTurnId === branch.turns.at(-1)?.id;
  lines.push('', '这次练习留下了什么');
  if (!current) lines.push('这段对话尚未完成最新目标核对，可根据上方原话自行回看。');
  else {
    if (progress.verificationVersion !== 'goal-progress-v2') lines.push('历史目标与约定尚待重新核对，旧归纳不作为已达成的结果。');
    else lines.push(`目标进展：${progress.status === 'achieved' ? '模拟沟通目标已达成' : progress.status === 'partial' ? '已有部分进展' : '仍在沟通中'}`);
    const agreements = progress.verificationVersion === 'goal-progress-v2' ? progress.agreements.filter(value => value.certification?.version === 'proposal-acceptance-v1') : [];
    lines.push('', '有原话依据的双方约定');
    if (!agreements.length) lines.push('本次没有记录新的双方约定。');
    for (const agreement of agreements) {
      const certification = agreement.certification!;
      const speaker = (value: 'user' | 'counterpart') => value === 'user' ? '我' : `${branch.setup.counterpartRole}（模拟）`;
      lines.push(`提议 · ${speaker(certification.proposal.speaker)}：${certification.proposal.quote}`, `接受 · ${speaker(certification.acceptance.speaker)}：${certification.acceptance.quote}`);
    }
    lines.push('', '还可以继续谈的事', list(progress.openQuestions));
  }
  if (branch.sourceContext?.questions.length) {
    lines.push('', branch.sourceContext.basis === 'retrospective' ? '补充阅读（生成原对话时未使用这些来源）' : '本次参考的知乎经验');
    for (const question of branch.sourceContext.questions) {
      lines.push(question.title, question.questionUrl);
      for (const answer of question.answers) {
        const brief = buildExperienceBrief(question, answer.answerId);
        lines.push(`作者：${answer.author.trim() || '作者昵称未显示'}；${sourceVotesLabel(answer)}`);
        if (brief.kind === 'reviewed') lines.push('团队提炼：', brief.summary, '适用提醒：', brief.conditions, '原创模拟练法：', brief.application);
        lines.push(`原回答：${answer.url}`, '已取得的支持片段：', answer.excerpt);
      }
    }
    lines.push('归纳基于已取得的摘要，不代表完整阅读全部回答。', `来源版本：${branch.sourceContext.version}`);
  }
  if (reflection?.trim()) lines.push('', '现实里，我准备尝试的一步（本人自述）', reflection.trim());
  return lines.join('\n');
}

/** Readable UTF-8 export: preserves branches and verbatim turns; never certifies legacy summaries. */
export function formatCustomPracticeText(view: CustomPracticeView, reflections: Record<string, string> = {}): string {
  return ['答案之外｜我的经验练习记录', `我最开始想练的事：${view.topic}`, `记录更新：${view.updatedAt}`, '',
    '这是模拟记录。角色的回应和同意不代表现实中的人已经接受，练习结束也不等于现实问题已经解决。',
    ...view.branches.map(branch => branchText(branch, view.activeBranchId, reflections[branch.id])), '', divider,
    '回看自己的尝试，选一个现实中愿意试的小步骤。', `记录编号：${view.id}`].join('\n\n');
}
