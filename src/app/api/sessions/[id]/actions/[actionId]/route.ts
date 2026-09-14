import { guest, handle, response, service, sessionId } from '@/server/http';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) { return handle(async () => { const { actionId } = await context.params; if (!/^[a-f0-9-]{36}$/i.test(actionId)) throw new AppError('ACTION_NOT_FOUND', '没有找到这次动作。', 404); return response(await service().actionStatus(guest(request).owner, await sessionId(context), actionId)); }); }
