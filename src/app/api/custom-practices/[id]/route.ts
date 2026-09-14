import { checkOrigin, guest, handle, jsonBody, response, sessionId } from '@/server/http';
import { customService } from '@/server/custom-service';
import { forgetReplyOptions } from '@/server/reply-options';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handle(async () => response({ session: await customService().read(guest(request).owner, await sessionId(context)) }));
}
export async function POST(request: Request, context: Context) {
  return handle(async () => { checkOrigin(request); return response({ session: await customService().action(guest(request).owner, await sessionId(context), await jsonBody(request)) }); });
}
export async function DELETE(request: Request, context: Context) {
  return handle(async () => { checkOrigin(request); const id = await sessionId(context); await customService().remove(guest(request).owner, id); await forgetReplyOptions('custom', [id]); return response({ deleted: true, deletedIds: [id] }); });
}
