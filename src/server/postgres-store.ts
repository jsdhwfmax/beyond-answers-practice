import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, lte, sql } from 'drizzle-orm';
import { AppError } from './errors';
import { ACTION_LEASE_MS } from './config';
import type { SessionRecord, Store } from './records';
import { sessions } from './schema';
import { assertNotExpired } from './retention';

let singleton: PostgresStore | undefined;
let applicationPool: Pool | undefined;
export async function closePostgresStore() { const pool = applicationPool; singleton = undefined; applicationPool = undefined; if (pool) await pool.end(); }
export function applicationDatabasePool() {
  if (!applicationPool) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, min: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 8000, query_timeout: 5000 });
    applicationPool = pool;
    // Handle idle-client errors without leaking connection strings into logs.
    pool.on('error', () => { console.error('Database pool connection interrupted.'); });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return applicationPool;
}
export function postgresStore() {
  if (!singleton) singleton = new PostgresStore(drizzle(applicationDatabasePool()));
  return singleton;
}

export class PostgresStore implements Store {
  readonly mode = 'postgres' as const;
  constructor(private db: NodePgDatabase) {}
  async create(record: SessionRecord) {
    assertNotExpired(record);
    await this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(704931)`);
      if (record.view.parentId) {
        const parent = await tx.select({ record: sessions.record }).from(sessions).where(and(eq(sessions.id, record.view.parentId), eq(sessions.owner, record.owner))).limit(1);
        if (!parent[0]) throw new AppError('NOT_FOUND', '原练习已删除，不能再建立分支。', 404);
        assertNotExpired(parent[0].record);
      }
      await tx.insert(sessions).values({ id: record.view.id, owner: record.owner, version: record.view.version, parentId: record.view.parentId, expiresAt: new Date(record.expiresAt), record });
    });
  }
  async read(owner: string, id: string) {
    const rows = await this.db.select({ record: sessions.record }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.owner, owner))).limit(1);
    if (!rows[0]) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
    assertNotExpired(rows[0].record); return rows[0].record;
  }
  async update<T>(owner: string, id: string, mutation: (record: SessionRecord) => T): Promise<T> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      const result = await tx.execute(sql`SELECT record FROM practice_sessions WHERE id = ${id}::uuid AND owner_hash = ${owner} FOR UPDATE`);
      if (!result.rows[0]) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
      const record = result.rows[0].record as SessionRecord;
      assertNotExpired(record);
      const output = mutation(record);
      if (output instanceof Promise) throw new Error('Storage mutations must be synchronous');
      await tx.update(sessions).set({ record, version: record.view.version, expiresAt: new Date(record.expiresAt), updatedAt: new Date(record.view.updatedAt) }).where(eq(sessions.id, id));
      return output;
    }, { isolationLevel: 'read committed' });
  }
  async remove(owner: string, id: string) {
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(704931)`);
      const descendants = await tx.execute(sql`WITH RECURSIVE owned AS (SELECT id FROM practice_sessions WHERE id = ${id}::uuid AND owner_hash = ${owner} UNION ALL SELECT child.id FROM practice_sessions child JOIN owned parent ON child.parent_id = parent.id) SELECT id FROM owned`);
      if (!descendants.rows.length) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
      await tx.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.owner, owner)));
      return descendants.rows.map(row => row.id as string);
    });
  }
  async acquireModel(token: string, now: number) {
    const result = await this.db.execute(sql`
      UPDATE practice_model_leases SET token = ${token}::uuid, expires_at = ${new Date(now + ACTION_LEASE_MS)}
      WHERE slot = (SELECT slot FROM practice_model_leases WHERE expires_at IS NULL OR expires_at <= ${new Date(now)} ORDER BY slot FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING slot`);
    return result.rows.length === 1;
  }
  async releaseModel(token: string) {
    await this.db.execute(sql`UPDATE practice_model_leases SET token = NULL, expires_at = NULL WHERE token = ${token}::uuid`);
  }
  async cleanup(now: number) {
    return this.db.transaction(async tx => { await tx.execute(sql`SET LOCAL lock_timeout = '1s'`); await tx.execute(sql`SELECT pg_advisory_xact_lock(704931)`); const removed = await tx.delete(sessions).where(lte(sessions.expiresAt, new Date(now))).returning({ id: sessions.id }); return removed.length; });
  }
}
