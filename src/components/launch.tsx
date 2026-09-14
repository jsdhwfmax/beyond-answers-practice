'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, BookOpen, Pause, Play } from 'lucide-react';
import styles from './launch.module.css';

export interface LaunchQuestion { id: string; title: string; url: string; category: string }

export function Launch({ questions, onEnter, onDemo }: { questions: LaunchQuestion[]; onEnter: () => void; onDemo: () => void }) {
  const [paused, setPaused] = useState(false);
  const rows = [questions.filter((_, index) => index % 3 === 0), questions.filter((_, index) => index % 3 === 1), questions.filter((_, index) => index % 3 === 2)];
  return <main className={styles.launch} id="main-content">
    <div className={styles.scene}><Image className={styles.background} src="/art/campus-arrival-scene-v5.png" alt="校园同伴在银杏树下交谈，准备迎接各自的第一次。" fill sizes="(max-width: 760px) 640px, 100vw" loading="eager" fetchPriority="high" /></div>
    <header className={styles.header}><Link href="/" className={styles.brand} aria-label="答案之外，启动页"><BookOpen size={23} /><span>答案之外<small>经验练习场</small></span></Link></header>
    <section className={styles.invitation} aria-labelledby="arrival-title">
      <p className={styles.eyebrow}>很多人的困惑，也曾和你一样。</p>
      <h1 id="arrival-title">有些话，<br />可以先在这里练一遍。</h1>
      <p className={styles.description}>借知乎里的真实经验，练一次难开口的沟通，<br className={styles.desktopBreak} />带着自己的下一步回到生活。</p>
      <div className={styles.actions}><Link className={styles.enter} href="/?view=home" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onEnter(); } }}><span>进入经验练习场</span><ArrowRight size={18} aria-hidden="true" /></Link><Link className={styles.help} href="/how-it-works"><BookOpen size={18} aria-hidden="true" /><span>第一次来？先看怎么玩</span></Link></div>
      <Link className={styles.demo} href="/?view=demo" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onDemo(); } }}>先看一个小示范</Link>
    </section>
    <section className={`${styles.questionField} ${paused ? styles.paused : ''}`} aria-label="校园里真实出现过的知乎问题">
      {rows.map((row, rowIndex) => <div className={styles.lane} key={rowIndex}><div className={styles.track}>
        <div className={styles.questionGroup}>{row.map(question => <a className={styles.question} href={question.url} key={question.id} target="_blank" rel="noopener noreferrer"><span className={styles.questionCategory}>{question.category}</span><span className={styles.questionTitle}>{question.title}</span></a>)}</div>
        <div className={styles.questionGroup} aria-hidden="true">{row.map(question => <span className={styles.question} key={question.id}><span className={styles.questionCategory}>{question.category}</span><span className={styles.questionTitle}>{question.title}</span></span>)}</div>
      </div></div>)}
    </section>
    <footer className={styles.footer}><span>问题来自已核读的知乎来源库</span><button onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? '继续流动' : '暂停流动'}</button><span className={styles.footerNote}>不必想好答案，先从一件事开始。</span></footer>
  </main>;
}
