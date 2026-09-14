'use client';

import type { CustomBranch, CustomGoalEvidence } from '@/domain/custom-practice';
import { Check, Flag, BookOpen } from 'lucide-react';
import styles from './practice-goal.module.css';

type Progress = CustomBranch['goalProgress'];
const statusText = { in_progress: '正在练习', partial: '有了进展', achieved: '模拟目标已达成' };
const progressText = {
  in_progress: '继续围绕目标，把需要和顾虑说清楚。',
  partial: '这段对话已回应了部分目标，可以继续看看还有哪些地方需要说清楚。',
  achieved: '这次对话已回应了你的模拟沟通目标。你可以继续练习，也可以回看自己的尝试。',
};
const speakerText = (speaker: CustomGoalEvidence['speaker']) => speaker === 'user' ? '你' : '模拟中的对方';

/** Historical paraphrases stay in the record but never become displayed facts. */
export function GoalProgressFacts({ progress }: { progress: NonNullable<Progress> }) {
  const current = progress.verificationVersion === 'goal-progress-v2';
  const agreements = current ? progress.agreements.flatMap(agreement => {
    const proof = agreement.certification;
    return proof?.version === 'proposal-acceptance-v1' ? [proof] : [];
  }) : [];
  return <div className={styles.facts}>
    <p>{progressText[progress.status]}</p>
    {!current ? <p className={styles.legacy}>这段历史记录的约定还需要重新核对。先保留原来的目标判断，只展示对话原话，不把旧归纳当成双方约定。</p> : agreements.length ? <section className={styles.agreements} aria-label="已核对的模拟约定">
      <h3>有双方原话支持的约定</h3>
      {agreements.map((proof, index) => <div key={`${proof.proposal.turnId}:${index}`} className={styles.agreement}>
        <blockquote><span>提议原话 · {speakerText(proof.proposal.speaker)}</span><p>{proof.proposal.quote}</p></blockquote>
        <blockquote><span>接受原话 · {speakerText(proof.acceptance.speaker)}</span><p>{proof.acceptance.quote}</p></blockquote>
      </div>)}
    </section> : <p className={styles.noAgreement}>本次没有记录新的双方约定。{progress.status === 'achieved' && '目标达成，也可以只是把想了解的事情问清楚。'}</p>}
    {current && !!progress.openQuestions.length && <div className={styles.openQuestions}><strong>还有这些地方值得确认</strong><ul>{progress.openQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {!!progress.evidence.length && <details className={styles.evidence}><summary>查看判断依据：对话里的原话</summary>{progress.evidence.map((item, index) => <blockquote key={`${item.turnId}:${index}`}><span>{speakerText(item.speaker)}说</span><p>{item.quote}</p></blockquote>)}</details>}
  </div>;
}

export function PracticeGoal({ goal, progress, needsReview = false }: { goal: string; progress?: Progress; needsReview?: boolean }) {
  return <section className={styles.purpose} aria-label="这次想谈成" data-goal-status={progress?.status ?? 'in_progress'}>
    <div><span><Flag size={16} aria-hidden="true" />这次想谈成</span><span className={styles.status}>{needsReview ? '进展待核对' : statusText[progress?.status ?? 'in_progress']}</span></div>
    <p>{goal}</p>
  </section>;
}

export function PracticeGoalReview({ progress, hasTurns, finished, disabled, onReview, onSources, onFinish }: {
  progress?: Progress; hasTurns: boolean; finished: boolean; disabled: boolean;
  onReview: () => void; onSources: () => void; onFinish: () => void;
}) {
  if (!progress) return hasTurns ? <div className={styles.unreviewed}><p>已经谈到一个结果了？可以核对这段对话是否回应了你的目标。</p><button type="button" disabled={disabled} onClick={onReview}>核对这次目标进展</button></div> : null;
  if (progress.status === 'in_progress') return <details className={styles.ongoing}><summary>看看离目标还差什么</summary><GoalProgressFacts progress={progress} />{progress.verificationVersion !== 'goal-progress-v2' && <button type="button" disabled={disabled} onClick={onReview}>重新核对目标与约定</button>}</details>;
  const achieved = progress.status === 'achieved';
  return <section className={`${styles.review} ${achieved ? styles.achieved : ''}`} aria-label="本次模拟的目标进展" data-testid="goal-review">
    <div className={styles.reviewTitle} role="status">{achieved ? <Check size={19} aria-hidden="true" /> : <Flag size={19} aria-hidden="true" />}<strong>{achieved ? '这次，你完成了模拟沟通目标' : '这段对话已经有了进展'}</strong></div>
    <GoalProgressFacts progress={progress} />
    <p className={styles.boundary}>{achieved ? '可以继续练习下一幕，或看看知乎上经历过类似事情的人怎么想。' : '继续把未确认的部分说清楚，也可以借知乎经验换个角度。'}这仍是模拟，不表示现实中的问题已经解决。</p>
    <div className={styles.actions}><button type="button" onClick={onSources}><BookOpen size={15} aria-hidden="true" />{achieved ? '看看知乎上的相似经验' : '借知乎经验想一想'}</button>{progress.verificationVersion !== 'goal-progress-v2' && <button type="button" disabled={disabled} onClick={onReview}>重新核对目标与约定</button>}{achieved && !finished && <button type="button" className={styles.save} disabled={disabled} onClick={onFinish}>保存这次复盘</button>}</div>
  </section>;
}
