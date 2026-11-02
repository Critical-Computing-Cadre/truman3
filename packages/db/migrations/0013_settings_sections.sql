ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "draft_presence" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'setting'));