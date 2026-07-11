import { useMemo, useState } from 'react';
import type { MatchRow, LeaderboardRow, RevealedPrediction } from '../lib/db';
import { matchState } from '../lib/format';
import { PickSheet } from './PickSheet';

interface Props {
  matches: MatchRow[];
  board: LeaderboardRow[];
  revealed: RevealedPrediction[];
  meId: string;
  onOpenMatch: (m: MatchRow) => void;
  onOpenPlayer: (userId: string) => void;
}

/** Points → heat tier, so strong matches pop out of the grid at a glance. */
function heat(points: number | null): string {
  if (points == null) return '';
  if (points <= 0) return 'h-cold';
  if (points <= 4) return 'h-1';
  if (points <= 9) return 'h-2';
  return 'h-3';
}

const roundShort: Record<MatchRow['round'], string> = {
  R16: 'R16', QF: 'QF', SF: 'SF', '3RD': '3rd', FINAL: 'F',
};

export function History({ matches, board, revealed, meId, onOpenMatch, onOpenPlayer }: Props) {
  const now = Date.now();
  const [openPick, setOpenPick] = useState<{ p: RevealedPrediction; m: MatchRow } | null>(null);

  // Columns: only matches whose picks have revealed (locked or final), oldest → newest.
  const cols = useMemo(
    () => matches.filter((m) => matchState(m, now) !== 'open'),
    [matches, now],
  );

  // Rows: every league member, YOU pinned to the top, then by standing.
  const rows = useMemo(() => {
    const rest = board.filter((r) => r.user_id !== meId);
    const me = board.find((r) => r.user_id === meId);
    return me ? [me, ...rest] : rest;
  }, [board, meId]);

  // Fast lookup: "userId:matchId" → that player's revealed pick.
  const byKey = useMemo(() => {
    const m = new Map<string, RevealedPrediction>();
    for (const p of revealed) m.set(`${p.user_id}:${p.match_id}`, p);
    return m;
  }, [revealed]);

  if (!cols.length) {
    return (
      <p className="center-note">
        No matches have locked yet. The moment one does, everyone's picks land here — side by side.
      </p>
    );
  }

  return (
    <div>
      <p className="eyebrow first">The Grid · your league's picks</p>
      <p className="section-hint">
        Tap any cell for the full pick · a match for all picks &amp; consensus · a name for their season.
      </p>

      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid-corner">Player</th>
              {cols.map((m) => (
                <th key={m.id} className="grid-head" onClick={() => onOpenMatch(m)}>
                  <span className="gh-flags">{m.home_flag}{m.away_flag}</span>
                  <span className="gh-round">{roundShort[m.round]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.user_id}
                className={r.user_id === meId ? 'grid-you' : ''}
                onClick={() => onOpenPlayer(r.user_id)}
              >
                <th className="grid-name">
                  <span className="gn-text">{r.display_name}</span>
                  {r.user_id === meId && <span className="you">YOU</span>}
                </th>
                {cols.map((m) => {
                  const p = byKey.get(`${r.user_id}:${m.id}`);
                  return (
                    <td
                      key={m.id}
                      className={`grid-cell ${p ? heat(p.points) : 'empty'}`}
                      role={p ? 'button' : undefined}
                      onClick={p ? (e) => { e.stopPropagation(); setOpenPick({ p, m }); } : undefined}
                    >
                      {p ? (
                        <>
                          <span className="gc-score">
                            {p.home_score}–{p.away_score}
                            {p.card_played && <span className="gc-card">🃏</span>}
                          </span>
                          <span className="gc-pts">
                            {p.points == null ? '·' : p.points > 0 ? `+${p.points}` : p.points}
                          </span>
                        </>
                      ) : (
                        <span className="gc-none">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openPick && (
        <PickSheet
          p={openPick.p}
          match={openPick.m}
          meId={meId}
          onClose={() => setOpenPick(null)}
          onOpenMatch={onOpenMatch}
          onOpenPlayer={onOpenPlayer}
        />
      )}
    </div>
  );
}
