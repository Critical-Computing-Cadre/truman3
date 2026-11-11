ALTER TABLE "content" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "push_platform" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "push_since" timestamp with time zone;