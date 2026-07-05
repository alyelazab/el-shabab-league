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

export async function getSquad(matchId: string): Promise<SquadPlayerRow[]> {
  const { data, error } = await supabase
    .from('squad_players')
    .select('*')
    .eq('match_id', matchId)
    .order('name');
  if (error) throw error;
  return data as SquadPlayerRow[];
}

export async function getMyPredictions(): Promise<
  Record<string, FullPrediction & { id: string }>
> {
  const { data: preds, error } = await supabase
    .from('predictions')
    .select('id, match_id, home_score, away_score, card_played, decided_stage, advancer');
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

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('total_points', { ascending: false });
  if (error) throw error;
  return data as LeaderboardRow[];
}

export async function getMatchScores(matchId: string): Promise<MatchScoreRow[]> {
  const { data, error } = await supabase.from('match_scores').select('*').eq('match_id', matchId);
  if (error) throw error;
  return data as MatchScoreRow[];
}

// ─── Profile ──────────────────────────────────────────────────────────────────
export async function getMyProfile(): Promise<Profile | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
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
