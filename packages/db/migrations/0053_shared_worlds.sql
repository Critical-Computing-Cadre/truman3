ALTER TABLE "actors" DROP CONSTRAINT "actors_driver";--> statement-breakpoint
DROP INDEX "beat_runs_once";--> statement-breakpoint
ALTER TABLE "beat_runs" ADD COLUMN "for_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "condition_id" uuid;--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_for_actor_id_actors_id_fk" FOREIGN KEY ("for_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_runs" ADD CONSTRAINT "beat_runs_once" UNIQUE NULLS NOT DISTINCT("world_id","beat","for_actor_id","run");--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_driver" CHECK ("actors"."driver" in ('scripted', 'llm', 'human', 'withdrawn'));