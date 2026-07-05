-- The Reveal — let players see each other's predictions, but only after a match
-- locks (kickoff − 5 min). Mirrors the existing write-lock philosophy in
-- 0001_initial_schema.sql: nothing about a match is exposed until it locks.
--
-- Permissive SELECT policies are OR'd together, so these ADD to the existing
-- owner-only "read own predictions" / "read own prediction scorers" policies:
-- a player still sees their own picks at any time, and everyone else's picks
-- for a match only once that match has locked. Upcoming matches stay secret.
--
-- All other tables needed for the reveal (profiles, matches, match_scores,
-- squad_players, match_goals) are already authenticated-readable.

create policy "read others predictions after lock" on predictions
  for select to authenticated
  using (
    exists (
      select 1 from matches m
      where m.id = match_id and m.lock_at <= now()
    )
  );

create policy "read others prediction scorers after lock" on prediction_scorers
  for select to authenticated
  using (
    exists (
      select 1 from predictions p
      join matches m on m.id = p.match_id
      where p.id = prediction_id and m.lock_at <= now()
    )
  );
