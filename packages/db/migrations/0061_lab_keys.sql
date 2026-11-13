ALTER TABLE "participants" ADD COLUMN "external_id_sealed" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "data_key_wrapped" text;