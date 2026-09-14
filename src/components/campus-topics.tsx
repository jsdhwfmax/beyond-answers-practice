'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, MessageCircle } from 'lucide-react';
import { campusPracticeDraft, type CampusTopicsFeed, type CampusTopicSource } from '@/domain/campus-topics';
import styles from './campus-topics.module.css';

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export function CampusTopics({ onPractice, disabled = false }: { onPractice: (draft: string, source?: CampusTopicSource) => void; disabled?: boolean }) {
  const [feed, setFeed] = useState<CampusTopicsFeed | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [now, setNow] = useState(0);
  const alive = useRef(false); const request = useRef<AbortController | null>(null);
  const load = useRef<(force?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    alive.current = true;
    load.current = async (force = false) => {
      if (request.current) return;
      const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('');
      try {
        const response = await fetch('/api/campus-topics', { method: force ? 'POST' : 'GET', signal: controller.signal });
        const data: CampusTopicsFeed | { error?: { message?: string } } = await response.json();
        if (!('items' in data) || !Array.isArray(data.items)) throw new Error('话题暂时无法加载，请稍后再试。');
        if (alive.current) { setFeed(data); setNow(Date.now()); if (force && data.refreshResult === 'cooldown') setMessage('仍是共享缓存，下次可刷新时间见下方。'); }
      } catch (error) { if (alive.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '话题暂时无法加载，请稍后再试。'); }
      finally { if (request.current === controller) request.current = null; if (alive.current) setBusy(false); }
    };
    void load.current();
    // Visible pages check shared server cache; this is not a per-visitor upstream refresh.
    const poll = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void load.current(); }, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') void load.current(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; request.current?.abort(); request.current = null; clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const cooling = Boolean(feed?.nextManualRefreshAt && Date.parse(feed.nextManualRefreshAt) > now);
  const stale = feed?.status === 'stale';
  return <section className={styles.section} aria-labelledby="campus-topics-title">
    <div className={styles.heading}><div><h2 id="campus-topics-title">从知乎讨论里，找一件想练的事</h2><p>看看别人的困惑，再把它改成你自己的练习。</p></div><button className={styles.refresh} type="button" disabled={busy || cooling} onClick={() => void load.current(true)}><RefreshCw size={15} aria-hidden="true" />{busy ? '正在获取话题' : '刷新话题'}</button></div>
    <div className={styles.status} aria-live="polite" role="status">
      {feed?.fetchedAt ? <><span>内容截至 {formatTime(feed.fetchedAt)}（北京时间）{stale ? ' · 暂保留此前内容' : ''}</span><span>最近检查 {formatTime(feed.checkedAt)}</span></> : <span>{busy ? '正在读取知乎公开话题…' : '还没有取得可用的话题。'}</span>}
      {feed?.status === 'refreshing' ? <span>服务器正在更新共享缓存。</span> : null}
      {feed?.error ? <p>{feed.error.message}{feed.items.length ? ' 先保留上次内容，获取时间没有更新。' : ' 你仍可以直接练自己的事。'}</p> : null}
      {message ? <p>{message}</p> : null}
    </div>
    {feed?.items.length ? <>
      <p className={styles.scope}>{feed.hotCount ? `热榜中筛出 ${feed.hotCount} 条校园相关话题` : '当前热榜未筛到校园相关话题'}{feed.relatedCount ? `，另补充 ${feed.relatedCount} 条相关讨论。` : '。'}相关讨论来自搜索，不代表近期发布或官方校园榜单。</p>
      <ul className={styles.list}>{feed.items.map(item => <li key={item.id} className={styles.item}><div className={styles.meta}><span className={item.kind === 'hot' ? styles.hot : styles.related}>{item.kind === 'hot' ? '热榜中的校园话题' : '校园相关讨论'}</span><span>{item.contentType === 'article' ? '文章' : item.contentType === 'answer' ? '回答入口' : '问题'}</span></div><h3>{item.title}</h3><div className={styles.actions}><a href={item.url} target="_blank" rel="noopener noreferrer">看原讨论<ArrowUpRight size={14} aria-hidden="true" /></a><button type="button" onClick={() => onPractice(campusPracticeDraft(item), { title: item.title, url: item.url, kind: item.kind, fetchedAt: item.fetchedAt })} disabled={disabled}><MessageCircle size={14} aria-hidden="true" />把它带进练习</button></div></li>)}</ul>
    </> : <div className={styles.empty}><MessageCircle size={24} aria-hidden="true" /><p>一件最近难开口、难安排的小事，也可以成为练习的起点。</p></div>}
    <div className={styles.foot}><p>点击后先填写可编辑草稿。讨论标题只是参考，不代表事件已核实，也不是原作者在与你对话。</p>{feed?.nextManualRefreshAt ? <span>每小时检查更新 · 下次可手动刷新 {formatTime(feed.nextManualRefreshAt)}</span> : <span>每小时检查更新；手动刷新间隔至少 30 分钟。</span>}</div>
  </section>;
}
