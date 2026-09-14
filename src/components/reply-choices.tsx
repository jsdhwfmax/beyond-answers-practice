'use client';

import { useEffect, useId, useState } from 'react';
import { Check, MessageCircle, RotateCw, Sparkles } from 'lucide-react';
import type { ReplyOptionsView } from '@/domain/reply-options';
import { CUSTOM_REPLY_FRAMES } from '@/domain/reply-frames';
import styles from './reply-choices.module.css';

interface Props {
  kind: 'session' | 'custom'; sessionId: string; version: number; branchId?: string;
  disabled: boolean; available: boolean; draft: string;
  onChoose: (text: string) => void; onWrite: () => void; onRevealAssistance?: () => Promise<boolean>;
}
interface Loaded { key: string; view: ReplyOptionsView | null; error: string }

function readOptions(value: unknown, sessionId: string, version: number, branchId?: string): ReplyOptionsView {
  if (!value || typeof value !== 'object') throw new Error('可选回复暂未准备好，你仍可以自己写。');
  const view = value as ReplyOptionsView;
  if (view.sessionId !== sessionId || view.version !== version || (branchId && view.customBranchId !== branchId) || !['ready', 'ended', 'not_ready', 'assistance_required'].includes(view.status) || !['model', 'fallback'].includes(view.source) || typeof view.notice !== 'string' || !Array.isArray(view.options) || view.options.length > 4 || view.options.some(option => !option || typeof option.id !== 'string' || typeof option.text !== 'string' || !option.text.trim() || option.text.length > 500)) {
    throw new Error('这组选项与当前对话不匹配。你可以自己写，或重新获取。');
  }
  return view;
}

/** Suggestions never submit an action or overwrite a draft when they arrive. */
export function ReplyChoices(props: Props) {
  const key = `${props.kind}:${props.sessionId}:${props.branchId ?? ''}:${props.version}`;
  const [requested, setRequested] = useState('');
  return <><RequestedReplyChoices {...props} requested={requested === key} onOpen={() => setRequested(key)} onClose={() => { setRequested(''); props.onWrite(); }} onRevealAssistance={props.onRevealAssistance ? async () => {
    // A failed assistance write cannot pre-arm a later, unrelated version.
    const saved = await props.onRevealAssistance!();
    if (saved) setRequested(`${props.kind}:${props.sessionId}:${props.branchId ?? ''}:${props.version + 1}`);
    return saved;
  } : undefined} />{props.kind === 'custom' && <details key={key} className={`${styles.root} ${styles.frames}`}><summary>用句式自己填，不用等建议</summary><p className={styles.intro}>这些是写作框架。把【】换成自己能确认的事实、需要或提议，不必每一项都用。</p><div className={styles.options} role="group" aria-label="可填写的说话框架">{CUSTOM_REPLY_FRAMES.map(frame => <button key={frame.label} type="button" className={styles.option} disabled={props.disabled} onClick={() => { props.onChoose(frame.text); props.onWrite(); }}><span><strong>{frame.label}</strong><br />{frame.text}</span></button>)}</div><p className={styles.provenance}>只填入草稿，不调用模型，不会替你发送。</p></details>}</>;
}

