CREATE TABLE "custom_practices" (
  "id" uuid PRIMARY KEY NOT NULL,
  "owner_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "custom_practices_owner_updated_idx" ON "custom_practices" ("owner_hash", "updated_at");
--> statement-breakpoint
CREATE INDEX "custom_practices_expiry_idx" ON "custom_practices" ("expires_at");
