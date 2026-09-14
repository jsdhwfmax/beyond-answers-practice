import { checkOrigin, guest, handle, jsonBody, response, service } from '@/server/http';
import { scenarioSchema } from '@/server/validation';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(async () => { checkOrigin(request); const parsed = scenarioSchema.safeParse(await jsonBody(request)); if (!parsed.success) throw new AppError('INVALID_SCENARIO', '请选择一个现有练习。'); const identity = guest(request, true); const session = await service().create(identity.owner, parsed.data.scenario); return response({ session }, 201, identity.newToken); });
}