function RequestedReplyChoices({ kind, sessionId, version, branchId, disabled, available, draft, onChoose, onWrite, onRevealAssistance, onClose, onOpen, requested }: Props & { onClose: () => void; onOpen: () => void; requested: boolean }) {
  const headingId = useId();
  const key = `${kind}:${sessionId}:${branchId ?? ''}:${version}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [elapsed, setElapsed] = useState({ key: '', attempt: 0, seconds: 0 });
  useEffect(() => {
    if (!requested || disabled || !available || loaded?.key === key) return;
    const controller = new AbortController();
    let live = true;
    const started = Date.now();
    const tick = setInterval(() => { if (live) setElapsed({ key, attempt, seconds: Math.floor((Date.now() - started) / 1000) }); }, 1000);
    const timeout = setTimeout(() => controller.abort(), 40_000);
    void (async () => {
      try {
        const root = kind === 'custom' ? '/api/custom-practices' : '/api/sessions';
        const response = await fetch(`${root}/${encodeURIComponent(sessionId)}/reply-options?expectedVersion=${version}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(response.status === 409 ? '对话正在更新，等本轮结果出来后会准备新选项。' : '可选回复暂未准备好，你仍可以自己写。');
        const view = readOptions(body, sessionId, version, branchId);
        if (live) setLoaded({ key, view, error: '' });
      } catch (cause) {
        if (live) setLoaded({ key, view: null, error: controller.signal.aborted ? '准备选项的时间有点长。你可以先自己写，或稍后再试。' : cause instanceof Error ? cause.message : '可选回复暂时不可用，你可以直接输入。' });
      } finally {
        clearTimeout(timeout); clearInterval(tick);
      }
    })();
    return () => { live = false; controller.abort(); clearTimeout(timeout); clearInterval(tick); };
  }, [key, kind, sessionId, version, branchId, disabled, available, attempt, requested, loaded]);

  const current = loaded?.key === key ? loaded : null;
  const view = current?.view;
  const loading = !disabled && available && !current;
  const seconds = elapsed.key === key && elapsed.attempt === attempt ? elapsed.seconds : 0;
  const selected = view?.options.find(option => option.text === draft);
  if (!requested) return <section className={styles.collapsed} data-testid="reply-choices" data-version={version}>
    <button type="button" disabled={disabled || !available} aria-expanded={false} onClick={onOpen}><MessageCircle size={15} aria-hidden="true" />想看看可以怎么说</button>
  </section>;
  return <section className={styles.root} aria-labelledby={headingId} data-testid="reply-choices" data-source={view?.source} data-version={version}>
    <div className={styles.heading}><h3 id={headingId}><MessageCircle size={17} aria-hidden="true" />借几个说法找思路</h3><button type="button" className={styles.write} aria-expanded={true} onClick={onClose}>收起选项</button></div>
    <p className={styles.intro}>选一句填入输入框，改成你的话，再发送。</p>
    {!available ? <p className={styles.notice}>可选回复暂不可用，仍可以使用练习的操作面板。</p> : disabled ? <p className={styles.notice}>先等这一轮完成，再选下一句。输入草稿会保留。</p> : loading ? <div className={styles.loading} aria-busy="true"><div className={styles.loadingHeading}><strong role="status">{seconds >= 20 ? '选项还在准备中，可以先自己写' : '正在结合这段对话准备选项'}</strong><span>已等 {seconds} 秒</span></div><div className={styles.progressTrack} role="progressbar" aria-label="正在准备可选回复，完成时间暂不确定"><span /></div><p>请求已发出，收到后显示。等待条不表示完成百分比，输入草稿不受影响。</p></div> : view?.status === 'assistance_required' ? <div className={styles.assistance}><p>先自己安排，或借几个选项找思路。查看后，这次短练习会记录为使用过选项辅助。</p><button type="button" onClick={onRevealAssistance} disabled={!onRevealAssistance}>看看回答选项</button></div> : current?.error ? <div className={styles.failure}><p role="status">{current.error}</p><button type="button" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}><RotateCw size={13} aria-hidden="true" />重新获取选项</button></div> : view?.options.length ? <>
      <div className={styles.options} role="group" aria-label="可选回复">{view.options.map(option => <button type="button" key={option.id} aria-pressed={selected?.id === option.id} onClick={() => { onChoose(option.text); onWrite(); }} className={styles.option}><span className={styles.marker} aria-hidden="true">{selected?.id === option.id ? <Check size={14} /> : null}</span><span>{option.text}</span></button>)}</div>
      <p className={styles.provenance}><Sparkles size={12} aria-hidden="true" />{view.source === 'model' ? '根据当前对话生成的几种说法，不是标准答案。' : view.notice || '暂用按情境准备的备用说法，你可以自由修改。'}</p>
      {selected ? <p className={styles.selection} role="status">已放入输入框，检查或修改后发送。</p> : null}
    </> : <p className={styles.notice}>{view?.notice || '继续用自己的话表达就好。'}</p>}
  </section>;
}
