import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  // On this Windows workspace, restoring a stale dev cache hid nested session
  // routes after build → dev. Keep dev discovery fresh; production cache stays enabled.
  experimental: { turbopackFileSystemCacheForDev: false },
  // The development file store is never a production data source. Dynamic fs
  // paths must not pull visitor records, credentials or research into a build.
  outputFileTracingExcludes: {
    '/*': ['.local/**/*', '.env*', 'key.txt', 'output/**/*', 'docs/**/*', 'tests/**/*', 'drizzle/**/*', '.agents/**/*'],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }];
  }
};
export default config;
