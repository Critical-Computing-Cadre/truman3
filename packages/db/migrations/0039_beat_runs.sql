CREATE TABLE "beat_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"world_id" uuid NOT NULL,
	"beat" text NOT NULL,
	"run" integer NOT NULL,
	"status" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"reason" text,
	"actor_id" uuid,
	"content_id" uuid,
	"target_content_id" uuid,
	CONSTRAINT "beat_runs_status" CHECK ("beat_runs"."status" in ('pending', 'fired', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_target_content_id_content_id_fk" FOREIGN KEY ("target_content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beat_runs_once" ON "beat_runs" USING btree ("world_id","beat","run");--> statement-breakpoint
CREATE INDEX "beat_runs_due" ON "beat_runs" USING btree ("world_id","status","due_at");