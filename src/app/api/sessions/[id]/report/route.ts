import { guest, handle, response, service, sessionId } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => response(await service().report(guest(request).owner, await sessionId(context)))); }
