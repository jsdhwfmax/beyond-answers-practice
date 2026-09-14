import pg from 'pg';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_TABLES = Object.freeze(['practice_sessions', 'practice_model_leases', 'custom_practices', 'campus_topics_cache', 'reply_options_cache']);
export const REQUIRED_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
// System-catalog inquiries only: no visitor rows, writes, or model requests.
// Each privilege is tested separately; PostgreSQL's comma-separated privilege
// form succeeds when ANY requested privilege is held, which is insufficient.
export const READINESS_SQL = `
  WITH required_tables AS (SELECT unnest($1::text[]) AS table_name),
  required_privileges AS (SELECT unnest($2::text[]) AS privilege),
  permissions AS (
    SELECT COALESCE(has_table_privilege(current_user,
      to_regclass('public.' || table_name), privilege), false) AS allowed
    FROM required_tables CROSS JOIN required_privileges
  )
  SELECT
    (SELECT count(*) = cardinality($1::text[]) * cardinality($2::text[]) AND bool_and(allowed) FROM permissions) AS privileges_ok,
    has_schema_privilege(current_user, 'public', 'USAGE') AS schema_ok,
    has_database_privilege(current_user, current_database(), 'CONNECT') AS database_ok,
    (SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls
      FROM pg_roles WHERE rolname = current_user) AS role_ok,
    (NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off') AS writable
`;

/**
 * @typedef {{ on: (event: string, listener: () => void) => unknown, connect: () => Promise<void>, query: (sql: string, parameters: unknown[]) => Promise<{rows: Record<string, unknown>[]}>, end: () => Promise<void> }} ReadinessClient
 * @param {{ environment?: Record<string, string | undefined>, fetcher?: typeof globalThis.fetch, createClient?: (options: import('pg').ClientConfig) => ReadinessClient }} [dependencies]
 */
export async function checkReadiness({ environment = process.env, fetcher = globalThis.fetch, createClient = options => new pg.Client(options) } = {}) {
  const provider = environment.MODEL_PROVIDER?.trim() || 'bailian';
  const customProvider = environment.CUSTOM_MODEL_PROVIDER?.trim() || provider;
  const keyFor = selected => selected === 'bailian' ? environment.DASHSCOPE_API_KEY : selected === 'openai' ? environment.OPENAI_API_KEY : selected === 'deepseek' ? environment.DEEPSEEK_API_KEY : undefined;
  if (!keyFor(provider)?.trim() || !keyFor(customProvider)?.trim() || !environment.DATABASE_URL?.trim()) return { ok: false, stage: 'configuration' };
  try {
    const origin = new URL(environment.PUBLIC_APP_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return { ok: false, stage: 'configuration' };
  } catch { return { ok: false, stage: 'configuration' }; }
  try {
    const result = await fetcher('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(1500) });
    if (!result.ok) return { ok: false, stage: 'http' };
    const value = await result.json();
    if (value?.storage !== 'postgres' || value?.naturalLanguage !== true) return { ok: false, stage: 'http' };
    if (environment.CUSTOM_MODEL_PROVIDER?.trim() && (value?.customModel?.configured !== true || value.customModel.provider !== customProvider)) return { ok: false, stage: 'http' };
  } catch { return { ok: false, stage: 'http' }; }

  let client;
  try {
    client = createClient({ connectionString: environment.DATABASE_URL.trim(), connectionTimeoutMillis: 2500, query_timeout: 1800, statement_timeout: 1500 });
    client.on('error', () => {});
    await client.connect();
    const result = await client.query(READINESS_SQL, [REQUIRED_TABLES, REQUIRED_PRIVILEGES]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || ['privileges_ok', 'schema_ok', 'database_ok', 'role_ok', 'writable'].some(field => row[field] !== true)) return { ok: false, stage: 'permissions' };
    return { ok: true, stage: 'ready' };
  } catch { return { ok: false, stage: 'database' }; }
  finally { if (client) await client.end().catch(() => undefined); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const deadline = setTimeout(() => { console.error('Readiness failed: timeout.'); process.exit(1); }, 8500);
  deadline.unref();
  const result = await checkReadiness();
  clearTimeout(deadline);
  if (result.ok) console.log('Readiness passed: application, model configuration and database permissions.');
  else { console.error(`Readiness failed: ${result.stage}.`); process.exitCode = 1; }
}
