import { browseCampusLibrary } from '@/server/campus-library';
import { handle, response } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    const integer = (key: string, fallback: number) => /^\d{1,5}$/.test(params.get(key) ?? '') ? Number(params.get(key)) : fallback;
    return response(browseCampusLibrary({ query: (params.get('q') ?? '').slice(0, 300), category: (params.get('category') ?? '').slice(0, 60), offset: integer('offset', 0), limit: integer('limit', 12) }));
  });
}
