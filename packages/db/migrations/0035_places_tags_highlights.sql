ALTER TABLE "actor_relations" DROP CONSTRAINT "actor_relations_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "place" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "tagged_actor_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "highlight" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "close_friends" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "actor_relations" ADD CONSTRAINT "actor_relations_kind" CHECK ("actor_relations"."kind" in ('follow', 'block', 'report', 'mute', 'closeFriend'));