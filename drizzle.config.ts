import { defineConfig } from 'drizzle-kit';
import { loadLocalEnv } from './src/server/load-local-env';
loadLocalEnv();

export default defineConfig({ schema: './src/server/schema.ts', out: './drizzle', dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL_MIGRATION ?? '' }, strict: true, verbose: false });
