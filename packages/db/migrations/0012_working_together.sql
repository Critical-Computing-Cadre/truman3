CREATE TABLE "draft_presence" (
	"draft_id" uuid NOT NULL,
	"researcher_id" uuid NOT NULL,
	"item_id" uuid,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_presence_draft_id_researcher_id_pk" PRIMARY KEY("draft_id","researcher_id")
);
--> statement-breakpoint
ALTER TABLE "draft_item_history" ADD COLUMN "change_id" uuid DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_item_history" ADD COLUMN "previous_data" jsonb;--> statement-breakpoint
ALTER TABLE "draft_item_history" ADD COLUMN "undone_by" uuid;--> statement-breakpoint
ALTER TABLE "draft_presence" ADD CONSTRAINT "draft_presence_draft_id_study_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."study_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_presence" ADD CONSTRAINT "draft_presence_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE cascade ON UPDATE no action;