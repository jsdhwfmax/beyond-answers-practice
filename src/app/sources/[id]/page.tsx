import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SOURCES } from '@/content/sources';
import styles from './page.module.css';

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = SOURCES.find(item => item.id === id);
  if (!source) notFound();
  return <main className={styles.page}>
    <nav><Link href="/?view=home">← 回到经验练习场</Link><span>知乎经验 · 阅读片段</span></nav>
    <article>
      <header><span className={styles.eyebrow}>从别人的经历，找到下一步的线索</span><h1>{source.title}</h1><p>{source.author} · 取得于 {source.retrievedAt}</p></header>
      <section className={styles.sourceExcerpt}><h2>实际取得的支持片段</h2><blockquote>{source.excerpt}</blockquote><p className={styles.note}>{source.truncated ? '官方接口返回的内容存在截断。这里展示支持本次归纳的片段，未取得完整章节。' : '此处展示实际取得的内容。'}</p></section>
      <div className={styles.readingNotes}>
      <section><h2>我们的阅读归纳</h2><p>{source.interpretation}</p></section>
      <section><h2>什么时候可以参考</h2><p>{source.conditions}</p></section>
      <section><h2>如何用在这次原创模拟里</h2><p>{source.application}</p></section>
      </div>
      <footer>官方内容标识：{source.id}<br />本页将已取得的来源片段整理为可阅读的页面。未核实到普通文章链接，因此不拼造原文地址。</footer>
    </article>
  </main>;
}
