CREATE TABLE "team_videos" (
	"team_id" uuid NOT NULL,
	"key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_videos_team_id_key_pk" PRIMARY KEY("team_id","key")
);
--> statement-breakpoint
ALTER TABLE "team_videos" ADD CONSTRAINT "team_videos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_videos" ADD CONSTRAINT "team_videos_uploaded_by_researchers_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."researchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Labs on a hosted Truman start with a limit on the videos their researchers upload (ADR 100).
-- Labs approved before it existed get the one a lab approved today starts with, 20 GB, which an
-- operator can change on the Labs page. Only labs with a hosted lab's other limits, so a team
-- made on someone's own server is left without one.
UPDATE teams
SET limits = limits || '{"videosGb": 20}'::jsonb
WHERE limits ? 'participantsPerMonth'
  AND NOT limits ? 'videosGb';
