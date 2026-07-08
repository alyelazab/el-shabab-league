// score-match — the ingestion + scoring worker for El Shabab League.
//
// Modes:
//   admin  — the commissioner submits/corrects a match result (scores + goals
//            picked from the seeded squad); we apply it and score everyone.
//   ingest — cron syncs the bracket forward (creates next-round fixtures + their
//            squads once both teams are known), then pulls finished results from
//            the free openfootball feed, maps scorer names to seeded players,
//            applies + scores.
//   sync-fixtures — just the bracket-forward step (create/refresh fixtures);
//            handy for isolated testing. Same auth as ingest.
//   rescore— re-run scoring for a match from already-stored result/goals.
//   rescore-all — re-run scoring for every match that already has a result
//            (applies a scoring-rule change retroactively to all players).
//
// Writes use the service-role key (auto-injected), so RLS is bypassed here only.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Set in production as Edge Function secrets: `supabase secrets set ADMIN_EMAIL=… CRON_SECRET=…`.
const ADMIN_EMAIL = (Deno.env.get('ADMIN_EMAIL') ?? '').toLowerCase();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const FEED = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
const SQUADS_FEED = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.squads.json';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Scoring (ported from src/lib/scoring — kept behaviourally identical) ────
const SCORING = { exactScore: 10, correctResult: 4, perScorer: 3, perTiming: 3, cardPenalty: -5, decidedBonus: 1 };
type Side = 'home' | 'away';
type Stage = 'FT' | 'ET' | 'PENS';

function bucketForMinute(min: number): string {
  if (min <= 15) return '1-15';
  if (min <= 30) return '16-30';
  if (min <= 45) return '31-45';
  if (min <= 60) return '46-60';
  if (min <= 75) return '61-75';
  if (min <= 90) return '76-90+';
  if (min <= 105) return '91-105';
  return '106-120';
}
function multisetOverlap(pred: string[], actual: string[]): number {
  const counts = new Map<string, number>();
  for (const k of actual) counts.set(k, (counts.get(k) ?? 0) + 1);
  let n = 0;
  for (const k of pred) {
    const r = counts.get(k) ?? 0;
    if (r > 0) { n++; counts.set(k, r - 1); }
  }
  return n;
}
// Which side goes through: the higher score, or (when regulation is level) the ET/shootout winner.
const advancerOf = (home: number, away: number, explicit?: Side | null): Side | null =>
  home > away ? 'home' : away > home ? 'away' : (explicit ?? null);

interface Pred { homeScore: number; awayScore: number; cardPlayed: boolean; decidedStage?: Stage | null; advancer?: Side | null; scorers: { playerId: string; team: Side; bucket: string }[]; }
interface Actual { homeScore: number; awayScore: number; decidedStage?: Stage | null; penWinner?: Side | null; advancer?: Side | null; goals: { playerId: string; team: Side; minute: number }[]; }

