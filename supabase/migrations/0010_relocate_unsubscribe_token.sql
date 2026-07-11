-- Relocate unsubscribe_token out of profiles — un-breaks old cached clients.
--
-- 0009 hid the token by revoking table-wide SELECT on profiles and re-granting only the safe columns
-- (id, display_name, created_at, is_admin, email_opt_out). The new frontend reads those columns by
-- name, but OLD cached PWA copies on players' phones still call select('*'), which the column-level
-- grant now rejects — the client treats that error as "no profile" and shows the sign-up screen.
--
-- Fix: move the only sensitive column into a service-role-only table. Afterwards every remaining
-- profiles column is already covered by the 0009 grant, so select('*') succeeds again with NO new
-- grant. email_opt_out stays on profiles (players toggle it; it isn't sensitive).

create table if not exists email_prefs (
  user_id           uuid primary key references profiles (id) on delete cascade,
  unsubscribe_token uuid not null default gen_random_uuid()
);

-- Service-role only: notify/unsubscribe read it via the service key (bypasses RLS); no client policy.
alter table email_prefs enable row level security;

-- Carry existing tokens over so any link already in the wild keeps working.
insert into email_prefs (user_id, unsubscribe_token)
  select id, unsubscribe_token from profiles
  on conflict (user_id) do nothing;

-- Drop the column (also drops profiles_unsubscribe_token_idx). This is the line that un-breaks login.
alter table profiles drop column unsubscribe_token;

-- The old column had `default gen_random_uuid()`, so every profile auto-got a token. Preserve that for
-- future sign-ups with an insert trigger. SECURITY DEFINER because `authenticated` (the role inserting
-- a profile at onboarding) has no grant on the service-role-only email_prefs table.
create or replace function ensure_email_prefs() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into email_prefs (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists profiles_ensure_email_prefs on profiles;
create trigger profiles_ensure_email_prefs
  after insert on profiles for each row execute function ensure_email_prefs();
