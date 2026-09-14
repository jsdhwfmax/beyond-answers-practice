import type { ReplyOptionsView } from '@/domain/reply-options';
import { applicationDatabasePool } from './postgres-store';

export const REPLY_CACHE_MS = 30 * 60_000;
export const REPLY_FALLBACK_MS = 2 * 60_000;
export const REPLY_LEASE_MS = 35_000;
export interface ReplyCacheKey { key: string; kind: 'fixed' | 'custom'; sessionId: string }
export interface ReplyCacheEntry { value: ReplyOptionsView | null; expiresAt: number; leaseUntil: number; token: string | null }
export interface ReplyCache {
  read(key: string, now: number): Promise<ReplyCacheEntry | null>;
  claim(identity: ReplyCacheKey, now: number, token: string): Promise<boolean>;
  finish(key: string, now: number, token: string, value: ReplyOptionsView): Promise<boolean>;
  forget?(kind: 'fixed' | 'custom', sessionIds: string[]): Promise<void>;
}
const clone = <T>(value: T): T => structuredClone(value);

/** Ephemeral development cache never writes player conversation text to another file. */
export class MemoryReplyCache implements ReplyCache {
  private entries = new Map<string, ReplyCacheEntry & { identity: ReplyCacheKey }>();
  constructor(private maxEntries = 256) {}
  async read(key: string, now: number) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now && entry.leaseUntil <= now) { this.entries.delete(key); return null; }
    return entry ? clone(entry) : null;
  }
  async claim(identity: ReplyCacheKey, now: number, token: string) {
    const previous = this.entries.get(identity.key);
    if (previous && (previous.leaseUntil > now || (previous.value && previous.expiresAt > now))) return false;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now && entry.leaseUntil <= now) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const removable = [...this.entries].find(([, entry]) => entry.leaseUntil <= now);
      if (!removable) return false;
      this.entries.delete(removable[0]);
    }
    this.entries.set(identity.key, { identity: clone(identity), value: null, expiresAt: now + REPLY_LEASE_MS, leaseUntil: now + REPLY_LEASE_MS, token }); return true;
  }
  async finish(key: string, now: number, token: string, value: ReplyOptionsView) {
    const entry = this.entries.get(key);
    if (!entry || entry.token !== token || entry.leaseUntil <= now) return false;
    this.entries.set(key, { identity: entry.identity, value: clone(value), expiresAt: now + (value.source === 'model' ? REPLY_CACHE_MS : REPLY_FALLBACK_MS), token: null, leaseUntil: 0 }); return true;
  }
  async forget(kind: 'fixed' | 'custom', sessionIds: string[]) {
    const removed = new Set(sessionIds);
    for (const [key, entry] of this.entries) if (entry.identity.kind === kind && removed.has(entry.identity.sessionId)) this.entries.delete(key);
  }
}

/** Independent cache rows share leases across instances and are deleted with their parent session. */
export class PostgresReplyCache implements ReplyCache {
  async read(key: string, now: number): Promise<ReplyCacheEntry | null> {
    const { rows } = await applicationDatabasePool().query('SELECT value, expires_at, lease_until, token FROM reply_options_cache WHERE cache_key=$1 AND (expires_at>$2 OR lease_until>$2)', [key, new Date(now)]);
    const row = rows[0]; return row ? { value: row.value, expiresAt: new Date(row.expires_at).getTime(), leaseUntil: row.lease_until ? new Date(row.lease_until).getTime() : 0, token: row.token } : null;
  }
  async claim(identity: ReplyCacheKey, now: number, token: string) {
    const { rowCount } = await applicationDatabasePool().query(`INSERT INTO reply_options_cache(cache_key, session_id, custom_id, expires_at, lease_until, token)
      VALUES ($1,$2,$3,$4,$4,$5) ON CONFLICT (cache_key) DO UPDATE SET value=NULL, expires_at=$4, lease_until=$4, token=$5
      WHERE reply_options_cache.expires_at<=$6 AND (reply_options_cache.lease_until IS NULL OR reply_options_cache.lease_until<=$6) RETURNING cache_key`, [identity.key, identity.kind === 'fixed' ? identity.sessionId : null, identity.kind === 'custom' ? identity.sessionId : null, new Date(now + REPLY_LEASE_MS), token, new Date(now)]);
    return rowCount === 1;
  }
  async finish(key: string, now: number, token: string, value: ReplyOptionsView) {
    const { rowCount } = await applicationDatabasePool().query('UPDATE reply_options_cache SET value=$3::jsonb, expires_at=$4, lease_until=NULL, token=NULL WHERE cache_key=$1 AND token=$2 AND lease_until>$5 RETURNING cache_key', [key, token, JSON.stringify(value), new Date(now + (value.source === 'model' ? REPLY_CACHE_MS : REPLY_FALLBACK_MS)), new Date(now)]);
    return rowCount === 1;
  }
}
export async function cleanupReplyOptions(now: number) {
  if (!process.env.DATABASE_URL) return 0;
  const result = await applicationDatabasePool().query('DELETE FROM reply_options_cache WHERE expires_at<=$1 AND (lease_until IS NULL OR lease_until<=$1)', [new Date(now)]);
  return result.rowCount ?? 0;
}
