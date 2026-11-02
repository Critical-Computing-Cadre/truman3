CREATE TABLE "content_packs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"contents" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_created_by_researchers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_packs_team" ON "content_packs" USING btree ("team_id");