'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { activeCustomBranch, activeCustomScene, customSceneReadiness, suggestedCustomSceneLabel, customActionSchema, CUSTOM_BOUNDARY, CUSTOM_SOURCE_BOUNDARY, type CustomAction, type CustomPracticeSummary, type CustomPracticeView, type CustomSetup } from '@/domain/custom-practice';
import { SOURCES } from '@/content/sources';
import { getChatAvatar, USER_CHAT_AVATAR } from '@/content/chat-avatars';
import styles from './custom-practice.module.css';
import { WaitingFeedback } from './waiting-feedback';
import { ChatAvatar, ChatMessage } from './chat-message';
import { SceneAdvance } from './scene-advance';
import { ReplyChoices } from './reply-choices';
import { PracticeGoal, PracticeGoalReview } from './practice-goal';
import { CampusExperience } from './campus-experience';
import { CampusLibrary } from './campus-library';
import { PracticeEntryIntro } from './practice-entry-intro';
import { ExperienceBrief } from './experience-brief';
import { CounterpartReplyEditor } from './counterpart-reply-editor';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import type { PracticeIntakeView } from '@/domain/practice-intake';
import { formatCustomPracticeText } from '@/domain/custom-export';
import { captureCustomRetryDraft, matchesCustomDraft, restoreQuestionDraft, restoreStoredQuestionDraft } from '@/domain/custom-draft';
import { ArrowRight, BookOpen, Check, ChevronDown, Lightbulb, PenLine } from 'lucide-react';

