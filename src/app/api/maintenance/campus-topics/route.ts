import { createHash, timingSafeEqual } from 'node:crypto';
import { campusTopicsService } from '@/server/campus-topics-cache';
import { AppError } from '@/server/errors';
import { handle, response } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError('MAINTENANCE_NOT_CONFIGURED', '话题定时刷新尚未配置。', 503);
    const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
    const provided = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
    if (!timingSafeEqual(expected, provided)) throw new AppError('UNAUTHORIZED', '刷新请求未获授权。', 401);
    const feed = await campusTopicsService().get(true);
    return response({ status: feed.status, refreshResult: feed.refreshResult, fetchedAt: feed.fetchedAt, count: feed.items.length }, feed.status === 'unavailable' ? 503 : 200);
  });
}
