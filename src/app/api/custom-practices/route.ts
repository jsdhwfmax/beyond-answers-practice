import { checkOrigin, guest, handle, jsonBody, response } from '@/server/http';
import { customService } from '@/server/custom-service';
import { modelConfiguration } from '@/server/model-provider';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  return handle(async () => {
    const identity = guest(request, true);
    return response({ sessions: await customService().list(identity.owner), available: modelConfiguration('custom').configured }, 200, identity.newToken);
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request); const identity = guest(request, true);
    return response({ session: await customService().create(identity.owner, await jsonBody(request)) }, 200, identity.newToken);
  });
}
