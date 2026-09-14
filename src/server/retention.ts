import type { SessionRecord } from './records';
import { RETENTION_MS } from './config';
import { AppError } from './errors';
export function expiry(record: SessionRecord) { return Date.parse(record.expiresAt ?? '') || Date.parse(record.view.createdAt) + RETENTION_MS; }
export function assertNotExpired(record: SessionRecord, now = Date.now()) {
  if (!Number.isFinite(expiry(record)) || expiry(record) <= now) throw new AppError('SESSION_EXPIRED', '这条练习及其分支已超过 30 天保留期，请开始新练习。', 410);
}
