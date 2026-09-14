import { createHash, randomUUID } from 'node:crypto';
import { activeCustomBranch } from '@/domain/custom-practice';
import type { ReplyOptionsView } from '@/domain/reply-options';
import type { Store } from './records';
import type { CustomStore } from './custom-records';
import { getStore } from './store';
import { getCustomStore } from './custom-store';
import { AppError } from './errors';
import { modelConfiguration } from './model-provider';
import { fallbackReplyTexts, liveReplyOptionsModel, type ReplyContext, type ReplyOptionsModel } from './reply-options-model';
import { MemoryReplyCache, PostgresReplyCache, type ReplyCache } from './reply-options-cache';

interface Snapshot { base: ReplyOptionsView; context: ReplyContext | null }
const OPTIONS_MODEL_BUDGET_MS = 22_000;
export function replyOptionsVersion(request: Request) {
  const value = new URL(request.url).searchParams.get('expectedVersion');
  if (!value || !/^(0|[1-9]\d{0,8})$/.test(value)) throw new AppError('VERSION_REQUIRED', '请先载入当前练习，再查看回答选项。');
  return Number(value);
}
const notices: Record<string, string> = {
  AI_TIMEOUT: '这次模型等待超时，先提供按当前情境准备的备用选项。',
  AI_NOT_CONFIGURED: '模型尚未连接，先提供按当前情境准备的备用选项。',
  AI_BUSY: '模型正在处理其他练习，先提供按当前情境准备的备用选项。',
  OPTIONS_INVALID: '这次模型选项未通过检查，先提供按当前情境准备的备用选项。',
  OPTIONS_IN_PROGRESS: '另一页面正在准备本轮选项，先提供按当前情境准备的备用选项。',
};

