CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"brief" text NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"budget_usd" numeric NOT NULL,
	"cost_usd" numeric DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"stopped" text,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_draft_id_study_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."study_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_started_by_researchers_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_draft" ON "agent_runs" USING btree ("draft_id");