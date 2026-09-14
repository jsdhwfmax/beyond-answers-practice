import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CampusTopic, CampusTopicsFeed, TopicErrorCode } from '@/domain/campus-topics';
import { collectCampusTopics, fetchZhihuPublic, publicZhihuUrl, ZhihuPublicError, type PublicTopicFetcher } from './zhihu-public';
import { applicationDatabasePool } from './postgres-store';

export const TOPIC_TTL_MS = 60 * 60 * 1000;
export const TOPIC_REFRESH_MIN_MS = 30 * 60 * 1000;
const LEASE_MS = 60_000;
export interface TopicCacheRecord { version: 1; items: CampusTopic[]; fetchedAt: string | null; error: TopicErrorCode | null }
export interface TopicCacheSnapshot { record: TopicCacheRecord; lastAttemptAt: number | null; leaseUntil: number; leaseToken: string | null }
const emptyRecord = (): TopicCacheRecord => ({ version: 1, items: [], fetchedAt: null, error: null });
const emptySnapshot = (): TopicCacheSnapshot => ({ record: emptyRecord(), lastAttemptAt: null, leaseUntil: 0, leaseToken: null });
export interface TopicCacheRepository {
  read(): Promise<TopicCacheSnapshot>;
  claim(now: number, token: string): Promise<boolean>;
  finish(token: string, now: number, record: TopicCacheRecord): Promise<boolean>;
}
function validRecord(value: TopicCacheRecord) {
  return value?.version === 1 && Array.isArray(value.items) && value.items.length <= 8 && value.items.every(item => typeof item.title === 'string' && typeof item.url === 'string' && publicZhihuUrl(item.url) && ['hot', 'related'].includes(item.kind) && Number.isFinite(Date.parse(item.fetchedAt))) && (value.fetchedAt === null || Number.isFinite(Date.parse(value.fetchedAt)));
}

