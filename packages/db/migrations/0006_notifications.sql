CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"world_id" uuid NOT NULL,
	"recipient_actor_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target_content_id" uuid NOT NULL,
	"reply_content_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply'))
);
--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD COLUMN "surface" text DEFAULT 'feed' NOT NULL;--> statement-breakpoint
ALTER TABLE "world_memberships" ADD COLUMN "notifications_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_actor_id_actors_id_fk" FOREIGN KEY ("recipient_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_content_id_content_id_fk" FOREIGN KEY ("target_content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reply_content_id_content_id_fk" FOREIGN KEY ("reply_content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient" ON "notifications" USING btree ("world_id","recipient_actor_id","due_at");