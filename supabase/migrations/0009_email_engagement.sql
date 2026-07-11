-- Email engagement loop — reminders before a match, a personalised recap after scoring, and one
-- season wrap-up after the final. Sent by the `notify` edge function, driven by a 15-minute cron.
--
-- Design notes:
--   · email_log makes every send idempotent. The cron fires every 15 min and matches can be
--     rescored, so we never want to email the same (user, match, kind) twice. Before sending we
--     check for an existing row; only a confirmed 'sent' (or a deliberate 'suppressed') blocks a
--     resend, so a 'failed' attempt retries on the next tick.
--   · Recipient email addresses live in auth.users and are read by the service role inside the
--     function — never copied into a public table.
--   · Auth for the cron reuses the same Vault cron_secret + check_cron_secret() as score-match.

-- ─────────────────────────────────────────────────────────────────────────────
-- Opt-out + a stable unsubscribe token per player
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles
  add column email_opt_out     boolean not null default false,
  add column unsubscribe_token uuid    not null default gen_random_uuid();
create unique index profiles_unsubscribe_token_idx on profiles (unsubscribe_token);

-- Let players toggle their own opt-out (e.g. an in-app setting); unsubscribe_token stays
-- service-role only so it can't be rotated to hijack someone else's link.
grant update (display_name, email_opt_out) on profiles to authenticated;

-- RLS is row-level, not column-level: the "profiles readable USING(true)" policy plus the default
-- table-wide SELECT grant would otherwise let any signed-in user read everyone's unsubscribe_token
-- and opt them out via the public endpoint. Restrict column SELECT so the token is never
-- client-readable (notify/unsubscribe read it via the service role, which bypasses grants).
revoke select on profiles from anon, authenticated;
grant select (id, display_name, created_at, is_admin, email_opt_out) on profiles to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Send log — one row per (player, match, kind); the idempotency guard
-- ─────────────────────────────────────────────────────────────────────────────
create table email_log (
  user_id  uuid not null references profiles (id) on delete cascade,
  match_id uuid not null references matches (id) on delete cascade,
  kind     text not null check (kind in ('reminder', 'recap', 'wrapup')),
  variant  text,   -- reminder | great | good | rough | card | missed | suppressed | wrapup
  result   text not null default 'sent' check (result in ('sent', 'failed', 'suppressed')),
  sent_at  timestamptz not null default now(),
  primary key (user_id, match_id, kind)
);
create index email_log_match_idx on email_log (match_id, kind);

-- Private to the service role: the notify function writes it, nobody reads it from the client.
alter table email_log enable row level security;

-- Don't retro-email recaps for matches that already finished before this feature shipped: mark them
-- handled so the very first notify tick only emails going forward. (Reminders only look at upcoming
-- matches, so they need no seeding; the final is excluded from recaps entirely.)
insert into email_log (user_id, match_id, kind, variant, result)
  select p.id, m.id, 'recap', 'suppressed', 'suppressed'
  from profiles p
  cross join matches m
  where m.status = 'finished' and m.round <> 'FINAL'
  on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notify cron — every 15 minutes, hit the `notify` edge function (reminders + recaps + wrapup).
--
-- Secrets are read from Vault at call time, so this migration holds none and is safe to commit.
-- Store the function URL once (Dashboard → Project Settings → Vault, or the SQL editor, NOT
-- committed). cron_secret already exists from migration 0004.
--
--   select vault.create_secret(
--     'https://rcidvhmxpllxmaiqtxme.supabase.co/functions/v1/notify', 'notify_fn_url');
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notify-every-15m')
where exists (select 1 from cron.job where jobname = 'notify-every-15m');

select cron.schedule(
  'notify-every-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := jsonb_build_object('mode', 'tick')
  );
  $$
);
