import { SOURCES, SOURCE_VERSION } from '@/content/sources';
import { handle, response } from '@/server/http';
import { AppError } from '@/server/errors';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => { const { id } = await context.params; const source = SOURCES.find(item => item.id === id); if (!source) throw new AppError('NOT_FOUND', '没有找到这张来源卡。', 404); return response({ source, version: SOURCE_VERSION }); }); }
