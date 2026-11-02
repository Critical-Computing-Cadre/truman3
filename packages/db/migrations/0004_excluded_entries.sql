CREATE TABLE "excluded_entries" (
	"study_id" uuid NOT NULL,
	"id_hash" text NOT NULL,
	CONSTRAINT "excluded_entries_study_id_id_hash_pk" PRIMARY KEY("study_id","id_hash")
);
--> statement-breakpoint
ALTER TABLE "excluded_entries" ADD CONSTRAINT "excluded_entries_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Same as before, and now also stops the same recruitment ID from entering this study again.
CREATE OR REPLACE FUNCTION delete_participant_data(p_participant uuid, p_reason text, p_requested_by text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  world_ids uuid[];
  deleted_events integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM world_memberships m JOIN worlds w ON w.id = m.world_id
    WHERE m.participant_id = p_participant AND w.mode <> 'solo'
  ) THEN
    RAISE EXCEPTION 'participant % is in a shared world, which deletion does not handle yet', p_participant;
  END IF;

  INSERT INTO excluded_entries (study_id, id_hash)
    SELECT study_id, encode(sha256(convert_to(study_id::text || ':' || external_id, 'UTF8')), 'hex')
    FROM participants WHERE id = p_participant
    ON CONFLICT DO NOTHING;

  SELECT coalesce(array_agg(world_id), '{}') INTO world_ids
    FROM world_memberships WHERE participant_id = p_participant;

  PERFORM set_config('truman.allow_participant_deletion', 'on', true);
  DELETE FROM events WHERE participant_id = p_participant OR world_id = ANY (world_ids);
  GET DIAGNOSTICS deleted_events = ROW_COUNT;
  DELETE FROM assignments WHERE participant_id = p_participant;
  PERFORM set_config('truman.allow_participant_deletion', 'off', true);

  DELETE FROM feed_impressions WHERE world_id = ANY (world_ids);
  DELETE FROM world_memberships WHERE participant_id = p_participant;
  DELETE FROM content WHERE world_id = ANY (world_ids);
  DELETE FROM actors WHERE world_id = ANY (world_ids);
  DELETE FROM worlds WHERE id = ANY (world_ids);
  DELETE FROM participants WHERE id = p_participant;

  INSERT INTO data_deletions (participant_id, reason, requested_by, events_deleted)
    VALUES (p_participant, p_reason, p_requested_by, deleted_events);
  RETURN deleted_events;
END $$;
