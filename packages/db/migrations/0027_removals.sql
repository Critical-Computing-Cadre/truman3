CREATE TABLE "scripted_removals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"offset_ms" bigint NOT NULL,
	"reason" text,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text
);
--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_reactions" DROP CONSTRAINT "scripted_reactions_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "scripted_removals" ADD CONSTRAINT "scripted_removals_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_removals" ADD CONSTRAINT "scripted_removals_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_removals" ADD CONSTRAINT "scripted_removals_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_removals_version" ON "scripted_removals" USING btree ("study_version_id");--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'setting', 'space'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove'));--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_type" CHECK ("scripted_reactions"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove'));--> statement-breakpoint
-- A study's removals are part of its version, so they freeze with it, like its actors and content.
CREATE TRIGGER scripted_removals_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_removals
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
