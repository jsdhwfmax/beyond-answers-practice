import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import type { CampusTopic, CampusTopicKind, TopicErrorCode } from '@/domain/campus-topics';

const execute = promisify(execFile);
export class ZhihuPublicError extends Error { constructor(public code: TopicErrorCode) { super(code); } }
const itemSchema = z.object({ Title: z.string(), Url: z.string(), ContentType: z.string().optional(), EditTime: z.number().optional() });
const responseSchema = z.object({ Code: z.number(), Data: z.object({ Items: z.array(itemSchema) }).nullish() });
export interface PublicTopicRequest { kind: CampusTopicKind; query?: string }
export type PublicTopicFetcher = (request: PublicTopicRequest) => Promise<unknown>;
const CAMPUS = /大学|高校|校园|新生|大[一二三四]|本科|硕士|研究生|毕业生|考研|保研|宿舍|室友|舍友|小组作业|社团|选课|实习|校招|北大|清华|学长|学姐|辅导员/;
const QUERIES = ['大学 宿舍 室友 相处', '大学 实习 考研 选择'];

export function publicZhihuUrl(value: string): { url: string; id: string; contentType: CampusTopic['contentType'] } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.zhihu.com', 'zhuanlan.zhihu.com'].includes(url.hostname)) return null;
    const question = /^\/question\/(\d+)(?:\/answer\/(\d+))?\/?$/.exec(url.pathname);
    const article = /^\/p\/(\d+)\/?$/.exec(url.pathname);
    if (url.hostname === 'www.zhihu.com' && question) return { url: url.href, id: `question:${question[1]}`, contentType: question[2] ? 'answer' : 'question' };
    if (url.hostname === 'zhuanlan.zhihu.com' && article) return { url: url.href, id: `article:${article[1]}`, contentType: 'article' };
    return null;
  } catch { return null; }
}
export function parsePublicTopics(value: unknown, kind: CampusTopicKind, fetchedAt: string): CampusTopic[] {
  const result = responseSchema.safeParse(value);
  if (!result.success) throw new ZhihuPublicError('INVALID_RESPONSE');
  if (result.data.Code !== 0) throw new ZhihuPublicError(result.data.Code === 20001 ? 'AUTH_FAILED' : [30001, 30002].includes(result.data.Code) ? 'RATE_LIMITED' : 'UNAVAILABLE');
  if (!result.data.Data) throw new ZhihuPublicError('INVALID_RESPONSE');
  return result.data.Data.Items.flatMap(item => {
    const link = publicZhihuUrl(item.Url);
    const title = item.Title.replace(/<[^>]*>/g, '').replace(/\s+-\s+知乎\s*$/, '').trim();
    if (!link || !title || title.length > 500 || !CAMPUS.test(title)) return [];
    const edited = typeof item.EditTime === 'number' && Number.isFinite(item.EditTime) && item.EditTime > 0 && item.EditTime * 1000 <= Date.parse(fetchedAt) ? new Date(item.EditTime * 1000).toISOString() : null;
    return [{ ...link, title, kind, fetchedAt, editedAt: edited }];
  });
}

/** Fixed official host only. An invalid injected secret never falls back to the local keychain. */
export const fetchZhihuPublic: PublicTopicFetcher = async request => {
  const secret = process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (secret) {
    const url = new URL(request.kind === 'hot' ? 'https://developer.zhihu.com/api/v1/content/hot_list' : 'https://developer.zhihu.com/api/v1/content/zhihu_search');
    if (request.kind === 'hot') url.searchParams.set('Limit', '30');
    else { url.searchParams.set('Query', request.query!); url.searchParams.set('Count', '10'); }
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, 'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)), 'Content-Type': 'application/json' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if ([401, 403].includes(response.status)) throw new ZhihuPublicError('AUTH_FAILED');
      if (response.status === 429) throw new ZhihuPublicError('RATE_LIMITED');
      if (!response.ok) throw new ZhihuPublicError('UNAVAILABLE');
      return await response.json();
    } catch (error) { if (error instanceof ZhihuPublicError) throw error; throw new ZhihuPublicError('UNAVAILABLE'); }
  }
  if (process.env.NODE_ENV === 'production') throw new ZhihuPublicError('NOT_CONFIGURED');
  const cliHome = path.resolve('.local/zhihu-cli');
  const binary = path.join(cliHome, 'current', process.platform === 'win32' ? 'zhihu-cli.exe' : 'zhihu-cli');
  const args = request.kind === 'hot' ? ['hot', '--limit', '30'] : ['search', 'zhihu', '--query', request.query!, '--count', '10'];
  try {
    const { stdout } = await execute(binary, [...args, '--timeout', '15s'], { env: { ...process.env, ZHIHU_CLI_HOME: cliHome }, windowsHide: true, timeout: 17_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(stdout);
  } catch (error) {
    // Never return subprocess stdout/stderr, command lines or credential details.
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 3 || error.code === 7) throw new ZhihuPublicError('AUTH_FAILED');
      if (error.code === 4) throw new ZhihuPublicError('RATE_LIMITED');
      if (error.code === 'ENOENT') throw new ZhihuPublicError('NOT_CONFIGURED');
    }
    throw new ZhihuPublicError('UNAVAILABLE');
  }
};

export async function collectCampusTopics(fetcher: PublicTopicFetcher, now: () => number): Promise<CampusTopic[]> {
  const hot = parsePublicTopics(await fetcher({ kind: 'hot' }), 'hot', new Date(now()).toISOString());
  const related = hot.length >= 8 ? [] : await Promise.all(QUERIES.map(async query => parsePublicTopics(await fetcher({ kind: 'related', query }), 'related', new Date(now()).toISOString())));
  const candidates = [...hot];
  // Interleave search themes; do not present one answer cluster as eight different dilemmas.
  for (let index = 0; index < 10; index++) for (const group of related) if (group[index]) candidates.push(group[index]);
  const seenIds = new Set<string>(); const seenTitles = new Set<string>(); const items: CampusTopic[] = [];
  for (const item of candidates) {
    const titleKey = item.title.replace(/[\s，,。.!！?？、]/g, '');
    if (seenIds.has(item.id) || seenTitles.has(titleKey)) continue;
    seenIds.add(item.id); seenTitles.add(titleKey); items.push(item);
    if (items.length === 8) break;
  }
  return items;
}
