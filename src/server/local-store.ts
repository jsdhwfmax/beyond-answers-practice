import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';
import { ACTION_LEASE_MS, MAX_MODEL_CONCURRENCY } from './config';
import type { ModelSlot, SessionRecord, Store } from './records';
import { assertNotExpired, expiry } from './retention';

const validId = /^[a-f0-9-]{36}$/i;
export class LocalStore implements Store {
  readonly mode = 'local' as const;
  constructor(private directory = path.join(process.cwd(), '.local', 'app-data')) {}
  private file(id: string) {
    if (!validId.test(id)) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
    return path.join(this.directory, `${id}.json`);
  }
  private async lock<T>(name: string, work: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = path.join(this.directory, `${name}.lock`);
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        await handle.close();
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // A concurrently removed lock can remain delete-pending on Windows.
        // Match LocalCustomStore's bounded retry while exclusive open is denied.
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
          if (Date.now() - started > 8000) throw new AppError('STORAGE_BUSY', '记录暂时无法保存，请稍后重试。', 503);
          await new Promise(resolve => setTimeout(resolve, 25)); continue;
        }
        if (code !== 'EEXIST') throw error;
        try {
          const info = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number };
          let alive = true;
          try { process.kill(info.pid, 0); } catch (cause) { alive = (cause as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (!alive) { await rm(lockPath, { force: true }); continue; }
        } catch {
          // A just-created lock can be empty; only reclaim an abandoned malformed lock.
          const metadata = await stat(lockPath).catch(() => null);
          if (metadata && Date.now() - metadata.mtimeMs > 30_000) { await rm(lockPath, { force: true }); continue; }
        }
        if (Date.now() - started > 8000) throw new AppError('STORAGE_BUSY', '记录正在保存，请稍后重试。', 503);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await work(); } finally { await rm(lockPath, { force: true }); }
  }
  private async write(filename: string, data: unknown) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, filename); } finally { await rm(temporary, { force: true }); }
  }
  private async load(filename: string): Promise<SessionRecord> {
    try { return JSON.parse(await readFile(filename, 'utf8')) as SessionRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404); throw error; }
  }
  private own(record: SessionRecord, owner: string) {
    if (record.owner !== owner) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
  }
  async create(record: SessionRecord) {
    assertNotExpired(record);
    const filename = this.file(record.view.id);
    await this.lock('session-tree', async () => {
      if (record.view.parentId) { const parent = await this.load(this.file(record.view.parentId)); this.own(parent, record.owner); assertNotExpired(parent); }
      await this.lock(record.view.id, async () => {
        if (await stat(filename).catch(() => null)) throw new AppError('SESSION_EXISTS', '会话编号重复，请重新开始。', 409);
        await this.write(filename, record);
      });
    });
  }
  async read(owner: string, id: string) { const record = await this.load(this.file(id)); this.own(record, owner); assertNotExpired(record); return record; }
  async update<T>(owner: string, id: string, mutation: (record: SessionRecord) => T): Promise<T> {
    const filename = this.file(id);
    return this.lock(id, async () => {
      const record = await this.load(filename); this.own(record, owner); assertNotExpired(record);
      const result = mutation(record);
      if (result instanceof Promise) throw new Error('Storage mutations must be synchronous');
      await this.write(filename, record);
      return result;
    });
  }
  async remove(owner: string, id: string) {
    const filename = this.file(id);
    return this.lock('session-tree', async () => { const record = await this.load(filename); this.own(record, owner); return this.removeTree(new Set([id])); });
  }
  private async removeTree(ids: Set<string>) {
    const records: SessionRecord[] = [];
    for (const filename of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/i.test(filename)) records.push(await this.load(path.join(this.directory, filename)));
    let changed = true;
    while (changed) { changed = false; for (const record of records) if (record.view.parentId && ids.has(record.view.parentId) && !ids.has(record.view.id)) { ids.add(record.view.id); changed = true; } }
    for (const id of ids) await this.lock(id, async () => { await rm(this.file(id), { force: true }); });
    return [...ids];
  }
  async cleanup(now: number) {
    return this.lock('session-tree', async () => {
      const ids = new Set<string>();
      for (const filename of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/i.test(filename)) { const record = await this.load(path.join(this.directory, filename)); if (expiry(record) <= now) ids.add(record.view.id); }
      return (await this.removeTree(ids)).length;
    });
  }
  async acquireModel(token: string, now: number) {
    return this.lock('model-slots', async () => {
      const filename = path.join(this.directory, 'model-slots.json');
      const slots: ModelSlot[] = JSON.parse(await readFile(filename, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return '[]'; throw error; }));
      const active = slots.filter(slot => slot.until > now);
      if (active.length >= MAX_MODEL_CONCURRENCY) return false;
      active.push({ token, until: now + ACTION_LEASE_MS }); await this.write(filename, active); return true;
    });
  }
  async releaseModel(token: string) {
    await this.lock('model-slots', async () => {
      const filename = path.join(this.directory, 'model-slots.json');
      const slots: ModelSlot[] = JSON.parse(await readFile(filename, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return '[]'; throw error; }));
      await this.write(filename, slots.filter(slot => slot.token !== token));
    });
  }
}
