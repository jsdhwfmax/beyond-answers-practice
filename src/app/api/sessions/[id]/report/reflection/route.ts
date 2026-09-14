import { checkOrigin, guest, handle, jsonBody, response, service, sessionId } from '@/server/http';
import { reflectionSchema } from '@/server/validation';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => { checkOrigin(request); const parsed = reflectionSchema.safeParse(await jsonBody(request)); if (!parsed.success) throw new AppError('INVALID_REFLECTION', '请从当前报告请求反思引导。'); return response(await service().reflection(guest(request).owner, await sessionId(context), parsed.data)); }); }
