import { supabase } from './supabase';
import type { Bucket, DecidedStage, Side } from './scoring/types';

// ─── Row shapes (mirror the Postgres schema) ────────────────────────────────
export type Round = 'R16' | 'QF' | 'SF' | '3RD' | 'FINAL';
export type MatchStatus = 'scheduled' | 'locked' | 'finished';

export interface MatchRow {
  id: string;
  api_fixture_id: string | null;
  round: Round;
  home_team: string;
  home_flag: string | null;
  away_team: string;
  away_flag: string | null;
  kickoff_utc: string;
  lock_at: string;
  status: MatchStatus;
  home_score_reg: number | null;
  away_score_reg: number | null;
}

export interface SquadPlayerRow {
  id: string;
  match_id: string;
  team: Side;
  api_player_id: string;
  name: string;
  is_starter: boolean;
  /** GK/DF/MF/FW — used to sort the scorer picker (likely scorers first). */
  position: string | null;
}

export interface PredictionRow {
  id: string;
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  card_played: boolean;
}

export interface PredictionScorerRow {
  id: string;
  prediction_id: string;
  slot: number;
  team: Side;
  api_player_id: string;
  bucket: Bucket;
}

export interface LeaderboardRow {
  user_id: string;
  display_name: string;
  total_points: number;
  matches_scored: number;
}

export interface MatchScoreRow {
  user_id: string;
  match_id: string;
  points: number;
  breakdown: Record<string, unknown>;
}

export interface Profile {
  id: string;
  display_name: string;
  is_admin: boolean;
}

export interface League {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
  created_at: string;
}

