ALTER TABLE "researchers" ADD COLUMN "operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "application" jsonb;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_status" CHECK ("teams"."status" in ('pending', 'approved', 'suspended'));