const SELECTED = 'practice-custom-selected';
const DRAFT = 'practice-custom-topic';
const CREATE = 'practice-custom-create-request';
const QUESTION = 'practice-custom-source-question';
const INTAKE_HELP = 'practice-custom-intake-help:v1';
const QUESTION_DRAFT = 'practice-custom-question-draft:';
type ActionInput = CustomAction extends infer Action ? Action extends CustomAction ? Omit<Action, 'actionId' | 'expectedVersion'> : never : never;
type Creation = { id: string; actionId: string; topic: string; sourceQuestionId?: string };
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string | null) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Server persistence remains available. */ } }
function savedResultNotice(view: CustomPracticeView, recovered: boolean, sameSession: boolean, beforeVersion: number) {
  if (view.pendingAction && view.pendingAction.until > Date.now()) return '已核对：这一轮仍在处理，保存结果后会自动显示。';
  if (view.pendingAction) return '已核对：上次处理已超时。原话保留，可以重新提交。';
  if (recovered) return '已找回这一轮保存的结果，没有重复提交。';
  return view.version > beforeVersion && sameSession ? '已取回更新后的练习记录。未发送的草稿保留了。' : '已核对：这里已经是最新记录。未发送的内容保留了。';
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let result: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try { result = await fetch(path, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, cache: 'no-store', signal: controller.signal }); }
  catch { throw new Error('连接中断或等待过久。原话仍保留，可以核对已保存结果。'); }
  finally { clearTimeout(timeout); }
  const data = await result.json().catch(() => null);
  if (!result.ok || !data) throw new Error(data?.error?.message ?? '暂时未能完成操作。请稍后重试，已保存的练习还在。');
  return data as T;
}
function exportRecord(session: CustomPracticeView, raw = false) {
  const reflections = session.branches.flatMap(branch => {
    const nextStep = stored(`practice-custom-reflection:${session.id}:${branch.id}`);
    return nextStep ? [{ branchId: branch.id, nextStep, storage: '仅此浏览器，未发送给模型' }] : [];
  });
  const takeaways = session.branches.flatMap(branch => { const text = stored(`practice-custom-takeaway:${session.id}:${branch.id}`); return text ? [{ branchId: branch.id, label: branch.label, text }] : []; });
  const payload = { ...session, reflections, takeaways, boundary: CUSTOM_BOUNDARY, sourceBoundary: CUSTOM_SOURCE_BOUNDARY, sources: SOURCES.map(source => ({ id: source.id, author: source.author, title: source.title, excerpt: source.excerpt, sourceUrl: source.sourceUrl, truncated: source.truncated })) };
  const takeawayText = takeaways.length ? `\n\n我自己记下的收获（仅此浏览器保存，未发送给模型）\n${takeaways.map(item => `${item.label}\n${item.text}`).join('\n\n')}\n` : '';
  const content = raw ? JSON.stringify(payload, null, 2) : `\ufeff${formatCustomPracticeText(session, Object.fromEntries(reflections.map(item => [item.branchId, item.nextStep])))}${takeawayText}`;
  const url = URL.createObjectURL(new Blob([content], { type: raw ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `我的经验练习-${session.id.slice(0, 8)}.${raw ? 'json' : 'txt'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CustomPractice({ onHome, initialTopic = '', initialQuestion, topicSource, openLibrary = false, entryIntent = 'resume', onSessionReady, onQuestionDetached }: { onHome: () => void; initialTopic?: string; initialQuestion?: CampusCorpusQuestion; topicSource?: { title: string; url: string; kind?: string; fetchedAt?: string }; openLibrary?: boolean; entryIntent?: 'new' | 'resume'; onSessionReady?: (id: string) => void; onQuestionDetached?: (topic: string) => void }) {
  const [topic, setTopic] = useState(initialTopic);
  const topicRef = useRef(initialTopic);
  const [intake, setIntake] = useState<PracticeIntakeView | null>(null);
  const [refiningTopic, setRefiningTopic] = useState(false);
  const intakeResultRef = useRef<HTMLElement>(null);
  const createInFlight = useRef(false);
  const [helper, setHelper] = useState({ who: '', situation: '', goal: '' });
  const [suggestionAssumptions, setSuggestionAssumptions] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(openLibrary);
  const initialInput = useRef({ entryIntent, topic: initialTopic, openLibrary, question: initialQuestion });
  const draftQuestionId = useRef<string | null>(initialQuestion?.id ?? null);
  const sourceSelectionRevision = useRef(0);
  const updateTopic = useCallback((value: string) => { topicRef.current = value; setTopic(value); setIntake(null); save(DRAFT, value); if (draftQuestionId.current) save(`${QUESTION_DRAFT}${draftQuestionId.current}`, value); }, []);
  const [session, setSession] = useState<CustomPracticeView | null>(null);
  const [setup, setSetup] = useState<CustomSetup | null>(null);
  const [sessions, setSessions] = useState<CustomPracticeSummary[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const setDraftValue = useCallback((value: string) => { draftRef.current = value; setDraft(value); }, []);
  const [reflection, setReflection] = useState('');
  const [takeaway, setTakeaway] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [pendingEditDraft, setPendingEditDraft] = useState<{ sessionId: string; action: Extract<CustomAction, { kind: 'edit_counterpart_reply' }> } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [sourceQuestion, setSourceQuestion] = useState<CampusCorpusQuestion | null>(initialQuestion ?? null);
  const [deleteQuestion, setDeleteQuestion] = useState(false);
  const [operation, setOperation] = useState('正在取回练习');
  const active = session ? activeCustomBranch(session) : undefined;
  const mounted = useRef(true);
  const currentId = useRef<string | null>(null);
  const currentVersion = useRef(-1);
  const navigationEpoch = useRef(0);
  const pendingSay = useRef<{ sessionId: string; action: CustomAction } | null>(null);
  const composing = useRef(false);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const accept = useCallback((view: CustomPracticeView, keepSetup = false) => {
    if (!mounted.current) return;
    save(SELECTED, view.id);
    if (currentId.current === view.id && currentVersion.current > view.version) return;
    currentId.current = view.id; currentVersion.current = view.version;
    setSession(view); if (!keepSetup) setSetup(activeCustomBranch(view)?.setup ?? null); setPending(Boolean(view.pendingAction && view.pendingAction.until > Date.now()));
    setReflection(view.activeBranchId ? stored(`practice-custom-reflection:${view.id}:${view.activeBranchId}`) ?? '' : '');
    setTakeaway(view.activeBranchId ? stored(`practice-custom-takeaway:${view.id}:${view.activeBranchId}`) ?? '' : '');
    const pending = pendingSay.current;
    if (pending?.sessionId === view.id && view.branches.some(branch => branch.turns.some(turn => turn.id === pending.action.actionId))) {
      if (pending.action.kind === 'say' && draftRef.current.trim() === pending.action.text) { save(`practice-custom-draft:${view.id}`, null); setDraftValue(''); }
      save(`practice-custom-pending:${view.id}`, null); pendingSay.current = null;
      setPendingEditDraft(null);
    } else if (pending?.sessionId === view.id && view.version > pending.action.expectedVersion && view.pendingAction?.actionId !== pending.action.actionId) {
      save(`practice-custom-pending:${view.id}`, null); pendingSay.current = null;
      setPendingEditDraft(null);
    }
  }, [setDraftValue]);
  const restorePending = useCallback((id: string) => {
    try {
      const raw = stored(`practice-custom-pending:${id}`);
      const parsed = raw ? customActionSchema.safeParse(JSON.parse(raw)) : null;
      pendingSay.current = parsed?.success && (parsed.data.kind === 'say' || parsed.data.kind === 'edit_counterpart_reply') ? { sessionId: id, action: parsed.data } : null;
      setPendingEditDraft(parsed?.success && parsed.data.kind === 'edit_counterpart_reply' ? { sessionId: id, action: parsed.data } : null);
    } catch { pendingSay.current = null; }
  }, []);
  const list = useCallback(async () => {
    const result = await api<{ sessions: CustomPracticeSummary[]; available: boolean }>('/api/custom-practices');
    if (mounted.current) { setSessions(result.sessions); setAvailable(result.available); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const epoch = navigationEpoch.current;
    const selectionRevision = sourceSelectionRevision.current;
    void (async () => {
      try {
        await list();
        if (!mounted.current || epoch !== navigationEpoch.current || selectionRevision !== sourceSelectionRevision.current) return;
        const initial = initialInput.current;
        if (topicRef.current !== initial.topic) return;
        if (initial.question) save(QUESTION, JSON.stringify(initial.question));
        let restoredQuestionTopic: string | undefined;
        if (!initial.topic && !initial.question) {
          try {
            const raw = stored(QUESTION);
            if (raw) {
              const value = JSON.parse(raw) as CampusCorpusQuestion;
              if (value && typeof value.id === 'string' && typeof value.questionUrl === 'string' && typeof value.title === 'string' && value.scenarioSeed && [value.scenarioSeed.userRole, value.scenarioSeed.counterpartRole, value.scenarioSeed.situation, value.scenarioSeed.goal].every(item => typeof item === 'string')) {
                const restored = restoreStoredQuestionDraft(value, stored(DRAFT));
                setSourceQuestion(restored.question); draftQuestionId.current = restored.question.id;
                save(QUESTION, JSON.stringify(restored.question)); restoredQuestionTopic = restored.topic;
              }
            }
          } catch { /* An invalid local selection can be replaced from the library. */ }
        }
        updateTopic(initial.question ? restoreQuestionDraft(initial.question.id, stored(`${QUESTION_DRAFT}${initial.question.id}`), initial.topic) : restoredQuestionTopic ?? (initial.topic || stored(DRAFT) || ''));
        try { const raw = stored(INTAKE_HELP); if (raw) { const value = JSON.parse(raw); if (['who', 'situation', 'goal'].every(key => typeof value[key] === 'string')) setHelper(value); } } catch { /* The free description remains available. */ }
        const selected = initial.entryIntent !== 'new' && !initial.topic && !initial.openLibrary && stored(SELECTED);
        if (selected) {
          const restoringDraft = { topic: topicRef.current, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current };
          const result = await api<{ session: CustomPracticeView }>(`/api/custom-practices/${selected}`);
          if (mounted.current && epoch === navigationEpoch.current && matchesCustomDraft(restoringDraft, { topic: topicRef.current, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current })) { restorePending(selected); setDraftValue(stored(`practice-custom-draft:${selected}`) ?? ''); accept(result.session); }
        }
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '暂时无法恢复练习。'); }
    })();
    return () => { mounted.current = false; };
  }, [accept, list, restorePending, setDraftValue, updateTopic]);

  const sessionId = session?.id; const pendingUntil = session?.pendingAction?.until;
  useEffect(() => {
    if (!sessionId || !pendingUntil) return;
    let stopped = false;
    const timer = setInterval(() => {
      void api<{ session: CustomPracticeView }>(`/api/custom-practices/${sessionId}`).then(result => {
        if (stopped || currentId.current !== sessionId) return;
        accept(result.session);
        if (!result.session.pendingAction || result.session.pendingAction.until <= Date.now()) {
          clearInterval(timer); setBusy(false);
          if (result.session.pendingAction) setError('这次回应等待较久。原话保留了，可以重试或先返回。');
        }
      }).catch(() => { if (!stopped) { clearInterval(timer); setBusy(false); setError('连接中断了。原话仍保留，可以点击“核对已保存结果”。'); } });
    }, 1800);
    return () => { stopped = true; clearInterval(timer); };
  }, [sessionId, pendingUntil, accept]);
  useEffect(() => { const transcript = transcriptRef.current; if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'instant' }); }, [active?.id, active?.turns.length, active?.scenes?.length]);
  useEffect(() => {
    if (intake && intake.status !== 'ready') {
      intakeResultRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      intakeResultRef.current?.focus({ preventScroll: true });
    }
  }, [intake]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); return true; } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '暂时无法完成操作，原话还在。'); return false; }
    finally { if (mounted.current) setBusy(false); }
  }
  function clearPreparedDraft() {
    save(CREATE, null); save(QUESTION, null); save(DRAFT, null); save(INTAKE_HELP, null);
    setSourceQuestion(null); draftQuestionId.current = null; sourceSelectionRevision.current++;
    topicRef.current = ''; setTopic(''); setIntake(null); setRefiningTopic(false); setHelper({ who: '', situation: '', goal: '' });
  }
  async function create() {
    if (createInFlight.current || busy || pending) return;
    if (intake && intake.status !== 'ready' && intake.originalText === topicRef.current) {
      intakeResultRef.current?.focus();
      return;
    }
    createInFlight.current = true;
    setOperation('先读懂你想练的事');
    const epoch = navigationEpoch.current;
    const submittedText = topicRef.current;
    const intakeRequestId = crypto.randomUUID();
    const sourceQuestionId = draftQuestionId.current ?? undefined;
    const submittedDraft = { topic: submittedText, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current };
    const stillCurrentDraft = () => matchesCustomDraft(submittedDraft, { topic: topicRef.current, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current });
    try { await run(async () => {
      const checked = await api<{ intake: PracticeIntakeView }>('/api/practice-intake', { method: 'POST', body: JSON.stringify({ requestId: intakeRequestId, text: submittedText }) });
      if (epoch !== navigationEpoch.current || !mounted.current || !stillCurrentDraft()) return;
      const assessment = checked.intake;
      if (!assessment || assessment.version !== 'practice-intake-v1' || assessment.requestId !== intakeRequestId || assessment.originalText !== submittedText || !['ready', 'needs_context', 'knowledge_request', 'topic_only'].includes(assessment.status) || !Array.isArray(assessment.questions) || assessment.questions.length > 2 || !Array.isArray(assessment.suggestions) || assessment.suggestions.length > 2 || assessment.suggestions.some(item => typeof item.draft !== 'string' || typeof item.label !== 'string' || !Array.isArray(item.assumptions))) throw new Error('这次整理与当前描述没有对上。原话还在，请再试一次。');
      setIntake(assessment);
      if (assessment.status !== 'ready' || assessment.canStartPractice !== true) { setRefiningTopic(true); return; }
      setOperation('正在为你搭建可以修改的情境');
      let request: Creation | undefined;
      try { const previous = stored(CREATE); if (previous) { const parsed = JSON.parse(previous) as Creation; if (parsed.topic === submittedText.trim() && parsed.sourceQuestionId === sourceQuestionId) request = parsed; } } catch { /* Create a fresh id for a malformed local draft. */ }
      request ??= { id: crypto.randomUUID(), actionId: crypto.randomUUID(), topic: submittedText.trim(), ...(sourceQuestionId ? { sourceQuestionId } : {}) };
      save(CREATE, JSON.stringify(request));
      const result = await api<{ session: CustomPracticeView }>('/api/custom-practices', { method: 'POST', body: JSON.stringify(request) });
      if (epoch !== navigationEpoch.current || !mounted.current) return;
      if (!stillCurrentDraft()) { setNotice('上一次描述的情境已存到下方记录。你刚写的内容保留在这里。'); await list(); return; }
      accept(result.session); onSessionReady?.(result.session.id);
      if (result.session.branches.length) clearPreparedDraft();
      await list();
    }); } finally { createInFlight.current = false; }
  }
  async function retryGeneration() {
    if (!session) return;
    setOperation('正在重新准备你的情境');
    const epoch = navigationEpoch.current; const id = session.id;
    const preparedDraft = captureCustomRetryDraft(session.topic, session.sourceQuestionId ?? null, { topic: topicRef.current, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current });
    await run(async () => {
      const result = await api<{ session: CustomPracticeView }>('/api/custom-practices', { method: 'POST', body: JSON.stringify({ id, actionId: crypto.randomUUID(), topic: session.topic, ...(session.sourceQuestionId ? { sourceQuestionId: session.sourceQuestionId } : {}) }) });
      if (epoch === navigationEpoch.current && currentId.current === id && mounted.current) {
        accept(result.session);
        if (result.session.branches.length && preparedDraft && matchesCustomDraft(preparedDraft, { topic: topicRef.current, questionId: draftQuestionId.current, selectionRevision: sourceSelectionRevision.current })) {
          clearPreparedDraft(); onSessionReady?.(result.session.id);
        }
      }
    });
  }
  async function load(id: string) {
    if (reading) return;
    const sameSession = session?.id === id && currentId.current === id;
    const beforeVersion = currentVersion.current;
    const savedAction = pendingSay.current?.action.actionId;
    const epoch = ++navigationEpoch.current;
    setReading(true); setError(''); setNotice('');
    try {
      const result = await api<{ session: CustomPracticeView }>(`/api/custom-practices/${id}`);
      if (epoch !== navigationEpoch.current || !mounted.current) return;
      if (!sameSession) { restorePending(id); setDraftValue(stored(`practice-custom-draft:${id}`) ?? ''); }
      accept(result.session, sameSession && result.session.version === beforeVersion); onSessionReady?.(result.session.id);
      const recovered = savedAction && result.session.branches.some(branch => branch.turns.some(turn => turn.id === savedAction));
      setNotice(savedResultNotice(result.session, Boolean(recovered), sameSession, beforeVersion));
    } catch (cause) { if (epoch === navigationEpoch.current && mounted.current) setError(cause instanceof Error ? cause.message : '暂时无法读取已保存记录。'); }
    finally { if (mounted.current) setReading(false); }
  }
  async function act(input: ActionInput) {
    if (!session) return false;
    setOperation(input.kind === 'say' ? '你的话已发出，正在等对方回应' : input.kind === 'advance_scene' ? '正在切换模拟场景' : input.kind === 'review_goal' ? '正在根据对话原话核对目标进展' : input.kind === 'edit_counterpart_reply' ? '正在保存调整后的尝试' : input.kind === 'finish' ? '正在保存本次练习' : '正在准备这一步');
    const id = session.id;
    const epoch = navigationEpoch.current;
    const previous = pendingSay.current;
    const sameInput = previous?.action.kind === input.kind && (input.kind === 'say' && previous.action.kind === 'say' && previous.action.text === input.text || input.kind === 'edit_counterpart_reply' && previous.action.kind === 'edit_counterpart_reply' && previous.action.turnId === input.turnId && previous.action.reply === input.reply);
    const action: CustomAction = previous?.sessionId === id && sameInput && previous.action.expectedVersion === session.version
      ? previous.action : { ...input, actionId: crypto.randomUUID(), expectedVersion: session.version } as CustomAction;
    if (input.kind === 'say' || input.kind === 'edit_counterpart_reply') { pendingSay.current = { sessionId: id, action }; save(`practice-custom-pending:${id}`, JSON.stringify(action)); }
    if (action.kind === 'edit_counterpart_reply') setPendingEditDraft({ sessionId: id, action });
    return run(async () => {
      const result = await api<{ session: CustomPracticeView }>(`/api/custom-practices/${id}`, { method: 'POST', body: JSON.stringify(action) });
      if (currentId.current !== id || epoch !== navigationEpoch.current || !mounted.current) return;
      accept(result.session);
      if (input.kind === 'rewind') setNotice('已返回上一步。刚才的尝试完整保留在“其他尝试”中。');
      if (input.kind === 'edit_counterpart_reply') setNotice('调整后的回应已另存为一次尝试。原对话保留在“其他尝试”中；你设定的回应不算对方自行接受。');
      if (input.kind === 'advance_scene') setNotice(activeCustomScene(activeCustomBranch(result.session))?.openingKind === 'guide' ? '场景已切换。现在由你先开口，未发送的草稿仍保留。' : `已进入“${input.label}”。现在轮到你在这个场景里回应，未发送的草稿仍保留。`);
      if (input.kind === 'accept_setup' || input.kind === 'advance_scene') requestAnimationFrame(() => document.getElementById('custom-say')?.focus());
    });
  }
  function toList() {
    navigationEpoch.current++;
    save(SELECTED, null); currentId.current = null; currentVersion.current = -1;
    setDraftValue(''); pendingSay.current = null; setPendingEditDraft(null);
    setSession(null); setSetup(null); setPending(false); setError(''); setNotice(''); setShowSources(false); setDeleteQuestion(false); void list().catch(() => undefined);
  }
  async function removeCurrent() {
    if (!session) return;
    const selected = session; const epoch = navigationEpoch.current;
    await run(async () => {
      await api(`/api/custom-practices/${selected.id}`, { method: 'DELETE' });
      save(`practice-custom-draft:${selected.id}`, null); save(`practice-custom-pending:${selected.id}`, null);
      for (const branch of selected.branches) { save(`practice-custom-reflection:${selected.id}:${branch.id}`, null); save(`practice-custom-takeaway:${selected.id}:${branch.id}`, null); }
      try { const creation = stored(CREATE); if (creation && (JSON.parse(creation) as Creation).id === selected.id) save(CREATE, null); } catch { /* Ignore an obsolete draft. */ }
      if (epoch === navigationEpoch.current && mounted.current && currentId.current === selected.id) toList();
    });
  }
  const working = busy || pending || reading;
  const counterpartAvatar = getChatAvatar(session?.id ?? 'preview');
  const currentScene = activeCustomScene(active);
  const sceneReadiness = customSceneReadiness(active);
  const turnLimitReached = (active?.turns.length ?? 0) >= 20;
  const needsIntakeRevision = Boolean(intake && intake.status !== 'ready');
  const fullRole = active?.setup.counterpartRole ?? setup?.counterpartRole ?? '对话同伴';
  const roleHeading = fullRole.split(/[，,；;]/)[0].trim();
  const roleName = roleHeading.length <= 24 ? roleHeading : '对话同伴';
  const matchedQuestions = active?.sourceContext?.questions ?? [];
  const currentProgress = active?.goalProgress?.evaluatedThroughTurnId === active?.turns.at(-1)?.id ? active?.goalProgress : undefined;
  function selectQuestion(question: CampusCorpusQuestion) {
    sourceSelectionRevision.current++;
    draftQuestionId.current = question.id;
    const seed = question.scenarioSeed;
    const value = `我扮演${seed.userRole}，想和${seed.counterpartRole}聊一聊。${seed.situation}\n这次我希望：${seed.goal}`;
    setSourceQuestion(question); save(QUESTION, JSON.stringify(question)); updateTopic(value); setSuggestionAssumptions([]); setChoosing(false);
    requestAnimationFrame(() => { document.getElementById('custom-topic')?.scrollIntoView({ block: 'center', behavior: 'instant' }); document.getElementById('custom-topic')?.focus({ preventScroll: true }); });
  }
  function supplementDescription() {
    const value = [topicRef.current.trim(), helper.who.trim() && `想面对的人：${helper.who.trim()}`, helper.situation.trim() && `现在卡在：${helper.situation.trim()}`, helper.goal.trim() && `我希望这次：${helper.goal.trim()}`].filter(Boolean).join('\n');
    if (value.length > 2000) { setError('补充后超过了 2000 字，先把描述缩短一点。'); return; }
    updateTopic(value); document.getElementById('custom-topic')?.focus();
  }

  return <section className={styles.root} aria-label="练自己的事">
    <nav className={styles.navigation} aria-label="练习导航">
      <button onClick={() => { navigationEpoch.current++; onHome(); }}>← 返回练习主页</button>
      {session && <button onClick={toList}>我的自由练习</button>}
      <span>练自己的事</span>
    </nav>
    <Link className={`${styles.firstVisit} ${!session ? styles.entryHelp : ''}`} href="/how-it-works"><BookOpen size={18} aria-hidden="true" /><span><strong>{session ? '怎样聊，什么时候换场景？' : '第一次来？先看怎么玩'}</strong>{session && <small>了解这是什么、先做哪一步</small>}</span><ArrowRight size={17} aria-hidden="true" /></Link>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {reading && <p className={styles.notice} role="status">正在核对已保存记录…</p>}
    {!session ? <>
      <div className={`${styles.entryLayout} ${choosing ? styles.entryChoosing : ''}`}>
      <PracticeEntryIntro choosing={choosing} desktopAside={!choosing} />
      <div className={styles.entryWorkspace}>
      <div className={styles.entrySwitch} role="group" aria-label="选择练习方式"><button type="button" aria-pressed={choosing} onClick={() => setChoosing(true)}><BookOpen size={17} aria-hidden="true" />不知道练什么，选一件事</button><button type="button" aria-pressed={!choosing} onClick={() => setChoosing(false)}><PenLine size={17} aria-hidden="true" />我已经有件事</button></div>
      {choosing && <CampusLibrary onChoose={selectQuestion} initiallyOpen />}
      {!choosing && <section className={styles.start} aria-label="描述想练习的事">
        {sourceQuestion ? <div className={styles.topicSeed}><span>借这个问题开始</span><a href={sourceQuestion.questionUrl} target="_blank" rel="noopener noreferrer">{sourceQuestion.title}</a><p>下方是原创练习起点，可以改成自己的情况。</p><button type="button" disabled={working} onClick={() => { setSourceQuestion(null); draftQuestionId.current = null; sourceSelectionRevision.current++; save(QUESTION, null); onQuestionDetached?.(topicRef.current); }}>取消这个问题关联</button></div> : topicSource && <div className={styles.topicSeed}><span>借一个话题开始</span><a href={topicSource.url} target="_blank" rel="noreferrer">{topicSource.title}</a><p>请把描述改成自己的角色、顾虑和目标。</p></div>}
        <label htmlFor="custom-topic">我想练习……</label>
        <p className={styles.stepNote} id="custom-topic-hint">先描述想和谁谈、希望谈成什么。这里准备对话情境，还没有开始聊天。</p>
        <textarea id="custom-topic" aria-describedby="custom-topic-hint custom-prior-context-hint" rows={4} maxLength={2000} value={topic} onChange={event => updateTopic(event.target.value)} placeholder="比如：室友常在深夜开麦。我明天早八，想和他商量一个彼此能接受的时间。" />
        <p className={styles.subtle} id="custom-prior-context-hint">已经聊到一半？也可以写下“我说了什么、对方怎么回应、想从哪里接着练”。这些前情是你提供的背景，不计入本次练习的话轮。</p>
        <details className={styles.intakeHelp}><summary><Lightbulb size={16} aria-hidden="true" />不知道怎么写？用三个小问题理一理<ChevronDown size={15} aria-hidden="true" /></summary><div className={styles.helperGrid}>{([{ key: 'who', label: '想面对谁？', placeholder: '比如：室友、家长，或者第一次见面的学姐' }, { key: 'situation', label: '现在卡在哪？', placeholder: '比如：想请教方法，但怕打扰对方' }, { key: 'goal', label: '希望谈成什么？', placeholder: '比如：获得对方愿意聊几分钟的回应' }] as const).map(field => <label key={field.key}>{field.label}<input maxLength={500} value={helper[field.key]} onChange={event => { const next = { ...helper, [field.key]: event.target.value }; setHelper(next); save(INTAKE_HELP, JSON.stringify(next)); }} placeholder={field.placeholder} /></label>)}</div><button type="button" disabled={!Object.values(helper).some(value => value.trim())} onClick={supplementDescription}>补到我的描述中</button><p>挑你想说的填，不需要全部填满。</p></details>
        {!!suggestionAssumptions.length && <details className={styles.intakeHelp}><summary>这个建议补充了哪些模拟假设？</summary><ul>{suggestionAssumptions.map((item, index) => <li key={index}>{item}</li>)}</ul><p>可修改描述；这些不是已经发生的现实事实。</p></details>}
        {intake && needsIntakeRevision && <section ref={intakeResultRef} tabIndex={-1} className={styles.intakeResult} aria-label="帮你找到练习的下一步"><h2>还没开始对话，先选一个练习方向</h2><strong>{intake.reason}</strong>{!!intake.questions.length && <ul>{intake.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}{!!intake.suggestions.length && <div className={styles.intakeSuggestions}>{intake.suggestions.map(suggestion => <button key={suggestion.id} type="button" disabled={working} onClick={() => { updateTopic(suggestion.draft); setSuggestionAssumptions(suggestion.assumptions); document.getElementById('custom-topic')?.focus(); }}><span>{suggestion.label}</span><small>选这个方向，先填入可修改的描述</small><ArrowRight size={16} aria-hidden="true" /></button>)}</div>}<button className={styles.reviseTopic} type="button" onClick={() => document.getElementById('custom-topic')?.focus()}>我来补充或修改描述</button><p>还没有创建练习。原话留在上方；选一个方向或改完描述后，再准备情境。重复提交原句不会进入聊天。</p></section>}
        <p className={styles.privacyNote}>不必写真实姓名。准备时，这段描述会交给模型读取。</p>
        {available === false && <p className={styles.error}>自由练习暂未连接模型。可以返回练习主页体验已有示例。</p>}
        {!needsIntakeRevision && <button className={styles.primary} disabled={working || available !== true || !topic.trim()} onClick={() => void create()}>{working ? '正在准备这次练习…' : refiningTopic ? '用修改后的描述准备情境' : '准备我的练习'}{!working && <ArrowRight size={17} aria-hidden="true" />}</button>}
        {working && !reading && <WaitingFeedback title={operation} />}
      </section>}
      </div>
      </div>
      {sessions.length > 0 && <section className={styles.saved}>
        <h2>接着上次练</h2>
        <p className={styles.subtle}>你的原话与尝试都还在。</p>
        {sessions.map(item => <button key={item.id} disabled={working} onClick={() => void load(item.id)}><strong>{item.title}</strong><span>{item.ready ? `已练 ${item.turns} 轮` : '情境待生成'} · 继续</span></button>)}
      </section>}
    </> : !active || !setup ? <section className={styles.start}>
      <h1>正在准备你的情境</h1><p>{session.topic}</p>
      <p className={styles.subtle}>生成期间可以返回练习主页。记录会保留在“我的自由练习”。</p>
      {working && !reading && <WaitingFeedback title={operation} />}
      {!working && <button className={styles.primary} onClick={() => void retryGeneration()}>重试生成情境</button>}
      {!working && <button onClick={() => setDeleteQuestion(true)}>删除这条未完成的练习</button>}
      {deleteQuestion && <div className={styles.deletePrompt}><p>删除这段描述和未完成的练习？</p><button onClick={() => setDeleteQuestion(false)}>保留</button><button disabled={working} onClick={() => void removeCurrent()}>删除这条练习及所有尝试</button></div>}
    </section> : <>
      <header className={styles.sessionHeader}>
        <p className={styles.eyebrow}>{active.accepted ? active.finished ? '这次练习留下了什么' : `${active.label} · 角色扮演中` : '开场前，先确认这是你想练的事'}</p>
        <h1>{active.setup.title}</h1>
      </header>
      <PracticeGoal goal={active.setup.goal} progress={currentProgress} needsReview={active.turns.length > 0 && !currentProgress} />
      {!active.accepted ? <section className={styles.setup}>
        <div className={styles.chatHeader}><ChatAvatar src={counterpartAvatar.src} name={setup.counterpartRole} /><div><strong>{setup.counterpartRole}</strong><p>这次练习的对话同伴 · AI 扮演</p></div></div>
        <p>这是你想练的事吗？不贴切的地方，可以直接改。</p>
        <div className={styles.twoColumns}>
          <label>我扮演谁<input maxLength={300} value={setup.userRole} onChange={event => setSetup({ ...setup, userRole: event.target.value })} /></label>
          <label>对方是谁<input maxLength={300} value={setup.counterpartRole} onChange={event => setSetup({ ...setup, counterpartRole: event.target.value })} /></label>
        </div>
        <label htmlFor="custom-goal">这次想谈成什么</label><textarea id="custom-goal" maxLength={300} rows={2} value={setup.goal} onChange={event => setSetup({ ...setup, goal: event.target.value })} />
        <details className={styles.setupDetails}><summary>核对具体情况与 {setup.assumptions.length} 条模拟假设<ChevronDown size={16} aria-hidden="true" /></summary><label>练习标题<input maxLength={60} value={setup.title} onChange={event => setSetup({ ...setup, title: event.target.value })} /></label><details className={styles.original}><summary>我最开始的原话</summary><p>{session.topic}</p></details><div className={styles.twoColumns}>
          <label>我提供的情况<span>来自你的描述；可逐行补充或修改。</span><textarea rows={4} value={setup.userFacts.join('\n')} onChange={event => setSetup({ ...setup, userFacts: event.target.value.split('\n') })} /></label>
          <label>为练习补充的假设<span>模型编写的模拟背景，不是现实事实。</span><textarea rows={4} value={setup.assumptions.join('\n')} onChange={event => setSetup({ ...setup, assumptions: event.target.value.split('\n') })} /></label>
        </div></details>
        <label>对方的开场白<textarea maxLength={500} rows={3} value={setup.openingLine} onChange={event => setSetup({ ...setup, openingLine: event.target.value })} /></label>
        <div className={styles.actions}><button onClick={toList}>← 返回，换件事练</button><button className={styles.primary} disabled={working} onClick={() => void act({ kind: 'accept_setup', setup: { ...setup, userFacts: setup.userFacts.map(line => line.trim()).filter(Boolean), assumptions: setup.assumptions.map(line => line.trim()).filter(Boolean) } })}>设定合适，开始对话</button></div>
        {working && !reading && <WaitingFeedback title={operation} model={false} />}
      </section> : <div className={styles.practiceGrid}>
        <section className={styles.conversation} aria-label="我的模拟对话">
          <div className={styles.chatHeader}><ChatAvatar src={counterpartAvatar.src} name={roleName} /><div><h2>{roleName}</h2><p>{working ? reading ? '正在核对记录…' : operation === '你的话已发出，正在等对方回应' ? '正在回应…' : operation : active.finished ? '本次对话已保存' : 'AI 扮演 · 模拟对话'}</p>{roleName !== fullRole && <details className={styles.roleDescription}><summary>对方的完整角色说明</summary><p>{fullRole}</p></details>}</div></div>
          {!active.finished && <button className={styles.experienceJump} onClick={() => document.getElementById('active-experience-brief')?.focus()}>先借一条经验 <ArrowRight size={14} aria-hidden="true" /></button>}
          {currentScene && <p className={styles.currentScene} role="status">{currentScene.openingKind === 'guide' ? '你选定的模拟场景：' : '当前模拟场景：'}{currentScene.label}</p>}
          <div className={styles.transcript} ref={transcriptRef} tabIndex={0} aria-label="自由练习对话记录">
            <ChatMessage src={counterpartAvatar.src} name={roleName} text={active.setup.openingLine} />
            {Array.from({ length: active.turns.length + 1 }, (_, index) => <div key={`scene-${index}`}>
              {active.scenes?.filter(scene => scene.turnIndex === index).map(scene => <div key={scene.id} className={styles.sceneEntry}><p className={styles.sceneDivider}>{scene.openingKind === 'guide' ? '选定场景：' : '模拟进入：'}{scene.label}</p>{scene.openingKind === 'guide' ? <section className={styles.sceneGuide} aria-label="场景提示"><h3>场景提示</h3><p>{scene.openingLine}</p></section> : <ChatMessage src={counterpartAvatar.src} name={roleName} text={scene.openingLine} />}</div>)}
              {active.turns[index] && (() => { const turn = active.turns[index]; return <div key={turn.id} className={styles.round}>
              <ChatMessage src={USER_CHAT_AVATAR.src} name={`我 · 第 ${index + 1} 轮`} text={turn.userText} own />
              <ChatMessage src={counterpartAvatar.src} name={turn.replyOrigin?.kind === 'user_edit' ? `${roleName} · 回应由你调整` : roleName} text={turn.reply}>{turn.replyOrigin?.kind === 'user_edit' && <p className={styles.subtle}>这是你设定的模拟回应，不代表对方自行接受。</p>}</ChatMessage>
              {index === active.turns.length - 1 && sceneReadiness.turnsInScene > 0 && <CounterpartReplyEditor key={`${active.id}:${turn.id}`} turnId={turn.id} reply={turn.reply} canContinue={!turnLimitReached} initialDraft={pendingEditDraft?.sessionId === session.id && pendingEditDraft.action.turnId === turn.id && pendingEditDraft.action.expectedVersion === session.version ? pendingEditDraft.action.reply : undefined} disabled={working || Boolean(error) || session.branches.length >= 12} onSave={(turnId, reply) => act({ kind: 'edit_counterpart_reply', turnId, reply })} />}
              {turn.reflection && <details className={styles.reflection}><summary>给自己一个思考问题</summary><p>{turn.reflection}</p><p className={styles.subtle}>这是模型给出的练习提示，不是评分。</p>{turn.sourceId && <button onClick={() => setShowSources(true)}>查看相关经验片段</button>}</details>}
            </div>; })()}
            </div>)}
            <div ref={conversationEnd} />
          </div>
          {active.turns.at(-1)?.replyOrigin?.kind === 'user_edit' ? <p className={styles.notice}>这句回应由你设定，暂不核对为已达成。{turnLimitReached || active.finished ? '可以保存这次尝试，或返回上一步换个说法。' : '继续说一句，练习如何应对这个情况。'}</p> : <PracticeGoalReview progress={currentProgress} hasTurns={active.turns.length > 0} finished={active.finished} disabled={working || Boolean(error) || available === false} onReview={() => void act({ kind: 'review_goal' })} onSources={() => setShowSources(true)} onFinish={() => void act({ kind: 'finish' })} />}
          {working && !reading && <WaitingFeedback title={operation} model={operation === '你的话已发出，正在等对方回应' || operation === '正在根据对话原话核对目标进展'} />}
          {error && !working && <div className={styles.nextMove}><strong>先核对这一轮，再继续聊</strong><p>{error}</p><button type="button" onClick={() => void load(session.id)}>核对已保存结果</button></div>}
          {!active.finished ? turnLimitReached ? <section className={styles.notice} aria-label="本次尝试已到轮数上限"><strong>这次已练到 20 轮</strong><p>先保存复盘，整理这次想带走的经验。也可以返回上一步，保留原尝试，再换个说法。</p></section> : <form className={styles.composer} onSubmit={event => { event.preventDefault(); if (!composing.current && draft.trim() && !working) void act({ kind: 'say', text: draft.trim() }); }}>
            {!sceneReadiness.turnsInScene && <p className={styles.firstReply}>{currentScene?.openingKind === 'guide' ? '现在由你先开口。在下方写一句话，再点“说给对方听”；对方收到你的话后才会回应。' : '现在轮到你回应了。在下方写一句话，再点“说给对方听”；对方会根据你的表达继续聊。'}</p>}
            <label htmlFor="custom-say">如果现在面对对方，你会怎么说？</label>
            <textarea id="custom-say" rows={3} maxLength={2000} value={draft} placeholder="写下你想说的话……" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={event => { setDraftValue(event.target.value); save(`practice-custom-draft:${session.id}`, event.target.value); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current && draft.trim() && !working) { event.preventDefault(); void act({ kind: 'say', text: draft.trim() }); } }} />
            <div className={styles.actions}><span className={styles.subtle}>换行不会发送 · Ctrl / ⌘ + Enter 发送</span><button className={styles.primary} type="submit" disabled={working || !draft.trim() || available === false}>说给对方听</button></div>
          </form> : <section className={styles.report} aria-label="本次练习复盘">
            <header className={styles.recapHeading}><Check size={20} aria-hidden="true" /><div><span>{active.label} · {active.turns.length} 轮对话已保存</span><h2>把这次尝试，变成自己的经验</h2></div></header>
            {active.turns.at(-1) && <div className={styles.recapQuotes}><section><h3>我最后一次怎样表达</h3><blockquote>{active.turns.at(-1)!.userText}</blockquote></section><section><h3>模拟中的对方怎样回应</h3><blockquote>{active.turns.at(-1)!.reply}</blockquote></section></div>}
            <ExperienceBrief questions={matchedQuestions} onOpenSources={() => setShowSources(true)} />
            <label className={styles.reflectionInput} htmlFor="custom-takeaway">这次，我想记住什么<span>由你自己写；只存在这个浏览器，不发给模型。</span></label>
            <textarea id="custom-takeaway" rows={2} maxLength={2000} value={takeaway} placeholder="哪句表达对你有用？还有什么顾虑没有谈到？" onChange={event => { setTakeaway(event.target.value); save(`practice-custom-takeaway:${session.id}:${active.id}`, event.target.value); }} />
            <label className={styles.reflectionInput} htmlFor="custom-next-step">现实里，我准备尝试的一步<span>选填，仅保存在这个浏览器，不发送给模型。</span></label>
            <textarea className={styles.reflectionInput} id="custom-next-step" rows={3} maxLength={2000} value={reflection} placeholder="比如：明天找个双方不赶时间的时候，先问问对方的顾虑，再提出我的具体想法。" onChange={event => { setReflection(event.target.value); save(`practice-custom-reflection:${session.id}:${active.id}`, event.target.value); }} />
            {reflection && <div className={styles.printReflection}><strong>现实里，我准备尝试的一步</strong><p>{reflection}</p></div>}
            {takeaway && <div className={styles.printReflection}><strong>这次，我想记住什么</strong><p>{takeaway}</p></div>}
            <p className={styles.subtle}>原话在上方完整保留。模拟里的回应，不等于现实结果。</p>
            <div className={styles.actions}><button className={styles.primary} onClick={() => exportRecord(session)}>下载我的经验记录</button><button onClick={() => window.print()}>打印 / 保存 PDF</button></div>
          </section>}
          {!active.finished && !turnLimitReached && <ReplyChoices kind="custom" sessionId={session.id} version={session.version} branchId={active.id} disabled={working || Boolean(error)} available={available !== false} draft={draft} onChoose={text => { setDraftValue(text); save(`practice-custom-draft:${session.id}`, text); }} onWrite={() => document.getElementById('custom-say')?.focus()} />}
          {!active.finished && !turnLimitReached && <SceneAdvance key={`${active.id}:${active.scenes?.length ?? 0}`} suggested={suggestedCustomSceneLabel(active)} ready={sceneReadiness.ready} blockedReason={sceneReadiness.reason} disabled={working || Boolean(error)} onAdvance={label => void act({ kind: 'advance_scene', label })} />}
          <div className={styles.bottomActions}>
            <button disabled={working} onClick={() => void act({ kind: 'rewind' })}>← 返回上一步，换个说法</button>
            {!active.finished && <button disabled={working || !active.turns.length} onClick={() => void act({ kind: 'finish' })}>先练到这里，保存复盘</button>}
          </div>
          <p className={styles.subtle}>返回会保留刚才的尝试，再退回最近一句之前；开场前返回可重新修改设定。</p>
        </section>
        <aside className={styles.context}>
          {!active.finished && <div id="active-experience-brief" tabIndex={-1} className={styles.sideBrief}><ExperienceBrief questions={matchedQuestions} onOpenSources={() => setShowSources(true)} />{active.sourceContext?.basis === 'retrospective' && <p className={styles.subtle}>这是为历史练习补充的阅读材料，原对话生成时未使用这些来源。</p>}</div>}
          <h2>这次的情境</h2><p><strong>我是：</strong>{active.setup.userRole}</p>
          <details className={styles.original}><summary>我最开始的原话</summary><p>{session.topic}</p></details>
          <details className={styles.confirmedFacts}><summary>已确认的情况与模拟假设</summary>
            <h3>我确认的情况</h3>{active.setup.userFacts.length ? <ul>{active.setup.userFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <p>暂未补充更多情况。</p>}
            <h3>仅用于这次模拟的假设</h3><ul>{active.setup.assumptions.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
          </details>
          <details className={styles.boundary}><summary>关于这场模拟</summary><p>{CUSTOM_BOUNDARY}</p></details>
          {session.branches.length > 1 && <label className={styles.branchPicker}>其他尝试<select value={active.id} disabled={working} onChange={event => void act({ kind: 'switch_branch', branchId: event.target.value })}>{session.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.label} · {branch.turns.length} 轮{branch.finished ? ' · 已复盘' : ''}</option>)}</select></label>}
        </aside>
      </div>}
      <div className={styles.recordTools}>
        <span>自动保存 · 默认保留30天</span><button onClick={() => exportRecord(session)}>下载经验记录（文本）</button>
        <details className={styles.recordMore}><summary>记录管理</summary><button disabled={working} onClick={() => void load(session.id)}>核对已保存结果</button><button onClick={() => exportRecord(session, true)}>导出原始数据</button><button disabled={working} onClick={() => setDeleteQuestion(true)}>删除这条练习</button></details>
      </div>
      {deleteQuestion && <section className={styles.deletePrompt} role="group" aria-label="删除练习确认"><p>删除这条练习及其所有尝试？删除后无法恢复。</p><button onClick={() => setDeleteQuestion(false)}>保留，返回练习</button><button disabled={working} onClick={() => void removeCurrent()}>删除这条练习及所有尝试</button></section>}
    </>}
    {showSources && active && <CampusExperience key={active.id} branch={active} onClose={() => {
      setShowSources(false);
      const input = document.getElementById(active.finished ? 'custom-takeaway' : 'custom-say');
      input?.focus({ preventScroll: true });
      requestAnimationFrame(() => input?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    }} />}
  </section>;
}
