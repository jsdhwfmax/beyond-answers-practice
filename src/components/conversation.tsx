'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronUp, FileSearch, Lightbulb, MessageCircle, PencilLine } from 'lucide-react';
import { ACTORS, SCENARIOS } from '@/domain/scenarios';
import type { Command, GameEvent, SessionView } from '@/domain/types';
import { Avatar } from './ui';
import { displayChange } from './display';
import { WaitingFeedback } from './waiting-feedback';
import { ReplyChoices } from './reply-choices';

function EventMessage({ event }: { event: GameEvent }) {
  const actor = ACTORS[event.actor];
  const isUser = event.actor === 'user';
  const isSystem = event.actor === 'system';
  // Asset name "resolved" means calm speaking, not an accepted or successful plan.
  // Both accepting and declining replies use the same speaking expression.
  const expression = ['disclosure', 'clarification', 'referral'].includes(event.kind) ? 'thinking' : 'resolved';
  if (isSystem && event.kind.startsWith('interpretation:')) return <details className="interpretation-details"><summary>查看这句话被怎样理解<ChevronDown size={13} /></summary><p>{event.text}</p></details>;
  return <article className={`event-message ${isUser ? 'event-user' : ''} ${isSystem ? 'event-system' : ''}`}>
    {!isSystem ? <Avatar actor={event.actor} name={actor.name} expression={expression} /> : null}
    <div className="event-body"><div className="event-meta"><strong>{actor.name}</strong><span>{isUser ? '你的表达' : isSystem ? '练习记录' : actor.role}</span></div><p>{event.text}</p>
      {event.changes.length ? <details className="event-changes"><summary><Check size={13} />{event.changes.length} 项记录发生变化<ChevronDown size={13} /></summary><ul>{event.changes.map((change, index) => { const shown = displayChange(change); return <li key={index}><strong>{shown.label}</strong><span>{shown.before} <span aria-label="改为">→</span> {shown.after}</span><small>{shown.reason}</small></li>; })}</ul></details> : null}
    </div>
  </article>;
}