function scorePrediction(p: Pred, a: Actual) {
  // The knockout "result" is who advances: a decisive pick names it via the scoreline, a draw pick
  // via `advancer`; the actual winner is the scoreline, or the ET/shootout winner when level.
  const exactScore = p.homeScore === a.homeScore && p.awayScore === a.awayScore;
  const predictedAdvancer = advancerOf(p.homeScore, p.awayScore, p.advancer);
  const actualAdvancer = advancerOf(a.homeScore, a.awayScore, a.advancer ?? a.penWinner);
  const correctResult = predictedAdvancer != null && predictedAdvancer === actualAdvancer;
  const scorePoints = exactScore ? SCORING.exactScore : correctResult ? SCORING.correctResult : 0;

  const correctScorers = multisetOverlap(p.scorers.map((s) => s.playerId), a.goals.map((g) => g.playerId));
  const scorersPoints = correctScorers * SCORING.perScorer;

  const correctTimings = multisetOverlap(
    p.scorers.map((s) => `${s.team}@${s.bucket}`),
    a.goals.map((g) => `${g.team}@${bucketForMinute(g.minute)}`),
  );
  const timingPoints = correctTimings * SCORING.perTiming;

  let decidedBonus = 0;
  if (p.decidedStage === 'PENS') {
    if (a.decidedStage === 'PENS' && p.advancer && p.advancer === a.penWinner) decidedBonus = SCORING.decidedBonus;
  } else if (p.decidedStage) {
    if (a.decidedStage && p.decidedStage === a.decidedStage) decidedBonus = SCORING.decidedBonus;
  }

  const coreBase = scorePoints + scorersPoints + timingPoints;
  const base = coreBase + decidedBonus;
  const hits = (scorePoints > 0 ? 1 : 0) + (scorersPoints > 0 ? 1 : 0) + (timingPoints > 0 ? 1 : 0);
  let points = base;
  let outcome: string | null = null;
  if (p.cardPlayed) {
    if (hits === 3) { outcome = 'double'; points = base * 2; }
    else if (hits === 0) { outcome = 'penalty'; points = SCORING.cardPenalty + decidedBonus; }
    else { outcome = 'neutral'; points = base; }
  }
  return { points, base, scorePoints, scorersPoints, timingPoints, decidedBonus, exactScore, correctResult, correctScorers, correctTimings, card: { played: p.cardPlayed, hits, outcome } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY);

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();

const parseMinute = (m: string | number): number => {
  const base = String(m).split('+')[0];
  return Math.max(1, parseInt(base, 10) || 1);
};

interface GoalInput { team: Side; api_player_id: string; minute: number; }

/** Write a match's result + goals, mark finished, then score every prediction. */
async function applyAndScore(matchId: string, homeScore: number, awayScore: number, goals: GoalInput[], decidedStage: Stage = 'FT', penWinner: Side | null = null, advancer: Side | null = null) {
  const db = svc();
  // Normalise who advances into a single column: the higher score, or (when regulation is level)
  // the extra-time / shootout winner. This is what the scorer compares a prediction against.
  const settledAdvancer = advancerOf(homeScore, awayScore, advancer ?? penWinner);
  await db.from('matches').update({ home_score_reg: homeScore, away_score_reg: awayScore, status: 'finished', decided_stage: decidedStage, pen_winner: penWinner, advancer: settledAdvancer }).eq('id', matchId);
  await db.from('match_goals').delete().eq('match_id', matchId);
  if (goals.length) {
    await db.from('match_goals').insert(
      goals.map((g) => ({ match_id: matchId, team: g.team, api_player_id: g.api_player_id, minute: g.minute, bucket: bucketForMinute(g.minute) })),
    );
  }
  await scoreMatch(matchId);
}

async function scoreMatch(matchId: string) {
  const db = svc();
  const { data: match } = await db.from('matches').select('*').eq('id', matchId).single();
  if (!match || match.home_score_reg === null) return;
  const { data: goals } = await db.from('match_goals').select('*').eq('match_id', matchId);
  const actual: Actual = {
    homeScore: match.home_score_reg,
    awayScore: match.away_score_reg,
    decidedStage: match.decided_stage ?? 'FT',
    penWinner: match.pen_winner ?? null,
    advancer: match.advancer ?? null,
    goals: (goals ?? []).map((g) => ({ playerId: g.api_player_id, team: g.team as Side, minute: g.minute })),
  };

  const { data: preds } = await db.from('predictions').select('id, user_id, home_score, away_score, card_played, decided_stage, advancer').eq('match_id', matchId);
  const ids = (preds ?? []).map((p) => p.id);
  const { data: scorers } = ids.length
    ? await db.from('prediction_scorers').select('*').in('prediction_id', ids)
    : { data: [] as any[] };

  const rows = (preds ?? []).map((p) => {
    const pred: Pred = {
      homeScore: p.home_score,
      awayScore: p.away_score,
      cardPlayed: p.card_played,
      decidedStage: p.decided_stage ?? null,
      advancer: p.advancer ?? null,
      scorers: (scorers ?? []).filter((s: any) => s.prediction_id === p.id).map((s: any) => ({ playerId: s.api_player_id, team: s.team as Side, bucket: s.bucket })),
    };
    const b = scorePrediction(pred, actual);
    return { user_id: p.user_id, match_id: matchId, points: b.points, breakdown: b };
  });

  if (rows.length) await db.from('match_scores').upsert(rows, { onConflict: 'user_id,match_id' });
  return rows.length;
}

/**
 * Fill matches.advancer for finished ties whose winner isn't derivable from stored data — i.e. wins
 * in extra time, where regulation was level and there's no shootout winner. Reads the winner off the
 * feed's `score.et`. Metadata-only and idempotent; never touches goals or status. (FT/PENS advancers
 * are already set at write time and by migration 0007.)
 */
async function backfillAdvancers() {
  const db = svc();
  const { data: rows } = await db
    .from('matches')
    .select('id, api_fixture_id')
    .not('home_score_reg', 'is', null)
    .is('advancer', null)
    .eq('decided_stage', 'ET');
  if (!rows || rows.length === 0) return 0;
  const feed = await fetch(FEED).then((r) => r.json());
  const feedMatches: any[] = feed.matches ?? [];
  let filled = 0;
  for (const m of rows) {
    const num = m.api_fixture_id?.startsWith('of-') ? Number(m.api_fixture_id.slice(3)) : null;
    const fm = feedMatches.find((f) => f.num === num);
    if (!fm || !Array.isArray(fm.score?.et)) continue;
    const advancer: Side = fm.score.et[0] > fm.score.et[1] ? 'home' : 'away';
    await db.from('matches').update({ advancer }).eq('id', m.id);
    filled += 1;
  }
  return filled;
}

/** Recompute scores for every match that already has a result. Used to apply a scoring change retroactively. */
async function rescoreAll() {
  const db = svc();
  // Backfill any missing extra-time winners first, so the advancer-based result scores correctly.
  const filled = await backfillAdvancers();
  const { data: matches } = await db.from('matches').select('id').not('home_score_reg', 'is', null);
  let matchCount = 0;
  let scoreCount = 0;
  for (const m of matches ?? []) {
    const n = await scoreMatch(m.id);
    matchCount += 1;
    scoreCount += n ?? 0;
  }
  return { matches: matchCount, scores: scoreCount, advancersFilled: filled };
}

/** Map a feed scorer name to a seeded player id for a given match + side. */
function matchPlayer(name: string, squad: { api_player_id: string; name: string }[]): string {
  const target = normalize(name);
  let best: string | null = null;
  for (const p of squad) {
    const pn = normalize(p.name);
    if (pn === target) return p.api_player_id;
    // last-name / contains fallback
    const last = target.split(' ').slice(-1)[0];
    if (last.length > 3 && pn.includes(last)) best = p.api_player_id;
  }
  return best ?? `feed:${target.replace(/ /g, '-')}`;
}

// ─── Fixture sync (bracket-forward) ──────────────────────────────────────────
// The feed carries the whole knockout bracket, not just R16. Undecided matchups
// appear as placeholders ("W93" = winner of match 93, "L101" = loser of 101) and
// resolve to real country names once the earlier round finishes. We only ever
// create a match once BOTH its teams are real, so every fixture players see is
// fully playable (real teams + seeded squads). lock_at is derived from
// kickoff_utc by a DB trigger, so we only ever touch kickoff_utc here.

const ROUND_MAP: Record<string, string> = {
  'Round of 16': 'R16',
  'Quarter-final': 'QF',
  'Semi-final': 'SF',
  'Match for third place': '3RD',
  'Final': 'FINAL',
};

// A team string is "resolved" (a real country) unless it's a W##/L## placeholder.
const isResolved = (team: string) => !/^[WL]\d+$/i.test((team ?? '').trim());

// Parse the feed's "HH:MM UTC±H[H][:MM]" + "YYYY-MM-DD" into a UTC ISO string.
// e.g. ("2026-07-10", "12:00 UTC-7") → "2026-07-10T19:00:00.000Z".
function parseKickoff(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const m = /^(\d{1,2}):(\d{2})\s*UTC([+-])(\d{1,2})(?::(\d{2}))?/i.exec((time ?? '').trim());
  if (!m) {
    // No parseable offset — assume the time is already UTC (feed is well-formed in practice).
    return new Date(`${date}T${(time ?? '00:00').slice(0, 5)}:00Z`).toISOString();
  }
  const [, hh, mm, sign, offH, offM] = m;
  const local = Date.UTC(y, mo - 1, d, Number(hh), Number(mm));
  const offsetMin = (sign === '-' ? -1 : 1) * (Number(offH) * 60 + Number(offM ?? 0));
  // Wall-clock is at UTC+offset, so UTC instant = local − offset.
  return new Date(local - offsetMin * 60_000).toISOString();
}

// Squad name-matching (ported from scripts/seed-squads.mjs).
const squadNorm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z ]/g, '').trim();
const SQUAD_ALIAS: Record<string, string> = {
  'usa': 'united states',
  'united states': 'usa',
  'south korea': 'korea republic',
  'korea republic': 'south korea',
};

