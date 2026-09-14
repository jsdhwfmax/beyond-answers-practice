'use client';

import { useId, useState } from 'react';
import { isGenericCustomSceneLabel } from '@/domain/custom-practice';
import styles from './custom-practice.module.css';

export function SceneAdvance({ suggested, ready, blockedReason, disabled, onAdvance }: { suggested: string; ready: boolean; blockedReason: string | null; disabled: boolean; onAdvance: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  const concreteSuggestion = isGenericCustomSceneLabel(suggested) ? '' : suggested;
  const [label, setLabel] = useState(concreteSuggestion);
  const inputId = useId();
  if (!ready) return <p className={styles.sceneHint}>{blockedReason}</p>;
  return <div className={styles.sceneAdvance}>
    <button type="button" aria-expanded={open} aria-controls={`${inputId}-form`} disabled={disabled} onClick={() => { if (!open) setLabel(concreteSuggestion); setOpen(value => !value); }}>{open ? '收起转场设置' : '跳到之后的时间或场景'}</button>
    {open && <div className={styles.sceneForm} id={`${inputId}-form`}>
      <strong>想继续听对方回应？先在上方说一句。</strong>
      <p>这里用于跳过中间时间。比如刚约好明天下午看简历，就把场景切到那次交流。它不会替你发言，也不是“让对方接着说”。</p>
      <label htmlFor={inputId}>接下来，想进入哪个时刻？</label>
      <input id={inputId} value={label} maxLength={120} placeholder="例如：明天下午三点，和学姐一起看简历" onChange={event => setLabel(event.target.value)} />
      {label.trim() && isGenericCustomSceneLabel(label) && <p>请写明想去的时间或场景，例如“明天下午一起看简历”。</p>}
      {concreteSuggestion && <p>预填的是对话里提到的时间，请核对并补充要做什么；提及不代表双方已经约好。</p>}
      <p>这是模拟转场，之前的对话会保留；没有谈妥的事仍然待定。</p>
      <button type="button" className={styles.primary} disabled={disabled || !label.trim() || isGenericCustomSceneLabel(label)} onClick={() => onAdvance(label.trim())}>切换到这个场景</button>
    </div>}
  </div>;
}
