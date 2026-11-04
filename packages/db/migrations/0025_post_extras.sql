ALTER TABLE "content_interactions" DROP CONSTRAINT "content_interactions_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "link_url" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "pinned_on" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_kind" CHECK ("content_interactions"."kind" in ('like', 'up', 'down', 'flag', 'view', 'save', 'hide'));