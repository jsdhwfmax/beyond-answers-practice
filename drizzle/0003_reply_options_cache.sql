CREATE TABLE "reply_options_cache" (
  "cache_key" text PRIMARY KEY NOT NULL,
  "session_id" uuid REFERENCES "practice_sessions"("id") ON DELETE CASCADE,
  "custom_id" uuid REFERENCES "custom_practices"("id") ON DELETE CASCADE,
  "value" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "lease_until" timestamp with time zone,
  "token" uuid,
  CONSTRAINT "reply_options_parent" CHECK (("session_id" IS NULL) <> ("custom_id" IS NULL))
);
CREATE INDEX "reply_options_expiry_idx" ON "reply_options_cache"("expires_at");
CREATE INDEX "reply_options_session_idx" ON "reply_options_cache"("session_id");
CREATE INDEX "reply_options_custom_idx" ON "reply_options_cache"("custom_id");