/** Development cache is a shared, bounded public file; no player data or credentials. */
export class LocalTopicCache implements TopicCacheRepository {
  private gate = Promise.resolve();
  constructor(private file = path.resolve('.local/campus-topics/cache.json')) {}
  private async unlockedRead(): Promise<TopicCacheSnapshot> {
    try {
      const snapshot = JSON.parse(await readFile(this.file, 'utf8')) as TopicCacheSnapshot;
      if (!validRecord(snapshot.record)) throw new Error('Invalid public cache');
      return snapshot;
    } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return emptySnapshot(); throw error; }
  }
  read() { return this.gate.then(() => this.unlockedRead()); }
  private update(work: (snapshot: TopicCacheSnapshot) => boolean): Promise<boolean> {
    let changed = false;
    const next = this.gate.then(async () => {
      const snapshot = await this.unlockedRead(); changed = work(snapshot);
      if (changed) { await mkdir(path.dirname(this.file), { recursive: true }); const temporary = `${this.file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(snapshot), 'utf8'); await rename(temporary, this.file); }
    });
    this.gate = next.catch(() => {}); return next.then(() => changed);
  }
  claim(now: number, token: string) { return this.update(snapshot => {
    if (snapshot.leaseUntil > now || (snapshot.lastAttemptAt !== null && snapshot.lastAttemptAt + TOPIC_REFRESH_MIN_MS > now)) return false;
    snapshot.lastAttemptAt = now; snapshot.leaseUntil = now + LEASE_MS; snapshot.leaseToken = token; return true;
  }); }
  finish(token: string, now: number, record: TopicCacheRecord) { return this.update(snapshot => {
    if (snapshot.leaseToken !== token || snapshot.leaseUntil <= now) return false;
    snapshot.record = record; snapshot.leaseToken = null; snapshot.leaseUntil = 0; return true;
  }); }
}

/** A single-row CAS coordinates all production instances without holding a connection during HTTP. */
export class PostgresTopicCache implements TopicCacheRepository {
  async read(): Promise<TopicCacheSnapshot> {
    const pool = applicationDatabasePool();
    await pool.query('INSERT INTO campus_topics_cache(id, record) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', ['campus-v1', JSON.stringify(emptyRecord())]);
    const { rows } = await pool.query('SELECT record, last_attempt_at, lease_until, lease_token FROM campus_topics_cache WHERE id=$1', ['campus-v1']);
    const row = rows[0]; if (!row || !validRecord(row.record)) throw new Error('Invalid public cache');
    return { record: row.record, lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).getTime() : null, leaseUntil: row.lease_until ? new Date(row.lease_until).getTime() : 0, leaseToken: row.lease_token };
  }
  async claim(now: number, token: string) {
    const result = await applicationDatabasePool().query('UPDATE campus_topics_cache SET last_attempt_at=$2, lease_until=$3, lease_token=$4 WHERE id=$1 AND (lease_until IS NULL OR lease_until <= $2) AND (last_attempt_at IS NULL OR last_attempt_at <= $5) RETURNING id', ['campus-v1', new Date(now), new Date(now + LEASE_MS), token, new Date(now - TOPIC_REFRESH_MIN_MS)]);
    return result.rowCount === 1;
  }
  async finish(token: string, now: number, record: TopicCacheRecord) {
    const result = await applicationDatabasePool().query('UPDATE campus_topics_cache SET record=$3::jsonb, lease_until=NULL, lease_token=NULL WHERE id=$1 AND lease_token=$2 AND lease_until > $4 RETURNING id', ['campus-v1', token, JSON.stringify(record), new Date(now)]);
    return result.rowCount === 1;
  }
}
const ERROR_MESSAGES: Record<TopicErrorCode, string> = { NOT_CONFIGURED: '知乎话题服务尚未配置。', AUTH_FAILED: '知乎话题服务暂未取得有效授权。', RATE_LIMITED: '知乎接口暂时达到刷新限额。', UNAVAILABLE: '这次没有连上知乎话题服务。', INVALID_RESPONSE: '这次知乎话题数据未通过检查。' };
export class CampusTopicsService {
  private pending: Promise<CampusTopicsFeed> | null = null;
  constructor(private repository: TopicCacheRepository, private fetcher: PublicTopicFetcher = fetchZhihuPublic, private now: () => number = Date.now) {}
  private view(snapshot: TopicCacheSnapshot, refreshResult: CampusTopicsFeed['refreshResult']): CampusTopicsFeed {
    const now = this.now(); const { record } = snapshot;
    const stale = record.fetchedAt === null || Date.parse(record.fetchedAt) + TOPIC_TTL_MS <= now || Boolean(record.error);
    return { items: record.items, fetchedAt: record.fetchedAt, checkedAt: new Date(now).toISOString(), lastAttemptAt: snapshot.lastAttemptAt === null ? null : new Date(snapshot.lastAttemptAt).toISOString(), nextAutoRefreshAt: record.fetchedAt ? new Date(Math.max(Date.parse(record.fetchedAt) + TOPIC_TTL_MS, (snapshot.lastAttemptAt ?? 0) + TOPIC_REFRESH_MIN_MS)).toISOString() : null, nextManualRefreshAt: snapshot.lastAttemptAt === null ? null : new Date(snapshot.lastAttemptAt + TOPIC_REFRESH_MIN_MS).toISOString(), status: snapshot.leaseUntil > now ? 'refreshing' : record.error ? (record.fetchedAt ? 'stale' : 'unavailable') : !record.fetchedAt ? 'unavailable' : stale ? 'stale' : record.items.length ? 'fresh' : 'empty', refreshResult, error: record.error ? { code: record.error, message: ERROR_MESSAGES[record.error] } : null, hotCount: record.items.filter(item => item.kind === 'hot').length, relatedCount: record.items.filter(item => item.kind === 'related').length };
  }
  async get(force = false): Promise<CampusTopicsFeed> {
    if (this.pending) return this.pending;
    const snapshot = await this.repository.read();
    if (this.pending) return this.pending;
    if (!force && snapshot.record.fetchedAt && Date.parse(snapshot.record.fetchedAt) + TOPIC_TTL_MS > this.now() && !snapshot.record.error) return this.view(snapshot, 'cached');
    // The promise is assigned before starting network work; the repository CAS also covers other instances.
    const pending = this.refresh(snapshot, force); this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = null; }
  }
  private async refresh(snapshot: TopicCacheSnapshot, force: boolean): Promise<CampusTopicsFeed> {
    const token = randomUUID();
    if (!await this.repository.claim(this.now(), token)) return this.view(await this.repository.read(), snapshot.leaseUntil > this.now() ? 'in_progress' : force ? 'cooldown' : 'cached');
    let record: TopicCacheRecord;
    try { const items = await collectCampusTopics(this.fetcher, this.now); record = { version: 1, items, fetchedAt: new Date(this.now()).toISOString(), error: null }; }
    catch (error) { record = { ...snapshot.record, error: error instanceof ZhihuPublicError ? error.code : 'UNAVAILABLE' }; }
    const saved = await this.repository.finish(token, this.now(), record);
    return this.view(await this.repository.read(), !saved ? 'in_progress' : record.error ? 'failed' : 'updated');
  }
}

const processCache = globalThis as typeof globalThis & { campusTopicsServiceV1?: CampusTopicsService; campusTopicsTimerV1?: ReturnType<typeof setInterval> };
export function startLocalTopicRefresh(service: CampusTopicsService) {
  const timer = setInterval(() => { void service.get(true).catch(() => {}); }, TOPIC_TTL_MS);
  timer.unref(); return timer;
}
export function campusTopicsService() {
  if (!processCache.campusTopicsServiceV1) {
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new ZhihuPublicError('NOT_CONFIGURED');
    const service = new CampusTopicsService(process.env.DATABASE_URL ? new PostgresTopicCache() : new LocalTopicCache());
    processCache.campusTopicsServiceV1 = service;
    if (process.env.NODE_ENV === 'development') {
      // Active local server refreshes once an hour, even with no page open. Serverless uses the authenticated cron route.
      processCache.campusTopicsTimerV1 = startLocalTopicRefresh(service);
    }
  }
  return processCache.campusTopicsServiceV1;
}
