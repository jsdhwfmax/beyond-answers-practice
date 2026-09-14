import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AppError } from './errors';
import { configuration } from './config';
import type { CustomRecord, CustomStore } from './custom-records';
import { applicationDatabasePool } from './postgres-store';

function own(record: CustomRecord, owner: string, includeExpired = false) {
  if (record.owner !== owner || (!includeExpired && new Date(record.view.expiresAt).getTime() <= Date.now())) throw new AppError('NOT_FOUND', '没有找到这条练习记录，或记录已过期。', 404);
}

// The same atomic write and interprocess file-lock strategy as LocalStore.
// Model requests happen outside update callbacks; callbacks must be synchronous.
export class LocalCustomStore implements CustomStore {
  constructor(private directory = path.join(process.cwd(), '.local', 'custom-practices')) {}
  private filename(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
    return path.join(this.directory, `${id}.json`);
  }
  private async lock<T>(id: string, work: () => Promise<T>) {
    await mkdir(this.directory, { recursive: true });
    const filename = this.filename(id) + '.lock'; const started = Date.now();
    for (;;) {
      try { const file = await open(filename, 'wx', 0o600); try { await file.writeFile(JSON.stringify({ pid: process.pid })); } finally { await file.close(); } break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // On Windows a concurrently unlinked lock can remain delete-pending
        // briefly; a fresh exclusive open reports EPERM instead of EEXIST.
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
          if (Date.now() - started > 8000) throw new AppError('STORAGE_BUSY', '记录暂时无法保存，请稍后重试。', 503);
          await new Promise(resolve => setTimeout(resolve, 25)); continue;
        }
        if (code !== 'EEXIST') throw error;
        try {
          const info = JSON.parse(await readFile(filename, 'utf8')) as { pid: number }; let alive = true;
          try { process.kill(info.pid, 0); } catch (cause) { alive = (cause as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (!alive) { await rm(filename, { force: true }); continue; }
        } catch { const info = await stat(filename).catch(() => null); if (info && Date.now() - info.mtimeMs > 30_000) { await rm(filename, { force: true }); continue; } }
        if (Date.now() - started > 8000) throw new AppError('STORAGE_BUSY', '练习正在保存，请稍后重试。', 503);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await work(); } finally { await rm(filename, { force: true }); }
  }
  private async load(id: string): Promise<CustomRecord> {
    try { return JSON.parse(await readFile(this.filename(id), 'utf8')) as CustomRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404); throw error; }
  }
  private async write(record: CustomRecord) {
    const filename = this.filename(record.view.id); const temporary = `${filename}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
    try { await rename(temporary, filename); } finally { await rm(temporary, { force: true }); }
  }
  async create(record: CustomRecord) {
    await this.lock(record.view.id, async () => {
      if (await stat(this.filename(record.view.id)).catch(() => null)) throw new AppError('SESSION_EXISTS', '这条练习已经建立。', 409);
      await this.write(record);
    });
  }
  async read(owner: string, id: string) { const record = await this.load(id); own(record, owner); return record; }
  async list(owner: string) {
    await mkdir(this.directory, { recursive: true }); const result: CustomRecord[] = [];
    for (const filename of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/i.test(filename)) {
      const record = await this.load(filename.slice(0, -5)).catch(() => null);
      if (record?.owner === owner && new Date(record.view.expiresAt).getTime() > Date.now()) result.push(record);
    }
    return result.sort((a, b) => b.view.updatedAt.localeCompare(a.view.updatedAt)).slice(0, 40);
  }
  async update<T>(owner: string, id: string, mutation: (record: CustomRecord) => T) {
    return this.lock(id, async () => {
      const record = await this.load(id); own(record, owner); const result = mutation(record);
      if (result instanceof Promise) throw new Error('Storage mutations must be synchronous');
      await this.write(record); return result;
    });
  }
  async remove(owner: string, id: string) { await this.lock(id, async () => { const record = await this.load(id); own(record, owner, true); await rm(this.filename(id)); }); }
  async cleanup(now: number) {
    await mkdir(this.directory, { recursive: true }); let deleted = 0;
    for (const filename of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/i.test(filename)) {
      const id = filename.slice(0, -5);
      await this.lock(id, async () => { const record = await this.load(id).catch(() => null); if (record && new Date(record.view.expiresAt).getTime() <= now) { await rm(this.filename(id)); deleted++; } });
    }
    return deleted;
  }
}

export class PostgresCustomStore implements CustomStore {
  constructor(private pool: Pool) {}
  async create(record: CustomRecord) {
    const result = await this.pool.query('INSERT INTO custom_practices (id, owner_hash, expires_at, record) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id', [record.view.id, record.owner, record.view.expiresAt, record]);
    if (!result.rowCount) throw new AppError('SESSION_EXISTS', '这条练习已经建立。', 409);
  }
  async read(owner: string, id: string) {
    const { rows } = await this.pool.query<{ record: CustomRecord }>('SELECT record FROM custom_practices WHERE id = $1 AND owner_hash = $2 AND expires_at > now()', [id, owner]);
    if (!rows[0]) throw new AppError('NOT_FOUND', '没有找到这条练习记录，或记录已过期。', 404); return rows[0].record;
  }
  async list(owner: string) {
    const { rows } = await this.pool.query<{ record: CustomRecord }>('SELECT record FROM custom_practices WHERE owner_hash = $1 AND expires_at > now() ORDER BY updated_at DESC LIMIT 40', [owner]);
    return rows.map(row => row.record);
  }
  async update<T>(owner: string, id: string, mutation: (record: CustomRecord) => T) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout = '5s'"); await client.query("SET LOCAL lock_timeout = '1s'");
      const { rows } = await client.query<{ record: CustomRecord }>('SELECT record FROM custom_practices WHERE id = $1 AND owner_hash = $2 AND expires_at > now() FOR UPDATE', [id, owner]);
      if (!rows[0]) throw new AppError('NOT_FOUND', '没有找到这条练习记录，或记录已过期。', 404);
      const record = rows[0].record; const result = mutation(record);
      if (result instanceof Promise) throw new Error('Storage mutations must be synchronous');
      await client.query('UPDATE custom_practices SET record = $1, updated_at = $2 WHERE id = $3 AND owner_hash = $4', [record, record.view.updatedAt, id, owner]);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async remove(owner: string, id: string) {
    const result = await this.pool.query('DELETE FROM custom_practices WHERE id = $1 AND owner_hash = $2', [id, owner]);
    if (!result.rowCount) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
  }
  async cleanup(now: number) { const result = await this.pool.query('DELETE FROM custom_practices WHERE expires_at <= $1', [new Date(now)]); return result.rowCount ?? 0; }
}

let customStore: CustomStore | undefined; let storageMode: string | undefined;
export async function closeCustomStore() { customStore = undefined; storageMode = undefined; }
export function getCustomStore(): CustomStore {
  const { storage } = configuration();
  if (storage === 'unavailable') throw new AppError('DATABASE_NOT_CONFIGURED', '生产环境尚未配置持久数据库。', 503);
  if (!customStore || storageMode !== storage) {
    storageMode = storage;
    if (storage === 'local') customStore = new LocalCustomStore();
    else customStore = new PostgresCustomStore(applicationDatabasePool());
  }
  return customStore;
}
