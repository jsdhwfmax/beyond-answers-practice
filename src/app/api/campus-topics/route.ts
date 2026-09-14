import { campusTopicsService } from '@/server/campus-topics-cache';
import { checkOrigin, handle, response } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET() { return handle(async () => { const feed = await campusTopicsService().get(); return response(feed, feed.status === 'unavailable' ? 503 : 200); }); }
export function POST(request: Request) { return handle(async () => { checkOrigin(request); const feed = await campusTopicsService().get(true); return response(feed, feed.status === 'unavailable' ? 503 : 200); }); }
