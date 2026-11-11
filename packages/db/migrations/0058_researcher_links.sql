CREATE TABLE "researcher_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"researcher_id" uuid,
	"team_id" uuid,
	"role" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "researcher_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "researcher_links_kind" CHECK ("researcher_links"."kind" in ('reset', 'invite')),
	CONSTRAINT "researcher_links_role" CHECK ("researcher_links"."role" is null or "researcher_links"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "researcher_links" ADD CONSTRAINT "researcher_links_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "researcher_links" ADD CONSTRAINT "researcher_links_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "researcher_links" ADD CONSTRAINT "researcher_links_created_by_researchers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."researchers"("id") ON DELETE set null ON UPDATE no action;