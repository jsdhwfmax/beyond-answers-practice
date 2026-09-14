'use client';

import { useEffect, useState } from 'react';
import { Check, MessageCircle } from 'lucide-react';
import styles from './waiting-feedback.module.css';

/** An elapsed-time animation, deliberately not a claim about model completion. */
export function WaitingFeedback({ title = '正在等对方回应', model = true }: { title?: string; model?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const width = Math.min(88, 12 + 76 * (1 - Math.exp(-elapsed / 14)));
  return <div className={styles.root} data-testid="waiting-feedback">
    <div className={styles.heading}><MessageCircle size={17} aria-hidden="true" /><strong role="status">{elapsed >= 25 ? '仍在等待，原话已经保留' : title}</strong><span aria-hidden="true">已等 {elapsed} 秒</span></div>
    <div className={styles.track} role="progressbar" aria-label="等待回应：动画不代表实际完成百分比"><span style={{ width: `${width}%` }} /></div>
    <div className={styles.steps} aria-hidden="true"><span><Check size={12} />已发送</span><span className={styles.current}>{model ? '等待回应' : '等待保存结果'}</span><span>收到后显示</span></div>
    <p>{elapsed >= 25 ? '这次比平时久一些。可以先返回，回来后继续核对结果。' : '可以继续想想下一句。等待动画不代表实际进度，收到结果后会自动显示。'}</p>
  </div>;
}