// A prediction plus its scorer slots, as the editor works with it.
export interface FullPrediction {
  home_score: number;
  away_score: number;
  card_played: boolean;
  decided_stage: DecidedStage | null;
  advancer: Side | null;
  scorers: { slot: number; team: Side; api_player_id: string; bucket: Bucket }[];
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

// ─── Reads ───────────────────────────────────────────────────────────────────
export async function getMatches(): Promise<MatchRow[]> {
  const { data, error } = await supabase.from('matches').select('*').order('kickoff_utc');
  if (error) throw error;
  return data as MatchRow[];
}

// A match's squad is static, but it's fetched on every match open and pick-sheet
// tap — cache per session so those navigations don't re-hit the network each time.
const squadCache = new Map<string, SquadPlayerRow[]>();

export async function getSquad(matchId: string): Promise<SquadPlayerRow[]> {
  const cached = squadCache.get(matchId);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('squad_players')
    .select('*')
    .eq('match_id', matchId)
    .order('name');
  if (error) throw error;
  const rows = data as SquadPlayerRow[];
  squadCache.set(matchId, rows);
  return rows;
}

export async function getMyPredictions(): Promise<
  Record<string, FullPrediction & { id: string }>
> {
  // Scope to the caller. RLS also exposes *others'* picks once a match locks
  // (that powers The Reveal), so without this filter a locked match would
  // collapse to another player's row in the by-match map below.
  const uid = await currentUserId();
  const { data: preds, error } = await supabase
    .from('predictions')
    .select('id, match_id, home_score, away_score, card_played, decided_stage, advancer')
    .eq('user_id', uid);
  if (error) throw error;

  const ids = (preds ?? []).map((p) => p.id);
  let scorers: PredictionScorerRow[] = [];
  if (ids.length) {
    const { data: sc, error: e2 } = await supabase
      .from('prediction_scorers')
      .select('*')
      .in('prediction_id', ids);
    if (e2) throw e2;
    scorers = sc as PredictionScorerRow[];
  }

  const byMatch: Record<string, FullPrediction & { id: string }> = {};
  for (const p of preds ?? []) {
    byMatch[p.match_id] = {
      id: p.id,
      home_score: p.home_score,
      away_score: p.away_score,
      card_played: p.card_played,
      decided_stage: p.decided_stage ?? null,
      advancer: p.advancer ?? null,
      scorers: scorers
        .filter((s) => s.prediction_id === p.id)
        .map((s) => ({ slot: s.slot, team: s.team, api_player_id: s.api_player_id, bucket: s.bucket })),
    };
  }
  return byMatch;
}

// Scoped to one league: fetch its members, then the (global) leaderboard filtered to them.
// Points are global — the league only decides whose rows show — so this reuses the leaderboard view.
export async function getLeaderboard(leagueId: string): Promise<LeaderboardRow[]> {
  if (!leagueId) return [];
  const { data: members, error: mErr } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);
  if (mErr) throw mErr;
  const ids = (members ?? []).map((m) => m.user_id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .in('user_id', ids)
    .order('total_points', { ascending: false });
  if (error) throw error;
  return data as LeaderboardRow[];
}

// ─── Leagues ───────────────────────────────────────────────────────────────────
// RLS returns only leagues the caller belongs to. create/join go through SECURITY DEFINER RPCs
// so a league can only be discovered with a valid code.
export async function getMyLeagues(): Promise<League[]> {
  const { data, error } = await supabase.from('leagues').select('*').order('created_at');
  if (error) throw error;
  return data as League[];
}

export async function createLeague(name: string): Promise<League> {
  const { data, error } = await supabase.rpc('create_league', { p_name: name });
  if (error) throw error;
  return data as League;
}

export async function joinLeague(code: string): Promise<League> {
  const { data, error } = await supabase.rpc('join_league', { p_code: code });
  if (error) throw error;
  return data as League;
}

export async function getMatchScores(matchId: string): Promise<MatchScoreRow[]> {
  const { data, error } = await supabase.from('match_scores').select('*').eq('match_id', matchId);
  if (error) throw error;
  return data as MatchScoreRow[];
}

// ─── The Reveal: everyone's predictions for locked matches ─────────────────────
// One player's prediction for one match, joined to their name and (once scored)
// their points. RLS only ever returns rows for matches that have locked — plus
// the caller's own rows — so upcoming picks never reach the client.
export interface RevealedPrediction {
  user_id: string;
  display_name: string;
  match_id: string;
  home_score: number;
  away_score: number;
  card_played: boolean;
  decided_stage: DecidedStage | null;
  advancer: Side | null;
  scorers: { slot: number; team: Side; api_player_id: string; bucket: Bucket }[];
  /** null until the match has been scored. */
  points: number | null;
  breakdown: Record<string, unknown> | null;
}

/**
 * Every revealed prediction across all locked matches, in one fetch. The grid,
 * the per-match view, and the per-player history are all client-side slices of
 * this — no extra round-trips. Callers should still gate on `matchState` when
 * they want *locked-only* columns (the caller's own future picks can appear here).
 */
export async function getRevealedPredictions(): Promise<RevealedPrediction[]> {
  const [{ data: preds, error }, { data: scores, error: e2 }] = await Promise.all([
    supabase
      .from('predictions')
      .select(
        'user_id, match_id, home_score, away_score, card_played, decided_stage, advancer, ' +
          'profiles(display_name), prediction_scorers(slot, team, api_player_id, bucket)',
      ),
    supabase.from('match_scores').select('user_id, match_id, points, breakdown'),
  ]);
  if (error) throw error;
  if (e2) throw e2;

  const scoreByKey = new Map<string, { points: number; breakdown: Record<string, unknown> }>();
  for (const s of scores ?? []) {
    scoreByKey.set(`${s.user_id}:${s.match_id}`, {
      points: s.points,
      breakdown: s.breakdown as Record<string, unknown>,
    });
  }

  // The client isn't generated-typed, so cast the embedded shape explicitly.
  type RawRow = {
    user_id: string;
    match_id: string;
    home_score: number;
    away_score: number;
    card_played: boolean;
    decided_stage: DecidedStage | null;
    advancer: Side | null;
    profiles: { display_name: string } | { display_name: string }[] | null;
    prediction_scorers: RevealedPrediction['scorers'] | null;
  };

  return ((preds ?? []) as unknown as RawRow[]).map((p) => {
    // PostgREST returns an embedded parent as an object, but type it defensively.
    const prof = p.profiles;
    const display_name = (Array.isArray(prof) ? prof[0]?.display_name : prof?.display_name) ?? '—';
    const sc = scoreByKey.get(`${p.user_id}:${p.match_id}`);
    return {
      user_id: p.user_id,
      display_name,
      match_id: p.match_id,
      home_score: p.home_score,
      away_score: p.away_score,
      card_played: p.card_played,
      decided_stage: (p.decided_stage as DecidedStage | null) ?? null,
      advancer: (p.advancer as Side | null) ?? null,
      scorers: ((p.prediction_scorers as RevealedPrediction['scorers']) ?? []).sort((a, b) => a.slot - b.slot),
      points: sc?.points ?? null,
      breakdown: sc?.breakdown ?? null,
    };
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────
export async function getMyProfile(): Promise<Profile | null> {
  const uid = await currentUserId();
  // Explicit columns: profiles has column-level SELECT grants (unsubscribe_token is not client-readable),
  // so `select('*')` would be rejected.
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_admin')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function createMyProfile(displayName: string): Promise<Profile> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: uid, display_name: displayName })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

// ─── Save a prediction (score + scorers + card) ───────────────────────────────
export async function savePrediction(matchId: string, p: FullPrediction): Promise<void> {
  const uid = await currentUserId();

  // Only one match may hold the Double-or-Nothing card. Clear it elsewhere first.
  if (p.card_played) {
    const { error } = await supabase
      .from('predictions')
      .update({ card_played: false })
      .eq('user_id', uid)
      .eq('card_played', true)
      .neq('match_id', matchId);
    if (error) throw error;
  }

  const { data: pred, error: upErr } = await supabase
    .from('predictions')
    .upsert(
      {
        user_id: uid,
        match_id: matchId,
        home_score: p.home_score,
        away_score: p.away_score,
        card_played: p.card_played,
        decided_stage: p.decided_stage,
        advancer: p.advancer,
      },
      { onConflict: 'user_id,match_id' },
    )
    .select('id')
    .single();
  if (upErr) throw upErr;

  const predId = (pred as { id: string }).id;

  // Replace scorer slots wholesale — simplest correct approach.
  const { error: delErr } = await supabase.from('prediction_scorers').delete().eq('prediction_id', predId);
  if (delErr) throw delErr;

  if (p.scorers.length) {
    const rows = p.scorers.map((s) => ({
      prediction_id: predId,
      slot: s.slot,
      team: s.team,
      api_player_id: s.api_player_id,
      bucket: s.bucket,
    }));
    const { error: insErr } = await supabase.from('prediction_scorers').insert(rows);
    if (insErr) throw insErr;
  }
}
