'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { CampusQuestionCard } from './campus-experience';
import styles from './campus-library.module.css';

interface LibraryView { version: string; total: number; categories: string[]; questions: CampusCorpusQuestion[]; highVoteThreshold: number }
export function CampusLibrary({ onChoose, initiallyOpen = false }: { onChoose: (question: CampusCorpusQuestion) => void; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className={styles.root} id="campus-library" aria-label="知乎校园问题库">
    <div className={styles.heading}><div><h2><BookOpen size={19} aria-hidden="true" />知乎校园问题库</h2></div><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起问题库' : '浏览知乎校园问题'}</button></div>
    {open && <LibraryResults onChoose={onChoose} />}
  </section>;
}

function LibraryResults({ onChoose }: { onChoose: (question: CampusCorpusQuestion) => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ q: '', category: '', offset: 0 });
  const key = `${filter.q}:${filter.category}:${filter.offset}`;
  const [loaded, setLoaded] = useState<{ key: string; data: LibraryView | null; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const params = new URLSearchParams({ q: filter.q, category: filter.category, offset: String(filter.offset), limit: '12' });
    void fetch(`/api/campus-library?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('暂时没有取到问题库，请稍后重试。');
      const data = await response.json() as LibraryView;
      if (!Array.isArray(data.questions) || !Array.isArray(data.categories) || typeof data.total !== 'number') throw new Error('问题库返回不完整，请稍后重试。');
      if (live) setLoaded({ key, data, error: '' });
    }).catch(cause => { if (live) setLoaded({ key, data: null, error: controller.signal.aborted ? '读取问题库的时间有点长，可以重试。' : cause instanceof Error ? cause.message : '问题库暂时不可用。' }); }).finally(() => clearTimeout(timeout));
    return () => { live = false; controller.abort(); clearTimeout(timeout); };
  }, [filter.q, filter.category, filter.offset, key, attempt]);
  const current = loaded?.key === key ? loaded : null;
  const data = current?.data;
  const categories = loaded?.data?.categories ?? [];
  return <div className={styles.results}>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); setFilter(value => ({ ...value, q: search.trim(), offset: 0 })); }}>
      <label htmlFor="campus-question-query">找一件想练的事</label><div><input id="campus-question-query" value={search} maxLength={100} placeholder="例如：室友、复读、拒绝、实习" onChange={event => setSearch(event.target.value)} /><button type="submit"><Search size={16} aria-hidden="true" />查找</button></div>
      <label htmlFor="campus-question-category">问题类别</label><select id="campus-question-category" value={filter.category} onChange={event => setFilter(value => ({ ...value, category: event.target.value, offset: 0 }))}><option value="">全部类别</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select>
    </form>
    {!current ? <p className={styles.notice} role="status">正在读取已整理的知乎问题…</p> : current.error ? <div className={styles.notice}><p role="status">{current.error}</p><button type="button" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>重新读取问题库</button></div> : data && <>
      <div className={styles.resultMeta}><span>找到 {data.total} 个问题</span><details><summary>这些经验从哪里来？</summary><p>每题至少收录一条达到 {data.highVoteThreshold} 赞同的回答，具体日期见回答旁的标注。标为“团队提炼”的内容经过片段核读，原回答和摘要可在每题里展开核对。</p></details></div>
      {data.questions.length ? <div className={styles.list}>{data.questions.map(question => <CampusQuestionCard key={question.id} question={question} onChoose={onChoose} />)}</div> : <p className={styles.empty}>暂时没有匹配这一说法的问题。可以换个关键词，也可以继续描述自己的事情。</p>}
      {data.total > 12 && <nav className={styles.pagination} aria-label="知乎问题分页"><button type="button" disabled={filter.offset === 0} onClick={() => setFilter(value => ({ ...value, offset: Math.max(0, value.offset - 12) }))}>上一页</button><span>第 {Math.floor(filter.offset / 12) + 1} / {Math.ceil(data.total / 12)} 页</span><button type="button" disabled={filter.offset + 12 >= data.total} onClick={() => setFilter(value => ({ ...value, offset: value.offset + 12 }))}>下一页</button></nav>}
    </>}
  </div>;
}
