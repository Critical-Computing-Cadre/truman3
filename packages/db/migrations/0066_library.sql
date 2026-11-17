CREATE TABLE "library_studies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"paper" text DEFAULT '' NOT NULL,
	"license" text NOT NULL,
	"bundle_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"about" jsonb NOT NULL,
	"status" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "library_studies_once" UNIQUE("team_id","content_hash"),
	CONSTRAINT "library_studies_status" CHECK ("library_studies"."status" in ('waiting', 'listed', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "library_studies" ADD CONSTRAINT "library_studies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_studies_status" ON "library_studies" USING btree ("status");