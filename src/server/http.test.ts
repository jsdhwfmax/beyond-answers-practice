import { afterEach, describe, expect, test, vi } from 'vitest';
import { checkOrigin, guest, jsonBody, response } from './http';
import { configuration } from './config';
import { getStore } from './store';
afterEach(() => vi.unstubAllEnvs());
describe('public API boundary', () => {
  test('writes require exact same origin, not a trusted-looking prefix', () => {
    expect(() => checkOrigin(new Request('https://practice.example/api/sessions', { method: 'POST' }))).toThrow();
    expect(() => checkOrigin(new Request('https://practice.example/api/sessions', { method: 'POST', headers: { origin: 'https://practice.example.attacker.test' } }))).toThrow();
    expect(() => checkOrigin(new Request('https://practice.example/api/sessions', { method: 'POST', headers: { origin: 'https://practice.example' } }))).not.toThrow();
    expect(() => checkOrigin(new Request('http://localhost:3000/api/sessions', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } }))).not.toThrow();
  });
  test('guest identity is random and only its hash identifies stored records', () => {
    const first = guest(new Request('https://practice.example'), true); const second = guest(new Request('https://practice.example'), true);
    expect(first.newToken).not.toBe(second.newToken); expect(first.owner).not.toBe(first.newToken);
    expect(guest(new Request('https://practice.example', { headers: { cookie: `practice_guest=${first.newToken}` } })).owner).toBe(first.owner);
    const cookie = response({}, 200, first.newToken, true).headers.get('set-cookie'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=strict');
  });
  test('HTTPS behind a local reverse proxy uses the configured public origin', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://practice.example');
    const request = (headers: Record<string, string>) => new Request('http://app:3000/api/sessions', { method: 'POST', headers });
    expect(() => checkOrigin(request({ host: 'practice.example', origin: 'https://practice.example' }))).not.toThrow();
    expect(() => checkOrigin(request({ host: 'practice.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))).toThrow();
    expect(() => checkOrigin(request({ host: 'evil.example', origin: 'https://practice.example' }))).toThrow();
    expect(() => checkOrigin(request({ host: 'practice.example', origin: 'https://practice.example', 'sec-fetch-site': 'cross-site' }))).toThrow();
  });
  test.each(['not a URL', 'https://user:password@practice.example', 'https://practice.example/path', 'http://practice.example', 'https://practice.example?redirect=x'])('invalid production public origin fails closed: %s', value => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PUBLIC_APP_ORIGIN', value);
    expect(() => checkOrigin(new Request('http://app:3000/api/sessions', { method: 'POST', headers: { host: 'practice.example', origin: 'https://practice.example' } }))).toThrowError('作品访问地址配置有误');
  });
  test('large JSON is rejected even without content-length', async () => {
    await expect(jsonBody(new Request('https://practice.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '长'.repeat(20_000) }) }))).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
  });
  test('production without database cannot silently use local storage', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('DASHSCOPE_API_KEY', ''); vi.stubEnv('MODEL_PROVIDER', 'bailian');
    expect(configuration()).toMatchObject({ ok: false, storage: 'unavailable', naturalLanguage: false, configured: { database: false, openai: false, bailian: false, model: false } });
    expect(() => getStore()).toThrowError('生产环境尚未配置持久数据库');
  });
});
