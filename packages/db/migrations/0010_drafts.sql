CREATE TABLE "draft_item_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "draft_item_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"data" jsonb NOT NULL,
	"researcher_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "draft_items_kind" CHECK ("draft_items"."kind" in ('actor', 'post', 'comment', 'reaction'))
);
--> statement-breakpoint
CREATE TABLE "study_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_id" uuid NOT NULL,
	"based_on_version_id" uuid,
	"settings" jsonb NOT NULL,
	"pages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"frozen_version_id" uuid
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_item_history" ADD CONSTRAINT "draft_item_history_draft_id_study_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."study_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_item_history" ADD CONSTRAINT "draft_item_history_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_draft_id_study_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."study_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_items" ADD CONSTRAINT "draft_items_updated_by_researchers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_drafts" ADD CONSTRAINT "study_drafts_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_drafts" ADD CONSTRAINT "study_drafts_based_on_version_id_study_versions_id_fk" FOREIGN KEY ("based_on_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_drafts" ADD CONSTRAINT "study_drafts_created_by_researchers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_drafts" ADD CONSTRAINT "study_drafts_frozen_version_id_study_versions_id_fk" FOREIGN KEY ("frozen_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_item_history_item" ON "draft_item_history" USING btree ("item_id","id");--> statement-breakpoint
CREATE INDEX "draft_items_draft" ON "draft_items" USING btree ("draft_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "study_drafts_one_open" ON "study_drafts" USING btree ("study_id") WHERE "study_drafts"."closed_at" is null;