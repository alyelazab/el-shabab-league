import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { ADMIN_EMAIL, supabase } from './lib/supabase';
import {
  getMatches,
  getMyPredictions,
  getLeaderboard,
  getRevealedPredictions,
  type MatchRow,
  type LeaderboardRow,
  type FullPrediction,
  type RevealedPrediction,
} from './lib/db';
import { Login, Onboarding } from './components/Login';
import { MatchList } from './components/MatchList';
import { Predict } from './components/Predict';
import { Leaderboard } from './components/Leaderboard';
import { History } from './components/History';
import { PlayerCard } from './components/PlayerCard';
import { Rules } from './components/Rules';
import { Admin } from './components/Admin';

type Tab = 'matches' | 'board' | 'history' | 'rules' | 'admin';

export default function App() {
  const { loading, session, profile, signOut } = useAuth();

  if (loading) return <div className="spinner" />;
  if (!session) return <Login />;
  if (!profile) return <Onboarding />;
  return <Game meId={session.user.id} email={session.user.email ?? ''} displayName={profile.display_name} onSignOut={signOut} />;
}

function Game({ meId, email, displayName, onSignOut }: { meId: string; email: string; displayName: string; onSignOut: () => void }) {
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
  const [tab, setTab] = useState<Tab>('matches');
  const [openMatch, setOpenMatch] = useState<MatchRow | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const closeMenu = () => { setMenuOpen(false); setConfirmOut(false); };

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [preds, setPreds] = useState<Record<string, FullPrediction & { id: string }>>({});
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [revealed, setRevealed] = useState<RevealedPrediction[]>([]);
  const [myScores, setMyScores] = useState<Record<string, Record<string, unknown>>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [m, p, lb, rev, scores] = await Promise.all([
      getMatches(),
      getMyPredictions(),
      getLeaderboard(),
      getRevealedPredictions(),
      supabase.from('match_scores').select('match_id, breakdown').eq('user_id', meId),
    ]);
    setMatches(m);
    setPreds(p);
    setBoard(lb);
    setRevealed(rev);
    const sm: Record<string, Record<string, unknown>> = {};
    for (const r of scores.data ?? []) sm[r.match_id] = r.breakdown as Record<string, unknown>;
    setMyScores(sm);
    setLoaded(true);
  }, [meId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const myPoints = board.find((r) => r.user_id === meId)?.total_points ?? 0;
  const cardMatchId = Object.entries(preds).find(([, p]) => p.card_played)?.[0];

  function openPredict(m: MatchRow) {
    setOpenPlayer(null);
    setOpenMatch(m);
    window.scrollTo(0, 0);
  }

  function openPlayerView(userId: string) {
    setOpenPlayer(userId);
    window.scrollTo(0, 0);
  }

  return (
    <div className="app">
      <header className="appbar">
        <div className="wordmark">
          El Shabab <span className="accent">League</span>
          <span className="sub">{displayName.toUpperCase()}</span>
        </div>
        <div className="appbar-right">
          <span className="points-chip" title="Your points">
            {myPoints} <small>PTS</small>
          </span>
          <button
            className="acct-btn"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            aria-label="Account menu"
          >
            {displayName.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen && (
            <>
              <div className="acct-backdrop" onClick={closeMenu} />
              <div className="acct-menu">
                <div className="acct-menu-name">{displayName}</div>
                {!confirmOut ? (
                  <button className="acct-menu-item" onClick={() => setConfirmOut(true)}>
                    Sign out
                  </button>
                ) : (
                  <div className="acct-menu-confirm">
                    <span>Sign out of the league?</span>
                    <div className="acct-menu-row">
                      <button className="acct-cancel" onClick={closeMenu}>Stay</button>
                      <button className="acct-danger" onClick={onSignOut}>Sign out</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {openPlayer ? (
        <PlayerCard
          userId={openPlayer}
          meId={meId}
          board={board}
          matches={matches}
          revealed={revealed}
          onBack={() => setOpenPlayer(null)}
        />
      ) : openMatch ? (
        <Predict
          match={openMatch}
          existing={preds[openMatch.id]}
          cardUsedElsewhere={!!cardMatchId && cardMatchId !== openMatch.id}
          breakdown={myScores[openMatch.id]}
          meId={meId}
          revealed={revealed.filter((r) => r.match_id === openMatch.id)}
          onOpenPlayer={openPlayerView}
          onBack={() => setOpenMatch(null)}
          onSaved={refresh}
        />
      ) : !loaded ? (
        <div className="spinner" />
      ) : (
        <main className="screen">
          {tab === 'matches' && <MatchList matches={matches} preds={preds} onOpen={openPredict} />}
          {tab === 'board' && <Leaderboard rows={board} meId={meId} onOpenPlayer={openPlayerView} />}
          {tab === 'history' && (
            <History
              matches={matches}
              board={board}
              revealed={revealed}
              meId={meId}
              onOpenMatch={openPredict}
              onOpenPlayer={openPlayerView}
            />
          )}
          {tab === 'rules' && <Rules />}
          {tab === 'admin' && isAdmin && <Admin matches={matches} onScored={refresh} />}
        </main>
      )}

      {!openMatch && !openPlayer && (
        <nav className="nav">
          <NavBtn on={tab === 'matches'} ic="⚽" label="Matches" onClick={() => setTab('matches')} />
          <NavBtn on={tab === 'board'} ic="🏆" label="Table" onClick={() => setTab('board')} />
          <NavBtn on={tab === 'history'} ic="🗂" label="Grid" onClick={() => setTab('history')} />
          <NavBtn on={tab === 'rules'} ic="📖" label="Rules" onClick={() => setTab('rules')} />
          {isAdmin && <NavBtn on={tab === 'admin'} ic="🛠" label="Admin" onClick={() => setTab('admin')} />}
        </nav>
      )}
    </div>
  );
}

function NavBtn({ on, ic, label, onClick }: { on: boolean; ic: string; label: string; onClick: () => void }) {
  return (
    <button className={on ? 'on' : ''} onClick={onClick}>
      <span className="ic">{ic}</span>
      {label}
    </button>
  );
}
