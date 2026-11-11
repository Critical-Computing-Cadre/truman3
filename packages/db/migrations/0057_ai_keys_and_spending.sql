CREATE TABLE "ai_spending" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_spending_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" uuid,
	"study_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric NOT NULL,
	"paid_by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_spending_paid_by" CHECK ("ai_spending"."paid_by" in ('lab', 'host'))
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "anthropic_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "anthropic_key_hint" text;--> statement-breakpoint
ALTER TABLE "ai_spending" ADD CONSTRAINT "ai_spending_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_spending" ADD CONSTRAINT "ai_spending_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_spending_team" ON "ai_spending" USING btree ("team_id","paid_by");