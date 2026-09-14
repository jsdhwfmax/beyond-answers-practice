import { createHash, randomUUID } from 'node:crypto';
import { activeCustomBranch, activeCustomScene, CUSTOM_SCENE_GUIDE, customActionSchema, customCreateSchema, customSceneGuide, customSceneReadiness, isGenericCustomSceneLabel, type CustomAction, type CustomPracticeSummary, type CustomPracticeView, type CustomTurn } from '@/domain/custom-practice';
import { SOURCE_VERSION } from '@/content/sources';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';
import { ACTION_LEASE_MS, RETENTION_MS } from './config';
import { AppError } from './errors';
import { liveCustomModel, type CustomModel } from './custom-model';
import type { CustomRecord, CustomStore } from './custom-records';
import { getCustomStore } from './custom-store';
import { getStore } from './store';
import { modelConfiguration } from './model-provider';
import { matchCampusSources } from './campus-library';
import { checkedGoalProgress } from './custom-goal-review';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const creationKey = (topic: string, sourceQuestionId?: string) => sourceQuestionId ? { topic, sourceQuestionId } : topic;
function originalSourceQuestionId(record: CustomRecord): string | undefined {
  if (record.view.sourceQuestionId) return record.view.sourceQuestionId;
  if (record.creationHash === hash(record.view.topic)) return undefined;
  // Older failed setups saved only the creation hash. Recover an exact original
  // ID from known public IDs, never from a semantic topic match. Read is owner-checked.
  const ids = new Set([
    ...record.view.branches.flatMap(branch => branch.sourceContext?.questions.map(question => question.id) ?? []),
    ...CAMPUS_CORPUS.map(question => question.id),
  ]);
  return [...ids].find(id => record.creationHash === hash(creationKey(record.view.topic, id)));
}
function restoredView(record: CustomRecord): CustomPracticeView {
  const view = clone(record.view); const sourceQuestionId = originalSourceQuestionId(record);
  if (sourceQuestionId) view.sourceQuestionId = sourceQuestionId;
  return view;
}
type ModelSlots = { acquireModel(token: string, now: number): Promise<boolean>; releaseModel(token: string): Promise<void> };

