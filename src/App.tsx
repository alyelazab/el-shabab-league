import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './lib/supabase';
import {
  getMatches,
  getMyPredictions,
  getLeaderboard,
  getRevealedPredictions,
  getMyLeagues,
  type MatchRow,
  type LeaderboardRow,
  type FullPrediction,
  type RevealedPrediction,
  type League,
} from './lib/db';
import { Login, Onboarding } from './components/Login';
import { ProfileLoadError } from './components/ProfileLoadError';
import { MatchList } from './components/MatchList';
import { Predict } from './components/Predict';
import { Leaderboard } from './components/Leaderboard';
import { History } from './components/History';
import { PlayerCard } from './components/PlayerCard';
import { Rules } from './components/Rules';
import { Admin } from './components/Admin';
import { LeagueBar } from './components/LeagueBar';
import { LeagueGate } from './components/LeagueGate';

type Tab = 'matches' | 'board' | 'history' | 'rules' | 'admin';

const ACTIVE_LEAGUE_KEY = 'elshabab.activeLeagueId';

export default function App() {
  const { loading, session, profile, profileError, signOut, refreshProfile } = useAuth();

  if (loading) return <div className="spinner" />;
  if (!session) return <Login />;
  // A load error (not a missing row) means an existing player whose profile fetch failed — offer a
  // retry instead of the sign-up screen. Only a genuine null profile (new user) reaches Onboarding.
  if (profileError) return <ProfileLoadError onRetry={refreshProfile} onSignOut={signOut} />;
  if (!profile) return <Onboarding />;
  return (
    <Game
      meId={session.user.id}
      isAdmin={profile.is_admin}
      displayName={profile.display_name}
      onSignOut={signOut}
    />
  );
}

function Game({ meId, isAdmin, displayName, onSignOut }: { meId: string; isAdmin: boolean; displayName: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('matches');
  const [openMatch, setOpenMatch] = useState<MatchRow | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const closeMenu = () => { setMenuOpen(false); setConfirmOut(false); };

  const [leagues, setLeagues] = useState<League[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [preds, setPreds] = useState<Record<string, FullPrediction & { id: string }>>({});
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [revealed, setRevealed] = useState<RevealedPrediction[]>([]);
  const [myScores, setMyScores] = useState<Record<string, Record<string, unknown>>>({});
  const [loaded, setLoaded] = useState(false);
  const [needLeague, setNeedLeague] = useState(false);

  // Load everything. Global data (matches, predictions, reveal, scores) is league-independent;
  // only the leaderboard is scoped to the active league.
  const refresh = useCallback(async () => {
    const myLeagues = await getMyLeagues();
    setLeagues(myLeagues);
    if (!myLeagues.length) {
      setNeedLeague(true);
      setLoaded(true);
      return;
    }
    setNeedLeague(false);
    const stored = localStorage.getItem(ACTIVE_LEAGUE_KEY) ?? '';
    const active = myLeagues.find((l) => l.id === stored)?.id ?? myLeagues[0].id;
    setActiveLeagueId(active);
    localStorage.setItem(ACTIVE_LEAGUE_KEY, active);

    const [m, p, lb, rev, scores] = await Promise.all([
      getMatches(),
      getMyPredictions(),
      getLeaderboard(active),
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

  // Switching leagues only needs a fresh (scoped) leaderboard; everything else is global.
  const switchLeague = useCallback(async (id: string) => {
    setActiveLeagueId(id);
    localStorage.setItem(ACTIVE_LEAGUE_KEY, id);
    setBoard(await getLeaderboard(id));
  }, []);

  // After creating/joining a league from the header, add it and jump to it.
  const onLeaguesChanged = useCallback(async (created: League) => {
    setLeagues(await getMyLeagues());
    await switchLeague(created.id);
  }, [switchLeague]);

  // After the first-league gate: remember it and reload the full game.
  const onFirstLeague = useCallback(async (created: League) => {
    localStorage.setItem(ACTIVE_LEAGUE_KEY, created.id);
    setLoaded(false);
    await refresh();
  }, [refresh]);

  const myPoints = board.find((r) => r.user_id === meId)?.total_points ?? 0;
  const cardMatchId = Object.entries(preds).find(([, p]) => p.card_played)?.[0];

  // Reveal (others' locked picks) scoped to the active league's members, so the match consensus,
  // the grid and player cards never surface picks from people in other leagues.
  const memberIds = useMemo(() => new Set(board.map((r) => r.user_id)), [board]);
  const leagueRevealed = useMemo(() => revealed.filter((r) => memberIds.has(r.user_id)), [revealed, memberIds]);

  function openPredict(m: MatchRow) {
    setOpenPlayer(null);
    setOpenMatch(m);
    window.scrollTo(0, 0);
  }

  function openPlayerView(userId: string) {
    setOpenPlayer(userId);
    window.scrollTo(0, 0);
  }

  if (!loaded) return <div className="spinner" />;
  if (needLeague) return <LeagueGate onDone={onFirstLeague} />;

  const inSubview = !!openMatch || !!openPlayer;

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

      {!inSubview && (
        <LeagueBar
          leagues={leagues}
          activeId={activeLeagueId}
          onSwitch={switchLeague}
          onChanged={onLeaguesChanged}
        />
      )}

      {openPlayer ? (
        <PlayerCard
          userId={openPlayer}
          meId={meId}
          board={board}
          matches={matches}
          revealed={leagueRevealed}
          onBack={() => setOpenPlayer(null)}
        />
      ) : openMatch ? (
        <Predict
          match={openMatch}
          existing={preds[openMatch.id]}
          cardUsedElsewhere={!!cardMatchId && cardMatchId !== openMatch.id}
          breakdown={myScores[openMatch.id]}
          meId={meId}
          revealed={leagueRevealed.filter((r) => r.match_id === openMatch.id)}
          onOpenPlayer={openPlayerView}
          onBack={() => setOpenMatch(null)}
          onSaved={refresh}
        />
      ) : (
        <main className="screen">
          {tab === 'matches' && <MatchList matches={matches} preds={preds} onOpen={openPredict} />}
          {tab === 'board' && <Leaderboard rows={board} meId={meId} onOpenPlayer={openPlayerView} />}
          {tab === 'history' && (
            <History
              matches={matches}
              board={board}
              revealed={leagueRevealed}
              meId={meId}
              onOpenMatch={openPredict}
              onOpenPlayer={openPlayerView}
            />
          )}
          {tab === 'rules' && <Rules />}
          {tab === 'admin' && isAdmin && <Admin matches={matches} onScored={refresh} />}
        </main>
      )}

      {!inSubview && (
        <nav className="nav">
          <NavBtn on={tab === 'matches'} ic="⚽" label="Matches" onClick={() => setTab('matches')} />
          <NavBtn on={tab === 'board'} ic="🏆" label="Table" onClick={() => setTab('board')} />
          <NavBtn on={tab === 'history'} ic="🗂" label="Predictions" onClick={() => setTab('history')} />
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
