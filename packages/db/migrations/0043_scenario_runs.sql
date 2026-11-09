CREATE TABLE "scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "warn_untested" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;