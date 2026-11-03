ALTER TABLE "content_interactions" DROP CONSTRAINT "content_interactions_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_reactions" DROP CONSTRAINT "scripted_reactions_type";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "base_ups" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "base_downs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_kind" CHECK ("content_interactions"."kind" in ('like', 'up', 'down', 'flag', 'view'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down'));--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_type" CHECK ("scripted_reactions"."type" in ('read', 'like', 'reply', 'up', 'down'));