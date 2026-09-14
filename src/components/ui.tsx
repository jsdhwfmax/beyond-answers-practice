'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { ActorId } from '@/domain/types';
import { USER_CHAT_AVATAR } from '@/content/chat-avatars';

export function Modal({ title, subtitle, children, onClose, wide = false, className = '' }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`dialog ${wide ? 'dialog-wide' : ''} ${className}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = event.currentTarget;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (active === first || active === root || !root.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === root || !root.contains(active))) { event.preventDefault(); first.focus(); }
    }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-shell">
      <header className="dialog-header"><div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <button className="icon-button" aria-label="关闭窗口" onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

export function Avatar({ actor, name, large = false, expression = 'neutral' }: { actor: ActorId; name: string; large?: boolean; expression?: 'neutral' | 'thinking' | 'resolved' }) {
  const [failed, setFailed] = useState(false);
  const hasArt = ['lin', 'xu', 'zhou', 'user'].includes(actor);
  return <span className={`avatar avatar-${actor} ${large ? 'avatar-large' : ''}`} aria-hidden="true">
    {hasArt && !failed ? <Image src={actor === 'user' ? USER_CHAT_AVATAR.src : `/art/${actor}-${expression}.png`} alt="" fill sizes={large ? '100px' : '40px'} onError={() => setFailed(true)} /> : <span>{name.slice(-1)}</span>}
  </span>;
}

export function ArtPortrait({ actor, name, role }: { actor: 'lin' | 'xu' | 'zhou'; name: string; role: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={`art-portrait portrait-${actor}`}>
    {!failed ? <Image src={`/art/${actor}-neutral.png`} alt="" fill sizes="(max-width: 700px) 110px, 220px" loading="eager" onError={() => setFailed(true)} /> : <span className="portrait-placeholder" aria-hidden="true">{name.slice(-1)}</span>}
    <div className="portrait-caption"><strong>{name}</strong><span>{role}</span></div>
  </div>;
}

export function SceneArt({ workplace = false }: { workplace?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="scene-backdrop" aria-hidden="true">{!failed ? <Image src={workplace ? '/art/workplace-studio.png' : '/art/campus-studio.png'} alt="" fill sizes="(max-width: 760px) calc(100vw - 24px), (max-width: 1399px) calc(100vw - 52px), 1328px" priority onError={() => setFailed(true)} /> : null}</div>;
}

export function SceneForeground() {
  const [failed, setFailed] = useState(false);
  return <div className="scene-foreground" aria-hidden="true">{!failed ? <Image src="/art/campus-foreground.png" alt="" fill sizes="(max-width: 760px) calc(100vw - 24px), (max-width: 1399px) calc(100vw - 52px), 1328px" onError={() => setFailed(true)} /> : null}</div>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'attention' }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

export function formatTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
