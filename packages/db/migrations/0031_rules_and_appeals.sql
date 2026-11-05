CREATE TABLE "scripted_appeal_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"after_ms" bigint NOT NULL,
	"message" text,
	"position" integer NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "scripted_appeal_answers_action" CHECK ("scripted_appeal_answers"."action" in ('uphold', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "scripted_auto_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"on" text NOT NULL,
	"match" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"after_ms" bigint NOT NULL,
	"message" text,
	"hold_outcome" text,
	"position" integer NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "scripted_auto_rules_on" CHECK ("scripted_auto_rules"."on" in ('post', 'comment', 'both')),
	CONSTRAINT "scripted_auto_rules_action" CHECK ("scripted_auto_rules"."action" in ('confirm', 'remove', 'warn', 'hold'))
);
--> statement-breakpoint
ALTER TABLE "draft_items" DROP CONSTRAINT "draft_items_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_appeal_answers" ADD CONSTRAINT "scripted_appeal_answers_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_appeal_answers" ADD CONSTRAINT "scripted_appeal_answers_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_auto_rules" ADD CONSTRAINT "scripted_auto_rules_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_auto_rules" ADD CONSTRAINT "scripted_auto_rules_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_appeal_answers_version" ON "scripted_appeal_answers" USING btree ("study_version_id");--> statement-breakpoint
CREATE INDEX "scripted_auto_rules_version" ON "scripted_auto_rules" USING btree ("study_version_id");--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction', 'removal', 'flagAnswer', 'ban', 'reportAnswer', 'autoRule', 'appealAnswer', 'setting', 'space'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn', 'answer', 'ban', 'hold', 'approve', 'uphold', 'restore'));--> statement-breakpoint
-- These are part of a version, so they freeze with it, like its actors and content.
CREATE TRIGGER scripted_auto_rules_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_auto_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
--> statement-breakpoint
CREATE TRIGGER scripted_appeal_answers_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_appeal_answers
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
