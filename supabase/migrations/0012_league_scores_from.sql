-- Per-league "start counting from" cutoff.
--
-- Until now every league summed a player's ENTIRE point history (points are global; a league
-- only filtered whose rows show). That makes a mid-tournament league unfair — whoever was
-- already playing carries their whole score in, newcomers start at zero. This gives each league
-- an optional start point: it counts a match's points only if the match kicked off at/after
-- leagues.scores_from. NULL = count everything (the original behaviour), so existing leagues are
-- untouched until told otherwise.
--
-- We key the cutoff off matches.kickoff_utc (when the game actually happened), never
-- match_scores.scored_at (which moves when the scoring job re-runs), so re-scoring an old match
-- can never shuffle it across the cutoff.
--
-- Idempotent: safe to re-apply.

-- ─────────────────────────────────────────────────────────────────────────────
-- Column — null means "count all history"
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leagues add column if not exists scores_from timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- league_leaderboard — the global `leaderboard` view, but scoped to one league AND
-- to its cutoff. Same row shape {user_id, display_name, total_points, matches_scored}.
-- SECURITY DEFINER + empty search_path mirrors the other league RPCs; the caller must
-- be a member. The cutoff is pre-applied inside the sub-query so a pre-cutoff score is
-- dropped from BOTH the sum and the count, while a member with no qualifying score still
-- appears (LEFT JOIN → sum 0, count 0).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.league_leaderboard(p_league_id uuid)
returns table (
  user_id        uuid,
  display_name   text,
  total_points   bigint,
  matches_scored bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid         uuid := auth.uid();
  v_scores_from timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_league_member(p_league_id, v_uid) then
    raise exception 'not a league member';
  end if;

  select l.scores_from into v_scores_from
    from public.leagues l
   where l.id = p_league_id;

  return query
    select p.id,
           p.display_name,
           coalesce(sum(s.points), 0)::bigint,
           count(s.match_id)::bigint
      from public.league_members lm
      join public.profiles p on p.id = lm.user_id
      left join (
        select ms.user_id, ms.match_id, ms.points
          from public.match_scores ms
          join public.matches m on m.id = ms.match_id
         where v_scores_from is null or m.kickoff_utc >= v_scores_from
      ) s on s.user_id = p.id
     where lm.league_id = p_league_id
     group by p.id, p.display_name
     order by 3 desc, 2 asc;   -- total_points desc, then display_name
end;
$$;
grant execute on function public.league_leaderboard(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_league — unchanged from 0008 except new leagues now default to counting
-- from the moment they're created, so a joiner never inherits pre-league points.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_league(p_name text)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_code   text;
  v_league public.leagues;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(trim(p_name), '')) < 2 or char_length(trim(p_name)) > 40 then
    raise exception 'league name must be 2 to 40 characters';
  end if;

  loop
    v_code := public.gen_join_code();
    exit when not exists (select 1 from public.leagues where join_code = v_code);
  end loop;

  insert into public.leagues (name, join_code, created_by, scores_from)
    values (trim(p_name), v_code, v_uid, now())
    returning * into v_league;

  insert into public.league_members (league_id, user_id)
    values (v_league.id, v_uid)
    on conflict do nothing;

  return v_league;
end;
$$;
grant execute on function public.create_league(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill existing leagues. LinkedIn starts at the first semifinal (its R16 + QF
-- reset to zero for everyone, including the admin). El Shabab stays NULL — the ALTER
-- above already left it that way — so it keeps counting the whole tournament.
-- ─────────────────────────────────────────────────────────────────────────────
update public.leagues
   set scores_from = (select min(m.kickoff_utc) from public.matches m where m.round = 'SF')
 where join_code = 'linkedin';
