export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function publicError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof AppError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时未能完成这次请求。你的已保存记录会保留，请稍后重试。' } } };
}