let squadsCache: any[] | null = null;
async function loadSquads(): Promise<any[]> {
  if (!squadsCache) squadsCache = await fetch(SQUADS_FEED).then((r) => r.json());
  return squadsCache;
}

/** Seed squad_players for one match from the squads feed. No-op per side if the team isn't found. */
async function seedSquadsForMatch(matchId: string, homeTeam: string, awayTeam: string) {
  const db = svc();
  const squads = await loadSquads();
  const byName = new Map<string, any>();
  for (const t of squads) byName.set(squadNorm(t.name), t);
  const findTeam = (name: string) => {
    const n = squadNorm(name);
    if (byName.has(n)) return byName.get(n);
    const a = SQUAD_ALIAS[n];
    return a && byName.has(a) ? byName.get(a) : null;
  };

  const rows: Record<string, unknown>[] = [];
  for (const [side, team] of [['home', homeTeam], ['away', awayTeam]] as const) {
    const t = findTeam(team);
    if (!t) continue;
    const code = String(t.fifa_code).toLowerCase();
    for (const p of t.players ?? []) {
      rows.push({ match_id: matchId, team: side, api_player_id: `${code}-${p.number}`, name: p.name, position: p.pos, is_starter: false });
    }
  }
  if (rows.length) await db.from('squad_players').upsert(rows, { onConflict: 'match_id,team,api_player_id' });
  return rows.length;
}

