CREATE TABLE "practice_model_leases" (
	"slot" integer PRIMARY KEY NOT NULL,
	"token" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "practice_model_leases_slot_range" CHECK ("practice_model_leases"."slot" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_hash" text NOT NULL,
	"version" integer NOT NULL,
	"parent_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_sessions_version_nonnegative" CHECK ("practice_sessions"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_parent_id_practice_sessions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_sessions_owner_idx" ON "practice_sessions" USING btree ("owner_hash");--> statement-breakpoint
CREATE INDEX "practice_sessions_parent_idx" ON "practice_sessions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "practice_sessions_expiry_idx" ON "practice_sessions" USING btree ("expires_at");
--> statement-breakpoint
INSERT INTO practice_model_leases (slot) VALUES (1), (2), (3), (4);
