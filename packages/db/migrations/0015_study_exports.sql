CREATE TABLE "study_exports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "study_exports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_id" uuid NOT NULL,
	"by" text NOT NULL,
	"included_recruitment_ids" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_exports" ADD CONSTRAINT "study_exports_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_exports_study" ON "study_exports" USING btree ("study_id","id");