/** Create next-round fixtures (and their squads) as the bracket resolves; refresh dates on reschedules. */
async function syncFixtures() {
  const db = svc();
  const res = await fetch(FEED);
  const feed = await res.json();
  const feedMatches: any[] = feed.matches ?? [];

  const { data: existing } = await db.from('matches').select('api_fixture_id, home_team, home_flag, away_team, away_flag, kickoff_utc, status');
  const byFixture = new Map((existing ?? []).map((m) => [m.api_fixture_id, m]));

  // Reuse the hand-curated R16 flags: every knockout team already played in R16.
  const flagByTeam = new Map<string, string | null>();
  for (const m of existing ?? []) {
    if (m.home_flag) flagByTeam.set(squadNorm(m.home_team), m.home_flag);
    if (m.away_flag) flagByTeam.set(squadNorm(m.away_team), m.away_flag);
  }
  const flagFor = (team: string) => flagByTeam.get(squadNorm(team)) ?? null;

  const created: string[] = [];
  const updated: string[] = [];

  for (const fm of feedMatches) {
    const round = ROUND_MAP[fm.round];
    if (!round) continue; // group stage / R32 — not part of this game
    const apiId = `of-${fm.num}`;
    const kickoff = parseKickoff(fm.date, fm.time);
    const row = byFixture.get(apiId);

    if (row) {
      if (row.status === 'finished') continue;
      if (new Date(row.kickoff_utc).getTime() !== new Date(kickoff).getTime()) {
        await db.from('matches').update({ kickoff_utc: kickoff }).eq('api_fixture_id', apiId);
        updated.push(`${apiId} → ${kickoff}`);
      }
      continue;
    }

    // New fixture: only create once both teams are real countries.
    if (!isResolved(fm.team1) || !isResolved(fm.team2)) continue;
    const { data: inserted } = await db
      .from('matches')
      .insert({
        api_fixture_id: apiId,
        round,
        home_team: fm.team1,
        home_flag: flagFor(fm.team1),
        away_team: fm.team2,
        away_flag: flagFor(fm.team2),
        kickoff_utc: kickoff,
        status: 'scheduled',
      })
      .select('id')
      .single();
    if (inserted) {
      await seedSquadsForMatch(inserted.id, fm.team1, fm.team2);
      created.push(`${fm.team1} v ${fm.team2} (${round}, ${apiId})`);
    }
  }
  return { created, updated };
}

