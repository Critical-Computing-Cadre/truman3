ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_reactions" DROP CONSTRAINT "scripted_reactions_type";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "repost_of" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "quote_of" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "base_reposts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "base_quotes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_repost_of_content_id_fk" FOREIGN KEY ("repost_of") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_quote_of_content_id_fk" FOREIGN KEY ("quote_of") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn', 'answer', 'ban', 'hold', 'approve', 'uphold', 'restore', 'repost', 'follow'));--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_type" CHECK ("scripted_reactions"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn', 'repost', 'follow'));