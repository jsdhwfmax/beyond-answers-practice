import { checkOrigin, guest, handle, response, service, sessionId } from '@/server/http';
import { forgetReplyOptions } from '@/server/reply-options';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handle(async () => response({ session: await service().get(guest(request).owner, await sessionId(context)) })); }
export async function DELETE(request: Request, context: Context) { return handle(async () => { checkOrigin(request); const deletedIds = await service().remove(guest(request).owner, await sessionId(context)); await forgetReplyOptions('fixed', deletedIds); return response({ deleted: true, deletedIds }); }); }
