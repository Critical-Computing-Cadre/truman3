CREATE TABLE "scripted_bans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"banned_actor_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"offset_ms" bigint NOT NULL,
	"reason" text,
	"space_id" uuid,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text
);
--> statement-breakpoint
CREATE TABLE "scripted_report_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"reported_actor_id" uuid,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"after_ms" bigint NOT NULL,
	"message" text,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "scripted_report_answers_action" CHECK ("scripted_report_answers"."action" in ('answer', 'ban'))
);
--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "target_content_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "target_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "scripted_bans" ADD CONSTRAINT "scripted_bans_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_bans" ADD CONSTRAINT "scripted_bans_banned_actor_id_actors_id_fk" FOREIGN KEY ("banned_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_bans" ADD CONSTRAINT "scripted_bans_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_bans" ADD CONSTRAINT "scripted_bans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_report_answers" ADD CONSTRAINT "scripted_report_answers_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_report_answers" ADD CONSTRAINT "scripted_report_answers_reported_actor_id_actors_id_fk" FOREIGN KEY ("reported_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_report_answers" ADD CONSTRAINT "scripted_report_answers_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_bans_version" ON "scripted_bans" USING btree ("study_version_id");--> statement-breakpoint
CREATE INDEX "scripted_report_answers_version" ON "scripted_report_answers" USING btree ("study_version_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'flagAnswer', 'ban', 'reportAnswer', 'setting', 'space'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_about_something" CHECK ("notifications"."target_content_id" is not null or "notifications"."target_actor_id" is not null);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn', 'answer', 'ban'));--> statement-breakpoint
-- These are part of a version, so they freeze with it, like its actors and content.
CREATE TRIGGER scripted_bans_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_bans
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
--> statement-breakpoint
CREATE TRIGGER scripted_report_answers_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_report_answers
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
