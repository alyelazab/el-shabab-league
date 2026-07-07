-- Auth for the scoring cron no longer depends on the score-match function's
-- CRON_SECRET env var. That env var is dropped whenever the function is
-- redeployed, which silently 401'd every automatic scoring run (ingest +
-- rescore-all) until it was re-set by hand. Instead we verify the incoming
-- x-cron-secret against the Vault value the cron jobs already send — a single,
-- durable source of truth. The function returns only a boolean, never the
-- secret, and is callable only by the service_role (the edge function's role).

create or replace function public.check_cron_secret(provided text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select provided is not null
     and provided <> ''
     and provided = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
$$;

-- Supabase grants EXECUTE on public functions to anon/authenticated by default,
-- so revoking from PUBLIC alone would leave this callable via the REST RPC
-- endpoint — a brute-force oracle for the secret. Lock it to service_role only.
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;
