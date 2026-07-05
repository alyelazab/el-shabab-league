import type { MatchRow, FullPrediction } from '../lib/db';
import { matchState, countdown, kickoffLabel } from '../lib/format';

interface Props {
  matches: MatchRow[];
  preds: Record<string, FullPrediction & { id: string }>;
  onOpen: (m: MatchRow) => void;
}

export function MatchList({ matches, preds, onOpen }: Props) {
  if (!matches.length) return <p className="center-note">No matches yet. Sit tight — they're loading in.</p>;

  const now = Date.now();
  return (
    <div>
      <p className="eyebrow first">Round of 16 · 8 matches</p>
      {matches.map((m) => {
        const state = matchState(m, now);
        const p = preds[m.id];
        const soon = state === 'open' && new Date(m.lock_at).getTime() - now < 6 * 3600 * 1000;
        return (
          <button key={m.id} className="card match" onClick={() => onOpen(m)}>
            <div className="match-top">
              <span className="match-round">{roundLabel(m.round)}</span>
              {state === 'open' && (
                <span className={`pill ${soon ? 'pill-soon' : 'pill-open'}`}>
                  <span className="dot" /> Locks in {countdown(m.lock_at, now)}
                </span>
              )}
              {state === 'locked' && (
                <span className="pill pill-locked">
                  <span className="dot live" /> In play
                </span>
              )}
              {state === 'final' && <span className="pill pill-final">Final</span>}
            </div>

            <div className="match-teams">
              <div className="team">
                <span className="flag">{m.home_flag}</span>
                <span className="team-name">{m.home_team}</span>
              </div>
              {state === 'final' ? (
                <span className="scoreline">
                  {m.home_score_reg ?? '–'}–{m.away_score_reg ?? '–'}
                </span>
              ) : (
                <span className="vs">VS</span>
              )}
              <div className="team away">
                <span className="flag">{m.away_flag}</span>
                <span className="team-name">{m.away_team}</span>
              </div>
            </div>

            <div className="match-foot">
              <span>{kickoffLabel(m.kickoff_utc)}</span>
              {p ? (
                <span className="your-pick">
                  {p.card_played && <span className="card-flag">🃏</span>}
                  <span>Your pick</span>
                  <span className="mini-score">{p.home_score}–{p.away_score}</span>
                </span>
              ) : state === 'open' ? (
                <span style={{ color: 'var(--coral)', fontWeight: 700 }}>Predict →</span>
              ) : (
                <span style={{ color: 'var(--faint)' }}>No pick</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function roundLabel(r: MatchRow['round']): string {
  return { R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', '3RD': 'Third place', FINAL: 'Final' }[r];
}
