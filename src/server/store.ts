import { configuration } from './config';
import { AppError } from './errors';
import { LocalStore } from './local-store';
import { postgresStore } from './postgres-store';
import type { Store } from './records';

let local: LocalStore | undefined;
export function getStore(): Store {
  const { storage } = configuration();
  if (storage === 'unavailable') throw new AppError('DATABASE_NOT_CONFIGURED', '生产环境尚未配置持久数据库，暂时无法开始练习。', 503);
  if (storage === 'postgres') return postgresStore();
  local ??= new LocalStore();
  return local;
}
