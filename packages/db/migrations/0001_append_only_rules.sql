-- Rules the database enforces, so a bug in application code can't break them.
-- These guard against mistakes. Someone with full database access can still get around them.

-- Events and assignments can't be changed. The only exception is delete_participant_data below.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('truman.allow_participant_deletion', true) = 'on' AND tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', tg_table_name, tg_op;
END $$;
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER assignments_append_only BEFORE UPDATE OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER assignments_no_truncate BEFORE TRUNCATE ON assignments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- A frozen study version can't change.
CREATE FUNCTION forbid_frozen_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'study version % is frozen', old.id;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
CREATE TRIGGER study_versions_frozen BEFORE UPDATE OR DELETE ON study_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_version_change();
--> statement-breakpoint

-- Neither can what belongs to it: its conditions, its cast, and its scripted content.
-- Rows that belong to a world are what happens during a study, so those are allowed.
CREATE FUNCTION forbid_frozen_definition_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb := to_jsonb(CASE WHEN tg_op = 'DELETE' THEN old ELSE new END);
BEGIN
  IF row_data ->> 'world_id' IS NULL AND EXISTS (
    SELECT 1 FROM study_versions
    WHERE id = (row_data ->> 'study_version_id')::uuid AND frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '% belongs to a frozen study version: % is not allowed', tg_table_name, tg_op;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
CREATE TRIGGER conditions_frozen BEFORE INSERT OR UPDATE OR DELETE ON conditions
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
--> statement-breakpoint
CREATE TRIGGER actors_frozen BEFORE INSERT OR UPDATE OR DELETE ON actors
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
--> statement-breakpoint
CREATE TRIGGER content_frozen BEFORE INSERT OR UPDATE OR DELETE ON content
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_definition_change();
--> statement-breakpoint

-- The one sanctioned way to delete a participant's data, such as when they withdraw. It removes
-- their solo world and everything in it, and leaves a record that a deletion happened.
-- Shared worlds aren't handled yet, because other people's events can point at this
-- participant's content, so that needs a decision. It refuses rather than guessing.
CREATE FUNCTION delete_participant_data(p_participant uuid, p_reason text, p_requested_by text)
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