export function Conversation({ session, busy, processing, pendingText, recoveryMessage, onCheckPending, draft, onDraft, onText, onCommand, onEdit, onSources, onFinish }: {
  session: SessionView; busy: boolean; processing: boolean; pendingText?: string; recoveryMessage?: string; onCheckPending: (retry: boolean) => void; draft: string; onDraft: (value: string) => void;
  onText: () => void; onCommand: (command: Command) => Promise<boolean>; onEdit: () => void; onSources: () => void; onFinish: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const previousCount = useRef(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const isEnded = session.state.phase === 'ended';
  const lastEvent = session.events.at(-1);
  const agreed = session.state.scenario === 'transfer' ? session.state.transfer.verified : session.state.agreement.status === 'confirmed';
  const openings = session.state.scenario === 'campus' ? [
    { actor: 'lin' as const, text: '明天展示前，我们能加上问答吗？我担心新生打开指南，还是不知道先从哪里找起。' },
    { actor: 'xu' as const, text: '我原本答应把视觉再打磨一下。可以一起商量取舍，但别把大家都排满了才发现来不及。' },
    { actor: 'zhou' as const, text: '我们已经有基础原型和问答组件。你可以先问清楚各自要做什么，再一起定今晚的范围。' },
  ] : [];
  useEffect(() => {
    if (session.events.length !== previousCount.current && autoScroll && scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' });
    previousCount.current = session.events.length;
  }, [session.events.length, autoScroll]);
  return <section className="conversation conversation-immersive" aria-labelledby="conversation-heading">
    <header className="conversation-header"><div><MessageCircle size={18} /><h2 id="conversation-heading">{isEnded ? '这次讨论的记录' : processing ? '你的话已发出，正在等回应' : busy || recoveryMessage ? '原话已保留，先处理这一轮' : session.events.length ? '对话还在继续，轮到你了' : '先听听大家怎么说'}</h2></div><span>{isEnded ? '原来的表达都在这里' : '可以追问、改主意，不用一次说完'}</span></header>
    <div className="conversation-scroll" ref={scrollRef} tabIndex={0} aria-label="对话记录" onScroll={() => { const el = scrollRef.current; if (el) setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100); }}>
      <div className="conversation-date"><span>{session.state.scenario === 'campus' ? '校园篇 · 展示前的最后一晚' : session.state.scenario === 'transfer' ? '校园短练习 · 一个可检查的小结果' : '职场篇 · 互动预告'}</span></div>
      {session.events.length ? session.events.map((event) => <EventMessage key={event.id} event={event} />) : openings.length ? <div className="opening-dialogue">{openings.map(line => <article className="event-message" key={line.actor}><Avatar actor={line.actor} name={ACTORS[line.actor].name} /><div className="event-body"><div className="event-meta"><strong>{ACTORS[line.actor].name}</strong><span>{ACTORS[line.actor].role}</span></div><p>{line.text}</p></div></article>)}</div> : <div className="conversation-empty"><p>{SCENARIOS[session.state.scenario].brief}</p><span>{session.capabilities.naturalLanguage ? '先想想对方需要知道什么。问一句或说出下一步就好，后面可以继续商量。' : '先点“项目资料”了解情况，再用安排面板提出你的想法。'}</span></div>}
      {pendingText ? <div className="pending-message"><strong>你的表达 · 正在核对</strong><p>{pendingText}</p></div> : null}
      <div ref={endRef} />
    </div>
    <div className="conversation-tools">
      <button className="chip-button" aria-expanded={materialsOpen} aria-controls="material-options" onClick={() => setMaterialsOpen(!materialsOpen)}><FileSearch size={15} />项目资料{materialsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      <button className="chip-button" onClick={onSources}><Lightbulb size={15} />借一条经验</button>
      {session.state.scenario === 'campus' ? <button className="chip-button" onClick={onEdit} disabled={busy || isEnded}><PencilLine size={15} />安排任务</button> : null}
      <button className="text-button end-button" onClick={onFinish} disabled={busy || !session.events.length}>{isEnded ? '回看已保存的记录' : agreed ? '完成练习，保存复盘' : '先练到这里'}<ArrowUpRight size={14} /></button>
    </div>
    {materialsOpen ? <div className="material-options" id="material-options">{SCENARIOS[session.state.scenario].materials.map((material) => <button key={material.id} className="material-option" disabled={busy || isEnded} onClick={() => { setMaterialsOpen(false); onCommand({ type: 'inspect', materialId: material.id }); }}><FileSearch size={15} /><span>{material.title}</span><ArrowUpRight size={15} /></button>)}</div> : null}
    {processing ? <div className="conversation-wait"><WaitingFeedback title={pendingText ? '你的话已发出，正在等回应' : '正在保存这次操作'} model={Boolean(pendingText)} /></div> : null}
    {!isEnded && !processing && (busy || recoveryMessage) ? <div className="conversation-recovery"><p>{recoveryMessage || '这轮还没有收到确定结果，原话已保留。先核对或重试，再接着说。'}</p>{busy ? <div><button className="button button-secondary" onClick={() => onCheckPending(false)}>在这里核对本轮结果</button><button className="text-button" onClick={() => onCheckPending(true)}>重试这句话</button></div> : <p>可以修改原话后重新发送。</p>}</div> : null}
    {!isEnded && session.events.length > 0 && !busy && !recoveryMessage ? <p className="conversation-continuation">{agreed ? '这次安排已保存。可以完成练习、回看经验，也可以接着聊。' : lastEvent?.actor === 'system' && lastEvent.kind === 'disclosure' ? '资料已展开在上方。现在可以向对方问一句，或提出自己的安排。' : lastEvent?.kind === 'clarification' ? '这轮还需要澄清上方的问题，约定尚未改变。' : '轮到你了，可以接着问，也可以试着提出一个安排。'}</p> : null}
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (!composingRef.current && !busy && draft.trim() && session.capabilities.naturalLanguage && !isEnded) onText(); }}>
      <label htmlFor="message-input" className="sr-only">写下你的问题、安排或需要澄清的地方</label>
      <textarea id="message-input" rows={2} value={draft} onChange={(event) => onDraft(event.target.value)}
        placeholder={isEnded ? '这次练习已收束。可以回看记录，或回到一个时刻再试。' : session.capabilities.naturalLanguage ? session.state.scenario === 'transfer' ? '我准备先……，再……，因为……' : '你会怎么开口？问一个问题，或说说你的安排……' : '自由表达暂不可用，可以先用安排面板练习。'}
        disabled={isEnded || !session.capabilities.naturalLanguage} maxLength={3000}
        onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && !composingRef.current) { event.preventDefault(); if (!busy && draft.trim() && session.capabilities.naturalLanguage && !isEnded) onText(); } }} />
      <div className="composer-footer"><span>{busy ? '正在核对这次行动，已确认的约定保持不变' : !session.capabilities.naturalLanguage ? '项目资料与结构化任务操作仍可使用' : '自然表达就好 · Ctrl / ⌘ + Enter 发送'}</span><button className="send-button" type="submit" aria-label="发送这次表达" disabled={busy || !draft.trim() || !session.capabilities.naturalLanguage || isEnded}><ArrowUp size={21} /></button></div>
    </form>
    {!isEnded && <ReplyChoices kind="session" sessionId={session.id} version={session.version} disabled={busy || Boolean(recoveryMessage)} available={session.capabilities.naturalLanguage} draft={draft} onChoose={onDraft} onWrite={() => document.getElementById('message-input')?.focus()} onRevealAssistance={() => onCommand({ type: 'reply_options_seen' })} />}
  </section>;
}
