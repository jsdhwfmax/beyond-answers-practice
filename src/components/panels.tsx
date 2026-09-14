'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, Download, ExternalLink, FileText, Flag, Printer, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { ACTORS, SCENARIOS, TASKS } from '@/domain/scenarios';
import type { ActorId, Command, ExperienceReport, ScenarioId, SessionView, SourceCard, TaskId } from '@/domain/types';
import { ACKNOWLEDGEMENTS } from './agreement-board';
import { formatTime, Modal, StatusPill } from './ui';
import { displayChange } from './display';
import { WaitingFeedback } from './waiting-feedback';
import { sourceReadingHref } from '@/domain/source-reading';
import { formatExperienceText } from '@/domain/experience-export';

export function SourcesPanel({ sources, loading, error, onReload, onClose }: { sources: SourceCard[]; loading: boolean; error: string; onReload: () => void; onClose: () => void }) {
  return <Modal title="练习方法来源" subtitle="这两个方法，是我们设计校园示例练习的起点。" onClose={onClose} className="source-dialog">
    <div className="dialog-content source-content"><div className="source-intro"><BookOpen size={22} /><p>先看方法，再判断能不能用在眼前这件事上。<br /><strong>自由练习中，与具体问题相关的知乎经验在对话旁查看。</strong></p></div>
      {loading ? <p role="status" className="loading-line">正在取回来源记录……</p> : null}
      {error ? <div className="notice notice-attention"><p>{error}</p><button className="text-button" onClick={onReload}>重新读取来源</button></div> : null}
      {sources.map((source, index) => <article className="source-card" key={source.id}>
        <div className="source-card-top"><span className="source-number">{index === 0 ? '把目标说清楚' : '先完成一个小结果'}</span><span>知乎经验</span></div>
        <h3>{source.title}</h3><p className="source-byline">{source.author}</p>
        <p className="source-application"><strong>可以怎样用</strong>{index === 0 ? '开始协商前，先问清：这次要解决什么问题，做到什么程度就够了？' : '选一个现在能做完的小步骤，并写清怎样检查它确实完成了。'}</p>
        <div className="source-interpretation"><span className="field-label">我们的阅读归纳</span><p>{source.interpretation}</p></div>
        <div className="source-conditions"><span className="field-label">先检查适用条件</span><p>{source.conditions}</p></div>
        <details className="source-excerpt"><summary>展开实际取得的来源片段</summary><blockquote>{source.excerpt}</blockquote><p className="small-note">{source.truncated ? '接口返回的片段存在截断，未取得完整章节。' : '此处展示实际取得的内容。'}{source.retrievedAt ? ` 取得日期：${source.retrievedAt.slice(0, 10)}` : ''}</p></details>
        <details className="source-excerpt"><summary>在固定校园练习中的用法</summary><p>{source.application}</p></details>
        <a className="text-button" href={sourceReadingHref(source)} target="_blank" rel="noopener noreferrer">阅读来源片段<ExternalLink size={14} /></a>
      </article>)}
      <p className="small-note source-disclaimer">人物、工时和任务后果是团队原创模拟设定。这里的归纳与应用不代表作者对你的处境作出了判断。</p>
    </div>
  </Modal>;
}

const GROUPS = [{ id: 'base', title: '基础可用与展示', note: '本次展示的基础' }, { id: 'visual', title: '精细视觉呈现', note: '已有承诺，调整需要协商' }, { id: 'guide', title: '有限的静态引导', note: '明确范围，处理指定入门问题' }, { id: 'qa', title: '完整问答', note: '依赖与验收范围单独核验' }] as const;

