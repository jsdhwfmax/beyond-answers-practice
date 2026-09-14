import { integer, jsonb, pgTable, text, timestamp, uuid, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SessionRecord } from './records';
import type { CustomRecord } from './custom-records';

// Each short practice is a bounded aggregate. State, checkpoints and its event log
// share one row, so an accepted action cannot be stored without its evidence.
export const sessions = pgTable('practice_sessions', {
  id: uuid('id').primaryKey(), owner: text('owner_hash').notNull(), version: integer('version').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => sessions.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  record: jsonb('record').$type<SessionRecord>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('practice_sessions_owner_idx').on(table.owner), index('practice_sessions_parent_idx').on(table.parentId), index('practice_sessions_expiry_idx').on(table.expiresAt), check('practice_sessions_version_nonnegative', sql`${table.version} >= 0`)]);

export const modelLeases = pgTable('practice_model_leases', {
  slot: integer('slot').primaryKey(), token: uuid('token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, table => [check('practice_model_leases_slot_range', sql`${table.slot} BETWEEN 1 AND 4`)]);

export const customPractices = pgTable('custom_practices', {
  id: uuid('id').primaryKey(), owner: text('owner_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  record: jsonb('record').$type<CustomRecord>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('custom_practices_owner_updated_idx').on(table.owner, table.updatedAt), index('custom_practices_expiry_idx').on(table.expiresAt)]);

export const campusTopicsCache = pgTable('campus_topics_cache', {
  id: text('id').primaryKey(), record: jsonb('record').notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), leaseToken: uuid('lease_token'),
});

export const replyOptionsCache = pgTable('reply_options_cache', {
  key: text('cache_key').primaryKey(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  customId: uuid('custom_id').references(() => customPractices.id, { onDelete: 'cascade' }),
  value: jsonb('value'), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), token: uuid('token'),
}, table => [index('reply_options_expiry_idx').on(table.expiresAt), index('reply_options_session_idx').on(table.sessionId), index('reply_options_custom_idx').on(table.customId), check('reply_options_parent', sql`(${table.sessionId} IS NULL) <> (${table.customId} IS NULL)`)]);
