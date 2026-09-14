'use client';

import { useRef, useState } from 'react';
import styles from './counterpart-reply-editor.module.css';

export function CounterpartReplyEditor({ turnId, reply, initialDraft, disabled, canContinue = true, onSave }: { turnId: string; reply: string; initialDraft?: string; disabled: boolean; canContinue?: boolean; onSave: (turnId: string, reply: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialDraft ?? reply);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const changed = draft.replace(/\s+/g, '') !== reply.replace(/\s+/g, '');
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  return <div className={styles.editor}>
    <button ref={trigger} type="button" aria-expanded={open} disabled={disabled} onClick={() => { setOpen(!open); if (!open) requestAnimationFrame(() => input.current?.focus()); }}>调整对方这句回应</button>
    {open && <form onSubmit={async event => { event.preventDefault(); if (!disabled && changed && draft.trim() && await onSave(turnId, draft.trim())) close(); }}>
      <label htmlFor={`edit-reply-${turnId}`}>你觉得对方会怎样说？</label>
      <p id={`edit-note-${turnId}`}>将另存一次尝试，原对话保留。你写的这句属于模拟设定，不会作为对方自行接受的依据。</p>
      <textarea ref={input} id={`edit-reply-${turnId}`} aria-describedby={`edit-note-${turnId}`} value={draft} maxLength={1200} rows={4} onChange={event => setDraft(event.target.value)} disabled={disabled} />
      <div><button type="button" disabled={disabled} onClick={close}>取消调整</button><button type="submit" disabled={disabled || !changed || !draft.trim()}>{canContinue ? '保存调整，继续练' : '保存调整'}</button></div>
    </form>}
  </div>;
}
