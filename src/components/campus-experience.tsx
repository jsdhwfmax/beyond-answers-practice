'use client';

import { useEffect, useRef } from 'react';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import type { CustomBranch } from '@/domain/custom-practice';
import { SOURCES } from '@/content/sources';
import { sourceReadingHref } from '@/domain/source-reading';
import { buildExperienceBrief } from '@/domain/experience-brief';
import { sourceVotesLabel } from '@/domain/source-display-date';
import { CUSTOM_SOURCE_BOUNDARY } from '@/domain/custom-practice';
import { GoalProgressFacts } from './practice-goal';
import styles from './campus-experience.module.css';

export function CampusQuestionCard({ question, onChoose }: { question: CampusCorpusQuestion; onChoose?: (question: CampusCorpusQuestion) => void }) {
  const answers = question.answers.map(answer => {
      const brief = buildExperienceBrief(question, answer.answerId);
      const author = answer.author.trim() || '作者昵称未显示';
      return <section key={answer.answerId} className={styles.answer} aria-label={`${author}的回答经验`}>
      <div className={styles.answerMeta}><strong>{author}</strong><span>{sourceVotesLabel(answer)}</span></div>
      {brief.kind === 'reviewed' ? <><span className={styles.teamLabel}>团队提炼</span><p>{brief.summary}</p><p className={styles.application}><strong>这次可以试：</strong>{brief.application}</p><p className={styles.application}><strong>适用提醒：</strong>{brief.conditions}</p></> : <><span className={styles.teamLabel}>原摘要里的一个片段</span><blockquote>{brief.quote}{brief.quoteTruncated ? '…' : ''}</blockquote></>}
      <details className={styles.excerpt}><summary>核对已取得的知乎摘要</summary><blockquote>{answer.excerpt}</blockquote><p>这是知乎摘要节选，并非完整回答。</p>{answer.evidenceUrl && <a href={answer.evidenceUrl} target="_blank" rel="noopener noreferrer">查看来源页面依据</a>}</details>
      <a className={styles.answerLink} href={answer.url} target="_blank" rel="noopener noreferrer">去知乎读这条回答<ArrowUpRight size={14} aria-hidden="true" /></a>
    </section>; });
  return <article className={`${styles.question} ${onChoose ? styles.compact : ''}`} data-question-id={question.id}>
    <div className={styles.questionMeta}><span>{question.category}</span><span>{onChoose ? sourceVotesLabel(question.answers[0]) : '知乎原问题'}</span></div>
    <h3><a href={question.questionUrl} target="_blank" rel="noopener noreferrer">{question.title}<ArrowUpRight size={16} aria-hidden="true" /></a></h3>
    {onChoose ? <><p className={styles.seedGoal}><span>这题可以练</span>{question.scenarioSeed.goal}</p><div className={styles.pickActions}><button type="button" onClick={() => onChoose(question)}>用这个问题开始练习<ArrowUpRight size={14} aria-hidden="true" /></button></div><details className={styles.sourceDetails}><summary>看看经验与出处</summary>{answers}</details></> : answers}
  </article>;
}

export function CampusExperience({ branch, onClose }: { branch: CustomBranch; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, []);
  const sources = branch.sourceContext;
  const questions = sources?.questions ?? [];
  const progress = branch.goalProgress?.evaluatedThroughTurnId === branch.turns.at(-1)?.id ? branch.goalProgress : undefined;
  return <section className={styles.experience} aria-label="自由练习的知乎经验依据">
    <header className={styles.heading}><div><span><BookOpen size={16} aria-hidden="true" />经验有出处，取舍留给你</span><h2 ref={heading} tabIndex={-1}>{progress?.status === 'achieved' ? '你刚才的尝试，遇见别人的经验' : '知乎上，也有人遇到过类似的事'}</h2></div><button type="button" onClick={onClose}>收起经验片段</button></header>
    {progress?.status === 'achieved' && <section className={styles.yourAttempt} aria-label="我的尝试对照"><h3>你在这次模拟里留下的尝试</h3><GoalProgressFacts progress={progress} />{progress.verificationVersion !== 'goal-progress-v2' && <p className={styles.comparePrompt}>需要更新判断时，收起经验片段，点击“重新核对目标与约定”。</p>}<p className={styles.comparePrompt}>往下看看：哪些经验回应了你的问题？哪些顾虑这次还没谈到？相似经历可以借鉴，条件不同，做法也可以不同。</p></section>}
    {questions.length ? <><p className={styles.note}>{sources?.note || '下面是为这次练习固定保存的相关知乎问题与回答摘要。'}标为“团队提炼”的内容经过片段核读，其余直接展示原摘要。场景和人物由我们原创，作者没有扮演你的对话同伴。</p><div className={styles.questionList}>{questions.map(question => <CampusQuestionCard key={question.id} question={question} />)}</div></> : <><p className={styles.note}>{sources?.note || '这次暂未匹配到足够相关的校园问题。不会把不相关的回答硬套到你的事情上。'}</p><details className={styles.generalMethods}><summary>看看仍可借用的两条通用方法</summary><p>{CUSTOM_SOURCE_BOUNDARY}</p>{SOURCES.map(source => <article key={source.id}><h3>{source.author} · {source.title}</h3><blockquote>{source.excerpt}</blockquote><p>{source.conditions} 已取得材料有截断，未读完整章节。</p><a href={sourceReadingHref(source)} target="_blank" rel="noopener noreferrer">阅读来源片段</a></article>)}</details></>}
    {!!questions.length && <p className={styles.footer}>来源版本：{sources?.version}。原问题与原回答链接可打开核对，赞同数会随时间变化。</p>}
  </section>;
}
