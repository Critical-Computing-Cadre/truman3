CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"world_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scan" text DEFAULT 'unscanned' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"held" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"decision" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "uploads_key_unique" UNIQUE("key"),
	CONSTRAINT "uploads_scan" CHECK ("uploads"."scan" in ('clear', 'flagged', 'unscanned')),
	CONSTRAINT "uploads_decision" CHECK ("uploads"."decision" is null or "uploads"."decision" in ('released', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_world" ON "uploads" USING btree ("world_id");--> statement-breakpoint
CREATE INDEX "uploads_participant" ON "uploads" USING btree ("participant_id");