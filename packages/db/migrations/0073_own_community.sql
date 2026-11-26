ALTER TABLE "community_days" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "community_days" ADD CONSTRAINT "community_days_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_days_world" ON "community_days" USING btree ("world_id");