export function PlanEditor({ session, busy, error, onSubmit, onClose }: { session: SessionView; busy: boolean; error?: string; onSubmit: (command: Command) => Promise<boolean>; onClose: () => void }) {
  const initialProposal = session.state.proposal?.status === 'pending' ? session.state.proposal : null;
  const [draftKey] = useState(() => `beyond.plan-draft.v1.${session.id}.${session.version}`);
  const [storedDraft] = useState<{ selected: TaskId[]; conditions: string; acks: string[]; assignments: Partial<Record<TaskId, ActorId>> } | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (value && Array.isArray(value.selected) && value.selected.every((id: string) => Object.hasOwn(TASKS, id)) && typeof value.conditions === 'string' && Array.isArray(value.acks) && value.acks.every((id: unknown) => typeof id === 'string') && value.assignments && typeof value.assignments === 'object') return value;
    } catch { /* The editable current agreement is a complete fallback. */ }
    return null;
  });
  const [selected, setSelected] = useState<TaskId[]>(storedDraft?.selected ?? initialProposal?.taskIds ?? session.state.taskIds);
  const [conditions, setConditions] = useState(storedDraft?.conditions ?? initialProposal?.conditions.join('\n') ?? '');
  const [acks, setAcks] = useState<string[]>(storedDraft?.acks ?? initialProposal?.acknowledgements ?? []);
  const [assignments, setAssignments] = useState<Partial<Record<TaskId, ActorId>>>(() => storedDraft?.assignments ?? Object.fromEntries(session.state.schedule.map((slot) => [slot.taskId, slot.actor])));
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ selected, conditions, acks, assignments })); } catch { /* Closing remains possible when browser storage is unavailable. */ } }, [draftKey, selected, conditions, acks, assignments]);
  const toggle = (id: TaskId) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const submit = async () => {
    const success = await onSubmit({ type: 'propose', taskIds: selected, conditions: conditions.split('\n').map((item) => item.trim()).filter(Boolean), acknowledgements: acks, assignments: selected.map((id) => ({ taskId: id, actor: assignments[id] ?? TASKS[id].actor })) });
    if (success) { try { localStorage.removeItem(draftKey); } catch { /* Saved server facts take precedence over a local draft. */ } onClose(); }
  };
  return <Modal title="把安排摆到桌上" subtitle="选择要交付的任务。工作量、依赖和各人的时间将一起核验。" onClose={onClose} wide>
    <div className="dialog-content plan-editor">{error ? <div className="notice notice-attention" role="alert"><p>{error}</p><button className="text-button" onClick={onClose}>返回工作室查看状态</button></div> : null}<div className="plan-editor-note"><PencilIcon /><p>这是一份提议。提交后，只有满足条件并被相关队友接受的安排，才会成为新约定。</p></div>
      <div className="task-groups">{GROUPS.map((group) => <fieldset className="task-group" key={group.id}><legend>{group.title}</legend><p>{group.note}</p>{Object.values(TASKS).filter((task) => task.group === group.id).map((task) => <div className={`task-choice ${selected.includes(task.id) ? 'is-selected' : ''}`} key={task.id}><label><input type="checkbox" checked={selected.includes(task.id)} onChange={() => toggle(task.id)} disabled={busy} /><span><strong>{task.title}</strong><small>{task.minutes} 分钟{task.dependencies.length ? ` · 依赖 ${task.dependencies.map((id) => TASKS[id].title).join('、')}` : ''}</small></span></label>{selected.includes(task.id) ? <label className="assignment-choice"><span>负责人</span><select aria-label={`${task.title}的负责人`} value={assignments[task.id] ?? task.actor} disabled={busy} onChange={(event) => setAssignments((current) => ({ ...current, [task.id]: event.target.value as ActorId }))}>{(['lin', 'xu', 'zhou', 'user'] as ActorId[]).map((actor) => <option key={actor} value={actor}>{ACTORS[actor].name}</option>)}</select></label> : null}</div>)}</fieldset>)}</div>
      <label className="form-label" htmlFor="proposal-conditions">还有什么前提需要先成立？<span>选填，每行写一个；未被确认的前提会保留在提议中。</span></label><textarea id="proposal-conditions" className="field-textarea" rows={2} value={conditions} onChange={(event) => setConditions(event.target.value)} maxLength={1200} placeholder="例如：需要有人先接下页面排版。" disabled={busy} />
      <fieldset className="scope-checks"><legend>你准备明确说清的取舍</legend>{ACKNOWLEDGEMENTS.map((item) => <label key={item.id}><input type="checkbox" checked={acks.includes(item.id)} disabled={busy} onChange={(event) => setAcks((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><strong>{item.label}</strong><small>{item.text}</small></span></label>)}</fieldset>
    </div>
    <footer className="dialog-footer"><p>已选 {selected.length} 项 · 合计 {selected.reduce((sum, id) => sum + TASKS[id].minutes, 0)} 分钟工作量<small>总数不等于排期可行，提交后按个人时间与依赖核验。</small></p><button className="button button-primary" disabled={busy || !selected.length} onClick={submit}>{busy ? '正在核验安排…' : '交给大家确认'}<ArrowRight size={17} /></button></footer>
  </Modal>;
}

function PencilIcon() { return <FileText size={21} aria-hidden="true" />; }

export function RetryPanel({ session, busy, error, onFork, onClose }: { session: SessionView; busy: boolean; error?: string; onFork: (afterSequence: number, reason: 'retry' | 'correction') => Promise<void>; onClose: () => void }) {
  const boundaries = session.events.filter((event, index, events) => index === events.length - 1 || event.actionId !== events[index + 1]?.actionId);
  const firstProposal = session.events.find((event) => ['interpretation:proposal', 'interpretation:transfer_plan', 'interpretation:workplace_proposal'].includes(event.kind));
  const proposalActionStart = firstProposal ? session.events.findIndex((event) => event.actionId === firstProposal.actionId) : -1;
  const retrySequence = proposalActionStart > 0 ? session.events[proposalActionStart - 1].sequence : 0;
  const [sequence, setSequence] = useState(0);
  const [reason, setReason] = useState<'retry' | 'correction'>('retry');
  return <Modal title="回到同一个时刻" subtitle="原记录会保留。在相同条件下，试试另一种安排。" onClose={onClose}>
    <div className="dialog-content">{error ? <div className="notice notice-attention" role="alert">{error}</div> : null}<div className="retry-explanation"><RotateCcw size={27} /><p>这里比较的是这组模拟设定中的不同做法，不是对现实结果的预测。</p></div><fieldset className="segmented-field"><legend>这次回去是为了</legend><label><input type="radio" name="fork-reason" checked={reason === 'retry'} onChange={() => setReason('retry')} disabled={busy} />再试一种做法</label><label><input type="radio" name="fork-reason" checked={reason === 'correction'} onChange={() => setReason('correction')} disabled={busy} />纠正被误解的表达</label></fieldset>
      {reason === 'retry' ? <><p className="form-label">首次范围提议之前</p><p className="small-note">{firstProposal ? '保留此前已经发生的记录，重新提出安排。原来的尝试仍可对照查看。' : '当前尚未提出范围安排，将从最初的任务单开始。'}</p></> : <><label className="form-label" htmlFor="retry-moment">从哪个节点继续</label><select id="retry-moment" className="field-select" value={sequence} onChange={(event) => setSequence(Number(event.target.value))} disabled={busy}><option value={0}>回到最初的任务单</option>{boundaries.map((event) => <option key={event.id} value={event.sequence}>第 {event.sequence} 条记录之后：{event.text.slice(0, 48)}</option>)}</select><p className="small-note">会保留所选节点之前的记录。之后的行动重新核验，不会静默改写原约定。</p></>}
    </div><footer className="dialog-footer"><button className="button button-secondary" onClick={onClose}>留在这里</button><button className="button button-primary" disabled={busy} onClick={() => onFork(reason === 'retry' ? retrySequence : sequence, reason)}>{busy ? '正在建立新尝试…' : '从这里重新尝试'}<ArrowRight size={17} /></button></footer>
  </Modal>;
}

export function ComparisonPanel({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const previous = session.comparison?.state;
  const schedule = (state?: SessionView['state']) => state?.schedule.map((slot) => {
    const taskTitle = TASKS[slot.taskId as TaskId]?.title ?? (slot.taskId === 'summary' ? '演示摘要' : slot.taskId === 'table' ? '竞品表' : '未标明任务');
    return `${ACTORS[slot.actor].name} · ${taskTitle} · ${formatTime(slot.start)}–${formatTime(slot.end)}`;
  }) ?? [];
  const unknowns = (state?: SessionView['state']) => [...new Set([
    ...(state?.agreement.unknowns ?? []),
    ...(state?.proposal?.status === 'pending' ? ['当前提议尚未确认。', ...state.proposal.issues] : []),
    ...(state?.workplace.issues ?? []),
  ])];
  const fields = [
    { label: '交付范围', before: previous?.agreement.scope ?? [], after: session.state.agreement.scope },
    { label: '负责人和排期', before: schedule(previous), after: schedule(session.state) },
    { label: '取舍与代价', before: previous?.agreement.tradeoffs ?? [], after: session.state.agreement.tradeoffs },
    { label: '待确认的条件', before: unknowns(previous), after: unknowns(session.state) },
  ];
  return <Modal title="两次尝试，放在一起看" subtitle="只比较实际发生的约定。不同做法可能各有代价。" onClose={onClose} wide><div className="dialog-content comparison-content"><div className="comparison-head"><span>原来的尝试</span><span>这一次尝试</span></div>{fields.map((field) => <section className="comparison-row" key={field.label}><h3>{field.label}</h3><div className={JSON.stringify(field.before) !== JSON.stringify(field.after) ? 'comparison-values has-change' : 'comparison-values'}>{[field.before, field.after].map((values, index) => <div key={index}><span className="mobile-comparison-label">{index ? '这一次' : '原来'}</span>{values.length ? <ul className="plain-list">{values.map((value, itemIndex) => <li key={itemIndex}>{value}</li>)}</ul> : <p>尚未记录</p>}</div>)}</div></section>)}<p className="small-note">原尝试保持可查。这些差异不代表其中一种方案适用于所有真实情境。</p></div></Modal>;
}

export const TRANSFER_STEPS = [{ id: 'publish', label: '发布可试用版本', minutes: 15 }, { id: 'verify', label: '按验收条件检查', minutes: 10 }, { id: 'references', label: '补充参考资料', minutes: 20 }];

export interface GuidedReflection { version: number; questions: { id: string; text: string }[]; generatedAt: string; model: string; provider?: 'bailian' | 'openai' | 'deepseek'; kind: 'guided_questions' }

export function ScenarioActions({ session, busy, onCommand }: { session: SessionView; busy: boolean; onCommand: (command: Command) => void }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [firstWork, setFirstWork] = useState<'summary' | 'table'>('summary');
  const [reschedule, setReschedule] = useState(false);
  const disabled = busy || session.state.phase === 'ended';
  if (session.state.scenario === 'campus') return null;
  if (session.state.scenario === 'workplace') return <section className="scenario-actions" aria-labelledby="workplace-action-title"><div className="section-heading"><h3 id="workplace-action-title">给负责人一份具体安排</h3><Flag size={18} /></div><fieldset className="workplace-order"><legend>先完成哪一项</legend><label><input type="radio" name="first-task" checked={firstWork === 'summary'} onChange={() => setFirstWork('summary')} disabled={disabled} /><span>演示摘要<small>需要 1.5 小时</small></span></label><label><input type="radio" name="first-task" checked={firstWork === 'table'} onChange={() => setFirstWork('table')} disabled={disabled} /><span>竞品表<small>还需 1 小时</small></span></label></fieldset><label className="scope-check"><input type="checkbox" checked={reschedule} onChange={(event) => setReschedule(event.target.checked)} disabled={disabled} /><span>说明旧承诺受到影响，并请求把竞品表调整到 16:00。<small>请求不等于同意，负责人回应后才会更新约定。</small></span></label><button className="button button-primary" disabled={disabled} onClick={() => onCommand({ type: 'workplace_propose', order: firstWork === 'summary' ? ['summary', 'table'] : ['table', 'summary'], requestReschedule: reschedule })}>提出这份安排<ArrowRight size={16} /></button></section>;
  const planned = session.state.transfer.plan.length > 0;
  const move = (id: string, amount: number) => setSteps((current) => { const result = [...current]; const at = result.indexOf(id); if (at < 0 || at + amount < 0 || at + amount >= result.length) return current; [result[at], result[at + amount]] = [result[at + amount], result[at]]; return result; });
  return <section className="scenario-actions" aria-labelledby="transfer-action-title"><div className="section-heading"><h3 id="transfer-action-title">今晚，先完成什么？</h3><span>{planned ? '计划之后，亲手执行' : '先提交你的独立安排'}</span></div>{!planned ? <>
    <p>目标和验收已经明确。选择你准备完成的事，并安排先后顺序。</p><ul className="step-picker">{steps.map((id, index) => { const step = TRANSFER_STEPS.find((item) => item.id === id)!; return <li key={id}><span className="step-order">{index + 1}</span><span><strong>{step.label}</strong><small>{step.minutes} 分钟</small></span><button className="icon-button" aria-label={`把${step.label}提前`} onClick={() => move(id, -1)} disabled={disabled || index === 0}><ArrowUp size={15} /></button><button className="icon-button" aria-label={`把${step.label}往后排`} onClick={() => move(id, 1)} disabled={disabled || index === steps.length - 1}><ArrowDown size={15} /></button><button className="text-button" disabled={disabled} onClick={() => setSteps((current) => current.filter((item) => item !== id))}>移除</button></li>; })}</ul><div className="step-add">{TRANSFER_STEPS.filter((step) => !steps.includes(step.id)).map((step) => <button className="chip-button" key={step.id} disabled={disabled} onClick={() => setSteps((current) => [...current, step.id])}>加入{step.label}</button>)}</div><button className="button button-primary" disabled={disabled || !steps.length} onClick={() => onCommand({ type: 'transfer_plan', steps })}>保存计划，开始执行<ArrowRight size={16} /></button>
  </> : <><p>计划已经留下。现在执行一项任务，检查它是否产生了可验证的结果。</p><div className="execute-steps">{TRANSFER_STEPS.map((step) => { const completed = session.state.transfer.completed.includes(step.id); return <button key={step.id} disabled={disabled || completed} className={`execute-step ${completed ? 'is-completed' : ''}`} onClick={() => onCommand({ type: 'transfer_execute', step: step.id })}><span>{completed ? <Check size={17} /> : <Flag size={17} />}</span><span><strong>{step.label}</strong><small>{completed ? '已执行' : `执行会推进 ${step.minutes} 分钟模拟时间`}</small></span><ArrowRight size={16} /></button>; })}</div></>}
    <button className="text-button hint-button" disabled={disabled} onClick={() => onCommand({ type: 'hint' })}><LightbulbIcon />需要一点提示{session.state.transfer.hintUsed ? '（本次已使用）' : ''}</button>
  </section>;
}

function LightbulbIcon() { return <Sparkles size={15} aria-hidden="true" />; }

export function ReportPanel({ session, report, reflectionQuestions, onGenerateQuestions, onClose, onNext, onDelete }: { session: SessionView; report: ExperienceReport; reflectionQuestions: GuidedReflection | null; onGenerateQuestions: () => Promise<void>; onClose: () => void; onNext: (scenario: ScenarioId) => void; onDelete: () => void }) {
  const reflectionKey = `beyond.reflection.v1.${session.id}`;
  const [reflection, setReflection] = useState(() => { try { return localStorage.getItem(reflectionKey) ?? ''; } catch { return ''; } });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState('');
  const generateQuestions = async () => { if (questionsLoading) return; setQuestionsLoading(true); setQuestionsError(''); try { await onGenerateQuestions(); } catch (error) { setQuestionsError(error instanceof Error ? error.message : '反思问题暂时未能准备好，本次事实记录已经保留。'); } finally { setQuestionsLoading(false); } };
  const saveReflection = () => { try { localStorage.setItem(reflectionKey, reflection); setSaved(true); setSaveError(''); } catch { setSaveError('浏览器未能保存这段反思，可以先导出记录。'); } };
  const download = (raw = false) => {
    const payload = { report, session, reflectionQuestions, personalReflection: reflection, reflectionKind: '用户自述，未验证现实效果' };
    const blob = new Blob([raw ? JSON.stringify(payload, null, 2) : '\uFEFF' + formatExperienceText(session, report, reflection)], { type: raw ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `经验练习场-${SCENARIOS[session.state.scenario].title}-${session.id.slice(0, 8)}.${raw ? 'json' : 'txt'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Modal title="把这一次，留给下一次" subtitle="这里记录实际发生的行动，不给你贴能力标签。" onClose={onClose} wide className="report-dialog"><div className="dialog-content report-content">
    <div className="report-heading"><div className="report-stamp"><Check size={25} /></div><div><span className="field-label">{SCENARIOS[session.state.scenario].title} · 本次练习记录</span><h3>{report.title}</h3><StatusPill tone={session.state.agreement.status === 'confirmed' ? 'success' : 'attention'}>{report.status}</StatusPill></div></div>
    {[{ title: '留下的交付范围', values: report.scope }, { title: '你接受的取舍', values: report.tradeoffs }, { title: '还不能下结论的地方', values: report.unknowns }].map((section) => <section className="report-section" key={section.title}><h3>{section.title}</h3>{section.values.length ? <ul className="plain-list">{section.values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p className="muted">本次尚未记录。</p>}</section>)}
    {report.changes.length ? <details className="report-change-details"><summary>查看约定的具体变化（{report.changes.length} 项）</summary>{report.changes.map((change, index) => { const shown = displayChange(change); return <div key={index}><strong>{shown.label}</strong><p><span>原来：</span>{shown.before}</p><p><span>现在：</span>{shown.after}</p><small>{shown.reason}</small></div>; })}</details> : null}
    {report.evidence.length ? <section className="report-section"><h3>变化，有迹可循</h3><div className="evidence-list">{report.evidence.map((evidence, index) => <div key={index}><blockquote>“{evidence.quote}”</blockquote><p>{evidence.result}</p></div>)}</div></section> : null}
    <section className="report-section reflection-questions"><h3>再往前想一步</h3>{reflectionQuestions ? <><p className="small-note">AI 根据本次已发生的行动，选取以下反思问题。它们不改变上方的事实记录。</p><ul className="plain-list">{reflectionQuestions.questions.map((question) => <li key={question.id}>{question.text}</li>)}</ul></> : <><p>可以请 AI 从本次行动中选几个值得追问的问题。你写在下方的个人反思不会随此请求上传。</p><button className="button button-secondary" disabled={questionsLoading || !session.capabilities.naturalLanguage} onClick={() => void generateQuestions()}><Sparkles size={15} />{questionsLoading ? '正在选取反思问题…' : 'AI 选取反思问题'}</button>{!session.capabilities.naturalLanguage ? <p className="small-note">此功能暂不可用，仍可直接写下自己的下一步。</p> : null}</>}{questionsLoading ? <WaitingFeedback title="正在为这次练习选取反思问题" /> : null}{questionsError ? <p className="notice notice-attention" role="alert">{questionsError}</p> : null}</section>
    <section className="report-section"><h3>带到现实中的一小步</h3><p>{report.nextStep}</p><label className="form-label" htmlFor="personal-reflection">写给下一次的自己<span>这段内容只保存在本机。现实尝试与模拟结果分别记录。</span></label><textarea id="personal-reflection" className="field-textarea" rows={3} value={reflection} onChange={(event) => { setReflection(event.target.value); setSaved(false); }} maxLength={3000} placeholder="我准备在哪件真实的小事中尝试？后来发生了什么？" /><div className="reflection-controls"><button className="text-button" onClick={saveReflection}><Save size={15} />{saved ? '已保存到本机' : '保存这段反思'}</button><span role="status">{saveError}</span></div><div className="print-reflection">{reflection || '尚未填写个人反思。'}</div></section>
    <p className="report-provenance">原创模拟情境 · 场景版本 {session.state.scenarioVersion} · 来源版本 {session.state.sourceVersion}<br />来源片段与团队应用可在“借一条经验”中查看。本记录不证明现实协作能力已经提升。</p>
    {session.state.scenario !== 'workplace' ? <div className="next-chapter"><div><span>{session.state.scenario === 'campus' ? '换个问题，自己试一次' : '下一站 · 入职第一周'}</span><h3>{session.state.scenario === 'campus' ? '如果目标已经很清楚呢？' : '熟悉的方法，遇见新的责任。'}</h3><p>{session.state.scenario === 'campus' ? '校园短练习，先安排再执行。' : '一个可操作的职场预告，随时可以返回。'}</p></div><button className="button button-primary" onClick={() => onNext(session.state.scenario === 'campus' ? 'transfer' : 'workplace')}>继续试试<ArrowRight size={17} /></button></div> : null}
  </div><footer className="dialog-footer report-actions"><div><button className="button button-secondary" onClick={() => window.print()}><Printer size={16} />打印 / 保存 PDF</button><button className="button button-secondary" onClick={() => download()}><Download size={16} />导出文字记录</button><button className="text-button" onClick={() => download(true)}>导出原始数据 JSON</button></div><button className="text-button danger-text" onClick={onDelete}><Trash2 size={15} />删除本次练习</button></footer></Modal>;
}

