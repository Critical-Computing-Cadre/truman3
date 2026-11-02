CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"world_id" uuid,
	"participant_id" uuid,
	"username" text NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"driver" text NOT NULL,
	"driver_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "actors_driver" CHECK ("actors"."driver" in ('scripted', 'llm', 'human')),
	CONSTRAINT "actors_human_is_participant" CHECK (("actors"."driver" = 'human') = ("actors"."participant_id" is not null)),
	CONSTRAINT "actors_participant_has_world" CHECK ("actors"."participant_id" is null or "actors"."world_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "assignment_counters" (
	"study_version_id" uuid PRIMARY KEY NOT NULL,
	"next_position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"participant_id" uuid NOT NULL,
	"study_version_id" uuid NOT NULL,
	"condition_id" uuid NOT NULL,
	"decision_point" text,
	"method" text NOT NULL,
	"probability" numeric NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_probability" CHECK ("assignments"."probability" > 0 and "assignments"."probability" <= 1)
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"factors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "conditions_study_version_id_key_unique" UNIQUE("study_version_id","key"),
	CONSTRAINT "conditions_id_study_version_id_unique" UNIQUE("id","study_version_id"),
	CONSTRAINT "conditions_weight_positive" CHECK ("conditions"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"world_id" uuid,
	"parent_id" uuid,
	"author_actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"media_key" text,
	"offset_ms" bigint,
	"visible_at" timestamp with time zone,
	"base_likes" integer DEFAULT 0 NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_kind" CHECK ("content"."kind" in ('post', 'comment')),
	CONSTRAINT "content_comment_has_parent" CHECK (("content"."kind" = 'comment') = ("content"."parent_id" is not null)),
	CONSTRAINT "content_timing" CHECK (("content"."world_id" is null and "content"."offset_ms" is not null and "content"."visible_at" is null)
        or ("content"."world_id" is not null and "content"."visible_at" is not null and "content"."offset_ms" is null))
);
--> statement-breakpoint
CREATE TABLE "data_deletions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_deletions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"participant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"events_deleted" integer NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"world_id" uuid NOT NULL,
	"study_version_id" uuid NOT NULL,
	"participant_id" uuid,
	"condition_id" uuid,
	"actor_id" uuid,
	"source" text NOT NULL,
	"target_content_id" uuid,
	"target_actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_event_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_world_id_client_event_id_unique" UNIQUE("world_id","client_event_id"),
	CONSTRAINT "events_source" CHECK ("events"."source" in ('participant', 'script', 'llm', 'researcher', 'system'))
);
--> statement-breakpoint
CREATE TABLE "feed_impressions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feed_impressions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"world_id" uuid NOT NULL,
	"viewer_actor_id" uuid NOT NULL,
	"condition_id" uuid,
	"ranker" text NOT NULL,
	"ranker_version" text NOT NULL,
	"items" jsonb NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_study_id_external_id_unique" UNIQUE("study_id","external_id"),
	CONSTRAINT "participants_status" CHECK ("participants"."status" in ('active', 'completed', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "study_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"pages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"seed" bigint NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_versions_study_id_version_unique" UNIQUE("study_id","version")
);
--> statement-breakpoint
CREATE TABLE "world_memberships" (
	"world_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "world_memberships_world_id_participant_id_pk" PRIMARY KEY("world_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"mode" text DEFAULT 'solo' NOT NULL,
	"seed" bigint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "worlds_mode" CHECK ("worlds"."mode" in ('solo', 'shared'))
);
--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_counters" ADD CONSTRAINT "assignment_counters_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_condition_id_study_version_id_conditions_id_study_version_id_fk" FOREIGN KEY ("condition_id","study_version_id") REFERENCES "public"."conditions"("id","study_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_parent_id_content_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_target_content_id_content_id_fk" FOREIGN KEY ("target_content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_viewer_actor_id_actors_id_fk" FOREIGN KEY ("viewer_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_memberships" ADD CONSTRAINT "world_memberships_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_memberships" ADD CONSTRAINT "world_memberships_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_memberships" ADD CONSTRAINT "world_memberships_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actors_cast_username" ON "actors" USING btree ("study_version_id","username") WHERE "actors"."world_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "actors_world_username" ON "actors" USING btree ("world_id","username") WHERE "actors"."world_id" is not null;--> statement-breakpoint
CREATE INDEX "content_scripted_feed" ON "content" USING btree ("study_version_id","offset_ms") WHERE "content"."world_id" is null and "content"."kind" = 'post';--> statement-breakpoint
CREATE INDEX "content_world_feed" ON "content" USING btree ("world_id","visible_at") WHERE "content"."world_id" is not null;--> statement-breakpoint
CREATE INDEX "content_parent" ON "content" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "events_world" ON "events" USING btree ("world_id","id");--> statement-breakpoint
CREATE INDEX "events_participant" ON "events" USING btree ("participant_id","id");--> statement-breakpoint
CREATE INDEX "events_version_type" ON "events" USING btree ("study_version_id","type","id");--> statement-breakpoint
CREATE INDEX "feed_impressions_world" ON "feed_impressions" USING btree ("world_id","id");