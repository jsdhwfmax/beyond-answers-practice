import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  // These are functional checks against one local Windows dev server. Explicit
  // HTTP concurrency tests exercise races independently of browser worker count.
  testDir: './tests/e2e', fullyParallel: false, workers: 2, timeout: 45000,
  expect: { timeout: 12000 }, retries: 0, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
