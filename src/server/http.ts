import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppError, publicError } from './errors';
import { getStore } from './store';
import { SessionService } from './sessions';

const COOKIE = 'practice_guest';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  // Next's development server can normalize request.url to localhost while the
  // browser actually uses 127.0.0.1. Host remains the authority being requested.
  let expected = request.headers.get('host') ? `${requestUrl.protocol}//${request.headers.get('host')}` : requestUrl.origin;
  // A TLS reverse proxy connects to Node over HTTP. Pin the public origin in
  // server configuration instead of trusting client-supplied forwarding headers.
  const configured = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (configured) {
    let publicUrl: URL;
    try { publicUrl = new URL(configured); } catch { throw new AppError('SITE_NOT_CONFIGURED', '作品访问地址配置有误，请联系维护者。', 503); }
    if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || (process.env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')) throw new AppError('SITE_NOT_CONFIGURED', '作品访问地址配置有误，请联系维护者。', 503);
    if (request.headers.get('host') !== publicUrl.host) throw new AppError('ORIGIN_REJECTED', '请从作品页面内进行操作。', 403);
    expected = publicUrl.origin;
  }
  if (!origin || origin !== expected || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('ORIGIN_REJECTED', '请从作品页面内进行操作。', 403);
}
export function guest(request: Request, create = false) {
  const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const token = cookie && TOKEN_PATTERN.test(cookie) ? cookie : create ? randomBytes(32).toString('base64url') : null;
  if (!token) throw new AppError('NOT_FOUND', '当前浏览器没有这条练习记录，请从首页开始。', 404);
  return { owner: createHash('sha256').update(token).digest('hex'), newToken: create || token !== cookie ? token : null };
}
export async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('JSON_REQUIRED', '请使用页面提交完整操作。', 415);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > 32_768) throw new AppError('BODY_TOO_LARGE', '这段内容过长，请缩短后提交。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_JSON', '请求内容为空。');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > 32_768) { await reader.cancel(); throw new AppError('BODY_TOO_LARGE', '这段内容过长，请缩短后提交。', 413); } chunks.push(result.value); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('INVALID_JSON', '请求内容不完整，请重试。'); }
}
export function response(data: unknown, status = 200, newToken?: string | null, secure = process.env.NODE_ENV === 'production') {
  const result = NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
  if (newToken) result.cookies.set(COOKIE, newToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return result;
}
export async function handle(work: () => Promise<Response> | Response) {
  try { return await work(); }
  catch (error) { const failure = publicError(error); return response(failure.body, failure.status); }
}
export function service() { return new SessionService(getStore()); }
export async function sessionId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new AppError('NOT_FOUND', '没有找到这条练习记录。', 404);
  return id;
}
