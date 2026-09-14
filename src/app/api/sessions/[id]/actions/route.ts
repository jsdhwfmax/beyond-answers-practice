import { checkOrigin, guest, handle, jsonBody, response, service, sessionId } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => { checkOrigin(request); const identity = guest(request); const id = await sessionId(context); return response({ session: await service().act(identity.owner, id, await jsonBody(request)) }); }); }
