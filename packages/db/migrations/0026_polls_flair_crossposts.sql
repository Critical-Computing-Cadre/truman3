ALTER TABLE "content_interactions" DROP CONSTRAINT "content_interactions_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "poll" jsonb;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "flair" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "crosspost_of" uuid;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD COLUMN "poll_option" integer;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD COLUMN "flair" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "post_flair" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "user_flair" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "require_post_flair" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_crosspost_of_content_id_fk" FOREIGN KEY ("crosspost_of") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_kind" CHECK ("content_interactions"."kind" in ('like', 'up', 'down', 'flag', 'view', 'save', 'hide', 'poll'));