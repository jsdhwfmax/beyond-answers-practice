'use client';

import { buildExperienceBrief } from '@/domain/experience-brief';
import { sourceVotesLabel } from '@/domain/source-display-date';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { CAMPUS_EDUCATION_OPTIONS, CAMPUS_SCHOOL_TIER_OPTIONS, CAMPUS_STAGE_OPTIONS, campusSchoolOptions, isCampusProfileCombinationValid, sanitizeCampusProfileFilters, type CampusProfileFilters, type CampusDiscoveryResult, type CampusDiscoveryEvidence, type CampusSchoolTier, type CampusDiscoveryPreview, type CampusProfileRelaxation } from '@/domain/campus-profile-options';
import styles from './profile-discovery.module.css';

const STORAGE_KEY = 'practice-discovery-filters:v1';
const PAGE_SIZE = 8;
const FIELDS = [
  { key: 'education', label: '学历', options: CAMPUS_EDUCATION_OPTIONS },
  { key: 'schoolTier', label: '院校类型', options: CAMPUS_SCHOOL_TIER_OPTIONS },
  { key: 'stage', label: '当前阶段', options: CAMPUS_STAGE_OPTIONS },
] as const;

function filterKey(filters: CampusProfileFilters) {
  return FIELDS.map(field => filters[field.key] ?? '').join('|');
}
function filterLabels(filters: CampusProfileFilters) {
  return FIELDS.flatMap(field => { const selected = field.options.find(option => option.value === filters[field.key]); return selected ? [selected.label] : []; });
}
function readPreview(value: unknown, requested: CampusProfileFilters): CampusDiscoveryPreview {
  const data = value as CampusDiscoveryPreview | null;
  if (!data || data.kind !== 'count_preview' || typeof data.version !== 'string' || !data.version || !data.filters || filterKey(data.filters) !== filterKey(requested) || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.relaxations) || data.relaxations.length > 3 || (data.total > 0 && data.relaxations.length)) throw new Error('数量与当前选择没有对上。可以重新核对，或直接查找。');
  const seen = new Set<string>();
  for (const item of data.relaxations) {
    if (!item || !Array.isArray(item.removedFields) || !item.removedFields.length || item.removedFields.length > 3 || new Set(item.removedFields).size !== item.removedFields.length || !item.filters || !Number.isSafeInteger(item.total) || item.total <= 0) throw new Error('放宽建议暂时无法核对，当前条件仍保留。');
    const next = { ...requested };
    for (const field of item.removedFields) {
      if (!FIELDS.some(candidate => candidate.key === field) || !requested[field]) throw new Error('放宽建议与当前选择不符，当前条件仍保留。');
      delete next[field];
    }
    const key = filterKey(next);
    if (filterKey(item.filters) !== key || seen.has(key) || !isCampusProfileCombinationValid(item.filters)) throw new Error('放宽建议与当前选择不符，当前条件仍保留。');
    seen.add(key);
  }
  return data;
}
const relaxationLabel = (item: CampusProfileRelaxation) => item.removedFields.map(field => FIELDS.find(candidate => candidate.key === field)!.label).join('、');
function groupEvidence(evidence: CampusDiscoveryEvidence[]) {
  const groups = new Map<string, { key: string; labels: string[]; source: CampusDiscoveryEvidence['source']; quote: string }>();
  for (const item of evidence) {
    const key = JSON.stringify([item.source, item.answerId ?? null, item.quote]);
    const group = groups.get(key);
    if (group) { if (!group.labels.includes(item.label)) group.labels.push(item.label); }
    else groups.set(key, { key, labels: [item.label], source: item.source, quote: item.quote });
  }
  return [...groups.values()];
}
function saveFilters(filters: CampusProfileFilters): boolean {
  try {
    if (filterLabels(filters).length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, filters }));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}
function schoolResetMessage(filters: CampusProfileFilters, cleared: CampusSchoolTier, restored = false) {
  const education = CAMPUS_EDUCATION_OPTIONS.find(option => option.value === filters.education)?.label;
  const school = CAMPUS_SCHOOL_TIER_OPTIONS.find(option => option.value === cleared)?.label;
  return `${restored ? '已恢复' : '已选择'}${education}，已清除不适用的“${school}”院校类型。请重新选择院校类型，或保持不限。`;
}
function readFilters(): ReturnType<typeof sanitizeCampusProfileFilters> & { storageIssue?: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return { filters: {} };
    const saved = JSON.parse(raw) as { version?: number; filters?: Record<string, unknown> };
    if (saved?.version !== 1) return { filters: {} };
    const restored = sanitizeCampusProfileFilters(saved.filters);
    return { ...restored, storageIssue: !saveFilters(restored.filters) };
  } catch { return { filters: {}, storageIssue: true }; }
}

