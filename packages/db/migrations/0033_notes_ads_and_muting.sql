CREATE TABLE "scripted_context_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"content_id" uuid NOT NULL,
	"body" text NOT NULL,
	"offset_ms" bigint NOT NULL,
	"base_helpful" integer DEFAULT 0 NOT NULL,
	"base_not_helpful" integer DEFAULT 0 NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text
);
--> statement-breakpoint
ALTER TABLE "actor_relations" DROP CONSTRAINT "actor_relations_kind";--> statement-breakpoint
ALTER TABLE "content_interactions" DROP CONSTRAINT "content_interactions_kind";--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "ad_label" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "base_views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scripted_context_notes" ADD CONSTRAINT "scripted_context_notes_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_context_notes" ADD CONSTRAINT "scripted_context_notes_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_context_notes_version" ON "scripted_context_notes" USING btree ("study_version_id");--> statement-breakpoint
ALTER TABLE "actor_relations" ADD CONSTRAINT "actor_relations_kind" CHECK ("actor_relations"."kind" in ('follow', 'block', 'report', 'mute'));--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_kind" CHECK ("content_interactions"."kind" in ('like', 'up', 'down', 'flag', 'view', 'save', 'hide', 'poll', 'note_helpful', 'note_not_helpful'));--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'flagAnswer', 'ban', 'reportAnswer', 'autoRule', 'appealAnswer', 'contextNote', 'setting', 'space'));--> statement-breakpoint
-- Context notes are part of a version, so they freeze with it, like its actors and content.
CREATE TRIGGER scripted_context_notes_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_context_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
