import { loadLocalEnv } from '../src/server/load-local-env';
import { configuration } from '../src/server/config';
loadLocalEnv();
const database = Boolean(process.env.DATABASE_URL?.trim());
const production = process.env.NODE_ENV === 'production';
const config = configuration();
console.log(JSON.stringify({ environment: production ? 'production' : 'development', storage: config.storage, configured: { ...config.configured, migration: Boolean(process.env.DATABASE_URL_MIGRATION?.trim()) }, model: config.model, naturalLanguage: config.naturalLanguage, checksPerformed: 'presence-only', databaseConnectionVerified: false, modelAccessVerified: false }, null, 2));
if (production && !database) { console.error('生产环境必须配置 PostgreSQL，不允许回退到本地文件。'); process.exitCode = 1; }
