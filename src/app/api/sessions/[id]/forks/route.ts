import { checkOrigin, guest, handle, jsonBody, response, service, sessionId } from '@/server/http';
import { forkSchema } from '@/server/validation';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => { checkOrigin(request); const parsed = forkSchema.safeParse(await jsonBody(request)); if (!parsed.success) throw new AppError('INVALID_FORK', '请选择完整回合的重试起点。'); return response({ session: await service().fork(guest(request).owner, await sessionId(context), parsed.data) }, 201); }); }
