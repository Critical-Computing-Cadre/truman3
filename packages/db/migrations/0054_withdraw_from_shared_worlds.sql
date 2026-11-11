-- Withdrawing someone from a shared world (ADR 67). Before this, deletion refused shared worlds.
--
-- In a world of their own, everything in it is theirs, so it all goes, as before. In a shared world,
-- the others' records stay. What the participant did, saw, and was sent goes, as does their account.
-- What they wrote, and messages to them, are wiped and marked withdrawn, rather than deleted, since
-- others' events point at those rows. Their actor stays as "Withdrawn", with nothing about them.
CREATE OR REPLACE FUNCTION delete_participant_data(p_participant uuid, p_reason text, p_requested_by text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  solo_worlds uuid[];
  shared_worlds uuid[];
  their_actors uuid[];
  deleted_events integer;
  the_study uuid;
BEGIN
  SELECT study_id INTO the_study FROM participants WHERE id = p_participant;

  INSERT INTO excluded_entries (study_id, id_hash)
    SELECT study_id, encode(sha256(convert_to(study_id::text || ':' || external_id, 'UTF8')), 'hex')
    FROM participants WHERE id = p_participant
    ON CONFLICT DO NOTHING;

  SELECT coalesce(array_agg(m.world_id) FILTER (WHERE w.mode = 'solo'), '{}'),
         coalesce(array_agg(m.world_id) FILTER (WHERE w.mode = 'shared'), '{}'),
         coalesce(array_agg(m.actor_id), '{}')
    INTO solo_worlds, shared_worlds, their_actors
    FROM world_memberships m JOIN worlds w ON w.id = m.world_id
    WHERE m.participant_id = p_participant;

  PERFORM set_config('truman.allow_participant_deletion', 'on', true);
  DELETE FROM events WHERE participant_id = p_participant OR world_id = ANY (solo_worlds);
  GET DIAGNOSTICS deleted_events = ROW_COUNT;
  DELETE FROM assignments WHERE participant_id = p_participant;
  PERFORM set_config('truman.allow_participant_deletion', 'off', true);

  -- Shared worlds: only what was theirs.
  DELETE FROM feed_impressions
    WHERE world_id = ANY (shared_worlds) AND viewer_actor_id = ANY (their_actors);
  DELETE FROM notifications
    WHERE world_id = ANY (shared_worlds)
      AND (recipient_actor_id = ANY (their_actors) OR actor_id = ANY (their_actors));
  DELETE FROM content_interactions
    WHERE world_id = ANY (shared_worlds) AND actor_id = ANY (their_actors);
  DELETE FROM actor_relations
    WHERE world_id = ANY (shared_worlds) AND actor_id = ANY (their_actors);
  DELETE FROM beat_runs
    WHERE world_id = ANY (shared_worlds) AND for_actor_id = ANY (their_actors);
  UPDATE content
    SET body = '', title = NULL, link_url = NULL, poll = NULL, place = NULL, flair = NULL,
        attachments = '[]'::jsonb, tagged_actor_ids = '{}', withdrawn_at = now()
    WHERE world_id = ANY (shared_worlds)
      AND (author_actor_id = ANY (their_actors)
        OR (kind = 'message' AND recipient_actor_id = ANY (their_actors)));
  DELETE FROM world_memberships WHERE participant_id = p_participant;
  UPDATE actors
    SET driver = 'withdrawn', participant_id = NULL, profile = '{"name": "Withdrawn"}'::jsonb,
        username = 'withdrawn-' || substr(md5(id::text), 1, 8)
    WHERE id = ANY (their_actors) AND world_id = ANY (shared_worlds);

  -- A world of their own: all of it, as before.
  DELETE FROM feed_impressions WHERE world_id = ANY (solo_worlds);
  DELETE FROM content WHERE world_id = ANY (solo_worlds);
  DELETE FROM actors WHERE world_id = ANY (solo_worlds);
  DELETE FROM worlds WHERE id = ANY (solo_worlds);

  DELETE FROM participants WHERE id = p_participant;

  INSERT INTO data_deletions (participant_id, study_id, reason, requested_by, events_deleted)
    VALUES (p_participant, the_study, p_reason, p_requested_by, deleted_events);
  RETURN deleted_events;
END $$;
