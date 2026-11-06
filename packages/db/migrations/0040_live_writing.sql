ALTER TABLE "beat_runs" ADD COLUMN "writing" jsonb;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "live_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "paused_actors" text[] DEFAULT '{}' NOT NULL;