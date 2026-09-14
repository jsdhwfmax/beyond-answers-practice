import { createHash, randomUUID } from 'node:crypto';
import { practiceIntakeRequestSchema, type PracticeIntakeView } from '@/domain/practice-intake';
import { AppError } from './errors';
import { modelConfiguration } from './model-provider';
import { getStore } from './store';
import { checkedPracticeIntake, livePracticeIntakeModel, type PracticeIntakeModel } from './practice-intake-model';

type ModelSlots = { acquireModel(token: string, now: number): Promise<boolean>; releaseModel(token: string): Promise<void> };
interface CachedIntake { digest: string; expiresAt: number; promise: Promise<PracticeIntakeView> }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const CACHE_MS = 5 * 60_000;
const INTAKE_BUDGET_MS = 22_000;

/** Bounded ephemeral guidance cache; no session, turn, branch or report is written. */
export class PracticeIntakeService {
  private cache = new Map<string, CachedIntake>();
  constructor(private slots: ModelSlots, private model: PracticeIntakeModel = livePracticeIntakeModel, private configured = true, private now: () => number = Date.now) {}
  async assess(owner: string, input: unknown): Promise<PracticeIntakeView> {
    const parsed = practiceIntakeRequestSchema.safeParse(input);
    if (!parsed.success) throw new AppError('INTAKE_INPUT_REQUIRED', '先写一点你在意的事，2000字以内就好；也可以从示例开始。');
    const request = parsed.data;
    const now = this.now();
    for (const [key, item] of this.cache) if (item.expiresAt <= now) this.cache.delete(key);
    const key = digest(`${owner}:${request.requestId}`); const inputHash = digest(request.text);
    const previous = this.cache.get(key);
    if (previous) {
      if (previous.digest !== inputHash) throw new AppError('INTAKE_REQUEST_CONFLICT', '原话已经修改，请重新整理这次练习方向。', 409);
      return structuredClone(await previous.promise);
    }
    if (!this.configured) throw new AppError('AI_NOT_CONFIGURED', '练习引导暂未连接模型，可以先看看首页示例，原话会保留。', 503);
    if (this.cache.size >= 128) throw new AppError('AI_BUSY', '这会儿正在整理较多练习方向，请保留原话，稍后再试。', 429);
    const promise = this.prepare(request);
    const entry = { digest: inputHash, expiresAt: now + CACHE_MS, promise }; this.cache.set(key, entry);
    try { return structuredClone(await promise); }
    catch (error) { if (this.cache.get(key) === entry) this.cache.delete(key); throw error; }
  }
  private async prepare(request: { requestId: string; text: string }): Promise<PracticeIntakeView> {
    const token = randomUUID(); let acquired = false;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      acquired = await this.slots.acquireModel(token, this.now());
      if (!acquired) throw new AppError('AI_BUSY', '这会儿正在整理其他练习方向，请保留原话，稍后再试。', 429);
      const result = await Promise.race([
        this.model(request.text, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AppError('AI_TIMEOUT', '这次整理稍慢，原话保留着，可以稍后重试。', 503)); }, INTAKE_BUDGET_MS); }),
      ]);
      return checkedPracticeIntake(request, result.candidate, result.generatedBy);
    } catch (error) {
      if (error instanceof AppError && (error.code.startsWith('INTAKE_') || error.code === 'AI_BUSY')) throw error;
      throw new AppError(error instanceof AppError ? error.code : 'INTAKE_UNAVAILABLE', '这次还没整理完练习方向，原话保留着，可以稍后重试或先看看示例。', error instanceof AppError ? error.status : 503);
    } finally {
      if (timer) clearTimeout(timer);
      if (acquired) await this.slots.releaseModel(token).catch(() => undefined);
    }
  }
}
const shared = globalThis as typeof globalThis & { practiceIntakeServiceV1?: PracticeIntakeService };
export function practiceIntakeService() {
  return shared.practiceIntakeServiceV1 ??= new PracticeIntakeService(getStore(), livePracticeIntakeModel, modelConfiguration('custom').configured);
}
