import { SOURCES, SOURCE_VERSION } from '@/content/sources';
import { response } from '@/server/http';
export const runtime = 'nodejs';
export function GET() { return response({ sources: SOURCES, version: SOURCE_VERSION }); }
