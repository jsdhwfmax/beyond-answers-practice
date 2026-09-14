'use client';

import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { SOURCES } from '@/content/sources';
import { buildExperienceBrief } from '@/domain/experience-brief';
import { sourceReadingHref } from '@/domain/source-reading';
import { sourceAsOf } from '@/domain/source-display-date';
import styles from './experience-brief.module.css';

export interface ExperienceBriefProps {
  questions: readonly CampusCorpusQuestion[];
  goal?: string;
  compact?: boolean;
  onUse?: (question: CampusCorpusQuestion) => void;
  onOpenSources?: () => void;
}

function BriefQuestion({ question, goal, onUse }: Pick<ExperienceBriefProps, 'goal' | 'onUse'> & { question: CampusCorpusQuestion }) {
  const brief = buildExperienceBrief(question);
  const asOf = sourceAsOf(brief.fetchedAt);
  return <article className={styles.question} data-question-id={question.id} data-brief-kind={brief.kind}>
    <h3 className={styles.questionTitle}>{question.title}</h3>
    {brief.kind === 'reviewed' ? <>
      <p className={styles.takeaway}><span>团队提炼</span>{brief.summary}</p>
      <p className={styles.application}><strong>这次可以试</strong>{brief.application}</p>
      <details className={styles.conditions}><summary>适用提醒与作者原话</summary>
        <p><strong>团队适用提醒：</strong>{brief.conditions}</p>
        <p className={styles.quoteLabel}>{brief.author}的原话 · 已取得摘要中的一段</p>
        <blockquote>{brief.quote}</blockquote>
        <p className={styles.boundary}>上面的提炼与练法由团队整理；模拟中的角色和结果不属于作者的承诺。</p>
      </details>
    </> : brief.kind === 'excerpt' ? <>
      <p className={styles.fallback}>先看这段原摘要，想想哪里适合你。</p>
      <blockquote className={styles.preview}>{brief.quote}{brief.quoteTruncated ? <span aria-label="后面还有摘要内容">…</span> : null}</blockquote>
      <p className={styles.quoteLabel}>{brief.author} · 已取得摘要节选</p>
    </> : <p className={styles.fallback}>这题还没有可直接核对的摘要。可以先看原问题，或换一道题。</p>}
    {goal && brief.kind === 'reviewed' ? <p className={styles.goal}>联系自己的目标：{goal}</p> : null}
    {brief.kind !== 'missing' ? <details className={styles.fullExcerpt}><summary>查看站内完整摘要与出处</summary>
      <blockquote>{brief.excerpt}</blockquote>
      <p className={styles.boundary}>这是回答摘要，并非完整回答。{asOf ? `内容${asOf}。` : ''}</p>
      <div className={styles.sourceLinks}>
        {brief.answerUrl ? <a href={brief.answerUrl} target="_blank" rel="noopener noreferrer">在知乎读这条回答</a> : null}
        {brief.questionUrl ? <a href={brief.questionUrl} target="_blank" rel="noopener noreferrer">知乎原问题</a> : null}
      </div>
    </details> : brief.questionUrl ? <a className={styles.missingLink} href={brief.questionUrl} target="_blank" rel="noopener noreferrer">查看知乎原问题</a> : null}
    {onUse ? <button className={styles.useButton} type="button" onClick={() => onUse(question)}>带着这条经验去练</button> : null}
  </article>;
}

function GeneralBrief({ goal }: Pick<ExperienceBriefProps, 'goal'>) {
  const source = SOURCES[0];
  return <article className={styles.question} data-brief-kind="general">
    <h3 className={styles.questionTitle}>通用方法，未匹配到相近经历</h3>
    <p className={styles.takeaway}><span>团队归纳</span>先聚焦一个共同目标，再把希望发生的变化说具体。</p>
    <p className={styles.application}><strong>这次可以试</strong>先说清想解决的问题和这次能讨论的范围，再问对方是不是也这样理解。</p>
    {goal ? <p className={styles.goal}>联系自己的目标：{goal}</p> : null}
    <details className={styles.conditions}><summary>适用提醒与作者原话</summary>
      <p><strong>团队适用提醒：</strong>{source.conditions}</p>
      <p className={styles.quoteLabel}>{source.author} · {source.title}</p>
      <blockquote>{source.excerpt}</blockquote>
      <p className={styles.boundary}>这里只借用通用沟通方法，不代表作者回答了你的事情；已取得片段有截断，未读完整章节。</p>
      <a className={styles.missingLink} href={sourceReadingHref(source)} target="_blank" rel="noopener noreferrer">阅读站内来源片段</a>
    </details>
  </article>;
}

/** An inline reading step, not a generated answer or an automatic practice action. */
export function ExperienceBrief({ questions, goal, compact = true, onUse, onOpenSources }: ExperienceBriefProps) {
  const [first, ...remaining] = questions;
  return <section className={`${styles.brief} ${compact ? styles.compact : ''}`} aria-label="先借一条经验">
    <header className={styles.header}><h2>先借一条经验</h2>{onOpenSources ? <button className={styles.sourcesButton} type="button" onClick={onOpenSources}>查看来源对照</button> : null}</header>
    {first ? <BriefQuestion question={first} goal={goal} onUse={onUse} /> : <GeneralBrief goal={goal} />}
    {remaining.length ? <details className={styles.more}><summary>再看 {remaining.length} 道关联问题的经验</summary>{remaining.map(question => <BriefQuestion key={question.id} question={question} goal={goal} onUse={onUse} />)}</details> : null}
  </section>;
}
