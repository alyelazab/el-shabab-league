import { useEffect, useRef, useState } from 'react';
import type { MatchRow, RevealedPrediction, SquadPlayerRow } from '../lib/db';
import { getSquad } from '../lib/db';
import { bucketLabel, kickoffLabel } from '../lib/format';
import { predictedWinner } from '../lib/reveal';
import { BreakdownChips } from './BreakdownChips';

interface Props {
  p: RevealedPrediction;
  match: MatchRow;
  meId: string;
  onClose: () => void;
  onOpenMatch: (m: MatchRow) => void;
  onOpenPlayer: (userId: string) => void;
}

const roundLabel: Record<MatchRow['round'], string> = {
  R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', '3RD': '3rd-place', FINAL: 'Final',
};

/** Bottom sheet: one player's full prediction for one match, tapped from the grid. */
export function PickSheet({ p, match, meId, onClose, onOpenMatch, onOpenPlayer }: Props) {
  const isMe = p.user_id === meId;
  const winner = predictedWinner(p, match);
  const [squad, setSquad] = useState<SquadPlayerRow[] | null>(null);
  const nameOf = (id: string) => squad?.find((s) => s.api_player_id === id)?.name ?? 'Unknown';

  // Scorer names live in the squad, which the grid doesn't load — fetch on open.
  useEffect(() => {
    let live = true;
    getSquad(match.id).then((s) => { if (live) setSquad(s); }).catch(() => { if (live) setSquad([]); });
    return () => { live = false; };
  }, [match.id]);

  // Esc to close + lock background scroll while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Lightweight swipe-down-to-dismiss on the handle.
  const dragStart = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { dragStart.current = e.touches[0].clientY; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (dragStart.current != null && e.changedTouches[0].clientY - dragStart.current > 60) onClose();
    dragStart.current = null;
  };

  const goMatch = () => { onClose(); onOpenMatch(match); };
  const goPlayer = () => { onClose(); onOpenPlayer(p.user_id); };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <span />
        </div>

        <div className="ps-match">
          {match.home_flag} {match.home_team} <span className="ps-vs">vs</span> {match.away_team} {match.away_flag}
          <span className="ps-when">{roundLabel[match.round]} · {kickoffLabel(match.kickoff_utc)}</span>
        </div>

        <div className="ps-head">
          <span className="ps-name">
            {p.display_name}
            {isMe && <span className="you">YOU</span>}
            {p.card_played && <span className="rv-card">🃏</span>}
          </span>
          <span className="ps-right">
            <span className="ps-score">{p.home_score}–{p.away_score}</span>
            <span className="ps-pts">
              {p.points == null ? '·' : p.points > 0 ? `+${p.points}` : p.points}
            </span>
          </span>
        </div>

        <div className="reveal-body" style={{ borderTop: 'none', marginTop: 0 }}>
          <div className="rv-detail">
            <span className="rv-detail-k">Sees through</span>
            <span className="rv-detail-v">{winner.flag} {winner.label}</span>
          </div>

          {p.scorers.length > 0 ? (
            <div className="rv-scorers">
              {p.scorers.map((s, i) => (
                <span key={i} className="rv-scorer">
                  <span className="rv-scorer-flag">{s.team === 'home' ? match.home_flag : match.away_flag}</span>
                  {squad == null ? 'loading…' : nameOf(s.api_player_id)}
                  <span className="rv-bucket">{bucketLabel(s.bucket)}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="rv-detail"><span className="rv-detail-k">Scorers</span><span className="rv-detail-v">Predicted 0–0</span></div>
          )}

          {p.decided_stage && (
            <div className="rv-detail">
              <span className="rv-detail-k">Settled</span>
              <span className="rv-detail-v">
                {p.decided_stage === 'PENS' ? 'Penalties' : p.decided_stage === 'ET' ? 'Extra time' : 'Full time'}
              </span>
            </div>
          )}

          {p.breakdown ? (
            <div className="ps-brk">
              <span className="rv-detail-k">Points</span>
              <BreakdownChips b={p.breakdown} />
            </div>
          ) : (
            <div className="rv-detail">
              <span className="rv-detail-k">Points</span>
              <span className="rv-detail-v ps-pending">Not scored yet</span>
            </div>
          )}
        </div>

        <div className="ps-actions">
          <button className="ps-link" onClick={goMatch}>See full match →</button>
          <button className="ps-link" onClick={goPlayer}>See {isMe ? 'my' : `${p.display_name}'s`} full season →</button>
        </div>
      </div>
    </div>
  );
}
