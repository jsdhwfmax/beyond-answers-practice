'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, BookOpen, Clock3, MessageCircle, Sparkles } from 'lucide-react';
import type { ScenarioId, SessionView } from '@/domain/types';
import { SCENARIOS } from '@/domain/scenarios';
import { CampusTopics } from './campus-topics';
import styles from './welcome.module.css';

export type SavedPractice = {
  id: string; scenario: ScenarioId; updatedAt: string; phase: SessionView['state']['phase'];
  forkReason: SessionView['forkReason'];
};

const EXAMPLES: { id: ScenarioId; question: string; context: string; skill: string; duration: string; cta: string }[] = [
  { id: 'campus', question: '队友临时加需求，怎么一起定下来？', context: '明天展示，今晚就要交付。听懂三位队友的顾虑，协商一次取舍。', skill: '练沟通与协商', duration: '约 6–8 分钟', cta: '进入校园协作练习' },
  { id: 'transfer', question: '只剩半小时，先完成哪件事？', context: '把一个小目标安排好，再亲手做完一次模拟发布与检查。', skill: '练安排与行动', duration: '约 1–2 分钟', cta: '进入半小时小任务' },
  { id: 'workplace', question: '新任务来了，旧承诺怎么办？', context: '入职第一周，两项任务赶在一起。向负责人提出可执行的调整。', skill: '练边界与承诺', duration: '约 1 分钟', cta: '进入职场协商练习' },
];

export function Welcome({ saved, busy, booting, onStart, onResume, onCustom, onLibrary, onTopic, onSources }: {
  saved: SavedPractice[]; busy: boolean; booting: boolean; onStart: (scenario: ScenarioId) => void;
  onResume: (id: string) => void; onCustom: () => void; onLibrary: () => void; onSources: () => void;
  onTopic: (draft: string, source?: { title: string; url: string; kind?: string; fetchedAt?: string }) => void;
}) {
  const [topicsOpen, setTopicsOpen] = useState(false);
  return <div className={styles.page}>
    <Link className={styles.firstVisit} href="/how-it-works"><BookOpen size={18} aria-hidden="true" /><span>第一次来？先看怎么玩</span><ArrowRight size={17} aria-hidden="true" /></Link>
    <header className={styles.heading}><div className={styles.headingCopy}><span>答案之外 · 练习室</span><h1>今天，想先练哪件事？</h1><p>从校园、入职第一周，到生活里的难开口。借一点知乎经验，用自己的话试一遍，再想想现实中的下一步。</p></div><Image className={styles.headingArt} src="/art/home-first-step-v14.png" alt="学生沿着从书页延伸的校园小路，迈向属于自己的空白笔记本。" width={1536} height={1024} loading="eager" sizes="(max-width: 650px) 100vw, (max-width: 1000px) 260px, (max-width: 1099px) 312px, (max-width: 1440px) 40vw, 520px" /></header>
    <section className={styles.entries} aria-label="选择练习入口">
      <button className={styles.entry} aria-label="从知乎校园问题开始" onClick={onLibrary} disabled={booting || busy}><BookOpen size={25} aria-hidden="true" /><span className={styles.entryHint}>不知道练什么</span><strong>选一件事</strong><span>从知乎里的真实困惑开始。</span><span className={styles.entryLink}>从知乎校园问题开始<ArrowRight size={17} aria-hidden="true" /></span></button>
      <button className={`${styles.entry} ${styles.ownEntry}`} aria-label="练自己的事" onClick={onCustom} disabled={booting || busy}><MessageCircle size={25} aria-hidden="true" /><span className={styles.entryHint}>心里已经有件事</span><strong>练自己的事</strong><span>说说谁、卡在哪、希望谈成什么。</span><span className={styles.entryLink}>从我的情况开始<ArrowRight size={17} aria-hidden="true" /></span></button>
    </section>
    <p className={styles.profileEntry}><Link href="/discover">按我的情况选题<ArrowRight size={16} aria-hidden="true" /></Link><span>选学历、学校类型和阶段，找处境相近的问题。</span></p>
    {saved.length ? <section className={styles.saved} aria-labelledby="saved-heading"><h2 id="saved-heading">接着上次练</h2><ul>{saved.slice(0, 4).map(item => <li key={item.id}><div><strong>{SCENARIOS[item.scenario].title}</strong><span>{item.forkReason === 'correction' ? '纠正后的分支' : item.forkReason === 'retry' ? '另一次尝试' : '独立练习'} · {item.phase === 'ended' ? '已收束' : '进行中'}</span></div><button onClick={() => onResume(item.id)} disabled={busy}>继续这次练习<ArrowRight size={15} aria-hidden="true" /></button></li>)}</ul>{saved.length > 4 && <details><summary>查看更早的 {saved.length - 4} 条记录</summary><ul>{saved.slice(4).map(item => <li key={item.id}><strong>{SCENARIOS[item.scenario].title}</strong><button onClick={() => onResume(item.id)} disabled={busy}>继续这次练习</button></li>)}</ul></details>}</section> : null}
    <details className={styles.chapters} id="example-practices"><summary><span><Sparkles size={18} aria-hidden="true" />也可以体验三个完整章节</span><small>校园协作 · 小任务 · 入职第一周</small></summary><div className={styles.chapterList}>{EXAMPLES.map(example => <article key={example.id}><div><span><Clock3 size={13} aria-hidden="true" />{example.duration}</span><h2>{example.question}</h2><p>{example.context}</p></div><button disabled={busy || booting} onClick={() => onStart(example.id)}>{example.cta}<ArrowRight size={15} aria-hidden="true" /></button></article>)}</div></details>
    <section className={styles.more}><button aria-expanded={topicsOpen} onClick={() => setTopicsOpen(value => !value)}>看看校园里正在聊什么</button><div><button onClick={onSources}>经验从哪里来</button></div></section>
    {topicsOpen && <CampusTopics onPractice={onTopic} disabled={booting || busy} />}
  </div>;
}

