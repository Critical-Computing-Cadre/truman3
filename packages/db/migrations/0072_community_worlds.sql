CREATE TABLE "community_day_worlds" (
	"day_id" uuid NOT NULL,
	"world_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_day_worlds_day_id_world_id_pk" PRIMARY KEY("day_id","world_id")
);
--> statement-breakpoint
ALTER TABLE "community_days" ADD COLUMN "removed" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_day_worlds" ADD CONSTRAINT "community_day_worlds_day_id_community_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."community_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_day_worlds" ADD CONSTRAINT "community_day_worlds_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;