import { guest, handle, response, sessionId } from '@/server/http';
import { replyOptionsService, replyOptionsVersion } from '@/server/reply-options';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => response(await replyOptionsService().get(guest(request).owner, await sessionId(context), replyOptionsVersion(request), 'fixed')));
}
