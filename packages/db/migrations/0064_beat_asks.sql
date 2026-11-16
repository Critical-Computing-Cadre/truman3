CREATE TABLE "beat_asks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"beat_run_id" uuid NOT NULL,
	"world_id" uuid NOT NULL,
	"recipient_actor_id" uuid NOT NULL,
	"beat" text NOT NULL,
	"title" text,
	"questions" jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"answers" jsonb,
	"took_ms" integer,
	CONSTRAINT "beat_asks_once" UNIQUE("beat_run_id")
);
--> statement-breakpoint
ALTER TABLE "beat_asks" ADD CONSTRAINT "beat_asks_beat_run_id_beat_runs_id_fk" FOREIGN KEY ("beat_run_id") REFERENCES "public"."beat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_asks" ADD CONSTRAINT "beat_asks_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_asks" ADD CONSTRAINT "beat_asks_recipient_actor_id_actors_id_fk" FOREIGN KEY ("recipient_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beat_asks_waiting" ON "beat_asks" USING btree ("world_id","recipient_actor_id","due_at");