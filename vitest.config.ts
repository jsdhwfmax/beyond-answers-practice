import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['tests/e2e/**'], testTimeout: 10000 } });
