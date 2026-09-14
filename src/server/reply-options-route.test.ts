import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./reply-options', async () => {
  const actual = await vi.importActual<typeof import('./reply-options')>('./reply-options');
  return { ...actual, replyOptionsService: () => ({ get: mocks.get }) };
});
import { GET as FIXED } from '@/app/api/sessions/[id]/reply-options/route';
import { GET as CUSTOM } from '@/app/api/custom-practices/[id]/reply-options/route';
const id = 'fd7e126b-34d4-4a6b-b98c-583a7de0e73c'; const token = 'a'.repeat(43);
const context = { params: Promise.resolve({ id }) };
beforeEach(() => mocks.get.mockReset().mockResolvedValue({ sessionId: id, version: 2, options: [], source: 'fallback', status: 'not_ready', assistance: 'none', generatedAt: null, notice: '' }));
test('both read endpoints require a valid visitor cookie and explicit version', async () => {
  expect((await FIXED(new Request(`https://practice.test/api/sessions/${id}/reply-options?expectedVersion=2`), context)).status).toBe(404); expect(mocks.get).not.toHaveBeenCalled();
  const request = new Request(`https://practice.test/api/sessions/${id}/reply-options`, { headers: { cookie: `practice_guest=${token}` } });
  expect((await FIXED(request, context)).status).toBe(400); expect(mocks.get).not.toHaveBeenCalled();
});
test('routes pass the hashed visitor identity and never emit shared browser cache headers', async () => {
  const request = new Request(`https://practice.test/api/sessions/${id}/reply-options?expectedVersion=2`, { headers: { cookie: `practice_guest=${token}` } });
  const fixed = await FIXED(request, context); expect(fixed.status).toBe(200); expect(fixed.headers.get('cache-control')).toBe('no-store, private');
  expect(mocks.get).toHaveBeenLastCalledWith(createHash('sha256').update(token).digest('hex'), id, 2, 'fixed');
  await CUSTOM(request, context); expect(mocks.get).toHaveBeenLastCalledWith(createHash('sha256').update(token).digest('hex'), id, 2, 'custom');
});
test('production cache migration has cascading references for both session types and short-lived rows', async () => {
  const migration = await readFile('drizzle/0003_reply_options_cache.sql', 'utf8');
  expect(migration).toContain('REFERENCES "practice_sessions"("id") ON DELETE CASCADE'); expect(migration).toContain('REFERENCES "custom_practices"("id") ON DELETE CASCADE'); expect(migration).toContain('"expires_at" timestamp with time zone NOT NULL');
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')); expect(journal.entries.at(-1).tag).toBe('0003_reply_options_cache');
});
