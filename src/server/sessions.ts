import { createHash, randomUUID } from 'node:crypto';
import type { ActionRequest, Command, EventDraft, GameEvent, GameState, Interpretation, ScenarioId, SessionView } from '@/domain/types';
import { initialState, transition } from '@/domain/engine';
import { buildReport } from '@/domain/report';
import { TASKS, SCENARIOS, SCENARIO_VERSION, TRANSFER_STEPS } from '@/domain/scenarios';
import { SOURCE_VERSION } from '@/content/sources';
import { ACTION_LEASE_MS, configuration, MAX_ACTIONS, RETENTION_MS } from './config';
import { AppError } from './errors';
import { interpretText, type Interpreter } from './interpreter';
import { parseAction, validateInterpretation } from './validation';
import type { SessionRecord, Store } from './records';
import { REFLECTION_QUESTIONS, selectReflectionQuestions, validateQuestionIds, type QuestionSelector } from './reflection';
import { expiry } from './retention';
import { guardPracticeIntent } from './practice-intent';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hashAction(request: ActionRequest) { return createHash('sha256').update(canonical(request)).digest('hex'); }
function commandLabel(command: Command, state: GameState): string {
  switch (command.type) {
    case 'inspect': return `查看：${SCENARIOS[state.scenario].materials.find(item => item.id === command.materialId)?.title ?? '场景材料'}`;
    case 'ask': return `询问${({ goal: '共同目标', capacity: '每个人的可用时间', visual: '视觉精修的范围', qa: '问答组件的边界', acceptance: '验收要求' } as Record<string, string>)[command.topic] ?? command.topic}`;
    case 'propose': return `我提议这次安排：${command.taskIds.map(id => TASKS[id]?.title ?? id).join('、') || '暂不安排任务'}${command.conditions?.length ? `。前提：${command.conditions.join('；')}` : ''}${command.acknowledgements?.length ? `。我接受的取舍：${command.acknowledgements.map(item => ({ limited_scope: '静态引导只有三个导航入口，不支持自由问答', replace_visual: '按当前提议减少或替换精修范围', defer_new: '新增问题本次未解决' } as Record<string, string>)[item] ?? item).join('；')}` : ''}`;
    case 'acknowledge': return `我确认这些取舍：${command.items.map(item => ({ limited_scope: '静态引导只有三个导航入口，不支持自由问答', replace_visual: '按当前提议减少或替换精修范围', defer_new: '新增问题本次未解决' } as Record<string, string>)[item] ?? item).join('、')}`;
    case 'withdraw': return '撤回当前尚未生效的提议。';
    case 'finish': return '结束本次练习，查看已经形成的记录。';
    case 'hint': return '我想看一条提示。';
    case 'reply_options_seen': return '我选择查看可以改写的回答选项，并记录这次辅助。';
    case 'transfer_plan': return `我准备依次：${command.steps.map(step => TRANSFER_STEPS[step]?.title ?? step).join('、')}`;
    case 'transfer_execute': return `执行：${TRANSFER_STEPS[command.step]?.title ?? command.step}`;
    case 'workplace_propose': return `我提议先后完成：${command.order.map(item => item === 'summary' ? '演示摘要' : '竞品表').join('、')}${command.requestReschedule ? '，并向负责人申请调整竞品表截止。' : '，按当前截止安排。'}`;
    case 'clarify': return command.question;
  }
}