export class CustomPracticeService {
  constructor(private store: CustomStore, private model: CustomModel = liveCustomModel, private slots?: ModelSlots, private enabled = true) {}
  async list(owner: string): Promise<CustomPracticeSummary[]> {
    return (await this.store.list(owner)).map(record => {
      const branch = activeCustomBranch(record.view);
      return { id: record.view.id, title: branch?.setup.title ?? record.view.topic.slice(0, 40), updatedAt: record.view.updatedAt, turns: branch?.turns.length ?? 0, ready: Boolean(branch) };
    });
  }
  async read(owner: string, id: string) {
    const view = restoredView(await this.store.read(owner, id));
    // Historic turns stay untouched. A supplemental reading selection is not
    // evidence that those old responses were generated from the new corpus.
    for (const branch of view.branches) if (!branch.sourceContext) {
      branch.sourceContext = matchCampusSources(`${view.topic} ${branch.setup.goal}`);
      branch.sourceContext.basis = 'retrospective';
      branch.sourceContext.note = `补充阅读：这段历史对话生成时尚未使用校园题库。${branch.sourceContext.note}`;
    }
    return view;
  }
  async remove(owner: string, id: string) { await this.store.remove(owner, id); }
  private available() { if (!this.enabled) throw new AppError('AI_NOT_CONFIGURED', '自由练习需要连接模型。当前可先体验首页的示例练习。', 503); }
  async create(owner: string, input: unknown) {
    const parsed = customCreateSchema.safeParse(input);
    if (!parsed.success) throw new AppError('INVALID_ACTION', '请用一句话说明想练的事，最多2000字。');
    this.available(); const request = parsed.data; const now = new Date().toISOString();
    const requestedSourceContext = matchCampusSources(request.topic, request.sourceQuestionId);
    try {
      await this.store.create({
        owner, creationHash: hash(creationKey(request.topic, request.sourceQuestionId)), actions: {},
        view: { id: request.id, version: 0, topic: request.topic, ...(request.sourceQuestionId ? { sourceQuestionId: request.sourceQuestionId } : {}), createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + RETENTION_MS).toISOString(), activeBranchId: null, branches: [], generating: false, sourceVersion: SOURCE_VERSION, pendingAction: null },
      });
    } catch (error) { if (!(error instanceof AppError && error.code === 'SESSION_EXISTS')) throw error; }
    const record = await this.store.read(owner, request.id);
    // Older clients may omit the ID on retry. Omission means keep the original;
    // an explicitly different ID or topic still fails the immutable creation hash.
    const sourceQuestionId = request.sourceQuestionId ?? originalSourceQuestionId(record);
    if (record.creationHash !== hash(creationKey(request.topic, sourceQuestionId))) throw new AppError('ACTION_CONFLICT', '这个练习编号已用于另一段内容，请开始一条新练习。', 409);
    if (record.view.activeBranchId) return restoredView(record);
    const sourceContext = sourceQuestionId === request.sourceQuestionId ? requestedSourceContext : matchCampusSources(request.topic, sourceQuestionId);
    return this.modelAction(owner, request.id, request.actionId, hash({ kind: 'create', topic: request.topic, ...(sourceQuestionId ? { sourceQuestionId } : {}) }), 0,
      () => this.model.setup(request.topic, clone(sourceContext)), (current, setup) => {
        const id = randomUUID();
        const { generation, ...plainSetup } = setup;
        if (sourceQuestionId) current.view.sourceQuestionId = sourceQuestionId;
        current.view.branches.push({ id, label: '第一次尝试', parentId: null, setup: plainSetup, accepted: false, finished: false, turns: [], createdAt: new Date().toISOString(), sourceContext: clone(sourceContext), ...(generation ? { generatedBy: generation } : {}) });
        current.view.activeBranchId = id;
      });
  }
  async action(owner: string, id: string, input: unknown) {
    const parsed = customActionSchema.safeParse(input);
    if (!parsed.success) throw new AppError('INVALID_ACTION', '操作内容不完整，请刷新练习后重试。');
    const action = parsed.data; const digest = hash(action);
    if (action.kind === 'say' || action.kind === 'review_goal') {
      this.available();
      // A retry must return the saved result before phase validation, even when
      // another action has since ended the conversation.
      const read = await this.store.read(owner, id); const previous = read.actions[action.actionId];
      if (previous) { if (previous.hash !== digest) throw new AppError('ACTION_CONFLICT', '同一个操作编号不能发送不同内容。', 409); if (previous.status === 'done') return clone(read.view); }
      const branch = activeCustomBranch(read.view);
      if (!branch?.accepted || (branch.finished && action.kind !== 'review_goal')) throw new AppError('NOT_READY', '请先确认情境设定，或返回上一步继续练习。', 409);
      if (!branch.sourceContext) {
        branch.sourceContext = matchCampusSources(`${read.view.topic} ${branch.setup.goal}`);
        branch.sourceContext.basis = 'retrospective';
        branch.sourceContext.note = `补充阅读：此前保存的对话生成时尚未使用校园题库。${branch.sourceContext.note}`;
      }
      if (action.kind === 'review_goal') {
        if (!branch.turns.length) throw new AppError('NOT_READY', '先进行一次对话，再核对目标进展。', 409);
        if (!this.model.reviewGoal) throw new AppError('AI_NOT_CONFIGURED', '当前模型暂不能核对已有对话，可以继续练习。', 503);
        const reviewGoal = this.model.reviewGoal.bind(this.model);
        return this.modelAction(owner, id, action.actionId, digest, action.expectedVersion, () => reviewGoal(clone(branch)), (record, assessment) => {
          const active = activeCustomBranch(record.view)!;
          active.sourceContext ??= clone(branch.sourceContext);
          const { generation, ...candidate } = assessment;
          const progress = checkedGoalProgress(active, candidate);
          if (!progress) throw new AppError('AI_GOAL_EVIDENCE_INVALID', '目标进展的依据未通过核对，原对话没有改变。可以稍后再试。', 502);
          active.goalProgress = { ...progress, ...(generation ? { generatedBy: generation } : {}) };
        });
      }
      if (branch.turns.length >= 20) throw new AppError('TURN_LIMIT', '本次已练习20轮，可以先保存复盘，另开一段练习。', 409);
      return this.modelAction(owner, id, action.actionId, digest, action.expectedVersion, () => this.model.reply(clone(branch), action.text), (record, reply) => {
        const active = activeCustomBranch(record.view)!;
        active.sourceContext ??= clone(branch.sourceContext);
        const sceneId = activeCustomScene(active)?.id;
        const turn: CustomTurn = { id: action.actionId, userText: action.text, reply: reply.reply, reflection: reply.practiceQuestion, supportedQuote: reply.supportedQuote, sourceId: reply.sourceId, createdAt: new Date().toISOString(), ...(reply.generation ? { generatedBy: reply.generation } : {}), ...(sceneId ? { sceneId } : {}) };
        const progress = checkedGoalProgress(active, reply.goalAssessment, turn);
        if (progress) { turn.goalProgress = { ...progress, ...(reply.generation ? { generatedBy: reply.generation } : {}) }; active.goalProgress = clone(turn.goalProgress); }
        else delete active.goalProgress;
        active.turns.push(turn);
      });
    }
    return this.store.update(owner, id, record => {
      const prior = record.actions[action.actionId];
      if (prior) { if (prior.hash !== digest) throw new AppError('ACTION_CONFLICT', '同一个操作编号不能发送不同内容。', 409); if (prior.status === 'done') return clone(record.view); }
      this.checkWritable(record, action.expectedVersion);
      this.apply(record, action);
      this.updated(record); record.actions[action.actionId] = { hash: digest, status: 'done', attempt: randomUUID(), until: 0 };
      return clone(record.view);
    });
  }
  private checkWritable(record: CustomRecord, version: number) {
    if (record.view.pendingAction && record.view.pendingAction.until > Date.now()) throw new AppError('ACTION_BUSY', '上一句仍在生成，稍后可以查看已保存结果。', 409);
    if (record.view.version !== version) throw new AppError('VERSION_CONFLICT', '记录已更新，请载入最新记录后再操作。', 409);
    if (Object.keys(record.actions).length >= 120) throw new AppError('ACTION_LIMIT', '这条练习已达到记录上限，请导出后开始新练习。', 409);
  }
  private updated(record: CustomRecord) {
    record.view.version++; record.view.updatedAt = new Date().toISOString(); record.view.pendingAction = null; record.view.generating = false;
  }
  private apply(record: CustomRecord, action: Exclude<CustomAction, { kind: 'say' | 'review_goal' }>) {
    const branch = activeCustomBranch(record.view);
    if (!branch) throw new AppError('NOT_READY', '情境还没有生成完成。', 409);
    switch (action.kind) {
      case 'edit_counterpart_reply': {
        if (!branch.accepted) throw new AppError('NOT_READY', '先确认情境，再调整对方的回应。', 409);
        const latest = branch.turns.at(-1); const scene = activeCustomScene(branch);
        if (!latest || latest.id !== action.turnId || branch.turns.length - 1 < (scene?.turnIndex ?? 0) || (latest.sceneId && latest.sceneId !== scene?.id)) throw new AppError('REPLY_EDIT_NOT_CURRENT', '只能调整当前这一幕中对方的最新回应。原对话已保留。', 409);
        const withoutWhitespace = (text: string) => text.replace(/\s/gu, '');
        if (withoutWhitespace(latest.reply) === withoutWhitespace(action.reply)) throw new AppError('REPLY_UNCHANGED', '回应内容没有变化，可以直接继续对话。', 409);
        if (record.view.branches.length >= 12) throw new AppError('BRANCH_LIMIT', '已保留12次尝试，可以切回已有尝试或开始新练习。', 409);
        const next = clone(branch); const now = new Date().toISOString();
        next.id = randomUUID(); next.parentId = branch.id; next.label = `调整对方回应 ${record.view.branches.length + 1}`;
        next.createdAt = now; next.finished = false; delete next.goalProgress;
        // Keep the player's actual line and the scene, but none of the old
        // model's reflection, attribution or certification applies to this edit.
        next.turns[next.turns.length - 1] = { id: action.actionId, userText: latest.userText, reply: action.reply,
          reflection: '', supportedQuote: '', sourceId: null, createdAt: now,
          ...(latest.sceneId ? { sceneId: latest.sceneId } : {}),
          replyOrigin: { kind: 'user_edit', branchId: branch.id, turnId: latest.id } };
        record.view.branches.push(next); record.view.activeBranchId = next.id; return;
      }
      case 'advance_scene': {
        if (!branch.accepted || branch.finished) throw new AppError('NOT_READY', '请先确认情境设定，或返回上一步继续练习。', 409);
        if ((branch.scenes?.length ?? 0) >= 12) throw new AppError('SCENE_LIMIT', '这次尝试已保留12幕，可以先保存，再开始一条新练习。', 409);
        if (activeCustomScene(branch)?.label === action.label) throw new AppError('SCENE_UNCHANGED', '已经在这一幕中，可以直接继续对话，或修改下一幕的时间与场景。', 409);
        const readiness = customSceneReadiness(branch);
        if (!readiness.ready) throw new AppError('SCENE_NEEDS_DIALOGUE', readiness.reason!, 409);
        if (isGenericCustomSceneLabel(action.label)) throw new AppError('SCENE_DESTINATION_REQUIRED', '请写明要跳到的时间或场景，例如“明天下午，和对方当面核对安排”。想听对方回应，请直接发送你的话。');
        // Only this code-owned template can create a guide. No model method or
        // user-supplied opening is consulted, so a model cannot self-label a bypass.
        const guide = customSceneGuide();
        if (guide.openingKind !== 'guide' || guide.openingLine !== CUSTOM_SCENE_GUIDE) throw new AppError('SCENE_GUIDE_INVALID', '场景提示未通过检查，原记录没有改变。', 500);
        branch.scenes ??= [];
        branch.scenes.push({ id: action.actionId, label: action.label, ...guide, turnIndex: branch.turns.length, createdAt: new Date().toISOString() });
        return;
      }
      case 'accept_setup':
        if (branch.accepted) throw new AppError('SETUP_ACCEPTED', '若要修改设定，请先返回到开场之前。', 409);
        branch.setup = action.setup; branch.accepted = true; branch.finished = false; delete branch.goalProgress; return;
      case 'finish':
        if (!branch.turns.length) throw new AppError('NOT_READY', '先说出想练的第一句话，再保存本次复盘。', 409);
        branch.finished = true; return;
      case 'switch_branch':
        if (!record.view.branches.some(item => item.id === action.branchId)) throw new AppError('NOT_FOUND', '没有找到这个尝试。', 404);
        record.view.activeBranchId = action.branchId; return;
      case 'rewind': {
        if (record.view.branches.length >= 12) throw new AppError('BRANCH_LIMIT', '已保留12次尝试，可以切回已有尝试或开始新练习。', 409);
        const next = clone(branch); next.id = randomUUID(); next.parentId = branch.id; next.label = `第${record.view.branches.length + 1}次尝试`;
        next.createdAt = new Date().toISOString(); next.finished = false;
        if (activeCustomScene(next)?.turnIndex === next.turns.length) next.scenes!.pop();
        else if (next.turns.length) { next.turns.pop(); next.goalProgress = clone(next.turns.at(-1)?.goalProgress); } else { next.accepted = false; delete next.goalProgress; }
        record.view.branches.push(next); record.view.activeBranchId = next.id; return;
      }
    }
  }
  private async modelAction<T>(owner: string, id: string, actionId: string, digest: string, version: number, work: () => Promise<T>, apply: (record: CustomRecord, result: T) => void): Promise<CustomPracticeView> {
    const attempt = randomUUID();
    const claim = await this.store.update(owner, id, record => {
      const prior = record.actions[actionId];
      if (prior) {
        if (prior.hash !== digest) throw new AppError('ACTION_CONFLICT', '同一个操作编号不能发送不同内容。', 409);
        if (prior.status === 'done' || (prior.status === 'processing' && prior.until > Date.now())) return { run: false, view: clone(record.view) };
      }
      this.checkWritable(record, version); const until = Date.now() + ACTION_LEASE_MS;
      record.actions[actionId] = { hash: digest, status: 'processing', attempt, until };
      record.view.pendingAction = { actionId, until }; record.view.generating = true;
      return { run: true, view: clone(record.view) };
    });
    if (!claim.run) return claim.view;
    let acquired = false;
    try {
      acquired = !this.slots || await this.slots.acquireModel(attempt, Date.now());
      if (!acquired) throw new AppError('MODEL_BUSY', '现在同时练习的人较多，请稍后重试；原话还在。', 503);
      const output = await work();
      return await this.store.update(owner, id, record => {
        const action = record.actions[actionId];
        if (action?.attempt !== attempt || action.status !== 'processing' || action.until <= Date.now()) throw new AppError('ACTION_EXPIRED', '这次生成已超时，没有覆盖记录。请查看最新结果后重试。', 409);
        if (record.view.version !== version) throw new AppError('VERSION_CONFLICT', '练习已有更新，这次回应没有覆盖它。', 409);
        apply(record, output); this.updated(record); action.status = 'done'; return clone(record.view);
      });
    } catch (error) {
      await this.store.update(owner, id, record => {
        const action = record.actions[actionId];
        if (action?.attempt === attempt && action.status === 'processing') {
          action.status = 'failed'; if (record.view.pendingAction?.actionId === actionId) { record.view.pendingAction = null; record.view.generating = false; }
        }
      }).catch(() => undefined);
      throw error;
    } finally { if (acquired && this.slots) await this.slots.releaseModel(attempt).catch(() => undefined); }
  }
}

export function customService() { return new CustomPracticeService(getCustomStore(), liveCustomModel, getStore(), modelConfiguration('custom').configured); }
