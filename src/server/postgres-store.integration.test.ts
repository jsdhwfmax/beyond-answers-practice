import { expect, test } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from './postgres-store';
import { SessionService } from './sessions';

// Opt in only with an isolated, already migrated test database. This never uses
// DATABASE_URL and never creates a cloud resource or runs a production migration.
test.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL locks, idempotency, ownership and cascading deletion', async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5, connectionTimeoutMillis: 8000 });
  const service = new SessionService(new PostgresStore(drizzle(pool))); const owner = randomUUID(); let id: string | undefined;
  try {
    const session = await service.create(owner, 'campus'); id = session.id;
    const request = { actionId: randomUUID(), expectedVersion: 0, command: { type: 'inspect' as const, materialId: 'members' } };
    await Promise.allSettled(Array.from({ length: 10 }, () => service.act(owner, session.id, request)));
    const saved = await service.get(owner, session.id); expect(saved.version).toBe(1); expect(saved.events.filter(item => item.kind === 'input')).toHaveLength(1);
    await expect(service.get(randomUUID(), session.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const fork = await service.fork(owner, session.id, { expectedVersion: 1, reason: 'retry' });
    await service.remove(owner, session.id); id = undefined;
    await expect(service.get(owner, fork.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  } finally { if (id) await service.remove(owner, id).catch(() => undefined); await pool.end(); }
}, 20_000);
