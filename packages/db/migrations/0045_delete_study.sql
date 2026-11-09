-- Deleting a study for good (ADR 58). Frozen versions and the event log refuse to change, so this
-- is the one way past them: a function that runs as the tables' owner. The rules let a deletion
-- through only when this function has turned it on and is running with the owner's rights, so the
-- API's login can't turn it on for itself.
CREATE OR REPLACE FUNCTION study_deletion_allowed(p_table name) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('truman.allow_study_deletion', true) = 'on'
    AND current_user = (SELECT tableowner FROM pg_tables
                        WHERE schemaname = 'public' AND tablename = p_table);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('truman.allow_participant_deletion', true) = 'on' AND tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  IF tg_op = 'DELETE' AND study_deletion_allowed(tg_table_name) THEN
    RETURN old;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', tg_table_name, tg_op;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_frozen_definition_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb := to_jsonb(CASE WHEN tg_op = 'DELETE' THEN old ELSE new END);
BEGIN
  IF tg_op = 'DELETE' AND study_deletion_allowed(tg_table_name) THEN
    RETURN old;
  END IF;
  IF row_data ->> 'world_id' IS NULL AND EXISTS (
    SELECT 1 FROM study_versions
    WHERE id = (row_data ->> 'study_version_id')::uuid AND frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '% belongs to a frozen study version: % is not allowed', tg_table_name, tg_op;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_frozen_reaction_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_id uuid := CASE WHEN tg_op = 'DELETE' THEN old.study_version_id ELSE new.study_version_id END;
BEGIN
  IF tg_op = 'DELETE' AND study_deletion_allowed(tg_table_name) THEN
    RETURN old;
  END IF;
  IF EXISTS (SELECT 1 FROM study_versions WHERE id = version_id AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'scripted_reactions belongs to a frozen study version: % is not allowed', tg_op;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_frozen_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'DELETE' AND study_deletion_allowed(tg_table_name) THEN
    RETURN old;
  END IF;
  IF old.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'study version % is frozen', old.id;
  END IF;
  RETURN coalesce(new, old);
END $$;
--> statement-breakpoint
-- Deletes an archived study and everything in it. It refuses a study that real people took part in,
-- that has withdrawals on record, or that paid anyone on Prolific: that's research data and its
-- records, which stay. Test participants, including scenario tests, go with the study.
CREATE OR REPLACE FUNCTION delete_study(p_study uuid, p_requested_by text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  the_study studies%ROWTYPE;
  version_ids uuid[];
  world_ids uuid[];
  participant_ids uuid[];
  draft_ids uuid[];
  the_title text;
BEGIN
  SELECT * INTO the_study FROM studies WHERE id = p_study FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'study % does not exist', p_study;
  END IF;
  IF the_study.archived_at IS NULL THEN
    RAISE EXCEPTION 'study % is not archived', p_study;
  END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE study_id = p_study AND NOT is_pilot) THEN
    RAISE EXCEPTION 'study % has had real participants', p_study;
  END IF;
  IF EXISTS (SELECT 1 FROM data_deletions WHERE study_id = p_study AND reason <> 'scenario test') THEN
    RAISE EXCEPTION 'study % has withdrawals on record', p_study;
  END IF;
  IF EXISTS (SELECT 1 FROM prolific_actions WHERE study_id = p_study)
     OR EXISTS (SELECT 1 FROM prolific_bonuses WHERE study_id = p_study) THEN
    RAISE EXCEPTION 'study % has Prolific payments on record', p_study;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO version_ids FROM study_versions WHERE study_id = p_study;
  SELECT coalesce(array_agg(id), '{}') INTO world_ids FROM worlds WHERE study_version_id = ANY (version_ids);
  SELECT coalesce(array_agg(id), '{}') INTO participant_ids FROM participants WHERE study_id = p_study;
  SELECT coalesce(array_agg(id), '{}') INTO draft_ids FROM study_drafts WHERE study_id = p_study;
  SELECT coalesce(
    (SELECT settings ->> 'title' FROM study_versions WHERE study_id = p_study ORDER BY version DESC LIMIT 1),
    (SELECT settings ->> 'title' FROM study_drafts WHERE study_id = p_study ORDER BY created_at DESC LIMIT 1),
    the_study.slug
  ) INTO the_title;

  PERFORM set_config('truman.allow_study_deletion', 'on', true);

  -- What happened in its worlds, which were all test participants'.
  DELETE FROM events WHERE study_version_id = ANY (version_ids);
  DELETE FROM feed_impressions WHERE world_id = ANY (world_ids);
  DELETE FROM notifications WHERE world_id = ANY (world_ids);
  DELETE FROM beat_runs WHERE world_id = ANY (world_ids);
  DELETE FROM content_interactions WHERE world_id = ANY (world_ids);
  DELETE FROM space_memberships WHERE world_id = ANY (world_ids);
  DELETE FROM actor_relations WHERE world_id = ANY (world_ids);
  DELETE FROM world_memberships WHERE world_id = ANY (world_ids);
  DELETE FROM sessions WHERE participant_id = ANY (participant_ids);
  DELETE FROM assignments WHERE participant_id = ANY (participant_ids);

  -- Its drafts, and the records of launching, downloading, testing, and recruiting it.
  DELETE FROM draft_presence WHERE draft_id = ANY (draft_ids);
  DELETE FROM draft_item_history WHERE draft_id = ANY (draft_ids);
  DELETE FROM draft_items WHERE draft_id = ANY (draft_ids);
  DELETE FROM study_drafts WHERE id = ANY (draft_ids);
  DELETE FROM study_launches WHERE study_id = p_study;
  DELETE FROM study_exports WHERE study_id = p_study;
  DELETE FROM scenario_runs WHERE study_version_id = ANY (version_ids);
  DELETE FROM prolific_links WHERE study_id = p_study;
  DELETE FROM data_deletions WHERE study_id = p_study;
  DELETE FROM excluded_entries WHERE study_id = p_study;

  -- Its versions and what they're made of.
  DELETE FROM scripted_reactions WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_removals WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_flag_answers WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_bans WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_report_answers WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_auto_rules WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_appeal_answers WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_context_notes WHERE study_version_id = ANY (version_ids);
  DELETE FROM scripted_labels WHERE study_version_id = ANY (version_ids);
  DELETE FROM content WHERE study_version_id = ANY (version_ids);
  DELETE FROM spaces WHERE study_version_id = ANY (version_ids);
  DELETE FROM actors WHERE study_version_id = ANY (version_ids);
  DELETE FROM worlds WHERE id = ANY (world_ids);
  DELETE FROM participants WHERE id = ANY (participant_ids);
  DELETE FROM conditions WHERE study_version_id = ANY (version_ids);
  DELETE FROM assignment_counters WHERE study_version_id = ANY (version_ids);
  UPDATE studies SET live_version_id = NULL WHERE id = p_study;
  DELETE FROM study_versions WHERE id = ANY (version_ids);
  DELETE FROM studies WHERE id = p_study;

  PERFORM set_config('truman.allow_study_deletion', 'off', true);

  INSERT INTO study_deletions (study_id, slug, title, requested_by)
    VALUES (p_study, the_study.slug, the_title, p_requested_by);
  RETURN coalesce(array_length(world_ids, 1), 0);
END $$;
