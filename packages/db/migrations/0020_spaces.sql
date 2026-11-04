CREATE TABLE "space_memberships" (
	"world_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"joined" boolean NOT NULL,
	CONSTRAINT "space_memberships_world_id_actor_id_space_id_pk" PRIMARY KEY("world_id","actor_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" text,
	"starts_joined" boolean DEFAULT true NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD COLUMN "sort" text;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD CONSTRAINT "space_memberships_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD CONSTRAINT "space_memberships_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD CONSTRAINT "space_memberships_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_version_key" ON "spaces" USING btree ("study_version_id","key");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'setting', 'space'));--> statement-breakpoint
-- Spaces are part of a study version, so they freeze with it, like its actors and content.
CREATE TRIGGER spaces_frozen BEFORE INSERT OR UPDATE OR DELETE ON spaces
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
