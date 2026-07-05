-- Auto-scoring cron — runs every 6 hours.
--
-- Posts to the already-deployed `score-match` edge function in `ingest` mode,
-- which pulls finished results from the openfootball feed and scores them (the
-- same path as the admin "Auto-import" button). A 6-hour tick keeps
-- `match_scores` and the leaderboard reflecting the current state; feed lag means
-- points land at the next tick after full time, which is the accepted trade-off.
--
-- Secrets are NOT hardcoded here — they're read from Supabase Vault at call time,
-- so this migration is safe to keep in version control. Before this job can
-- succeed, store the two secrets once (Dashboard → Project Settings → Vault, or
-- run these in the SQL editor, NOT committed):
--
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select vault.create_secret(
--     'https://rcidvhmxpllxmaiqtxme.supabase.co/functions/v1/score-match', 'score_fn_url');
--
-- <CRON_SECRET> must equal the CRON_SECRET env var set on the edge function
-- (checked at supabase/functions/score-match/index.ts).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a prior copy of this job before (re)creating it.
select cron.unschedule('score-every-6h')
where exists (select 1 from cron.job where jobname = 'score-every-6h');

select cron.schedule(
  'score-every-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'score_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := jsonb_build_object('mode', 'ingest')
  );
  $$
);
