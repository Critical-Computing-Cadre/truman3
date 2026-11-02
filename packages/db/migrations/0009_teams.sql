CREATE TABLE "researcher_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"researcher_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "researchers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "researchers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" uuid NOT NULL,
	"researcher_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "team_memberships_team_id_researcher_id_pk" PRIMARY KEY("team_id","researcher_id"),
	CONSTRAINT "team_memberships_role" CHECK ("team_memberships"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "researcher_sessions" ADD CONSTRAINT "researcher_sessions_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "researcher_sessions_researcher" ON "researcher_sessions" USING btree ("researcher_id");--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;