-- A second seeded league with a vanity join code, shared publicly (e.g. on LinkedIn).
-- Unlike El Shabab (0008), which backfilled every existing player, this one starts with
-- just the admin (Aly) — newcomers join with the code and form a fresh leaderboard.
--
-- 'linkedin' is safe to keep in version control: it's a public share code by design.
-- join_code has no charset constraint and join_league() matches case-insensitively, so
-- the code works typed as linkedin / LinkedIn / LINKEDIN. created_by stays null, matching
-- the seeded-league convention noted in 0008 ("null for the seeded default league").

insert into leagues (name, join_code) values ('LinkedIn', 'linkedin')
  on conflict (join_code) do nothing;

insert into league_members (league_id, user_id)
  select l.id, p.id
  from leagues l
  cross join profiles p
  where l.join_code = 'linkedin' and p.is_admin
  on conflict do nothing;
