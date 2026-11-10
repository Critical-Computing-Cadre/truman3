ALTER TABLE "content" DROP CONSTRAINT "content_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "recipient_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_recipient_actor_id_actors_id_fk" FOREIGN KEY ("recipient_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_messages" ON "content" USING btree ("world_id","recipient_actor_id") WHERE "content"."kind" = 'message';--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_message_has_recipient" CHECK (("content"."kind" = 'message') = ("content"."recipient_actor_id" is not null));--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_message_in_world" CHECK ("content"."kind" <> 'message' or "content"."world_id" is not null);--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_kind" CHECK ("content"."kind" in ('post', 'comment', 'story', 'message'));