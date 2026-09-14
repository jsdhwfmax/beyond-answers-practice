import { test, expect, type APIRequestContext } from './fixtures';
import { randomUUID } from 'node:crypto';

async function create(request: APIRequestContext, baseURL: string) {
  const response = await request.post('/api/sessions', { headers: { Origin: baseURL }, data: { scenario: 'campus' } });
  expect(response.status()).toBe(201);
  return (await response.json()).session;
}

test('HTTP 同行动十次并发只保存一次，冲突内容不能复用编号', async ({ request, baseURL }) => {
  const session = await create(request, baseURL!);
  const input = { actionId: randomUUID(), expectedVersion: 0, command: { type: 'inspect', materialId: 'feedback' } };
  const responses = await Promise.all(Array.from({ length: 10 }, () => request.post(`/api/sessions/${session.id}/actions`, { headers: { Origin: baseURL! }, data: input })));
  expect(responses.some(response => response.ok())).toBeTruthy();
  for (const response of responses) expect([200, 409], `Concurrent action returned ${response.status()}: ${response.ok() ? 'ok' : await response.text()}`).toContain(response.status());
  const stored = (await (await request.get(`/api/sessions/${session.id}`)).json()).session;
  expect(stored.version).toBe(1);
  expect(stored.events.filter((event: { kind: string }) => event.kind === 'input')).toHaveLength(1);
  const repeated = await request.post(`/api/sessions/${session.id}/actions`, { headers: { Origin: baseURL! }, data: input });
  expect(repeated.ok()).toBeTruthy();
  expect((await repeated.json()).session.version).toBe(1);
  const changed = await request.post(`/api/sessions/${session.id}/actions`, { headers: { Origin: baseURL! }, data: { ...input, command: { type: 'inspect', materialId: 'members' } } });
  expect(changed.status()).toBe(409);
  expect((await changed.json()).error.code).toBe('ACTION_ID_REUSED');
  const status = await request.get(`/api/sessions/${session.id}/actions/${input.actionId}`);
  expect((await status.json()).action.status).toBe('complete');
});

test('HTTP 不同动作竞争、游客隔离、跨源拒绝与分支删除', async ({ request, playwright, baseURL }) => {
  const session = await create(request, baseURL!);
  const competing = await Promise.all(['feedback', 'members', 'brief'].map(materialId => request.post(`/api/sessions/${session.id}/actions`, { headers: { Origin: baseURL! }, data: { actionId: randomUUID(), expectedVersion: 0, command: { type: 'inspect', materialId } } })));
  expect(competing.filter(response => response.ok())).toHaveLength(1);
  expect(competing.filter(response => response.status() === 409)).toHaveLength(2);
  const unrelated = await playwright.request.newContext({ baseURL });
  try { expect((await unrelated.get(`/api/sessions/${session.id}`)).status()).toBe(404); }
  finally { await unrelated.dispose(); }
  const forbidden = await request.delete(`/api/sessions/${session.id}`, { headers: { Origin: 'https://unrelated.invalid' } });
  expect(forbidden.status()).toBe(403);
  const branch = await request.post(`/api/sessions/${session.id}/forks`, { headers: { Origin: baseURL! }, data: { expectedVersion: 1, reason: 'retry', afterSequence: 0 } });
  expect(branch.status()).toBe(201);
  const child = (await branch.json()).session;
  expect(child.parentId).toBe(session.id);
  expect(child.version).toBe(0);
  const deleted = await request.delete(`/api/sessions/${session.id}`, { headers: { Origin: baseURL! } });
  expect(deleted.ok()).toBeTruthy();
  expect((await request.get(`/api/sessions/${child.id}`)).status()).toBe(404);
});
