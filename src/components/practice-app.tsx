'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, ClipboardList, FileText, GitCompareArrows, Menu, MessageCircle, RotateCcw, Trash2, X } from 'lucide-react';
import { SCENARIOS } from '@/domain/scenarios';
import type { ActionRequest, Command, ExperienceReport, ScenarioId, SessionView, SourceCard } from '@/domain/types';
import { AgreementBoard } from './agreement-board';
import { Conversation } from './conversation';
import { ComparisonPanel, PlanEditor, ReportPanel, RetryPanel, ScenarioActions, SourcesPanel, type GuidedReflection } from './panels';
import { Modal, StatusPill } from './ui';
import { Welcome, ScenarioGuide, type SavedPractice } from './welcome';
import { CustomPractice } from './custom-practice';
import { PracticeGuidance } from './practice-guidance';
import { Launch, type LaunchQuestion } from './launch';
import { PracticeDemo } from './practice-demo';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';

type Health = { ok: boolean; storage: 'local' | 'postgres' | 'unavailable'; naturalLanguage: boolean; configured: { database: boolean; openai: boolean } };
type Pending = { sessionId: string; request: ActionRequest };
type CustomSeed = { topic: string; library?: boolean; entryIntent?: 'new' | 'resume'; question?: CampusCorpusQuestion; source?: { title: string; url: string; kind?: string; fetchedAt?: string } };
type Mode = 'launch' | 'home' | 'demo' | 'session' | 'custom';
type Panel = 'sources' | 'plan' | 'retry' | 'undo' | 'comparison' | 'report' | 'delete' | 'about' | null;
const SESSION_KEY = 'beyond.session.v1';
const HISTORY_KEY = 'beyond.history.v1';
const PENDING_KEY = 'beyond.pending.v1';
const SAVED_KEY = 'beyond.practices.v2';

class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(body?.error?.message ?? '这次请求未能完成，请稍后再试。', body?.error?.code ?? 'REQUEST_FAILED', response.status);
    const expectsSession = /^\/api\/sessions(?:\/|$)/.test(path) && options.method !== 'DELETE';
    if (!body || typeof body !== 'object' || Array.isArray(body) || (expectsSession && (!body.session || !Array.isArray(body.session.events) || typeof body.session.version !== 'number' || !body.session.state))) {
      throw new ApiError('这次没有收到可读取的结果。原话已保留，请先核对本轮结果或重试。', 'INVALID_RESPONSE', 502);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('连接暂时中断。已确认的记录不会因此改变，可以核对本轮结果。', 'CONNECTION_UNKNOWN', 0);
  } finally { clearTimeout(timeout); }
}

function readLocal<T>(key: string): T | null { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : null; } catch { return null; } }
function writeLocal(key: string, value: unknown) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* The current tab retains the live session even when browser storage is unavailable. */ } }
function readSaved(): SavedPractice[] {
  const value = readLocal<unknown>(SAVED_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SavedPractice => item !== null && typeof item === 'object' && typeof item.id === 'string' && Object.hasOwn(SCENARIOS, item.scenario) && typeof item.updatedAt === 'string');
}

