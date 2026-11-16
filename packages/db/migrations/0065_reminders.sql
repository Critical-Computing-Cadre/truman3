CREATE TABLE "reminders_sent" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reminders_sent_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"participant_id" uuid NOT NULL,
	"sent_on" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" text NOT NULL,
	CONSTRAINT "reminders_sent_once_a_day" UNIQUE("participant_id","sent_on")
);
--> statement-breakpoint
ALTER TABLE "prolific_actions" DROP CONSTRAINT "prolific_actions_action";--> statement-breakpoint
ALTER TABLE "prolific_links" ADD COLUMN "remind_after_hours" integer;--> statement-breakpoint
ALTER TABLE "prolific_links" ADD COLUMN "remind_message" text;--> statement-breakpoint
ALTER TABLE "prolific_links" ADD COLUMN "remind_by" uuid;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_links" ADD CONSTRAINT "prolific_links_remind_by_researchers_id_fk" FOREIGN KEY ("remind_by") REFERENCES "public"."researchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_actions" ADD CONSTRAINT "prolific_actions_action" CHECK ("prolific_actions"."action" in ('created draft', 'approved', 'paid bonus', 'unlinked', 'sent reminders', 'turned reminders on', 'turned reminders off'));