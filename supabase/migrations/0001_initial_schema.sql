-- El Shabab League — initial schema.
-- One implicit league; anyone with a valid account (and the optional join code,
-- enforced in the app) is a member. All match data is written only by the
-- service-role ingestion job; players write only their own predictions, and only
-- before a match locks (5 minutes before kickoff), enforced server-side by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
create type match_round as enum ('R16', 'QF', 'SF', '3RD', 'FINAL');
create type match_status as enum ('scheduled', 'locked', 'finished');
create type team_side as enum ('home', 'away');
create type goal_bucket as enum ('1-15', '16-30', '31-45', '46-60', '61-75', '76-90+');

-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles (extends Supabase auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Matches (knockout fixtures). lock_at is derived: kickoff − 5 minutes.
-- ─────────────────────────────────────────────────────────────────────────────
create table matches (
  id             uuid primary key default gen_random_uuid(),
  api_fixture_id text unique,
  round          match_round not null,
  home_team      text not null,
  home_flag      text,               -- flag emoji, e.g. '🇪🇬'
  away_team      text not null,
  away_flag      text,
  kickoff_utc    timestamptz not null,
  lock_at        timestamptz not null,   -- set to kickoff_utc − 5 min by trigger below
  status         match_status not null default 'scheduled',
  home_score_reg smallint,           -- regulation score, null until finished
  away_score_reg smallint,
  created_at     timestamptz not null default now()
);
create index matches_kickoff_idx on matches (kickoff_utc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Squad players available to pick as scorers for a match (full squad; XI flagged)
-- ─────────────────────────────────────────────────────────────────────────────
create table squad_players (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches (id) on delete cascade,
  team          team_side not null,
  api_player_id text not null,
  name          text not null,
  is_starter    boolean not null default false,
  unique (match_id, team, api_player_id)
);
create index squad_players_match_idx on squad_players (match_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Actual goals that happened (regulation only), written by the ingestion job
-- ─────────────────────────────────────────────────────────────────────────────
create table match_goals (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches (id) on delete cascade,
  team          team_side not null,
  api_player_id text not null,
  minute        smallint not null,   -- elapsed minute, stoppage folded down
  bucket        goal_bucket not null
);
create index match_goals_match_idx on match_goals (match_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Predictions (one per user per match)
-- ─────────────────────────────────────────────────────────────────────────────
create table predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  match_id    uuid not null references matches (id) on delete cascade,
  home_score  smallint not null check (home_score between 0 and 20),
  away_score  smallint not null check (away_score between 0 and 20),
  card_played boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, match_id)
);
create index predictions_match_idx on predictions (match_id);

-- One row per predicted goal. Same api_player_id may repeat (a predicted brace).
create table prediction_scorers (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references predictions (id) on delete cascade,
  slot          smallint not null,   -- 0-based goal index within the prediction
  team          team_side not null,
  api_player_id text not null,
  bucket        goal_bucket not null,
  unique (prediction_id, slot)
);

-- Only one player may hold the Double-or-Nothing card across the whole tournament.
create unique index one_card_per_user on predictions (user_id) where card_played;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scores (written by the scoring job) + leaderboard view
-- ─────────────────────────────────────────────────────────────────────────────
create table match_scores (
  user_id   uuid not null references profiles (id) on delete cascade,
  match_id  uuid not null references matches (id) on delete cascade,
  points    integer not null,
  breakdown jsonb not null,
  scored_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

create view leaderboard as
  select p.id as user_id,
         p.display_name,
         coalesce(sum(ms.points), 0) as total_points,
         count(ms.match_id)          as matches_scored
  from profiles p
  left join match_scores ms on ms.user_id = p.id
  group by p.id, p.display_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger for predictions
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger predictions_set_updated_at
  before update on predictions
  for each row execute function set_updated_at();

-- Derive lock_at = kickoff − 5 minutes on every insert/update (kept in a trigger
-- because a generated column can't use non-immutable timestamptz interval math).
create or replace function set_match_lock_at() returns trigger
  language plpgsql as $$
begin
  new.lock_at := new.kickoff_utc - interval '5 minutes';
  return new;
end;
$$;
create trigger matches_set_lock_at
  before insert or update on matches
  for each row execute function set_match_lock_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles           enable row level security;
alter table matches            enable row level security;
alter table squad_players      enable row level security;
alter table match_goals        enable row level security;
alter table predictions        enable row level security;
alter table prediction_scorers enable row level security;
alter table match_scores       enable row level security;

-- Profiles: everyone (signed in) can read display names for the leaderboard;
-- a user may create/edit only their own profile row.
create policy "profiles readable" on profiles
  for select to authenticated using (true);
create policy "insert own profile" on profiles
  for insert to authenticated with check (id = auth.uid());
create policy "update own profile" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Public read-only reference data (writes happen via the service role, which
-- bypasses RLS — so no write policies are defined here).
create policy "matches readable" on matches
  for select to authenticated using (true);
create policy "squads readable" on squad_players
  for select to authenticated using (true);
create policy "goals readable" on match_goals
  for select to authenticated using (true);
create policy "scores readable" on match_scores
  for select to authenticated using (true);

-- Predictions: a user reads only their own, and may write only their own AND
-- only while the match is still open (lock_at is in the future).
create policy "read own predictions" on predictions
  for select to authenticated using (user_id = auth.uid());

create policy "insert own prediction before lock" on predictions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from matches m where m.id = match_id and m.lock_at > now())
  );

create policy "update own prediction before lock" on predictions
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from matches m where m.id = match_id and m.lock_at > now())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from matches m where m.id = match_id and m.lock_at > now())
  );

create policy "delete own prediction before lock" on predictions
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from matches m where m.id = match_id and m.lock_at > now())
  );

-- Prediction scorers: readable/writable only through an owned, still-open prediction.
create policy "read own prediction scorers" on prediction_scorers
  for select to authenticated
  using (exists (select 1 from predictions p where p.id = prediction_id and p.user_id = auth.uid()));

create policy "write own prediction scorers before lock" on prediction_scorers
  for all to authenticated
  using (
    exists (
      select 1 from predictions p join matches m on m.id = p.match_id
      where p.id = prediction_id and p.user_id = auth.uid() and m.lock_at > now()
    )
  )
  with check (
    exists (
      select 1 from predictions p join matches m on m.id = p.match_id
      where p.id = prediction_id and p.user_id = auth.uid() and m.lock_at > now()
    )
  );
