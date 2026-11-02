CREATE TABLE "scripted_reactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"study_version_id" uuid NOT NULL,
	"on" text NOT NULL,
	"nth" integer NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"after_ms" bigint NOT NULL,
	"body" text,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"class" text,
	CONSTRAINT "scripted_reactions_on" CHECK ("scripted_reactions"."on" in ('post', 'comment')),
	CONSTRAINT "scripted_reactions_type" CHECK ("scripted_reactions"."type" in ('read', 'like', 'reply'))
);
--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_study_version_id_study_versions_id_fk" FOREIGN KEY ("study_version_id") REFERENCES "public"."study_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripted_reactions_trigger" ON "scripted_reactions" USING btree ("study_version_id","on","nth");--> statement-breakpoint
CREATE FUNCTION forbid_frozen_reaction_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_id uuid := CASE WHEN tg_op = 'DELETE' THEN old.study_version_id ELSE new.study_version_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM study_versions WHERE id = version_id AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'scripted_reactions belongs to a frozen study version: % is not allowed', tg_op;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
CREATE TRIGGER scripted_reactions_frozen BEFORE INSERT OR UPDATE OR DELETE ON scripted_reactions
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_reaction_change();
