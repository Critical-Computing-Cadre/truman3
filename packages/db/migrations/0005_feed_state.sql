CREATE TABLE "actor_relations" (
	"world_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "actor_relations_world_id_actor_id_target_actor_id_kind_pk" PRIMARY KEY("world_id","actor_id","target_actor_id","kind"),
	CONSTRAINT "actor_relations_kind" CHECK ("actor_relations"."kind" in ('follow', 'block', 'report'))
);
--> statement-breakpoint
CREATE TABLE "content_interactions" (
	"world_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "content_interactions_world_id_actor_id_content_id_kind_pk" PRIMARY KEY("world_id","actor_id","content_id","kind"),
	CONSTRAINT "content_interactions_kind" CHECK ("content_interactions"."kind" in ('like', 'flag', 'view'))
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "actor_relations" ADD CONSTRAINT "actor_relations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_relations" ADD CONSTRAINT "actor_relations_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_relations" ADD CONSTRAINT "actor_relations_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;