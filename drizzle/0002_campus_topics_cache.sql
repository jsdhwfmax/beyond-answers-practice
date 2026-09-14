CREATE TABLE "campus_topics_cache" (
  "id" text PRIMARY KEY NOT NULL,
  "record" jsonb NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "lease_until" timestamp with time zone,
  "lease_token" uuid
);