export function PracticeApp({ initialMode = 'launch', launchQuestions = [] }: { initialMode?: Mode; launchQuestions?: LaunchQuestion[] } = {}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [booting, setBooting] = useState(true);
  const [navigationReady, setNavigationReady] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [busy, setBusy] = useState(false);
  const [customSeed, setCustomSeed] = useState<CustomSeed | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [tab, setTab] = useState<'conversation' | 'board'>('conversation');
  const [panel, setPanelState] = useState<Panel>(null);
  const panelRef = useRef<Panel>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [saved, setSaved] = useState<SavedPractice[]>([]);
  const targetSessionId = useRef<string | null>(null);
  const navigationId = useRef(0);
  const [sources, setSources] = useState<SourceCard[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [report, setReport] = useState<ExperienceReport | null>(null);
  const [reportSession, setReportSession] = useState<SessionView | null>(null);
  const [reflectionQuestions, setReflectionQuestions] = useState<GuidedReflection | null>(null);
  const reflectionRequestIds = useRef(new Map<string, string>());
  const [menuOpen, setMenuOpen] = useState(false);
  const lock = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const sessionRef = useRef<SessionView | null>(null);
  const mounted = useRef(true);

  const acceptSession = useCallback((value: SessionView) => {
    const item: SavedPractice = { id: value.id, scenario: value.state.scenario, updatedAt: value.updatedAt, phase: value.state.phase, forkReason: value.forkReason };
    const entries = readSaved();
    const existingEntry = entries.find((entry) => entry.id === value.id);
    const nextEntries = [existingEntry && existingEntry.updatedAt > item.updatedAt ? existingEntry : item, ...entries.filter((entry) => entry.id !== value.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeLocal(SAVED_KEY, nextEntries); setSaved(nextEntries);
    const history = readLocal<Partial<Record<ScenarioId, string>>>(HISTORY_KEY) ?? {};
    writeLocal(HISTORY_KEY, { ...history, [value.state.scenario]: value.id });
    if (targetSessionId.current !== value.id) return;
    if (sessionRef.current?.id === value.id && sessionRef.current.version > value.version) return;
    sessionRef.current = value;
    setSession(value);
    writeLocal(SESSION_KEY, value.id);
  }, []);
  const rememberPending = useCallback((value: Pending | null) => { pendingRef.current = value; setPending(value); writeLocal(PENDING_KEY, value); }, []);
  const begin = () => { if (lock.current) return false; lock.current = true; setBusy(true); setProblem(''); setNotice(''); return true; };
  const end = () => { lock.current = false; setBusy(false); };

  const setPanel = (value: Panel) => {
    if (value === panelRef.current) return;
    if (value === null && panelRef.current && window.history.state?.beyondPanel) {
      panelRef.current = null; setPanelState(null); window.history.back(); return;
    }
    const hadPanel = Boolean(panelRef.current);
    panelRef.current = value; setPanelState(value);
    const state = { ...window.history.state, beyondPanel: value };
    if (value && !hadPanel) window.history.pushState(state, '', window.location.href);
    else window.history.replaceState(state, '', window.location.href);
  };
  const selectLocation = (id: string | null, custom = false, seed: CustomSeed | null = null, screen: 'home' | 'demo' | 'launch' = 'home') => {
    setEntryError('');
    setNavigationReady(true);
    navigationId.current += 1; targetSessionId.current = id;
    if (panelRef.current) window.history.replaceState({ ...window.history.state, beyondPanel: null }, '', window.location.href);
    panelRef.current = null; setPanelState(null); setMenuOpen(false); setProblem(''); setNotice('');
    setMode(custom ? 'custom' : id ? 'session' : screen);
    setCustomSeed(custom ? seed : null);
    window.history.pushState({ ...window.history.state, beyondPanel: null, beyondCustomSeed: custom ? seed : null }, '', custom ? '/?mode=custom' : id ? `/?session=${encodeURIComponent(id)}` : screen === 'launch' ? '/' : `/?view=${screen}`);
    if (!id) { sessionRef.current = null; setSession(null); }
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const goHome = () => selectLocation(null);
  const goDemo = () => selectLocation(null, false, null, 'demo');
  const startCustom = () => selectLocation(null, true, { topic: '', entryIntent: 'new' });
  const startLibrary = () => selectLocation(null, true, { topic: '', library: true, entryIntent: 'new' });
  const consumeCustomIntent = () => {
    if (customSeed?.entryIntent !== 'new') return;
    const seed: CustomSeed = { topic: '', entryIntent: 'resume' };
    setCustomSeed(seed);
    window.history.replaceState({ ...window.history.state, beyondCustomSeed: seed }, '', '/?mode=custom');
  };

  useEffect(() => {
    mounted.current = true;
    const storedPending = readLocal<Pending>(PENDING_KEY);
    const fetchHealth = api<Health>('/api/health').then((value) => { if (mounted.current) setHealth(value); }).catch(() => { if (mounted.current) setHealth(null); });
    const restoreLocation = async () => {
      const params = new URLSearchParams(window.location.search);
      const storedId = params.get('session');
      const custom = params.get('mode') === 'custom';
      const navigation = ++navigationId.current;
      setEntryError('');
      const sourceQuestionId = custom ? params.get('sourceQuestionId') : null;
      let seed: CustomSeed | null = custom && (window.history.state?.beyondCustomSeed?.topic || window.history.state?.beyondCustomSeed?.library || window.history.state?.beyondCustomSeed?.entryIntent) ? window.history.state.beyondCustomSeed as CustomSeed : custom && params.get('intent') === 'new' ? { topic: '', entryIntent: 'new' } : null;
      if (sourceQuestionId) {
        setNavigationReady(false);
        try {
          const { question } = await api<{ question: CampusCorpusQuestion }>(`/api/campus-library/${encodeURIComponent(sourceQuestionId)}`);
          if (!mounted.current || navigationId.current !== navigation) return;
          if (!question || question.id !== sourceQuestionId || !question.scenarioSeed) throw new Error('这条题目暂时无法读取。');
          const s = question.scenarioSeed;
          seed = { topic: `我是${s.userRole}，想和${s.counterpartRole}聊聊。${s.situation}我希望${s.goal}`, question, entryIntent: 'new' };
        } catch {
          if (!mounted.current || navigationId.current !== navigation) return;
          setEntryError('这条题目暂时无法读取，请重新载入，或返回选题页换一道。');
          seed = null;
        }
      }
      setCustomSeed(seed);
      setNavigationReady(true);
      const nextPanel = (window.history.state?.beyondPanel as Panel) ?? null;
      panelRef.current = nextPanel; setPanelState(nextPanel); setMenuOpen(false);
      targetSessionId.current = storedId;
      setMode(custom ? 'custom' : storedId ? 'session' : params.get('view') === 'demo' ? 'demo' : params.get('view') === 'home' ? 'home' : 'launch');
      if (!storedId || custom) { sessionRef.current = null; setSession(null); setBooting(false); return; }
      if (sessionRef.current?.id === storedId) return;
      setBooting(true); sessionRef.current = null; setSession(null);
      try {
      const { session: restored } = await api<{ session: SessionView }>(`/api/sessions/${encodeURIComponent(storedId)}`);
      if (!mounted.current || navigationId.current !== navigation) return;
      acceptSession(restored);
      let restoredDraft = '';
      try { restoredDraft = localStorage.getItem(`beyond.draft.v1.${restored.id}`) ?? ''; draftRef.current = restoredDraft; setDraft(restoredDraft); } catch { /* Draft storage is optional. */ }
      const unfinished = pendingRef.current;
      if (unfinished?.sessionId === restored.id) {
        const committed = restored.events.some((event) => event.actionId === unfinished.request.actionId);
        if (committed) {
          rememberPending(null);
          if (unfinished.request.text && restoredDraft.trim() === unfinished.request.text) {
            draftRef.current = ''; setDraft('');
            try { localStorage.removeItem(`beyond.draft.v1.${restored.id}`); } catch { /* The live draft has already been cleared. */ }
          }
          setNotice('已核对：上次行动已经保存。');
        }
        else setProblem('上次行动的结果尚待核对。请先核对，再继续提出安排。');
      }
    } catch (error: unknown) {
      if (!mounted.current || navigationId.current !== navigation) return;
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        const entries = (readSaved()).filter((item) => item.id !== storedId);
        writeLocal(SAVED_KEY, entries); setSaved(entries);
        setProblem('这次练习已删除、到期，或不属于当前浏览器。可以返回练习主页，开始另一段练习。');
      }
      else setProblem('暂时没能恢复上次练习。可以刷新重试，已有记录不会被自动删除。');
    } finally { if (mounted.current && navigationId.current === navigation) setBooting(false); }
    };
    // Migrate the previous one-per-scenario history into the new recoverable list.
    const legacy = readLocal<Partial<Record<ScenarioId, string>>>(HISTORY_KEY) ?? {};
    const oldLatest = readLocal<string>(SESSION_KEY);
    const knownIds = new Set((readSaved()).map((item) => item.id));
    const legacyIds = [...new Set([...Object.values(legacy), oldLatest].filter((id): id is string => Boolean(id)))].filter((id) => !knownIds.has(id));
    void Promise.allSettled(legacyIds.map((id) => api<{ session: SessionView }>(`/api/sessions/${encodeURIComponent(id)}`).then(({ session: value }) => { if (mounted.current) acceptSession(value); })));
    void fetchHealth;
    // Read browser-only storage after hydration; subscribe to subsequent navigation below.
    queueMicrotask(() => {
      if (!mounted.current) return;
      setSaved(readSaved());
      if (storedPending) rememberPending(storedPending);
      void restoreLocation();
    });
    window.addEventListener('popstate', restoreLocation);
    return () => { mounted.current = false; window.removeEventListener('popstate', restoreLocation); };
  }, [acceptSession, rememberPending]);

  const changeDraft = (value: string) => { draftRef.current = value; setDraft(value); if (sessionRef.current) { try { localStorage.setItem(`beyond.draft.v1.${sessionRef.current.id}`, value); } catch { /* Keep in memory if local storage is unavailable. */ } } };
  const clearSubmittedDraft = (text?: string, id = sessionRef.current?.id) => {
    if (!text || !id) return;
    try { if (localStorage.getItem(`beyond.draft.v1.${id}`)?.trim() === text) localStorage.removeItem(`beyond.draft.v1.${id}`); } catch { /* Keep current in-memory editing usable. */ }
    if (sessionRef.current?.id === id && draftRef.current.trim() === text) changeDraft('');
  };

  const loadSources = async () => {
    setSourcesLoading(true); setSourceError('');
    try { const result = await api<{ sources: SourceCard[] }>('/api/sources'); setSources(result.sources); }
    catch (error) { setSourceError(error instanceof Error ? error.message : '来源暂时无法读取。'); }
    finally { setSourcesLoading(false); }
  };
  const openSources = async () => {
    const navigation = navigationId.current;
    const current = sessionRef.current;
    if (current?.state.scenario === 'transfer' && current.state.transfer.firstPlan === null && !current.state.transfer.hintUsed) {
      const recorded = await act({ type: 'hint' });
      if (!recorded) { setProblem('这次经验阅读的辅助记录尚未保存。请先核对当前行动，再打开经验；不能把提示后的表现视为无提示作答。'); return; }
    }
    if (navigationId.current !== navigation) return;
    setPanel('sources'); if (!sources.length && !sourcesLoading) void loadSources();
  };

  const startScenario = async (scenario: ScenarioId, restoreExisting = false) => {
    if (pendingRef.current) { setProblem('请先核对当前行动的结果，再切换练习。'); return; }
    if (!begin()) return;
    const navigation = navigationId.current;
    try {
      const history = readLocal<Partial<Record<ScenarioId, string>>>(HISTORY_KEY) ?? {};
      const id = restoreExisting ? history[scenario] : null;
      let result: { session: SessionView };
      if (id) {
        try { result = await api(`/api/sessions/${encodeURIComponent(id)}`); }
        catch (error) { if (error instanceof ApiError && error.status === 404) result = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ scenario }) }); else throw error; }
      } else result = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ scenario }) });
      if (navigationId.current !== navigation) { acceptSession(result.session); return; }
      selectLocation(result.session.id); acceptSession(result.session); setReport(null); setReportSession(null); setReflectionQuestions(null); setTab('conversation');
      try { const restoredDraft = localStorage.getItem(`beyond.draft.v1.${result.session.id}`) ?? ''; draftRef.current = restoredDraft; setDraft(restoredDraft); } catch { draftRef.current = ''; setDraft(''); }
      setNotice(`${SCENARIOS[scenario].title}已准备好。`);
    } catch (error) { setProblem(error instanceof Error ? error.message : '暂时无法开始练习。'); }
    finally { end(); }
  };

  const resumeSession = async (id: string) => {
    if (!begin()) return;
    const navigation = navigationId.current;
    try {
      const result = await api<{ session: SessionView }>(`/api/sessions/${encodeURIComponent(id)}`);
      if (navigationId.current !== navigation) { acceptSession(result.session); return; }
      selectLocation(id); acceptSession(result.session); setTab('conversation'); setReport(null);
      const restoredDraft = (() => { try { return localStorage.getItem(`beyond.draft.v1.${id}`) ?? ''; } catch { return ''; } })();
      draftRef.current = restoredDraft; setDraft(restoredDraft);
      if (pendingRef.current?.sessionId === id) setProblem('有一次行动尚待核对，原话与记录已经保留。');
    } catch (error) { setProblem(error instanceof Error ? error.message : '暂时不能恢复这次练习。'); }
    finally { end(); }
  };

  const submitRequest = async (value: Pending): Promise<SessionView | null> => {
    try {
      const { session: next } = await api<{ session: SessionView }>(`/api/sessions/${value.sessionId}/actions`, { method: 'POST', body: JSON.stringify(value.request) });
      acceptSession(next);
      if (!next.events.some((event) => event.actionId === value.request.actionId)) {
        setProblem(next.pendingActionId === value.request.actionId ? '这次行动仍在处理中，当前约定保持不变。稍后核对结果即可。' : '这次行动尚未找到已保存结果，请先核对。');
        return null;
      }
      rememberPending(null);
      clearSubmittedDraft(value.request.text, value.sessionId);
      const changes = next.events.filter((event) => event.actionId === value.request.actionId).reduce((sum, event) => sum + event.changes.length, 0);
      setNotice(changes ? `本轮已保存，${changes} 项记录发生变化。` : '本轮行动已记录。');
      return next;
    } catch (error) {
      if (error instanceof ApiError && ((error.status >= 400 && error.status < 500 && error.code !== 'ACTION_IN_PROGRESS') || error.code === 'AI_NOT_CONFIGURED')) {
        rememberPending(null);
        if (error.code === 'VERSION_CONFLICT') { try { const result = await api<{ session: SessionView }>(`/api/sessions/${value.sessionId}`); acceptSession(result.session); } catch { /* The error below keeps the action unconfirmed. */ } }
      }
      setProblem(error instanceof Error ? error.message : '这次行动尚未确认，请核对结果。');
      return null;
    }
  };

  const act = async (command?: Command, text?: string): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current || pendingRef.current) { if (pendingRef.current) setProblem('请先核对上一次行动，再提交新的安排。'); return false; }
    if (!begin()) return false;
    const request: ActionRequest = { actionId: crypto.randomUUID(), expectedVersion: current.version, ...(command ? { command } : { text }) };
    const value = { sessionId: current.id, request }; rememberPending(value);
    try { return Boolean(await submitRequest(value)); }
    finally { end(); }
  };

  const checkPending = async (retry = false) => {
    const value = pendingRef.current;
    if (!value || !begin()) return;
    try {
      const result = await api<{ session: SessionView }>(`/api/sessions/${value.sessionId}`);
      acceptSession(result.session);
      if (result.session.events.some((event) => event.actionId === value.request.actionId)) {
        rememberPending(null); clearSubmittedDraft(value.request.text, value.sessionId); setNotice('已核对：这次行动已经保存，没有重复执行。');
      } else if (result.session.pendingActionId) setProblem('这次行动仍在处理中，当前约定保持不变。稍后再核对即可。');
      else if (retry) await submitRequest(value);
      else {
        try {
          const checked = await api<{ session: SessionView; action: { id: string; status: string; leaseExpired: boolean; errorCode?: string } }>(`/api/sessions/${value.sessionId}/actions/${value.request.actionId}`);
          acceptSession(checked.session);
          if (checked.action.status === 'failed') { rememberPending(null); setProblem('已核对：上次行动未能完成，没有改变约定。原话已保留，可以修改后再试。'); }
          else setProblem('已核对：尚未找到这次行动的已保存结果。可以用原行动重试，不会重复执行。');
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ACTION_NOT_FOUND') { rememberPending(null); setProblem('已核对：上次请求尚未登记，没有改变约定。原话已保留，可以重新提交。'); }
          else throw error;
        }
      }
    } catch (error) { setProblem(error instanceof Error ? error.message : '暂时无法核对。'); }
    finally { end(); }
  };

  const openReport = async () => {
    const current = sessionRef.current;
    if (!current) return;
    try { const result = await api<{ session: SessionView; report: ExperienceReport; reflection?: GuidedReflection }>(`/api/sessions/${current.id}/report`); if (sessionRef.current?.id !== current.id) return; acceptSession(result.session); setReport(result.report); setReportSession(result.session); setReflectionQuestions(result.reflection ?? null); setPanel('report'); }
    catch (error) { setProblem(error instanceof Error ? error.message : '本次记录暂时无法读取。'); }
  };
  const finish = async () => { if (!sessionRef.current) return; if (sessionRef.current.state.phase !== 'ended' && !await act({ type: 'finish' })) return; await openReport(); };

  const generateReflectionQuestions = async () => {
    if (!reportSession) return;
    const key = `${reportSession.id}:${reportSession.version}`;
    let requestId = reflectionRequestIds.current.get(key);
    if (!requestId) { requestId = crypto.randomUUID(); reflectionRequestIds.current.set(key, requestId); }
    const result = await api<{ session: SessionView; report: ExperienceReport; reflection: GuidedReflection }>(`/api/sessions/${reportSession.id}/report/reflection`, { method: 'POST', body: JSON.stringify({ requestId, expectedVersion: reportSession.version }) });
    if (sessionRef.current?.id !== result.session.id) return;
    setReport(result.report); setReportSession(result.session); setReflectionQuestions(result.reflection);
  };

  const fork = async (afterSequence: number, reason: 'retry' | 'correction') => {
    const current = sessionRef.current;
    if (!current || pendingRef.current || !begin()) return;
    const navigation = navigationId.current;
    try { const result = await api<{ session: SessionView }>(`/api/sessions/${current.id}/forks`, { method: 'POST', body: JSON.stringify({ expectedVersion: current.version, afterSequence, reason }) }); if (navigationId.current !== navigation) { acceptSession(result.session); return; } selectLocation(result.session.id); acceptSession(result.session); changeDraft(''); setTab('conversation'); setNotice(reason === 'correction' ? '已回到所选时刻，可以重新说清你的意思。原记录已保留。' : '新的尝试已准备好，原来的记录已保留。'); }
    catch (error) { setProblem(error instanceof Error ? error.message : '暂时无法建立新尝试。'); }
    finally { end(); }
  };

  const removeSession = async () => {
    const current = sessionRef.current;
    if (!current || !begin()) return;
    try {
      const deletion = await api<{ deleted: boolean; deletedIds: string[] }>(`/api/sessions/${current.id}`, { method: 'DELETE' });
      if (!deletion.deleted) throw new Error('删除没有完成，记录仍然保留。');
      const deletedIds = new Set(deletion.deletedIds);
      writeLocal(SESSION_KEY, null); rememberPending(null);
      const history = readLocal<Partial<Record<ScenarioId, string>>>(HISTORY_KEY) ?? {};
      for (const key of Object.keys(history) as ScenarioId[]) if (history[key] && deletedIds.has(history[key]!)) delete history[key];
      writeLocal(HISTORY_KEY, history);
      const entries = (readSaved()).filter((item) => !deletedIds.has(item.id));
      writeLocal(SAVED_KEY, entries); setSaved(entries);
      try { for (const id of deletedIds) { localStorage.removeItem(`beyond.reflection.v1.${id}`); localStorage.removeItem(`beyond.draft.v1.${id}`); for (const key of Object.keys(localStorage)) if (key.startsWith(`beyond.plan-draft.v1.${id}.`)) localStorage.removeItem(key); } } catch { /* Server deletion already succeeded. */ }
      goHome(); setReport(null); setReportSession(null); setReflectionQuestions(null); draftRef.current = ''; setDraft(''); setNotice('这次练习及其相关重试、纠正分支已删除。');
    } catch (error) { setProblem(error instanceof Error ? error.message : '删除没有完成，记录仍然保留。'); }
    finally { end(); }
  };

  const activeScenario = session?.state.scenario ?? 'campus';
  const mutationBusy = busy || Boolean(pending);
  const lastActionId = session?.events.at(-1)?.actionId;
  const lastActionStart = lastActionId ? session!.events.findIndex((event) => event.actionId === lastActionId) : -1;
  const undoSequence = lastActionStart > 0 ? session!.events[lastActionStart - 1].sequence : 0;
  if (mode === 'launch') return <Launch questions={launchQuestions} onEnter={goHome} onDemo={goDemo} />;
  return <div className={`app-shell scenario-${activeScenario}`}>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <div className="site-header-band"><header className="site-header"><Link className="brand" href="/?view=home" onClick={(event) => { event.preventDefault(); goHome(); }} aria-label="答案之外，返回练习主页"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span className="brand-name">答案之外<small>经验练习场</small></span></Link>
      <p className="header-motto">在重要的第一次之前，先练一次。</p><nav className="header-nav" aria-label="主要导航"><Link className="nav-link" href="/discover">按我的情况选题</Link><Link className="nav-link" href="/how-it-works">怎样练一次</Link><button className="nav-link" onClick={openSources}><BookOpen size={16} aria-hidden="true" />练习方法来源</button><button className="nav-link" onClick={() => setPanel('about')}>关于这次练习</button></nav>
      <button className="icon-button mobile-menu-button" aria-label="打开菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button>
    </header></div>
    {menuOpen ? <nav className="mobile-menu" aria-label="手机导航"><button onClick={goHome}>返回练习主页</button><Link href="/discover">按我的情况选题</Link><Link href="/how-it-works">怎样练一次</Link><button onClick={() => { setMenuOpen(false); openSources(); }}>练习方法来源</button><button onClick={() => { setMenuOpen(false); setPanel('about'); }}>关于这次练习</button>{session ? <button onClick={() => { setMenuOpen(false); void openReport(); }}>本次记录</button> : null}</nav> : null}

    <main id="main-content" tabIndex={-1}>
      <div className="workspace-wrap navigation-alerts">
        {problem ? <div className="notice notice-attention global-notice" role="alert"><div><strong>{pending ? '这次行动还需要核对' : '有一件事需要处理'}</strong><p>{problem}</p></div>{pending ? <div className="notice-actions"><button className="button button-secondary" disabled={busy} onClick={() => void checkPending()}>核对本轮结果</button><button className="text-button" disabled={busy} onClick={() => void checkPending(true)}>用原行动重试</button></div> : <button className="icon-button" aria-label="关闭提示" onClick={() => setProblem('')}><X size={17} /></button>}</div> : null}
      </div>
      {mode === 'custom' ? entryError ? <section className="practice-loading"><p role="alert">{entryError}</p><button className="button button-secondary" onClick={() => window.location.reload()}>重新载入题目</button><Link className="text-button" href="/discover">返回按情况选题</Link></section> : !navigationReady ? <p className="practice-loading" role="status">正在恢复你的练习入口…</p> : <CustomPractice onHome={goHome} initialTopic={customSeed?.topic} initialQuestion={customSeed?.question} topicSource={customSeed?.source} openLibrary={customSeed?.library} entryIntent={customSeed?.entryIntent ?? 'resume'} onSessionReady={consumeCustomIntent} onQuestionDetached={() => { const seed: CustomSeed = { topic: '', entryIntent: 'new' }; setCustomSeed(seed); window.history.replaceState({ ...window.history.state, beyondCustomSeed: seed }, '', '/?mode=custom'); }} /> : mode === 'home' ? <Welcome saved={saved} busy={busy} booting={booting} onStart={(scenario) => void startScenario(scenario)} onResume={(id) => void resumeSession(id)} onCustom={startCustom} onLibrary={startLibrary} onTopic={(topic, source) => selectLocation(null, true, { topic, source, entryIntent: 'new' })} onSources={openSources} /> : mode === 'demo' ? <PracticeDemo onStart={startCustom} onLibrary={startLibrary} onBack={goHome} /> : null}
      {mode === 'session' ? <><nav className="practice-navigation" aria-label="练习导航"><button className="button button-secondary" onClick={goHome}><ArrowLeft size={17} />返回练习主页</button><span>记录自动保存，随时可以回来。</span>{session ? <button className="text-button" disabled={mutationBusy || !session.events.length} onClick={() => setPanel('undo')}><RotateCcw size={16} />刚才点错了</button> : null}</nav>{session ? <section className="practice-chapter-heading" aria-labelledby="scene-title"><div><span>{activeScenario === 'campus' ? '校园协作' : activeScenario === 'transfer' ? '校园短练习' : '初入职场'}</span><h1 id="scene-title">{SCENARIOS[activeScenario].title}</h1></div><p>{session.state.phase === 'ended' ? '本次已收束，可以回看或另开一次尝试。' : '一起说清楚，再决定下一步。每一句都可以继续商量。'}</p>{session.comparison ? <button className="text-button" onClick={() => setPanel('comparison')}><GitCompareArrows size={15} />对照两次尝试</button> : null}</section> : <div className="practice-loading" role="status">{booting ? '正在取回这次练习…' : '这次练习暂时没有打开。请查看下方提示，或返回练习主页。'}</div>}</> : null}

      <div className="workspace-wrap">

        <div className="sr-only" role="status" aria-live="polite">{notice || (busy ? '正在核对本次操作。' : '')}</div>
        {mode === 'session' && session ? <>
          <div className="workspace-toolbar"><div className="workspace-path"><span>我的练习</span><ChevronRight size={13} /><strong>{SCENARIOS[activeScenario].title}</strong></div><div className="workspace-toolbar-actions"><button className="text-button" onClick={() => void openReport()}><FileText size={15} />本次记录</button></div></div>
          
          {notice ? <div className="saved-notice"><Check size={14} /><span>{notice}</span>{tab === 'conversation' ? <button onClick={() => setTab('board')}>查看约定</button> : null}</div> : null}
          <nav className="mobile-tabs" aria-label="练习分区"><button aria-current={tab === 'conversation' ? 'page' : undefined} onClick={() => setTab('conversation')}><MessageCircle size={17} />对话</button><button aria-current={tab === 'board' ? 'page' : undefined} onClick={() => setTab('board')}><ClipboardList size={17} />约定{session.state.proposal?.status === 'pending' ? <span className="tab-dot" aria-label="有待确认提议" /> : null}</button><button onClick={openSources}><BookOpen size={17} />经验</button></nav>
          <div className={`workspace active-tab-${tab}`}><div className="dialogue-column"><details className="scenario-context"><summary>我的角色、这件事的背景</summary><ScenarioGuide scenario={activeScenario} naturalLanguage={session.capabilities.naturalLanguage} onFirstQuestion={(question) => { changeDraft(question); document.getElementById('message-input')?.focus(); }} /></details><PracticeGuidance session={session} busy={mutationBusy} onReview={() => void openReport()} /><Conversation session={session} busy={mutationBusy} processing={busy} recoveryMessage={problem} onCheckPending={(retry) => void checkPending(retry)} pendingText={pending?.sessionId === session.id ? pending.request.text : undefined} draft={draft} onDraft={changeDraft} onText={() => void act(undefined, draft.trim())} onCommand={(command) => act(command)} onEdit={() => setPanel('plan')} onSources={openSources} onFinish={() => void finish()} />{activeScenario !== 'campus' ? <details className="optional-actions" open={!session.capabilities.naturalLanguage || session.state.scenario === 'transfer' && session.state.transfer.plan.length > 0}><summary>用操作面板安排与执行<span>也可以用上方自己的话表达</span></summary><ScenarioActions key={session.id} session={session} busy={mutationBusy} onCommand={(command) => void act(command)} /></details> : null}</div><div className="board-column"><AgreementBoard session={session} busy={mutationBusy} onCommand={(command) => act(command)} onEdit={() => setPanel('plan')} onReport={() => void openReport()} onRetry={() => setPanel('retry')} /><button className="experience-teaser" onClick={openSources}><span className="experience-teaser-icon"><BookOpen size={24} /></span><span><strong>有些经验，正好用在这一刻。</strong><small>两条有出处的经验，按需翻开。</small></span><ArrowRight size={19} /></button></div></div>
        </> : null}
      </div>
    </main>
    <footer className="site-footer"><span>答案之外 · 把别人的经验，练成自己的下一步。</span><span>模拟记录有依据，现实结果待你亲自验证。</span><button className="text-button" onClick={() => setPanel('about')}>说明与隐私</button></footer>

    {panel === 'undo' && session ? <Modal title="回到刚才那一步？" subtitle="点错、说错都可以重新来，原来的记录会保留。" onClose={() => setPanel(null)}><div className="dialog-content"><p>将回到最近一次行动之前，建立一条纠正分支。它不消耗教学重试；你仍可以从首页的历史记录回看原来那次。</p><blockquote className="undo-preview">{session.events.find((event) => event.actionId === lastActionId && event.actor === 'user')?.text ?? session.events.at(-1)?.text}</blockquote>{problem ? <p role="alert" className="notice notice-attention">{problem}</p> : null}</div><footer className="dialog-footer"><button className="button button-secondary" onClick={() => setPanel(null)}>留在这里</button><button className="button button-primary" disabled={mutationBusy} onClick={() => void fork(undoSequence, 'correction')}><RotateCcw size={16} />回到上一步</button></footer></Modal> : null}
    {panel === 'sources' ? <SourcesPanel sources={sources} loading={sourcesLoading} error={sourceError} onReload={() => void loadSources()} onClose={() => setPanel(null)} /> : null}
    {panel === 'plan' && session ? <PlanEditor session={session} busy={mutationBusy} error={problem} onSubmit={(command) => act(command)} onClose={() => setPanel(null)} /> : null}
    {panel === 'retry' && session ? <RetryPanel session={session} busy={mutationBusy} error={problem} onFork={fork} onClose={() => setPanel(null)} /> : null}
    {panel === 'comparison' && session ? <ComparisonPanel session={session} onClose={() => setPanel(null)} /> : null}
    {panel === 'report' && reportSession && report && reportSession.id === session?.id ? <ReportPanel session={reportSession} report={report} reflectionQuestions={reflectionQuestions} onGenerateQuestions={generateReflectionQuestions} onClose={() => setPanel(null)} onNext={(scenario) => void startScenario(scenario)} onDelete={() => setPanel('delete')} /> : null}
    {panel === 'delete' && session ? <Modal title="删除这次练习及相关分支？" subtitle="删除后无法恢复，请先导出需要保留的记录。" onClose={() => setPanel(null)}><div className="dialog-content"><p>将删除当前练习，以及从它建立的所有后续重试、纠正分支；本机对应的草稿和个人反思一并清除。其他独立练习不会在这里自动删除。</p>{problem ? <div className="notice notice-attention" role="alert">{problem}</div> : null}</div><footer className="dialog-footer"><button className="button button-secondary" onClick={() => setPanel('report')}>保留记录</button><button className="button button-danger" disabled={busy} onClick={() => void removeSession()}><Trash2 size={16} />{busy ? '正在删除…' : '删除本次练习及分支'}</button></footer></Modal> : null}
    {panel === 'about' ? <Modal title="这间工作室，怎样陪你练习" subtitle="答案之外 · 经验练习场" onClose={() => setPanel(null)}><div className="dialog-content about-content"><h3>一次真实操作的模拟</h3><p>你可以自然表达，也可以直接编辑示例中的任务安排。三个示例由固定规则核验时间、能力与承诺；“练自己的事”是可编辑的原创模拟，模型回应不代表现实中的人已经同意或作出承诺。</p><h3>有出处，也有边界</h3><p>知识材料来自知乎比赛内容接口取得的片段。作者原意、团队归纳和模拟应用分别标注。这里不会根据几次操作给你贴能力或人格标签。</p><h3>关于你的记录</h3><p>练习以游客会话保存，可恢复、导出或删除。自由表达会发送到应用服务端；当自由表达功能可用时，由独立的模型接口处理。不要输入他人的隐私、账号凭证或不适合提供给服务的内容。</p><p>个人反思只保存在当前浏览器，属于你的现实自述，不会自动发布到知乎。清理浏览器数据后，本机反思可能丢失。</p><div className="about-status"><StatusPill tone={session?.capabilities.naturalLanguage || health?.naturalLanguage ? 'success' : 'neutral'}>{session?.capabilities.naturalLanguage || health?.naturalLanguage ? '自由表达可用' : '结构化操作可用'}</StatusPill><span>示例：校园主篇、校园短练习、职场互动预告</span></div><button className="text-button" onClick={openSources}><BookOpen size={16} />查看两条来源经验</button></div></Modal> : null}
  </div>;
}



