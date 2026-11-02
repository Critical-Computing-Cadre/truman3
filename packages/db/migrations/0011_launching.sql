CREATE TABLE "study_launches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "study_launches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_id" uuid NOT NULL,
	"version_id" uuid,
	"action" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_launches_action" CHECK ("study_launches"."action" in ('launch', 'stop'))
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "is_pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "live_version_id" uuid;--> statement-breakpoint
ALTER TABLE "study_launches" ADD CONSTRAINT "study_launches_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_launches" ADD CONSTRAINT "study_launches_version_id_study_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_launches_study" ON "study_launches" USING btree ("study_id","id");--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_live_version_id_study_versions_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Studies that are already running keep running: their newest version stays what people get.
UPDATE studies SET live_version_id = (
  SELECT id FROM study_versions v
  WHERE v.study_id = studies.id AND v.frozen_at IS NOT NULL
  ORDER BY v.version DESC LIMIT 1
);
--> statement-breakpoint
INSERT INTO study_launches (study_id, version_id, action, by)
  SELECT id, live_version_id, 'launch', 'existing study, before launching was separate'
  FROM studies WHERE live_version_id IS NOT NULL;