export class SessionService {
  constructor(private store: Store, private interpreter: Interpreter = interpretText, private now: () => number = Date.now, private questionSelector: QuestionSelector = selectReflectionQuestions) {}
  private view(record: SessionRecord): SessionView {
    const pending = Object.values(record.actions).find(action => action.status === 'interpreting' && action.leaseUntil > this.now());
    const config = configuration();
    return { ...structuredClone(record.view), pendingActionId: pending?.id ?? null, capabilities: { naturalLanguage: config.configured.model, storage: this.store.mode, model: config.model.name, ...(config.model.provider ? { provider: config.model.provider } : {}) }, ...(record.view.parentId && record.parentState ? { comparison: { parentId: record.view.parentId, state: structuredClone(record.parentState) } } : {}) };
  }
  async create(owner: string, scenario: ScenarioId): Promise<SessionView> {
    const state = initialState(scenario); state.sourceVersion = SOURCE_VERSION;
    const time = new Date(this.now()).toISOString();
    const record: SessionRecord = { owner, expiresAt: new Date(this.now() + RETENTION_MS).toISOString(), view: { id: randomUUID(), version: 0, state, events: [], parentId: null, forkReason: null, createdAt: time, updatedAt: time }, actions: {}, checkpoints: [{ sequence: 0, state: structuredClone(state) }] };
    await this.store.create(record); return this.view(record);
  }
  async get(owner: string, id: string) { return this.view(await this.store.read(owner, id)); }
  async actionStatus(owner: string, id: string, actionId: string) {
    const record = await this.store.read(owner, id); const action = record.actions[actionId];
    if (!action) throw new AppError('ACTION_NOT_FOUND', '这次动作尚未登记，可以使用原编号和内容重试。', 404);
    return { session: this.view(record), action: { id: action.id, status: action.status === 'committed' ? 'complete' : action.status, leaseExpired: action.status === 'interpreting' && action.leaseUntil <= this.now(), ...(action.errorCode ? { errorCode: action.errorCode } : {}) } };
  }
  async remove(owner: string, id: string) { return this.store.remove(owner, id); }
  async report(owner: string, id: string) {
    return this.store.update(owner, id, record => {
      record.reports ??= {};
      let report = record.reports[String(record.view.version)];
      if (!report) {
        report = buildReport(record.view.state, record.view.events);
        if (record.view.parentId) report.tradeoffs.push('本次是从原记录建立的重试或纠正分支，不能作为新的无提示独立测量。');
        report.generatedAt = new Date(this.now()).toISOString();
        record.reports[String(record.view.version)] = structuredClone(report);
      }
      return { session: this.view(record), report: structuredClone(report), ...(record.reflections?.[String(record.view.version)]?.result ? { reflection: structuredClone(record.reflections[String(record.view.version)].result) } : {}) };
    });
  }
  async reflection(owner: string, id: string, request: { requestId: string; expectedVersion: number }) {
    await this.report(owner, id); // Save factual report even when the optional model is unavailable.
    const claim = await this.store.update(owner, id, record => {
      if (record.view.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', '练习记录已更新，请重新打开当前报告后请求反思引导。', 409);
      record.reflections ??= {};
      if (Object.values(record.reflections).some(item => item.requestId === request.requestId && item.version !== request.expectedVersion)) throw new AppError('ACTION_ID_REUSED', '这个请求编号已用于另一份报告。', 409);
      const previous = record.reflections[String(request.expectedVersion)];
      if (previous?.status === 'complete' && previous.result) return { kind: 'complete' as const, result: { session: this.view(record), report: structuredClone(record.reports![String(request.expectedVersion)]), reflection: structuredClone(previous.result) } };
      if (previous?.status === 'pending' && previous.leaseUntil > this.now()) throw new AppError('REFLECTION_IN_PROGRESS', '反思引导仍在生成，事实报告已经保存。', 409);
      if (this.questionSelector === selectReflectionQuestions && !configuration().configured.model) throw new AppError('AI_NOT_CONFIGURED', '事实报告已经保存。AI 反思引导需要先配置模型服务。', 503);
      const attempt = (previous?.attempt ?? 0) + 1;
      record.reflections[String(request.expectedVersion)] = { requestId: request.requestId, version: request.expectedVersion, attempt, leaseUntil: this.now() + ACTION_LEASE_MS, status: 'pending' };
      return { kind: 'claimed' as const, attempt, report: structuredClone(record.reports![String(request.expectedVersion)]) };
    });
    if (claim.kind === 'complete') return claim.result;
    const token = randomUUID(); let acquired = false;
    try {
      acquired = await this.store.acquireModel(token, this.now());
      if (!acquired) throw new AppError('AI_BUSY', 'AI 服务当前繁忙，事实报告已经保存，请稍后重试引导。', 429);
      const selection = await this.questionSelector(claim.report);
      const ids = validateQuestionIds(Array.isArray(selection) ? selection : selection.ids);
      return await this.store.update(owner, id, record => {
        const attempt = record.reflections?.[String(request.expectedVersion)];
        if (!attempt || attempt.attempt !== claim.attempt || attempt.status !== 'pending' || attempt.leaseUntil <= this.now()) throw new AppError('ACTION_EXPIRED', '反思请求已过期，请重新打开报告。', 409);
        if (record.view.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', '练习已进入新回合，本次引导未覆盖新报告。', 409);
        attempt.result = { version: request.expectedVersion, questions: ids.map(questionId => ({ id: questionId, text: REFLECTION_QUESTIONS[questionId] })), generatedAt: new Date(this.now()).toISOString(), ...(Array.isArray(selection) ? { model: 'injected-selector' } : { model: selection.model, provider: selection.provider }), kind: 'guided_questions' };
        attempt.status = 'complete'; attempt.leaseUntil = 0;
        return { session: this.view(record), report: structuredClone(record.reports![String(request.expectedVersion)]), reflection: structuredClone(attempt.result) };
      });
    } catch (error) {
      await this.store.update(owner, id, record => { const attempt = record.reflections?.[String(request.expectedVersion)]; if (attempt?.attempt === claim.attempt && attempt.status === 'pending') { attempt.status = 'failed'; attempt.leaseUntil = 0; attempt.errorCode = error instanceof AppError ? error.code : 'SERVICE_UNAVAILABLE'; } }).catch(() => undefined);
      throw error;
    } finally { if (acquired) await this.store.releaseModel(token).catch(() => undefined); }
  }
  async fork(owner: string, id: string, options: { expectedVersion: number; afterSequence?: number; reason: 'retry' | 'correction' }): Promise<SessionView> {
    // Copy while holding the same short lock used by action submission. The parent
    // is not rewritten by future actions in this new aggregate.
    const child = await this.store.update(owner, id, record => {
      if (record.view.version !== options.expectedVersion) throw new AppError('VERSION_CONFLICT', '原记录已更新，请刷新后选择重试起点。', 409);
      if (Object.values(record.actions).some(action => action.status === 'interpreting' && action.leaseUntil > this.now())) throw new AppError('ACTION_IN_PROGRESS', '这一轮仍在处理，请完成后再从记录建立分支。', 409);
      const firstProposal = record.view.events.find(event => ['interpretation:proposal', 'interpretation:transfer_plan', 'interpretation:workplace_proposal'].includes(event.kind));
      const retryCheckpoint = firstProposal ? record.checkpoints.filter(item => item.sequence < firstProposal.sequence).at(-1)! : record.checkpoints[0];
      if (options.reason === 'retry' && options.afterSequence !== undefined && options.afterSequence !== retryCheckpoint.sequence) throw new AppError('INVALID_CHECKPOINT', '教学重试必须回到首次范围提议前；如需选择其他完整节点，请使用纠正分支。');
      const checkpoint = options.afterSequence === undefined ? options.reason === 'retry' ? retryCheckpoint : record.checkpoints.at(-1)! : record.checkpoints.find(item => item.sequence === options.afterSequence);
      if (!checkpoint) throw new AppError('INVALID_CHECKPOINT', '只能从完整回合结束的记录点重试。');
      const time = new Date(this.now()).toISOString();
      const state = structuredClone(checkpoint.state);
      if (state.scenario === 'transfer') {
        state.transfer.firstPlan = structuredClone(record.view.state.transfer.firstPlan);
        state.transfer.firstAssisted = record.view.state.transfer.firstAssisted;
        state.transfer.hintUsed = record.view.state.transfer.hintUsed;
      }
      const checkpoints = structuredClone(record.checkpoints.filter(item => item.sequence <= checkpoint.sequence));
      checkpoints[checkpoints.length - 1] = { sequence: checkpoint.sequence, state: structuredClone(state) };
      return { owner, expiresAt: new Date(expiry(record)).toISOString(), view: { id: randomUUID(), version: 0, state, events: structuredClone(record.view.events.filter(event => event.sequence <= checkpoint.sequence)), parentId: id, forkReason: options.reason, createdAt: time, updatedAt: time }, actions: {}, checkpoints, parentState: structuredClone(record.view.state) } satisfies SessionRecord;
    });
    await this.store.create(child); return this.view(child);
  }
  async act(owner: string, id: string, rawRequest: unknown): Promise<SessionView> {
    const request = parseAction(rawRequest);
    const hash = hashAction(request);
    const claim = await this.store.update(owner, id, record => {
      const existing = record.actions[request.actionId];
      for (const previous of Object.values(record.actions)) if (previous.status === 'committed') { previous.status = 'complete'; previous.leaseUntil = 0; }
      if (existing && existing.hash !== hash) throw new AppError('ACTION_ID_REUSED', '这次请求编号已用于其他内容，请刷新后重新提交。', 409);
      if (existing?.status === 'complete' || existing?.status === 'committed') {
        existing.status = 'complete'; existing.leaseUntil = 0;
        return { kind: 'existing' as const, view: this.view(record) };
      }
      if (existing?.status === 'interpreting' && existing.leaseUntil > this.now()) throw new AppError('ACTION_IN_PROGRESS', '这一轮仍在处理，尚未保存为完成。请恢复记录查看进度。', 409);
      if (record.view.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', '这条练习已有新记录，请刷新后重新提交你的安排。', 409);
      if (record.view.state.scenarioVersion !== SCENARIO_VERSION || record.view.state.sourceVersion !== SOURCE_VERSION) throw new AppError('SCENARIO_VERSION_UNAVAILABLE', '这条记录使用较早的场景版本，仍可阅读回放。请新建练习继续。', 409);
      if (Object.values(record.actions).some(action => action.id !== request.actionId && (action.status === 'committed' || (action.status === 'interpreting' && action.leaseUntil > this.now())))) throw new AppError('ACTION_IN_PROGRESS', '这一轮还在处理，请稍等再提出新安排。', 409);
      if (!existing && Object.keys(record.actions).length >= MAX_ACTIONS) throw new AppError('SESSION_LIMIT', '本条练习记录已到回合上限，请保存复盘后重新开始。', 429);
      if (request.text && this.interpreter === interpretText && !configuration().configured.model) throw new AppError('AI_NOT_CONFIGURED', '自然语言理解尚未接通模型服务。可以先使用页面中的练习操作。', 503);
      const attempt = (existing?.attempt ?? 0) + 1;
      record.actions[request.actionId] = { id: request.actionId, hash, request, status: 'interpreting', attempt, leaseUntil: this.now() + ACTION_LEASE_MS, baseVersion: record.view.version };
      return { kind: 'claimed' as const, attempt, state: structuredClone(record.view.state), history: record.view.events.slice(-12).map(event => ({ actor: event.actor, text: event.text })) };
    });
    if (claim.kind === 'existing') return claim.view;
    const modelToken = randomUUID(); let acquired = false;
    try {
      let interpretation: Interpretation;
      if (request.command) interpretation = { commands: [request.command], evidence: [] };
      else {
        acquired = await this.store.acquireModel(modelToken, this.now());
        if (!acquired) throw new AppError('AI_BUSY', '当前练习较多，本轮没有改变约定。请稍后重试。', 429);
        interpretation = guardPracticeIntent(validateInterpretation(await this.interpreter(request.text!, claim.state, claim.history), request.text!), request.text!, claim.state, claim.history);
      }
      await this.store.update(owner, id, record => {
        const action = record.actions[request.actionId];
        if (!action || action.attempt !== claim.attempt || action.status !== 'interpreting' || action.leaseUntil <= this.now()) throw new AppError('ACTION_EXPIRED', '本轮处理已过期，请恢复记录后重试。', 409);
        if (record.view.version !== action.baseVersion) throw new AppError('VERSION_CONFLICT', '练习状态已更新，旧解释没有被执行。', 409);
        const drafts: EventDraft[] = [{ actor: 'user', kind: 'input', text: request.text ?? commandLabel(request.command!, record.view.state), changes: [] }];
        let state = structuredClone(record.view.state);
        const clarification = interpretation.clarification?.trim() || interpretation.commands.find(command => command.type === 'clarify')?.question;
        for (const command of clarification ? [] : interpretation.commands) {
          const next = transition(state, command); state = next.state;
          // Preserve the user's actual input separately from the engine's normalized
          // description. A generated paraphrase must never masquerade as a quote.
          drafts.push(...next.events.map(event => event.actor === 'user' ? { ...event, actor: 'system' as const, kind: `interpretation:${event.kind}`, text: `本轮动作解释：${event.text}` } : event));
        }
        if (interpretation.commands.length === 0 || clarification) drafts.push({ actor: 'system', kind: 'clarification', text: clarification || '这段话还没有形成可执行的新安排。可以说明你要询问什么，或明确提出任务、条件与取舍。', changes: [] });
        const time = new Date(this.now()).toISOString();
        let sequence = record.view.events.at(-1)?.sequence ?? 0;
        const events: GameEvent[] = drafts.map(draft => ({ ...draft, id: randomUUID(), sequence: ++sequence, actionId: request.actionId, createdAt: time }));
        record.view.state = state; record.view.events.push(...events); record.view.version++; record.view.updatedAt = time;
        record.checkpoints.push({ sequence, state: structuredClone(state) });
        action.status = 'committed'; action.interpretation = interpretation;
      });
      // Role replies above are deterministic facts emitted by the rule engine.
      // Marking delivery complete is independently recoverable after a lost response.
      return await this.store.update(owner, id, record => {
        const action = record.actions[request.actionId];
        if (action?.attempt === claim.attempt && action.status === 'committed') { action.status = 'complete'; action.leaseUntil = 0; }
        return this.view(record);
      });
    } catch (error) {
      await this.store.update(owner, id, record => {
        const action = record.actions[request.actionId];
        if (action?.attempt === claim.attempt && action.status === 'interpreting') { action.status = 'failed'; action.leaseUntil = 0; action.errorCode = error instanceof AppError ? error.code : 'SERVICE_UNAVAILABLE'; }
      }).catch(() => undefined);
      throw error;
    } finally { if (acquired) await this.store.releaseModel(modelToken).catch(() => undefined); }
  }
}
