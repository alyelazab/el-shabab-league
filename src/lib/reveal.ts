import type { MatchRow, RevealedPrediction } from './db';

/** Who a prediction backs to go through — the higher score, or the shootout advancer on a predicted draw. */
export function predictedWinner(
  p: RevealedPrediction,
  match: MatchRow,
): { label: string; flag: string | null } {
  if (p.home_score > p.away_score) return { label: match.home_team, flag: match.home_flag };
  if (p.away_score > p.home_score) return { label: match.away_team, flag: match.away_flag };
  // A predicted draw is settled on penalties → the advancer they backed.
  if (p.advancer === 'home') return { label: match.home_team, flag: match.home_flag };
  if (p.advancer === 'away') return { label: match.away_team, flag: match.away_flag };
  return { label: 'a draw', flag: null };
}
