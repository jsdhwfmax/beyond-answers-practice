'use client';

import { Compass, FileText } from 'lucide-react';
import { derivePracticeGuidance } from '@/domain/practice-guidance';
import type { SessionView } from '@/domain/types';
import styles from './practice-guidance.module.css';

export function PracticeGuidance({ session, onReview, busy }: { session: SessionView; onReview: () => void; busy: boolean }) {
  const guide = derivePracticeGuidance(session.state, session.events);
  const step = guide.stage === 'orient' ? 0 : ['agreed', 'complete', 'ended'].includes(guide.stage) ? 2 : 1;
  return <section className={styles.root} aria-label="接下来可以怎么练" data-stage={guide.stage}>
    <ol className={styles.steps} aria-label="练习进展">{['了解情况', session.state.scenario === 'transfer' ? '安排并动手' : '一起商量', '回看与带走'].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className={styles.heading}><Compass size={18} /><h2>{guide.title}</h2></div><p>{guide.detail}</p>
    {guide.canReview ? <button className={styles.review} onClick={onReview} disabled={busy}><FileText size={14} />{['agreed', 'complete', 'ended'].includes(guide.stage) ? '回看经验，带走这次记录' : '先看看这次改变了什么'}</button> : null}
  </section>;
}
