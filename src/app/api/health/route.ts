import { configuration } from '@/server/config';
import { response } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() { const result = configuration(); return response(result, result.ok ? 200 : 503); }
