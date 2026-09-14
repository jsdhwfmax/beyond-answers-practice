import { checkOrigin, guest, handle, jsonBody, response } from '@/server/http';
import { practiceIntakeService } from '@/server/practice-intake-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request); const identity = guest(request, true);
    const intake = await practiceIntakeService().assess(identity.owner, await jsonBody(request));
    return response({ intake }, 200, identity.newToken);
  });
}