export function ScenarioGuide({ scenario, onFirstQuestion, naturalLanguage }: { scenario: ScenarioId; onFirstQuestion: (question: string) => void; naturalLanguage: boolean }) {
  const guide = {
    campus: { role: '你是项目协调者', goal: '22:00 前，和三位队友约定今晚到底做什么。', first: '先弄清楚新增功能想解决什么问题。', question: '林澄，你想加问答，最想解决的是什么问题？', success: '一份大家接受、负责人和时间说得清的安排。可保留不同取舍。' },
    transfer: { role: '你负责一次招新页面预览', goal: '用 30 分钟，做出能检查的小结果。', first: '先提交你准备做什么、先后怎样安排，再执行模拟操作。', question: '', success: '实际完成模拟发布和检查，而不只是写下计划。' },
    workplace: { role: '你是入职第一周的新同事', goal: '说明两项任务的冲突，和负责人重新约定时间。', first: '先询问新任务的目标和哪些期限可以调整。', question: '我手里还有答应15点交的竞品表。新摘要的期限能调整吗，还是旧表可以顺延？', success: '排期能够成立，受到影响的旧承诺也取得调整同意。' },
  }[scenario];
  return <section className="scenario-guide" aria-labelledby="guide-heading"><div><span>开始前，用半分钟认识这件事</span><h2 id="guide-heading">{guide.role}</h2><p>{guide.goal}</p></div><div className="guide-first"><strong>你的第一步</strong><p>{guide.first}</p>{guide.question && naturalLanguage ? <button className="text-button" onClick={() => onFirstQuestion(guide.question)}>把这个问题放进输入框<ArrowRight size={14} /></button> : null}</div><details><summary>做到什么程度，就可以收束？</summary><p>{guide.success}</p><p>阅读和对话不会消耗生产时间。这是一段原创模拟，不会替你完成现实任务。</p></details></section>;
}
