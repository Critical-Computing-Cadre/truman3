CREATE TABLE "study_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"requested_by" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "archived_at" timestamp with time zone;