import { modelConfiguration } from './model-provider';
import { version } from '../../package.json';

export type StorageMode = 'postgres' | 'local' | 'unavailable';

export function configuration() {
  const database = Boolean(process.env.DATABASE_URL?.trim());
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const bailian = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  const deepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const model = modelConfiguration();
  const custom = modelConfiguration('custom');
  const storage: StorageMode = database ? 'postgres' : process.env.NODE_ENV === 'production' ? 'unavailable' : 'local';
  return { ok: storage !== 'unavailable', version, storage, naturalLanguage: model.configured && storage !== 'unavailable', model: { provider: model.provider, name: model.model }, customModel: { provider: custom.provider, name: custom.model, configured: custom.configured }, configured: { database, openai, bailian, deepseek, model: model.configured } };
}

export const ACTION_LEASE_MS = 65_000;
export const MAX_MODEL_CONCURRENCY = 4;
export const MAX_ACTIONS = 120;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
