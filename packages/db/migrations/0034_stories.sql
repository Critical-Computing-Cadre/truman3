ALTER TABLE "content" DROP CONSTRAINT "content_kind";--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "scripted_reactions" DROP CONSTRAINT "scripted_reactions_on";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "lasts_ms" bigint;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "liked_by_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_liked_by_actor_id_actors_id_fk" FOREIGN KEY ("liked_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_kind" CHECK ("content"."kind" in ('post', 'comment', 'story'));--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'flagAnswer', 'ban', 'reportAnswer', 'autoRule', 'appealAnswer', 'contextNote', 'story', 'setting', 'space'));--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_on" CHECK ("scripted_reactions"."on" in ('post', 'comment', 'story'));