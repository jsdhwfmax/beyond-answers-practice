import { existsSync } from 'node:fs';
import path from 'node:path';

/** Node's loader preserves variables already supplied to this process. */
export function loadLocalEnv() {
  const filename = path.join(process.cwd(), '.env.local');
  if (existsSync(filename)) process.loadEnvFile(filename);
}