export function ProfileDiscovery() {
  const [filters, setFilters] = useState<CampusProfileFilters>({});
  const [hydrated, setHydrated] = useState(false);
  const [result, setResult] = useState<CampusDiscoveryResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [storageIssue, setStorageIssue] = useState(false);
  const [preview, setPreview] = useState<{ key: string; value?: CampusDiscoveryPreview; error?: string } | null>(null);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [beforeRelaxation, setBeforeRelaxation] = useState<CampusProfileFilters | null>(null);
  const controller = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const previewSequence = useRef(0);
  const sourceVersion = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const live = useRef(true);
  const latestFilters = useRef(filters);
  const latestResult = useRef(result);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const firstFilter = useRef<HTMLSelectElement>(null);
  const applied = result ? filterLabels(result.filters) : [];
  const changed = Boolean(result && filterKey(filters) !== filterKey(result.filters));
  const selectedKey = filterKey(filters);
  const currentPreview = preview?.key === selectedKey ? preview : null;
  const count = currentPreview?.value;
  useEffect(() => { latestFilters.current = filters; }, [filters]);
  useEffect(() => { latestResult.current = result; }, [result]);

  useEffect(() => {
    live.current = true;
    const frame = requestAnimationFrame(() => {
      const restored = readFilters(); setFilters(restored.filters); setStorageIssue(Boolean(restored.storageIssue)); setHydrated(true);
      if (restored.clearedSchoolTier) setAnnouncement(schoolResetMessage(restored.filters, restored.clearedSchoolTier, true));
      else if (filterLabels(restored.filters).length) setAnnouncement('已恢复这个浏览器的选择，点击查找即可。');
    });
    return () => { live.current = false; cancelAnimationFrame(frame); controller.current?.abort(); previewController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const sequence = ++previewSequence.current;
    const activeController = new AbortController(); previewController.current?.abort(); previewController.current = activeController;
    const requested = { ...latestFilters.current };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Selection changes only request a small count payload; full questions remain explicit.
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => activeController.abort(), 10_000);
      const params = new URLSearchParams({ preview: '1' });
      for (const field of FIELDS) { const value = requested[field.key]; if (value) params.set(field.key, value); }
      void (async () => {
        try {
          const response = await fetch(`/api/discover?${params}`, { cache: 'no-store', signal: activeController.signal });
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error('暂时没取到数量，可以重新核对，或直接查找。');
          const value = readPreview(body, requested);
          if (!live.current || activeController.signal.aborted || sequence !== previewSequence.current || filterKey(latestFilters.current) !== selectedKey) return;
          // Do not combine counts from a changed corpus with an older visible page.
          if ((sourceVersion.current && sourceVersion.current !== value.version) || (latestResult.current && latestResult.current.version !== value.version)) {
            requestSequence.current++; controller.current?.abort(); setWorking(false);
            setResult(null); setAnnouncement('题库已更新，数量已重新核对。请重新查找题目。');
          }
          sourceVersion.current = value.version;
          setPreview({ key: selectedKey, value });
        } catch (cause) {
          if (!live.current || sequence !== previewSequence.current || filterKey(latestFilters.current) !== selectedKey) return;
          setPreview({ key: selectedKey, error: activeController.signal.aborted ? '数量核对超时。条件还在，可以重新核对或直接查找。' : cause instanceof Error ? cause.message : '数量暂不可用，可以直接查找。' });
        } finally { clearTimeout(timeout); }
      })();
    }, 300);
    return () => { clearTimeout(debounce); clearTimeout(timeout); activeController.abort(); };
  }, [hydrated, selectedKey, previewRefresh]);

  function updateFilters(next: CampusProfileFilters) {
    requestSequence.current++; controller.current?.abort(); controller.current = null; setWorking(false);
    previewSequence.current++; previewController.current?.abort(); setPreview(null);
    setPreviewRefresh(value => value + 1);
    const cleaned = sanitizeCampusProfileFilters(next);
    latestFilters.current = cleaned.filters;
    setFilters(cleaned.filters); setAnnouncement(cleaned.clearedSchoolTier ? schoolResetMessage(cleaned.filters, cleaned.clearedSchoolTier) : ''); setError('');
    setStorageIssue(!saveFilters(cleaned.filters));
  }
  function clearFilters() {
    requestSequence.current++; controller.current?.abort(); controller.current = null;
    updateFilters({}); setBeforeRelaxation(null); setResult(null); setWorking(false); setAnnouncement('已清除选择。可以重新挑选，也可以不限条件查找。'); firstFilter.current?.focus();
  }
  async function search(requested: CampusProfileFilters, offset = 0, expectedSourceVersion = count?.version) {
    if (!isCampusProfileCombinationValid(requested)) { setError('学历与院校类型不匹配，请按同一就读阶段重新选择。'); return; }
    const sequence = ++requestSequence.current;
    controller.current?.abort(); const activeController = new AbortController(); controller.current = activeController;
    setWorking(true); setError(''); setAnnouncement('');
    const timeout = setTimeout(() => activeController.abort(), 20_000);
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    if (expectedSourceVersion) params.set('expectedSourceVersion', expectedSourceVersion);
    for (const field of FIELDS) { const value = requested[field.key]; if (value) params.set(field.key, value); }
    try {
      const response = await fetch(`/api/discover?${params}`, { cache: 'no-store', signal: activeController.signal });
      const data = await response.json().catch(() => null);
      if (!live.current || activeController.signal.aborted || sequence !== requestSequence.current) return;
      if (data?.error?.code === 'SOURCE_VERSION_CHANGED') {
        previewSequence.current++; previewController.current?.abort(); setPreview(null); setResult(null); setPreviewRefresh(value => value + 1);
        throw new Error('题库已更新，正在重新核对数量。请查看新数量后再查找。');
      }
      if (!response.ok) throw new Error(data?.error?.message ?? '暂时没有取到结果，请再查找一次。');
      if (!data || typeof data.version !== 'string' || !data.filters || filterKey(data.filters) !== filterKey(requested) || !Number.isInteger(data.total) || data.total < 0 || data.offset !== offset || data.limit !== PAGE_SIZE || !Array.isArray(data.matches) || data.matches.length > PAGE_SIZE) throw new Error('结果与本次筛选没有对上，请重新查找。');
      if ((expectedSourceVersion && data.version !== expectedSourceVersion) || (sourceVersion.current && sourceVersion.current !== data.version)) {
        previewSequence.current++; previewController.current?.abort(); setPreview(null); setResult(null); setPreviewRefresh(value => value + 1);
        throw new Error('题数与结果的来源版本不同，请重新核对后查找。');
      }
      if (!live.current || activeController.signal.aborted || sequence !== requestSequence.current) return;
      setResult(data as CampusDiscoveryResult);
      latestResult.current = data as CampusDiscoveryResult;
      sourceVersion.current = data.version;
      if (previewController.current && (!count || count.version !== data.version)) {
        previewSequence.current++; previewController.current.abort(); setPreview(null); setPreviewRefresh(value => value + 1);
      }
      requestAnimationFrame(() => { resultHeading.current?.focus({ preventScroll: true }); resultHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
    } catch (cause) {
      if (!live.current || sequence !== requestSequence.current) return;
      setError(activeController.signal.aborted ? '查找等得有点久。选择还在，请再试一次。' : cause instanceof Error ? cause.message : '暂时无法查找，选择仍保留。');
    } finally {
      clearTimeout(timeout); if (live.current && sequence === requestSequence.current) { setWorking(false); controller.current = null; }
    }
  }
  function relax(item: CampusProfileRelaxation) {
    if (!count || count.total !== 0 || filterKey(count.filters) !== filterKey(latestFilters.current) || working) return;
    const previous = { ...filters };
    updateFilters(item.filters); setBeforeRelaxation(previous);
    void search(item.filters, 0, count.version);
    setAnnouncement(`已将${relaxationLabel(item)}设为不限，其余条件保留。可以恢复放宽前的条件。`);
  }

  return <div className={styles.page}>
    <a className={styles.skip} href="#discovery-main">跳到筛选与结果</a>
    <header className={styles.nav}><Link href="/?view=home" className={styles.brand}><BookOpen size={23} aria-hidden="true" /><span>答案之外<small>经验练习场</small></span></Link><Link href="/?view=home">返回练习主页</Link></header>
    <main id="discovery-main">
      <header className={styles.intro}><div className={styles.introCopy}><h1>找到和你处境相近的问题</h1><p>选几个你想了解的标签，看看知乎里有哪些经验可以借鉴。</p></div><div className={styles.introArtwork}><Image src="/art/profile-pathways-v6.png" alt="四位同学在校园的共享书架旁交流，身后小路通往不同的学习空间" width={1536} height={1024} sizes="(max-width: 650px) 100vw, (max-width: 1120px) 40vw, 435px" loading="eager" /></div></header>
      <div className={styles.discoveryLayout}>
      <div className={styles.searchControls}>
      <form className={styles.filters} aria-label="按处境筛选" onSubmit={event => { event.preventDefault(); if (hydrated && !working) void search({ ...filters }); }}>
        <div className={styles.filterHeading}><SlidersHorizontal size={18} aria-hidden="true" /><strong>你想了解怎样的处境？</strong><span>三组选填 · 默认不限</span></div>
        <div className={styles.fields}>{FIELDS.map((field, index) => <label key={field.key} htmlFor={`discovery-${field.key}`}>{field.label}<select ref={index === 0 ? firstFilter : undefined} id={`discovery-${field.key}`} value={filters[field.key] ?? ''} aria-describedby={field.key !== 'stage' ? 'discovery-study-context' : undefined} disabled={!hydrated} onChange={event => { const next = { ...filters }; if (event.target.value) Object.assign(next, { [field.key]: event.target.value }); else delete next[field.key]; updateFilters(next); }}><option value="">不限</option>{(field.key === 'schoolTier' ? campusSchoolOptions(filters.education) : field.options).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div>
        <p id="discovery-study-context" className={styles.contextHint}>{filters.education === 'junior_college' ? '本页专科阶段可选“高职 / 专科院校”或“不限”；升本后的经历，请另选“本科”查找。' : '请按同一就读阶段选择学历与院校类型；跨阶段的经历，可以分别查找。'}</p>
        <section className={styles.countPreview} aria-label="当前筛选预览" data-preview-version={count?.version}>
          <p aria-live="polite">{count ? <><strong>{count.total ? `当前条件有 ${count.total} 个问题` : '当前条件暂时没有相近问题'}</strong><span>{count.total ? '查找后可以阅读原回答，或选一题开始练习。' : '已选条件还在。以下仅是可选的放宽方式，不会自动替你修改。'}</span></> : <span>{currentPreview?.error || '正在核对当前条件的题数…'}</span>}</p>
          {currentPreview?.error && <button type="button" onClick={() => { setPreview(null); setPreviewRefresh(value => value + 1); }}>重新核对数量</button>}
          {count?.total === 0 && count.relaxations.length > 0 && <div className={styles.relaxations} aria-label="可选的放宽条件">{count.relaxations.map(item => <button key={filterKey(item.filters)} type="button" disabled={working} onClick={() => relax(item)}>放宽{relaxationLabel(item)}，可看 {item.total} 题</button>)}</div>}
          {beforeRelaxation && <button type="button" className={styles.undoRelaxation} disabled={working} onClick={() => { updateFilters(beforeRelaxation); setBeforeRelaxation(null); setAnnouncement('已恢复放宽前的条件。下方结果仍保留原标注，查找后再更新。'); }}>恢复放宽前的条件</button>}
        </section>
        <div className={styles.filterActions}><button type="submit" className={styles.primary} disabled={!hydrated || working}><Search size={17} aria-hidden="true" />{working ? '正在查找…' : '查找相近的问题'}</button><button type="button" className={styles.clear} onClick={clearFilters} disabled={!hydrated}><X size={15} aria-hidden="true" />清除选择</button></div>
        <p className={styles.privacy}>{storageIssue ? '这个浏览器暂时无法保存筛选，当前页面仍可查找。' : '选择只保存在这个浏览器，并用于核对公开题库的数量；不会发送给模型。'}</p>
      </form>
      <p className={styles.boundary}>匹配依据是原题和回答摘要中的文字，标签不代表我们核实了回答作者的身份。</p>
      <div className={styles.announcement} role="status" aria-live="polite">{announcement}</div>
      {working && <div className={styles.loading} role="status"><span className={styles.loadingLine} aria-hidden="true" /><span>正在核对题库中的匹配依据…</span></div>}
      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => void search({ ...filters })} disabled={working}>重新查找</button></div>}
      </div>
      <div className={styles.searchResults}>
      {result ? <section className={styles.results} aria-labelledby="discovery-results-title">
        <header className={styles.resultHeading}><div><h2 id="discovery-results-title" ref={resultHeading} tabIndex={-1}>{applied.length ? `找到 ${result.total} 个相近问题` : `可浏览 ${result.total} 个问题`}</h2><p>{applied.length ? `本次同时筛选：${applied.join(' ／ ')}` : '本次不限标签，按回答旁标注的赞同数排序。'}</p></div>{result.total > 0 && <span>每页最多 {PAGE_SIZE} 个</span>}</header>
        {changed && <p className={styles.changed}>筛选已修改。下方仍是上一次的结果，点击“查找相近的问题”更新。</p>}
        {!result.matches.length ? <div className={styles.empty}><BookOpen size={28} aria-hidden="true" /><h3>先换一个查找范围</h3><p>当前资料里，暂时没有同时满足这些条件的已核对情境。可以调整一项标签，或清除选择后再查找。</p><div><button type="button" onClick={() => firstFilter.current?.focus()}>调整筛选</button><button type="button" onClick={clearFilters}>清除并重新选择</button></div></div> : <div className={styles.resultList}>{result.matches.map(match => <article className={styles.question} key={match.question.id} data-discovery-question={match.question.id}>
          <div className={styles.questionMeta}><span>{match.question.category}</span><a href={match.question.questionUrl} target="_blank" rel="noopener noreferrer">知乎原问题<ArrowUpRight size={13} aria-hidden="true" /></a></div>
          <h3>{match.question.title}</h3>
          {!!match.evidence.length && <section className={styles.evidence} aria-label="匹配依据"><h4><Check size={15} aria-hidden="true" />为什么匹配</h4>{match.contextLabel && <p className={styles.contextLabel}>{match.contextLabel}</p>}<ul>{groupEvidence(match.evidence).map(evidence => <li key={evidence.key}><span>{evidence.labels.join(' · ')}</span><div><small>{evidence.source === 'question' ? '原题提到' : '回答摘要提到'}</small><q>{evidence.quote}</q></div></li>)}</ul></section>}
          <div className={styles.answers}>{match.question.answers.map(answer => { const author = answer.author.trim() || '作者昵称未显示'; const brief = buildExperienceBrief(match.question, answer.answerId); return <section key={answer.answerId} aria-label={`${author}的回答`}>
            <div className={styles.author}><strong>{author}</strong><span>{sourceVotesLabel(answer)}</span></div>
            <div className={styles.experienceTeaser} data-brief-kind={brief.kind}>{brief.kind === 'reviewed' ? <><span>团队提炼</span><p>{brief.summary}</p></> : <><span>原摘要预览</span><blockquote>{brief.quote}{brief.quoteTruncated ? '…' : ''}</blockquote></>}</div><div className={styles.answerActions}><Link className={styles.practiceLink} prefetch={false} href={`/?mode=custom&intent=new&sourceQuestionId=${encodeURIComponent(match.question.id)}`}>从这题开始练习<ArrowRight size={16} aria-hidden="true" /></Link><a href={answer.url} target="_blank" rel="noopener noreferrer">读知乎原回答<ArrowUpRight size={14} aria-hidden="true" /></a></div>
            <details className={styles.reading}><summary>在这里核对摘要与出处</summary>{brief.kind === 'reviewed' && <><h4>团队适用提醒</h4><p>{brief.conditions}</p><h4>这次可以试 · 原创模拟练法</h4><p>{brief.application}</p></>}<h4>已取得的知乎摘要节选</h4><blockquote>{answer.excerpt}</blockquote><p>这是回答摘要，并非完整回答。</p><p>练习场景和人物由我们原创，不是对作者经历的重现。</p></details>
          </section>; })}</div>
        </article>)}</div>}
        {result.total > PAGE_SIZE && <nav className={styles.pagination} aria-label="匹配问题分页"><button type="button" disabled={working || changed || result.offset === 0} onClick={() => void search(result.filters, Math.max(0, result.offset - PAGE_SIZE))}>上一页</button><span>第 {Math.floor(result.offset / PAGE_SIZE) + 1} / {Math.ceil(result.total / PAGE_SIZE)} 页</span><button type="button" disabled={working || changed || result.offset + PAGE_SIZE >= result.total} onClick={() => void search(result.filters, result.offset + PAGE_SIZE)}>下一页</button></nav>}
        <details className={styles.aboutMatching}><summary>关于标签与匹配范围</summary><p>每个选中的维度都需要同一情境中的文字依据；没有标签，也可能只是取得的摘要没有说明。标签用于寻找可参考的问题，不是对学校或个人的评价。</p><p>来源版本：{result.version}。仅使用已取得的片段，未宣称读过全部回答。</p></details>
      </section> : !working && !error && <section className={styles.beforeSearch}><BookOpen size={23} aria-hidden="true" /><div><h2>先找到一件值得聊聊的事</h2><p>选中一个、几个，或保持不限，再点击查找。你可以直接阅读回答，也可以把问题改成自己的练习。</p></div></section>}
      </div>
      </div>
    </main>
    <footer className={styles.footer}><span>有出处的经验，可编辑的练习。</span><Link href="/?mode=custom&intent=new">也可以直接练自己的事<ArrowRight size={14} aria-hidden="true" /></Link></footer>
  </div>;
}
