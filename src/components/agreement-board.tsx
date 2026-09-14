'use client';

import { ArrowUpRight, Check, ClipboardList, Clock3, FileText, PencilLine, RotateCcw, Users } from 'lucide-react';
import { ACTORS, TASKS } from '@/domain/scenarios';
import type { Command, SessionView } from '@/domain/types';
import { formatTime, StatusPill } from './ui';
import { neededAcknowledgements } from '@/domain/practice-guidance';

export const ACKNOWLEDGEMENTS = [
  { id: 'limited_scope', label: '明确有限引导的范围', text: '静态引导只处理约定的入门问题，不承诺自由问答。' },
  { id: 'replace_visual', label: '协商替换原视觉交付', text: '明确哪些原有视觉任务被替换，并取得相关队友确认。' },
  { id: 'defer_new', label: '新增需要留待后续评估', text: '本次保留原范围，不把后续评估说成已承诺完成新增功能。' },
] as const;

export function AgreementBoard({ session, busy, onCommand, onEdit, onReport, onRetry }: {
  session: SessionView; busy: boolean; onCommand: (command: Command) => void;
  onEdit: () => void; onReport: () => void; onRetry: () => void;
}) {
  const { state } = session;
  const pending = state.proposal?.status === 'pending' ? state.proposal : null;
  const confirmed = state.agreement.status === 'confirmed';
  const neededAcks = neededAcknowledgements(state);
  return <section className="agreement-board" aria-labelledby="agreement-heading">
    <header className="board-header"><div className="board-title"><ClipboardList size={19} /><h2 id="agreement-heading">我们的约定</h2></div><StatusPill tone={confirmed ? 'success' : pending ? 'attention' : 'neutral'}>{confirmed ? '已确认' : pending ? '有提议待确认' : state.agreement.status === 'incomplete' ? '尚未达成完整约定' : '原有安排'}</StatusPill></header>
    <div className="board-goal"><span className="field-label">{state.scenario === 'campus' ? '项目交付目标' : state.scenario === 'transfer' ? '已经明确的完成条件' : '两项任务的交付要求'}</span><p>{state.scenario === 'campus' ? '交付能展示、可使用的新生校园指南。今晚 22:00 前完成版本，明天展示。' : state.scenario === 'transfer' ? '在 30 分钟内发布模拟预览，并运行一次模拟提交、核对记录。' : '15:00 前完成演示摘要，同时处理原定 15:00 的竞品表承诺；截止调整需要负责人确认。'}</p></div>
    {state.scenario === 'campus' ? <>
      {pending ? <div className="proposal-orientation"><strong>你的新提议还在讨论中</strong><p>{pending.issues[0] ?? '有一项前提还需要说清。'} 可以接着回应，不需要结束练习。</p><small>下方任务是仍然生效的原安排，尚未被本轮提议替换。</small></div> : null}
      <div className="section-heading"><h3>{pending ? '仍然生效的原安排' : '已接受的任务安排'}</h3><span>{state.taskIds.length} 项</span></div>
      <p className="schedule-explanation">以下是已约定的排期，工作尚未执行。</p>
      <ul className="task-list">{state.taskIds.map((id) => {
        const task = TASKS[id];
        const slot = state.schedule.find((item) => item.taskId === id);
        return <li key={id}><span className={`task-mark task-${task.group}`} aria-hidden="true"><Clock3 size={12} /></span><div><strong>{task.title}</strong><span>{ACTORS[slot?.actor ?? task.actor].name}{slot ? ` · ${formatTime(slot.start)}–${formatTime(slot.end)}` : ` · 预计 ${task.minutes} 分钟`}</span></div></li>;
      })}</ul>
      <div className="board-acceptance"><h3>按什么验收</h3><ul className="plain-list"><li>基础版本：核对 12 条指南内容，检查页面可读性、现有路由与集成。</li>{state.taskIds.includes('G') ? <li>静态引导：三个入口分别到达报到、报修、校园卡正文，不承诺自由问答。</li> : null}{state.taskIds.includes('Q3') ? <li>问答：限现有 12 条指南，回答显示出处，范围外提示不知道。</li> : null}</ul></div>
      {pending ? <div className="pending-proposal">
        <div className="section-heading"><h3>这份提议尚未生效</h3><StatusPill tone="attention">待确认</StatusPill></div>
        <p className="proposal-scope">{pending.taskIds.map((id) => TASKS[id].title).join('、')}</p>
        {pending.conditions.length ? <><span className="field-label">你提出的前提</span><ul className="plain-list">{pending.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul></> : null}
        {pending.issues.length ? <ul className="issue-list">{pending.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}
        <div className="acknowledgement-list">{ACKNOWLEDGEMENTS.filter((item) => neededAcks.includes(item.id)).map((item) => <button key={item.id} className="acknowledgement-button" disabled={busy} onClick={() => onCommand({ type: 'acknowledge', items: [item.id] })}><span><strong>{item.label}</strong><small>{item.text}</small></span><ArrowUpRight size={17} /></button>)}</div>
        <button className="text-button" disabled={busy} onClick={() => onCommand({ type: 'withdraw' })}>撤回这份提议</button>
      </div> : null}
      {state.proposal?.status === 'rejected' ? <div className="notice notice-attention"><strong>这份安排暂时不能成立</strong><ul className="plain-list">{state.proposal.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><span>已生效的约定保持不变，可以修改后再提。</span></div> : null}
      <button className="button button-board" onClick={onEdit} disabled={busy || state.phase === 'ended'}><PencilLine size={17} />提出一份安排<span>打开任务板</span></button>
    </> : state.scenario === 'transfer' ? <div className="transfer-summary">
      <div className="board-stat"><Clock3 size={18} /><div><strong>已用 {state.transfer.elapsed} 分钟</strong><span>模拟时间由执行动作推进</span></div></div>
      <div className="check-row"><span>{state.transfer.published ? <Check size={16} /> : <span className="empty-check" />}</span>模拟预览已发布</div>
      <div className="check-row"><span>{state.transfer.verified ? <Check size={16} /> : <span className="empty-check" />}</span>已完成一次模拟提交检查</div>
      <p className="small-note">首次计划与后续执行分别记录。阅读和思考不消耗模拟时间。</p>
    </div> : <div className="workplace-summary">
      <div className="board-stat"><Clock3 size={18} /><div><strong>竞品表截止 {formatTime(state.workplace.tableDeadline)}</strong><span>{state.workplace.managerAccepted ? '负责人已确认本次调整' : '原承诺仍有效'}</span></div></div>
      {state.schedule.length ? <><div className="section-heading"><h3>已生效的安排</h3></div><ul className="task-list">{state.schedule.map((slot, index) => <li key={index}><span className="task-mark"><Clock3 size={12} /></span><div><strong>{slot.taskId === 'summary' ? '演示摘要' : slot.taskId === 'table' ? '竞品表' : slot.taskId}</strong><span>{formatTime(slot.start)}–{formatTime(slot.end)}</span></div></li>)}</ul></> : null}
      {state.workplace.issues.length ? <ul className="issue-list">{state.workplace.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}
    </div>}
    {state.agreement.tradeoffs.length ? <div className="board-detail"><h3>这次取舍的代价</h3><ul className="plain-list">{state.agreement.tradeoffs.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
    {state.agreement.unknowns.length ? <div className="board-detail"><h3>仍待确认</h3><ul className="plain-list">{state.agreement.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
    <div className="board-footer"><button className="text-button" onClick={onReport}><FileText size={15} />查看本次记录</button><button className="text-button" onClick={onRetry} disabled={busy}><RotateCcw size={15} />回到一个时刻</button></div>
    <div className="board-footnote"><Users size={13} />原创模拟情境 · 结果依据已确认条件</div>
  </section>;
}
