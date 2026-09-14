import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadLocalEnv } from '../src/server/load-local-env';
loadLocalEnv();

async function main() {
  const connectionString = process.env.DATABASE_URL_MIGRATION;
  if (!connectionString) { console.error('缺少 DATABASE_URL_MIGRATION。尚未运行数据库迁移。'); process.exitCode = 1; return; }
  const url = new URL(connectionString);
  if (url.hostname.includes('-pooler')) { console.error('迁移需要数据库直连地址，不能使用 pooler 地址。'); process.exitCode = 1; return; }
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }); console.log('数据库迁移完成。'); }
  catch { console.error('数据库迁移失败。请检查私密连接配置和数据库权限；未输出凭证。'); process.exitCode = 1; }
  finally { await pool.end(); }
}
main().catch(() => { console.error('迁移配置无效。未输出连接地址。'); process.exitCode = 1; });
