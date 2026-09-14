import { describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { checkReadiness, READINESS_SQL, REQUIRED_PRIVILEGES, REQUIRED_TABLES } from '../deploy/readiness.mjs';

const environment = { NODE_ENV: 'production' as const, MODEL_PROVIDER: 'bailian', DASHSCOPE_API_KEY: 'synthetic-never-a-real-key', DATABASE_URL: 'postgresql://synthetic:do-not-log@database:5432/practice', PUBLIC_APP_ORIGIN: 'https://practice.example' };
const ready = { privileges_ok: true, schema_ok: true, database_ok: true, role_ok: true, writable: true };
function fixture() {
  const client = { on: vi.fn(), connect: vi.fn(async () => {}), query: vi.fn(async () => ({ rows: [{ ...ready }] })), end: vi.fn(async () => {}) };
  const createClient = vi.fn(() => client);
  const fetcher = vi.fn(async () => Response.json({ storage: 'postgres', naturalLanguage: true }));
  return { client, createClient, fetcher };
}
describe('private deployment readiness', () => {
  test('a separate custom model needs its own key and a matching running application', async () => {
    const dependencies = fixture();
    const separated = { ...environment, CUSTOM_MODEL_PROVIDER: 'deepseek' };
    expect(await checkReadiness({ ...dependencies, environment: separated })).toEqual({ ok: false, stage: 'configuration' });
    expect(dependencies.fetcher).not.toHaveBeenCalled();
    const keyed = { ...separated, DEEPSEEK_API_KEY: 'synthetic-custom-key' };
    expect(await checkReadiness({ ...dependencies, environment: keyed })).toEqual({ ok: false, stage: 'http' });
    dependencies.fetcher.mockResolvedValue(Response.json({ storage: 'postgres', naturalLanguage: true, customModel: { provider: 'bailian', configured: true } }));
    expect(await checkReadiness({ ...dependencies, environment: keyed })).toEqual({ ok: false, stage: 'http' });
    dependencies.fetcher.mockResolvedValue(Response.json({ storage: 'postgres', naturalLanguage: true, customModel: { provider: 'deepseek', configured: true } }));
    expect(await checkReadiness({ ...dependencies, environment: keyed })).toEqual({ ok: true, stage: 'ready' });
  });
  test('an invalid custom provider never borrows the primary provider credentials', async () => {
    const dependencies = fixture();
    expect(await checkReadiness({ ...dependencies, environment: { ...environment, CUSTOM_MODEL_PROVIDER: 'unknown' } })).toEqual({ ok: false, stage: 'configuration' });
    expect(dependencies.fetcher).not.toHaveBeenCalled();
  });
  test.each([
    { DATABASE_URL: '' }, { DASHSCOPE_API_KEY: ' ' }, { MODEL_PROVIDER: 'unknown' }, { PUBLIC_APP_ORIGIN: 'http://practice.example' },
  ])('missing required configuration fails before any network request: %s', async overrides => {
    const dependencies = fixture();
    expect(await checkReadiness({ ...dependencies, environment: { ...environment, ...overrides } })).toEqual({ ok: false, stage: 'configuration' });
    expect(dependencies.fetcher).not.toHaveBeenCalled(); expect(dependencies.createClient).not.toHaveBeenCalled();
  });
  test('an optional OpenAI provider requires its own configured key and does not call it', async () => {
    const dependencies = fixture();
    expect(await checkReadiness({ ...dependencies, environment: { ...environment, MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'synthetic-key' } })).toEqual({ ok: true, stage: 'ready' });
    expect(dependencies.fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3000/api/health', expect.any(Object));
  });
  test('an HTTP 200 local store is not production readiness', async () => {
    const dependencies = fixture(); dependencies.fetcher.mockResolvedValue(Response.json({ storage: 'local', naturalLanguage: true }));
    expect(await checkReadiness({ ...dependencies, environment })).toEqual({ ok: false, stage: 'http' }); expect(dependencies.createClient).not.toHaveBeenCalled();
  });
  test('HTTP failure and invalid response cannot proceed to a database check', async () => {
    const dependencies = fixture(); dependencies.fetcher.mockRejectedValue(new Error('connection failed'));
    expect(await checkReadiness({ ...dependencies, environment })).toEqual({ ok: false, stage: 'http' }); expect(dependencies.createClient).not.toHaveBeenCalled();
  });
  test.each(['privileges_ok', 'schema_ok', 'database_ok', 'role_ok', 'writable'])('a missing permission or unsafe database role fails: %s', async field => {
    const dependencies = fixture(); dependencies.client.query.mockResolvedValue({ rows: [{ ...ready, [field]: false }] });
    expect(await checkReadiness({ ...dependencies, environment })).toEqual({ ok: false, stage: 'permissions' }); expect(dependencies.client.end).toHaveBeenCalledTimes(1);
  });
  test('connection errors close the client and never return private error text', async () => {
    const dependencies = fixture(); dependencies.client.connect.mockRejectedValue(new Error(environment.DATABASE_URL));
    const result = await checkReadiness({ ...dependencies, environment });
    expect(result).toEqual({ ok: false, stage: 'database' }); expect(JSON.stringify(result)).not.toContain('do-not-log');
    expect(dependencies.client.end).toHaveBeenCalledTimes(1); expect(dependencies.client.query).not.toHaveBeenCalled();
  });
  test('all five tables and each of the four privileges are checked using catalog inquiries only', async () => {
    const dependencies = fixture();
    expect(await checkReadiness({ ...dependencies, environment })).toEqual({ ok: true, stage: 'ready' });
    expect(dependencies.client.connect).toHaveBeenCalledTimes(1); expect(dependencies.client.query).toHaveBeenCalledExactlyOnceWith(READINESS_SQL, [REQUIRED_TABLES, REQUIRED_PRIVILEGES]);
    expect(REQUIRED_TABLES).toHaveLength(5); expect(REQUIRED_PRIVILEGES).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    expect(READINESS_SQL).toContain('CROSS JOIN required_privileges'); expect(READINESS_SQL).toContain('bool_and(allowed)');
    for (const table of REQUIRED_TABLES) expect(READINESS_SQL).not.toContain(`FROM ${table}`);
    expect(dependencies.client.end).toHaveBeenCalledTimes(1);
  });
  test('the actual CLI fails closed without configuration and prints no provided credentials', () => {
    const result = spawnSync(process.execPath, ['deploy/readiness.mjs'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, DATABASE_URL: '', MODEL_PROVIDER: 'bailian', DASHSCOPE_API_KEY: 'synthetic-secret-that-must-not-print', PUBLIC_APP_ORIGIN: 'https://practice.example' } });
    expect(result.status).toBe(1); expect(result.stderr).toContain('Readiness failed: configuration.');
    expect(result.stdout + result.stderr).not.toContain('synthetic-secret-that-must-not-print');
  });
});
