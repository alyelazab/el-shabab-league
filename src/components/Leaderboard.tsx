import type { LeaderboardRow } from '../lib/db';

export function Leaderboard({
  rows,
  meId,
  onOpenPlayer,
}: {
  rows: LeaderboardRow[];
  meId: string | null;
  onOpenPlayer?: (userId: string) => void;
}) {
  if (!rows.length) return <p className="center-note">No one's on the board yet. First predictions, then first points.</p>;

  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div>
      <p className="eyebrow first">Standings</p>
      <p className="section-hint">Tap anyone to see their picks &amp; full season.</p>
      {rows.map((r, i) => (
        <button
          key={r.user_id}
          className={`card lb-row lb-tap ${i === 0 ? 'top1' : ''}`}
          onClick={() => onOpenPlayer?.(r.user_id)}
        >
          {i < 3 ? <span className="lb-medal">{medals[i]}</span> : <span className="lb-rank">{i + 1}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lb-name">
              {r.display_name}
              {r.user_id === meId && <span className="you">YOU</span>}
            </div>
            <div className="lb-sub">{r.matches_scored} match{r.matches_scored === 1 ? '' : 'es'} scored</div>
          </div>
          <div className="lb-pts">
            {r.total_points}
            <small>PTS</small>
          </div>
          <span className="lb-chev">›</span>
        </button>
      ))}
    </div>
  );
}
