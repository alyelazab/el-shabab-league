<div align="center">
  <img src="public/icon.svg" width="96" alt="El Shabab League" />
  <h1>El Shabab League</h1>
  <p><b>Predict the knockouts. Beat the shabab.</b></p>
  <p>A mobile-first prediction game for the 2026 international football knockouts — built for a group of friends to play from the Round of 16 to the final.</p>
  <p>
    <a href="https://el-shabab-league.pages.dev"><b>▶ Live app</b></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/React-19-149ECA" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6" />
    <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-3ECF8E" />
    <img src="https://img.shields.io/badge/PWA-installable-5A0FC8" />
  </p>
</div>

---

## What it is

Each knockout match, players predict three things — **the final score, who scores, and when** —
before predictions lock **5 minutes before kickoff**. Matches are **auto-scored** from a free,
public football data feed, and a live leaderboard tracks who's on top across the whole
tournament. Install it to your phone's home screen and it plays like a native app.

No spreadsheets, no manual scorekeeping — submit your picks and the points land themselves.

## Features

- ⚽ **Three-part predictions** — exact scoreline, goalscorers (pick from real squads; the same
  player can score twice), and the **15-minute window** each goal falls in.
- 🃏 **Double or Nothing card** — one per player, per tournament. Nail all three categories and
  your points double; whiff all three and it's −5. Choose your moment.
- ⏱️ **"How's it settled?" bonus (+2)** — call Full Time / Extra Time for a decisive pick, or
  who wins the shootout when you predict a draw.
- 🔒 **Server-enforced lock** — predictions freeze 5 minutes before kickoff, enforced in the
  database (never trusting the client clock).
- 🤖 **Automatic scoring** — a scheduled job ingests results, maps scorers to players, and runs
  a pure, unit-tested scoring engine. A commissioner override handles any edge cases.
- 🏆 **Live leaderboard** with per-match breakdowns.
- 📱 **Installable PWA** — home-screen icon, offline shell, magic-link email login.

## How scoring works

Points weight the hardest calls highest — **score > scorers > timing**, all judged on the
90-minute regulation result.

| Prediction | Points |
| --- | --- |
| Exact scoreline | **10** |
| Correct result, wrong score | **4** |
| Each correct goalscorer | **3** |
| Each correct goal-timing window | **+1** |
| Correctly calling how it's settled (FT/ET or penalties + who advances) | **+2** |

The **Double or Nothing** card doubles a match's total when all three core categories score,
or deducts 5 when none do. The scoring engine is a pure function with full unit-test coverage
of every rule and edge case (braces, multiset matching, card outcomes, the settle bonus).

## Architecture

```
React PWA (Vite + TS)  ──►  Supabase
  · prediction editor        · Postgres + Row Level Security (own picks only, before lock)
  · leaderboard              · Magic-link auth
  · admin panel              · Edge Function: ingest + score  ◄── openfootball feed (no key)
                             · pg_cron (every 15 min)         ◄── scheduled auto-scoring
```

- **Scoring engine** (`src/lib/scoring/`) — pure, deterministic, unit-tested; the same rules
  power both the app and the scoring worker.
- **Edge Function** (`supabase/functions/score-match/`) — pulls finished-match results from the
  public-domain [openfootball](https://github.com/openfootball/worldcup.json) feed, fuzzy-matches
  scorer names to seeded players, derives FT/ET/penalties, and writes each player's points.
- **Row Level Security** — players can read only their own predictions and write only before a
  match locks; all reference data and scores are written by the service role.

## Tech stack

React 19 · TypeScript · Vite · Supabase (Postgres, Auth, Edge Functions, pg_cron) ·
Vitest · vite-plugin-pwa · Cloudflare Pages.

## Local development

```bash
npm install
npm run dev        # start the app
npm test           # run the scoring-engine test suite
npm run build      # production build (outputs dist/)
```

Create a `.env.local` pointing at your own Supabase project:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-publishable-key>
VITE_JOIN_CODE=<league-join-code>
VITE_ADMIN_EMAIL=<commissioner-email>
```

Database schema lives in `supabase/migrations/`; the scoring worker in
`supabase/functions/score-match/`.

## Notes

Built to avoid official tournament trademarks — matches are shown by country name and flag only.
Squad lists are seeded and editable by the commissioner.

<div align="center"><sub>Made for the shabab. ⚽</sub></div>
