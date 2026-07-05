import { useMemo } from 'react';
import type { MatchRow, LeaderboardRow, RevealedPrediction } from '../lib/db';
import { SCORING } from '../lib/scoring/config';
import { matchState, kickoffLabel } from '../lib/format';

interface Props {
  userId: string;
  meId: string;
  board: LeaderboardRow[];
  matches: MatchRow[];
  revealed: RevealedPrediction[];
  onBack: () => void;
}

const roundLabel: Record<MatchRow['round'], string> = {
  R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', '3RD': 'Third place', FINAL: 'Final',
};

export function PlayerCard({ userId, meId, board, matches, revealed, onBack }: Props) {
  const now = Date.now();
  const me = userId === meId;

  const rank = useMemo(() => {
    const sorted = [...board].sort((a, b) => b.total_points - a.total_points);
    return sorted.findIndex((r) => r.user_id === userId) + 1;
  }, [board, userId]);

  const row = board.find((r) => r.user_id === userId);
  const picks = useMemo(
    () => new Map(revealed.filter((p) => p.user_id === userId).map((p) => [p.match_id, p])),
    [revealed, userId],
  );
  const cardMatch = useMemo(() => {
    const carded = revealed.find((p) => p.user_id === userId && p.card_played);
    return carded ? matches.find((m) => m.id === carded.match_id) ?? null : null;
  }, [revealed, matches, userId]);

  if (!row) return null;

  return (
    <div className="screen">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="card pc-head">
        <div className="pc-badge">{row.display_name.slice(0, 1).toUpperCase()}</div>
        <div className="pc-id">
          <div className="pc-name">{row.display_name}{me && <span className="you">YOU</span>}</div>
          <div className="pc-meta">
            {rank > 0 && <span>#{rank}</span>}
            <span>{row.matches_scored} scored</span>
            <span className="pc-card">
              {cardMatch ? `🃏 spent · ${cardMatch.home_flag}${cardMatch.away_flag}` : '🃏 card in hand'}
            </span>
          </div>
        </div>
        <div className="pc-pts">{row.total_points}<small>PTS</small></div>
      </div>

      <p className="eyebrow">Season so far</p>
      {matches.map((m) => {
        const state = matchState(m, now);
        const p = picks.get(m.id);

        if (state === 'open') {
          return (
            <div key={m.id} className="card pc-row pc-locked">
              <div className="pc-fixture">
                <span className="pc-flags">{m.home_flag}{m.away_flag}</span>
                <span className="pc-round">{roundLabel[m.round]}</span>
              </div>
              <span className="pc-hidden">🔒 reveals at lock</span>
            </div>
          );
        }

        return (
          <div key={m.id} className="card pc-row">
            <div className="pc-fixture">
              <span className="pc-flags">{m.home_flag}{m.away_flag}</span>
              <span className="pc-round">{roundLabel[m.round]}</span>
              <span className="pc-kick">{kickoffLabel(m.kickoff_utc)}</span>
            </div>

            {p ? (
              <div className="pc-pick">
                <div className="pc-pick-top">
                  <span className="pc-scoreline">
                    {p.home_score}–{p.away_score}
                    {p.card_played && <span className="pc-card-flag">🃏</span>}
                  </span>
                  {p.points != null && (
                    <span className="pc-row-pts">{p.points > 0 ? `+${p.points}` : p.points}</span>
                  )}
                </div>
                {p.breakdown && <ChipRow b={p.breakdown} />}
              </div>
            ) : (
              <span className="pc-nopick">No pick</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Compact hit/miss chips, mirroring the Breakdown component in Predict. */
function ChipRow({ b }: { b: Record<string, unknown> }) {
  const exact = b.exactScore === true;
  const result = b.correctResult === true;
  const scorers = Number(b.correctScorers ?? 0);
  const timings = Number(b.correctTimings ?? 0);
  const decided = Number(b.decidedBonus ?? 0) > 0;
  const card = (b.card as { played?: boolean; outcome?: string } | undefined) ?? {};
  return (
    <div className="brk" style={{ marginTop: 8 }}>
      <span className={`brk-chip ${exact || result ? 'hit' : 'miss'}`}>
        {exact ? 'Exact ✓' : result ? 'Result ✓' : 'Score ✗'}
      </span>
      {scorers > 0 && <span className="brk-chip hit">{scorers} scorer{scorers === 1 ? '' : 's'} ✓</span>}
      {timings > 0 && <span className="brk-chip hit">{timings} timing{timings === 1 ? '' : 's'} ✓</span>}
      {decided && <span className="brk-chip hit">Settled ✓ +{SCORING.decidedBonus}</span>}
      {card.played && (
        <span className="brk-chip gold">
          🃏 {card.outcome === 'double' ? 'Doubled!' : card.outcome === 'penalty' ? '−5' : 'Spent'}
        </span>
      )}
    </div>
  );
}
