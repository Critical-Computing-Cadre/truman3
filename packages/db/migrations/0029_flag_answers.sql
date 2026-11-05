CREATE TABLE "scripted_flag_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"content_id" uuid,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"after_ms" bigint NOT NULL,
	"message" text,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "scripted_flag_answers_action" CHECK ("scripted_flag_answers"."action" in ('remove', 'answer'))
);
--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_flag_answers" ADD CONSTRAINT "scripted_flag_answers_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_flag_answers" ADD CONSTRAINT "scripted_flag_answers_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_flag_answers" ADD CONSTRAINT "scripted_flag_answers_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_flag_answers_version" ON "scripted_flag_answers" USING btree ("study_version_id");--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'flagAnswer', 'setting', 'space'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn', 'answer'));--> statement-breakpoint
-- A study's answers are part of its version, so they freeze with it, like its actors and content.
CREATE TRIGGER scripted_flag_answers_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_flag_answers
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