async function ingestFromFeed() {
  const db = svc();
  const { data: matches } = await db.from('matches').select('*');
  const res = await fetch(FEED);
  const feed = await res.json();
  const feedMatches: any[] = feed.matches ?? [];
  const results: Record<string, unknown>[] = [];

  for (const m of matches ?? []) {
    if (m.status === 'finished') continue;
    const num = m.api_fixture_id?.startsWith('of-') ? Number(m.api_fixture_id.slice(3)) : null;
    const fm = feedMatches.find((f) => f.num === num);
    if (!fm || !fm.score?.ft) continue; // not played / no result yet

    const [h, a] = fm.score.ft;
    // Derive how the tie was settled from the feed's extra-time / penalty fields.
    const stage: Stage = fm.score.p ? 'PENS' : fm.score.et ? 'ET' : 'FT';
    let penWinner: Side | null = null;
    if (stage === 'PENS' && Array.isArray(fm.score.p)) penWinner = fm.score.p[0] > fm.score.p[1] ? 'home' : 'away';
    // A tie won in extra time (not pens) is level in regulation, so the winner isn't on `score.ft` —
    // read it off the extra-time aggregate `score.et`.
    let etWinner: Side | null = null;
    if (stage === 'ET' && Array.isArray(fm.score.et)) etWinner = fm.score.et[0] > fm.score.et[1] ? 'home' : 'away';

    const { data: squad } = await db.from('squad_players').select('api_player_id, name, team').eq('match_id', m.id);
    const homeSquad = (squad ?? []).filter((p) => p.team === 'home');
    const awaySquad = (squad ?? []).filter((p) => p.team === 'away');

    const goals: GoalInput[] = [];
    for (const g of fm.goals1 ?? []) {
      if (g.owngoal) continue;
      goals.push({ team: 'home', api_player_id: matchPlayer(g.name, homeSquad), minute: parseMinute(g.minute) });
    }
    for (const g of fm.goals2 ?? []) {
      if (g.owngoal) continue;
      goals.push({ team: 'away', api_player_id: matchPlayer(g.name, awaySquad), minute: parseMinute(g.minute) });
    }
    await applyAndScore(m.id, h, a, goals, stage, penWinner, etWinner);
    results.push({ match: `${m.home_team} ${h}-${a} ${m.away_team}`, stage, goals: goals.length });
  }
  return results;
}

// ─── HTTP entrypoint ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? 'ingest';

    // Is the caller the commissioner? (admin actions + admin-triggered ingest)
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    let isAdmin = false;
    if (token) {
      const { data: userData } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(token);
      isAdmin = userData.user?.email?.toLowerCase() === ADMIN_EMAIL;
    }

    // ingest, sync-fixtures and rescore-all are safe to run server-side (cron
    // secret) or by the commissioner.
    if (mode === 'ingest' || mode === 'sync-fixtures' || mode === 'rescore-all') {
      const provided = req.headers.get('x-cron-secret') ?? '';
      // Verify against the CRON_SECRET env var when present, but fall back to the
      // Vault value the cron actually sends. The env var is dropped on every
      // redeploy, which silently 401'd all automatic scoring; the Vault check
      // (check_cron_secret RPC) is the durable source of truth.
      let cronOk = provided !== '' && provided === CRON_SECRET;
      if (!cronOk && provided !== '') {
        const { data: ok } = await svc().rpc('check_cron_secret', { provided });
        cronOk = ok === true;
      }
      if (!cronOk && !isAdmin) return json({ error: 'unauthorized' }, 401);
      if (mode === 'sync-fixtures') {
        const fixtures = await syncFixtures();
        return json({ ok: true, fixtures });
      }
      if (mode === 'ingest') {
        // Advance the bracket first (create next-round fixtures + squads), then score.
        const fixtures = await syncFixtures();
        const results = await ingestFromFeed();
        return json({ ok: true, fixtures, scored: results });
      }
      const summary = await rescoreAll();
      return json({ ok: true, ...summary });
    }

    // admin / rescore require the commissioner's JWT
    if (!token) return json({ error: 'missing token' }, 401);
    if (!isAdmin) return json({ error: 'not admin' }, 403);

    if (mode === 'admin') {
      const { matchId, homeScore, awayScore, goals, decidedStage, penWinner, advancer } = body;
      await applyAndScore(matchId, homeScore, awayScore, goals ?? [], decidedStage ?? 'FT', penWinner ?? null, advancer ?? null);
      return json({ ok: true });
    }
    if (mode === 'rescore') {
      const n = await scoreMatch(body.matchId);
      return json({ ok: true, scored: n });
    }
    return json({ error: 'unknown mode' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