export class ReplyOptionsService {
  private pending = new Map<string, Promise<ReplyOptionsView>>();
  constructor(private fixed: Store, private custom: CustomStore, private cache: ReplyCache, private model: ReplyOptionsModel = liveReplyOptionsModel, private now: () => number = Date.now, private configured: boolean | ((kind: 'fixed' | 'custom') => boolean) = true) {}
  async forget(kind: 'fixed' | 'custom', sessionIds: string[]) { await this.cache.forget?.(kind, sessionIds); }
  private async snapshot(owner: string, id: string, version: number, kind: 'fixed' | 'custom'): Promise<Snapshot> {
    let context: ReplyContext | null; let customBranchId: string | undefined;
    let status: ReplyOptionsView['status'] = 'ready'; let assistance: ReplyOptionsView['assistance'] = 'none';
    if (kind === 'fixed') {
      const record = await this.fixed.read(owner, id);
      if (record.view.version !== version) throw new AppError('VERSION_CONFLICT', '对话已更新，请查看当前回合的回答选项。', 409);
      if (Object.values(record.actions).some(action => action.status === 'interpreting' && action.leaseUntil > this.now())) throw new AppError('ACTION_IN_PROGRESS', '这一轮仍在保存，请等回应完整出现后再查看选项。', 409);
      const state = record.view.state;
      if (state.phase === 'ended') status = 'ended';
      if (state.scenario === 'transfer') {
        assistance = state.transfer.hintUsed ? 'recorded' : 'none';
        if (status !== 'ended' && !state.transfer.hintUsed) { status = 'assistance_required'; assistance = 'requires_record'; }
      }
      context = { kind: 'fixed', state: structuredClone(state), events: structuredClone(record.view.events.slice(-16)) };
    } else {
      const record = await this.custom.read(owner, id);
      if (record.view.version !== version) throw new AppError('VERSION_CONFLICT', '对话已更新，请查看当前回合的回答选项。', 409);
      if (record.view.pendingAction && record.view.pendingAction.until > this.now()) throw new AppError('ACTION_IN_PROGRESS', '对方还在回应，请等这一轮完成后查看选项。', 409);
      const branch = activeCustomBranch(record.view); customBranchId = branch?.id;
      if (!branch?.accepted) status = 'not_ready'; else if (branch.finished || branch.turns.length >= 20) status = 'ended';
      context = branch ? { kind: 'custom', branch: structuredClone(branch) } : null;
    }
    return { base: { sessionId: id, version, ...(customBranchId ? { customBranchId } : {}), status, options: [], source: 'fallback', generatedAt: null, notice: status === 'assistance_required' ? '查看选项会记录为提示辅助；也可以直接写下自己的计划。' : status === 'ended' ? '这段练习已经结束，不再准备新的回答。' : status === 'not_ready' ? '先确认这段模拟的设定，再查看回答选项。' : '', assistance }, context };
  }
  private fallback(snapshot: Snapshot, code: string): ReplyOptionsView {
    const texts = fallbackReplyTexts(snapshot.context!);
    return { ...snapshot.base, source: 'fallback', generatedAt: new Date(this.now()).toISOString(), options: texts.map((text, index) => ({ id: `option-${index + 1}`, text })), notice: `${notices[code] ?? '这次没有取得可用的模型选项，先提供按当前情境准备的备用选项。'}选中后可以修改，再由你决定是否发送。` };
  }
  async get(owner: string, id: string, version: number, kind: 'fixed' | 'custom'): Promise<ReplyOptionsView> {
    // Ownership and current version are checked on every call, including cached reads.
    const snapshot = await this.snapshot(owner, id, version, kind);
    if (snapshot.base.status !== 'ready') return snapshot.base;
    const key = createHash('sha256').update(JSON.stringify([kind === 'custom' ? 'reply-options-custom-v12' : 'reply-options-v9', owner, kind, id, version, snapshot.base.customBranchId])).digest('hex');
    const pending = this.pending.get(key);
    if (pending) { const result = await pending; await this.snapshot(owner, id, version, kind); return structuredClone(result); }
    const work = this.prepare(key, owner, id, version, kind, snapshot);
    this.pending.set(key, work);
    try { return await work; } finally { if (this.pending.get(key) === work) this.pending.delete(key); }
  }
  private async prepare(key: string, owner: string, id: string, version: number, kind: 'fixed' | 'custom', snapshot: Snapshot): Promise<ReplyOptionsView> {
    const cached = await this.cache.read(key, this.now());
    if (cached?.value && cached.expiresAt > this.now()) { await this.snapshot(owner, id, version, kind); return structuredClone(cached.value); }
    const token = randomUUID();
    if (!await this.cache.claim({ key, kind, sessionId: id }, this.now(), token)) {
      const current = await this.cache.read(key, this.now()); await this.snapshot(owner, id, version, kind);
      return current?.value ?? this.fallback(snapshot, 'OPTIONS_IN_PROGRESS');
    }
    let acquired = false; let output: ReplyOptionsView;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!(typeof this.configured === 'function' ? this.configured(kind) : this.configured)) throw new AppError('AI_NOT_CONFIGURED', '模型尚未连接。', 503);
      acquired = await this.fixed.acquireModel(token, this.now());
      if (!acquired) throw new AppError('AI_BUSY', '模型正在处理其他练习。', 429);
      const generated = await Promise.race([
        this.model(snapshot.context!, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AppError('AI_TIMEOUT', '选项等待超时。', 503)); }, OPTIONS_MODEL_BUDGET_MS); }),
      ]);
      output = { ...snapshot.base, options: generated.texts.map((text, index) => ({ id: `option-${index + 1}`, text })), source: 'model', model: generated.model, provider: generated.provider, generatedAt: new Date(this.now()).toISOString(), notice: '模型根据当前对话准备了不同说法。选中后可以修改，不代表唯一正确做法。' };
    } catch (error) { output = this.fallback(snapshot, error instanceof AppError ? error.code : 'OPTIONS_UNAVAILABLE'); }
    finally { if (timer) clearTimeout(timer); if (acquired) await this.fixed.releaseModel(token).catch(() => undefined); }
    const current = await this.snapshot(owner, id, version, kind);
    if (current.base.status !== 'ready' || current.base.customBranchId !== snapshot.base.customBranchId) throw new AppError('VERSION_CONFLICT', '练习已进入新状态，这份旧选项没有显示。', 409);
    if (!await this.cache.finish(key, this.now(), token, output)) throw new AppError('OPTIONS_EXPIRED', '本轮选项请求已过期，请重新载入当前对话。', 409);
    return output;
  }
}
const shared = globalThis as typeof globalThis & { replyOptionsServiceV11?: ReplyOptionsService; replyOptionsServiceV10?: unknown; replyOptionsServiceV9?: unknown; replyOptionsServiceV8?: unknown; replyOptionsServiceV7?: unknown; replyOptionsServiceV6?: unknown; replyOptionsServiceV1?: unknown; replyOptionsServiceV2?: unknown; replyOptionsServiceV3?: unknown; replyOptionsServiceV4?: unknown; replyOptionsServiceV5?: unknown };
// Invalidate old prompt/cache generations on development hot reload as well as deployment.
delete shared.replyOptionsServiceV1; delete shared.replyOptionsServiceV2; delete shared.replyOptionsServiceV3; delete shared.replyOptionsServiceV4; delete shared.replyOptionsServiceV5; delete shared.replyOptionsServiceV6; delete shared.replyOptionsServiceV7; delete shared.replyOptionsServiceV8; delete shared.replyOptionsServiceV9; delete shared.replyOptionsServiceV10;
export function replyOptionsService() {
  return shared.replyOptionsServiceV11 ??= new ReplyOptionsService(getStore(), getCustomStore(), process.env.DATABASE_URL ? new PostgresReplyCache() : new MemoryReplyCache(), liveReplyOptionsModel, Date.now, kind => modelConfiguration(kind === 'custom' ? 'custom' : undefined).configured);
}
export async function forgetReplyOptions(kind: 'fixed' | 'custom', sessionIds: string[]) {
  await shared.replyOptionsServiceV11?.forget(kind, sessionIds);
}
