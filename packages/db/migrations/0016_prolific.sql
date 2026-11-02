CREATE TABLE "prolific_actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prolific_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_id" uuid NOT NULL,
	"by" text NOT NULL,
	"action" text NOT NULL,
	"people" integer,
	"amount" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prolific_actions_action" CHECK ("prolific_actions"."action" in ('created draft', 'approved', 'paid bonus', 'unlinked'))
);
--> statement-breakpoint
CREATE TABLE "prolific_bonuses" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" uuid NOT NULL,
	"people" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"created_by" text NOT NULL,
	"paying_at" timestamp with time zone,
	"paid_by" text
);
--> statement-breakpoint
CREATE TABLE "prolific_connections" (
	"researcher_id" uuid PRIMARY KEY NOT NULL,
	"token_encrypted" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prolific_links" (
	"study_id" uuid PRIMARY KEY NOT NULL,
	"prolific_study_id" text NOT NULL,
	"review_mode" text NOT NULL,
	"codes" jsonb NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prolific_links_review_mode" CHECK ("prolific_links"."review_mode" in ('manual', 'automatic'))
);
--> statement-breakpoint
ALTER TABLE "prolific_actions" ADD CONSTRAINT "prolific_actions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_bonuses" ADD CONSTRAINT "prolific_bonuses_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_connections" ADD CONSTRAINT "prolific_connections_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_links" ADD CONSTRAINT "prolific_links_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prolific_actions_study" ON "prolific_actions" USING btree ("study_id","id");--> statement-breakpoint
CREATE INDEX "prolific_bonuses_study" ON "prolific_bonuses" USING btree ("study_id");