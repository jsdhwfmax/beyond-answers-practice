import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CampusTopicsFeed } from '@/domain/campus-topics';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./campus-topics-cache', () => ({ campusTopicsService: () => ({ get: mocks.get }) }));
import { GET, POST } from '@/app/api/campus-topics/route';
import { GET as CRON } from '@/app/api/maintenance/campus-topics/route';
const feed: CampusTopicsFeed = { items: [], fetchedAt: '2026-09-13T08:00:00Z', checkedAt: '2026-09-13T08:01:00Z', lastAttemptAt: '2026-09-13T08:00:00Z', nextAutoRefreshAt: '2026-09-13T09:00:00Z', nextManualRefreshAt: '2026-09-13T08:30:00Z', status: 'empty', refreshResult: 'cached', error: null, hotCount: 0, relatedCount: 0 };
beforeEach(() => { mocks.get.mockReset().mockResolvedValue(feed); });
afterEach(() => vi.unstubAllEnvs());
test('public GET returns real cache timestamps without an anonymous login or forced refresh', async () => {
  const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual(feed); expect(mocks.get).toHaveBeenCalledWith(); expect(response.headers.get('set-cookie')).toBeNull();
});
test('manual refresh rejects foreign origins and only accepted POST requests force refresh', async () => {
  expect((await POST(new Request('https://practice.test/api/campus-topics', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status).toBe(403);
  expect(mocks.get).not.toHaveBeenCalled();
  expect((await POST(new Request('https://practice.test/api/campus-topics', { method: 'POST', headers: { origin: 'https://practice.test' } }))).status).toBe(200);
  expect(mocks.get).toHaveBeenCalledWith(true);
});
test('failed first load remains unavailable instead of a successful fabricated empty feed', async () => {
  mocks.get.mockResolvedValue({ ...feed, fetchedAt: null, status: 'unavailable' }); expect((await GET()).status).toBe(503);
});
test('hourly platform cron is configured and requires the exact service secret', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')); expect(config.crons).toContainEqual({ path: '/api/maintenance/campus-topics', schedule: '23 * * * *' });
  vi.stubEnv('CRON_SECRET', 'synthetic-only');
  expect((await CRON(new Request('https://practice.test/api/maintenance/campus-topics'))).status).toBe(401); expect(mocks.get).not.toHaveBeenCalled();
  expect((await CRON(new Request('https://practice.test/api/maintenance/campus-topics', { headers: { authorization: 'Bearer synthetic-only' } }))).status).toBe(200); expect(mocks.get).toHaveBeenCalledWith(true);
});
