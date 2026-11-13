CREATE TABLE "key_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "key_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "key_events_kind" CHECK ("key_events"."kind" in ('used', 'changed'))
);
--> statement-breakpoint
ALTER TABLE "key_events" ADD CONSTRAINT "key_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "key_events_team" ON "key_events" USING btree ("team_id","at");