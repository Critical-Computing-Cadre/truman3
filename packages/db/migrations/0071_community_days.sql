CREATE TABLE "community_days" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"day" integer NOT NULL,
	"status" text NOT NULL,
	"written" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped" integer DEFAULT 0 NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"cost_usd" numeric DEFAULT 0 NOT NULL,
	"error" text,
	"decided_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	CONSTRAINT "community_days_study_version_id_condition_day_unique" UNIQUE("study_version_id","condition","day")
);
--> statement-breakpoint
ALTER TABLE "community_days" ADD CONSTRAINT "community_days_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_days" ADD CONSTRAINT "community_days_decided_by_researchers_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;