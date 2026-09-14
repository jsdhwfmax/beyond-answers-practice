import { getProfileQuestion } from '@/server/campus-profile-library';
import { AppError } from '@/server/errors';
import { handle, response } from '@/server/http';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const question = /^zhihu-q-\d+$/.test(id) ? getProfileQuestion(id) : undefined;
    if (!question) throw new AppError('SOURCE_NOT_FOUND', '这条题目暂不可用，请返回选题页重新选择。', 404);
    return response({ question });
  });
}
