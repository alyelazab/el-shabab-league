// score-match — the ingestion + scoring worker for El Shabab League.
//
// Modes:
//   admin  — the commissioner submits/corrects a match result (scores + goals
//            picked from the seeded squad); we apply it and score everyone.
//   ingest — cron pulls finished R16 results from the free openfootball feed,
//            maps scorer names to seeded players, applies + scores.
//   rescore— re-run scoring for a match from already-stored result/goals.
//
// Writes use the service-role key (auto-injected), so RLS is bypassed here only.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Set in production as Edge Function secrets: `supabase secrets set ADMIN_EMAIL=… CRON_SECRET=…`.
const ADMIN_EMAIL = (Deno.env.get('ADMIN_EMAIL') ?? '').toLowerCase();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const FEED = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Scoring (ported from src/lib/scoring — kept behaviourally identical) ────
const SCORING = { exactScore: 10, correctResult: 4, perScorer: 3, perTiming: 1, cardPenalty: -5, decidedBonus: 2 };
type Side = 'home' | 'away';
type Stage = 'FT' | 'ET' | 'PENS';

function bucketForMinute(min: number): string {
  if (min <= 15) return '1-15';
  if (min <= 30) return '16-30';
  if (min <= 45) return '31-45';
  if (min <= 60) return '46-60';
  if (min <= 75) return '61-75';
  return '76-90+';
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
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

interface Pred { homeScore: number; awayScore: number; cardPlayed: boolean; decidedStage?: Stage | null; advancer?: Side | null; scorers: { playerId: string; bucket: string }[]; }
interface Actual { homeScore: number; awayScore: number; decidedStage?: Stage | null; penWinner?: Side | null; goals: { playerId: string; minute: number }[]; }

function scorePrediction(p: Pred, a: Actual) {
  const exactScore = p.homeScore === a.homeScore && p.awayScore === a.awayScore;
  const correctResult = sign(p.homeScore - p.awayScore) === sign(a.homeScore - a.awayScore);
  const scorePoints = exactScore ? SCORING.exactScore : correctResult ? SCORING.correctResult : 0;

  const correctScorers = multisetOverlap(p.scorers.map((s) => s.playerId), a.goals.map((g) => g.playerId));
  const scorersPoints = correctScorers * SCORING.perScorer;

  const correctTimings = multisetOverlap(
    p.scorers.map((s) => `${s.playerId}@${s.bucket}`),
    a.goals.map((g) => `${g.playerId}@${bucketForMinute(g.minute)}`),
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
async function applyAndScore(matchId: string, homeScore: number, awayScore: number, goals: GoalInput[], decidedStage: Stage = 'FT', penWinner: Side | null = null) {
  const db = svc();
  await db.from('matches').update({ home_score_reg: homeScore, away_score_reg: awayScore, status: 'finished', decided_stage: decidedStage, pen_winner: penWinner }).eq('id', matchId);
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
    goals: (goals ?? []).map((g) => ({ playerId: g.api_player_id, minute: g.minute })),
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
      scorers: (scorers ?? []).filter((s: any) => s.prediction_id === p.id).map((s: any) => ({ playerId: s.api_player_id, bucket: s.bucket })),
    };
    const b = scorePrediction(pred, actual);
    return { user_id: p.user_id, match_id: matchId, points: b.points, breakdown: b };
  });

  if (rows.length) await db.from('match_scores').upsert(rows, { onConflict: 'user_id,match_id' });
  return rows.length;
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
    await applyAndScore(m.id, h, a, goals, stage, penWinner);
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

    if (mode === 'ingest') {
      const cronOk = req.headers.get('x-cron-secret') === CRON_SECRET;
      if (!cronOk && !isAdmin) return json({ error: 'unauthorized' }, 401);
      const results = await ingestFromFeed();
      return json({ ok: true, scored: results });
    }

    // admin / rescore require the commissioner's JWT
    if (!token) return json({ error: 'missing token' }, 401);
    if (!isAdmin) return json({ error: 'not admin' }, 403);

    if (mode === 'admin') {
      const { matchId, homeScore, awayScore, goals, decidedStage, penWinner } = body;
      await applyAndScore(matchId, homeScore, awayScore, goals ?? [], decidedStage ?? 'FT', penWinner ?? null);
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
