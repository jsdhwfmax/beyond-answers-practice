import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';

const mocks = vi.hoisted(() => ({ assess: vi.fn() }));
vi.mock('@/server/practice-intake-service', () => ({ practiceIntakeService: () => ({ assess: mocks.assess }) }));
import { POST } from '@/app/api/practice-intake/route';

beforeEach(() => { vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://practice.test'); mocks.assess.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });
function request(body: unknown, origin = 'https://practice.test') {
  return new Request('http://internal:3000/api/practice-intake', { method: 'POST', headers: { host: 'practice.test', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
test('the new POST enforces the pinned same-origin rule before asking the model', async () => {
  const result = await POST(request({ requestId: randomUUID(), text: '与或非' }, 'https://other.test'));
  expect(result.status).toBe(403); expect(mocks.assess).not.toHaveBeenCalled();
});
test('a knowledge intake returns guidance and guest ownership, never a practice session', async () => {
  const input = { requestId: randomUUID(), text: '与或非' };
  mocks.assess.mockResolvedValue({ version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: 'topic_only', reason: '你想先请教还是练习讲解？', evidenceQuotes: [input.text], questions: ['想先练哪一种？'], suggestions: [], canStartPractice: false });
  const result = await POST(request(input)); const json = await result.json();
  expect(result.status).toBe(200); expect(result.headers.get('set-cookie')).toContain('HttpOnly');
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(mocks.assess).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), input);
  expect(json.intake.originalText).toBe(input.text); expect(json.intake.canStartPractice).toBe(false); expect(json).not.toHaveProperty('session');
});
test('malformed HTTP JSON does not reach the intake service', async () => {
  const req = new Request('http://internal:3000/api/practice-intake', { method: 'POST', headers: { host: 'practice.test', origin: 'https://practice.test', 'content-type': 'application/json' }, body: '{' });
  expect((await POST(req)).status).toBe(400); expect(mocks.assess).not.toHaveBeenCalled();
});
test('busy guidance is a retryable error rather than a fallback ready decision', async () => {
  mocks.assess.mockRejectedValue(new AppError('AI_BUSY', '原话保留着，请稍后再试。', 429));
  const result = await POST(request({ requestId: randomUUID(), text: '迷茫' }));
  expect(result.status).toBe(429); expect(await result.json()).toEqual({ error: { code: 'AI_BUSY', message: '原话保留着，请稍后再试。' } });
});
