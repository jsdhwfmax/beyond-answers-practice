import { createHash, timingSafeEqual } from 'node:crypto';
import { getStore } from '@/server/store';
import { getCustomStore } from '@/server/custom-store';
import { handle, response } from '@/server/http';
import { AppError } from '@/server/errors';
import { cleanupReplyOptions } from '@/server/reply-options-cache';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError('MAINTENANCE_NOT_CONFIGURED', '维护入口尚未启用。', 503);
    const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
    const provided = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
    if (!timingSafeEqual(expected, provided)) throw new AppError('UNAUTHORIZED', '维护请求未获授权。', 401);
    const now = Date.now();
    const removed = await getStore().cleanup(now);
    const removedCustom = await getCustomStore().cleanup(now);
    const removedOptions = await cleanupReplyOptions(now);
    return response({ removedExpiredRootsOrRecords: removed, removedExpiredCustomPractices: removedCustom, removedExpiredReplyOptions: removedOptions, descendantsDeleted: true });
  });
}
