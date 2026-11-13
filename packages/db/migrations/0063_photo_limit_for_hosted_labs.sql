-- A lab on a hosted Truman starts with a limit on its participants' photos (ADR 80). Labs approved
-- before that limit existed have none. This gives them the one a lab approved today starts with,
-- 5 GB, which an operator can change on the Labs page.
--
-- Only labs that have the other limits a hosted lab is given, so a team made on someone's own
-- server, which has no limits, is left without one. And only where there's no photo limit yet.
UPDATE teams
SET limits = limits || '{"uploadsGb": 5}'::jsonb
WHERE limits ? 'participantsPerMonth'
  AND NOT limits ? 'uploadsGb';
