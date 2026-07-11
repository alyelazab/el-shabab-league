-- Leagues — private groups that each keep their own leaderboard.
--
-- Matches, predictions and scores stay global: everyone predicts the same real fixtures and a
-- player's points are the same everywhere. A "league" is just a named set of players, and its
-- leaderboard is the global leaderboard filtered to its members. A player can create leagues and
-- join others by code, and can belong to several at once.
--
-- Membership tables are the classic Postgres RLS foot-gun: a policy on league_members that itself
-- reads league_members recurses forever. We route every membership check through the SECURITY
-- DEFINER helper is_league_member(), which runs as the table owner and so does not re-trigger RLS.
-- Creating and joining go through SECURITY DEFINER RPCs too, so there are no direct write policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin flag (replaces the email that used to be baked into the client bundle)
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles add column is_admin boolean not null default false;

-- A player must never be able to flag themselves admin. The existing "update own profile" /
-- "insert own profile" policies allow writing any column of your own row, so restrict writes to
-- the columns players legitimately set. is_admin is service-role only (set via dashboard SQL).
revoke insert, update on profiles from anon, authenticated;
grant insert (id, display_name) on profiles to authenticated;
grant update (display_name)     on profiles to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table leagues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 40),
  join_code  text not null unique,
  created_by uuid references profiles (id) on delete set null,   -- null for the seeded default league
  created_at timestamptz not null default now()
);

create table league_members (
  league_id uuid not null references leagues (id) on delete cascade,
  user_id   uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index league_members_user_idx on league_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership check — SECURITY DEFINER so RLS policies can call it without recursing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_league_member(p_league_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.league_members m
    where m.league_id = p_league_id and m.user_id = p_user_id
  );
$$;
grant execute on function public.is_league_member(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — you see only leagues you belong to, and only your co-members
-- ─────────────────────────────────────────────────────────────────────────────
alter table leagues        enable row level security;
alter table league_members enable row level security;

create policy "read leagues you belong to" on leagues
  for select to authenticated
  using (public.is_league_member(id, auth.uid()));

create policy "read co-members" on league_members
  for select to authenticated
  using (public.is_league_member(league_id, auth.uid()));

-- No INSERT/UPDATE/DELETE policies: all writes flow through the RPCs below, which run as
-- SECURITY DEFINER and so bypass RLS. This keeps league discovery gated behind a valid code.

-- ─────────────────────────────────────────────────────────────────────────────
-- Join-code generator — 6 chars from an unambiguous alphabet (no I/O/0/1)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.gen_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
           ''
         )
  from generate_series(1, 6);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_league — make a league, get a unique code, join it as the creator
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

  insert into public.leagues (name, join_code, created_by)
    values (trim(p_name), v_code, v_uid)
    returning * into v_league;

  insert into public.league_members (league_id, user_id)
    values (v_league.id, v_uid)
    on conflict do nothing;

  return v_league;
end;
$$;
grant execute on function public.create_league(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- join_league — look a league up by code (case-insensitive) and join it
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_league(p_code text)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_league public.leagues;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_league from public.leagues
    where upper(join_code) = upper(trim(p_code));
  if v_league.id is null then
    raise exception 'invalid join code';
  end if;

  insert into public.league_members (league_id, user_id)
    values (v_league.id, v_uid)
    on conflict do nothing;

  return v_league;
end;
$$;
grant execute on function public.join_league(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the existing implicit league and backfill every current player into it,
-- so nobody's standing changes. 'SHABAB26' is already public (it shipped in the
-- client bundle), so it is safe to keep in version control.
-- ─────────────────────────────────────────────────────────────────────────────
insert into leagues (name, join_code) values ('El Shabab', 'SHABAB26')
  on conflict (join_code) do nothing;

insert into league_members (league_id, user_id)
  select l.id, p.id
  from leagues l
  cross join profiles p
  where l.join_code = 'SHABAB26'
  on conflict do nothing;
