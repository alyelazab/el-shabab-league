import { useEffect, useState } from 'react';
import type { MatchRow, SquadPlayerRow } from '../lib/db';
import { getSquad } from '../lib/db';
import { supabase } from '../lib/supabase';
import type { DecidedStage, Side } from '../lib/scoring/types';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/score-match`;

interface Goal { team: Side; playerId: string; minute: string; }

async function callFn(body: unknown) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json;
}

export function Admin({ matches, onScored }: { matches: MatchRow[]; onScored: () => void }) {
  const [matchId, setMatchId] = useState(matches[0]?.id ?? '');
  const [squad, setSquad] = useState<SquadPlayerRow[]>([]);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [decided, setDecided] = useState<DecidedStage>('FT');
  const [penWinner, setPenWinner] = useState<Side>('home');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const match = matches.find((m) => m.id === matchId);

  useEffect(() => {
    if (matchId) getSquad(matchId).then(setSquad).catch(() => setSquad([]));
  }, [matchId]);

  const teamSquad = (t: Side) => squad.filter((p) => p.team === t);

  async function submit() {
    setBusy(true);
    setMsg('');
    try {
      const payload = {
        mode: 'admin',
        matchId,
        homeScore: home,
        awayScore: away,
        decidedStage: decided,
        penWinner: decided === 'PENS' ? penWinner : null,
        goals: goals
          .filter((g) => g.playerId && g.minute)
          .map((g) => ({ team: g.team, api_player_id: g.playerId, minute: Math.max(1, parseInt(g.minute, 10) || 1) })),
      };
      await callFn(payload);
      setMsg('✓ Result saved and everyone scored.');
      onScored();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function autoImport() {
    setBusy(true);
    setMsg('');
    try {
      const r = await callFn({ mode: 'ingest' });
      const n = Array.isArray(r.scored) ? r.scored.length : 0;
      setMsg(n ? `✓ Auto-imported ${n} finished match${n === 1 ? '' : 'es'} from the feed.` : 'No new finished matches in the feed yet.');
      onScored();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function syncFixtures() {
    setBusy(true);
    setMsg('');
    try {
      const r = await callFn({ mode: 'sync-fixtures' });
      const c = r.fixtures?.created?.length ?? 0;
      const u = r.fixtures?.updated?.length ?? 0;
      setMsg(c || u ? `✓ ${c} new fixture${c === 1 ? '' : 's'} added, ${u} date${u === 1 ? '' : 's'} updated.` : 'Bracket is up to date — nothing new to add.');
      onScored();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function recomputeAll() {
    setBusy(true);
    setMsg('');
    try {
      const r = await callFn({ mode: 'rescore-all' });
      setMsg(`✓ Recomputed ${r.matches ?? 0} scored match${r.matches === 1 ? '' : 'es'} for everyone.`);
      onScored();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <p className="eyebrow first">Commissioner tools</p>
      <p className="section-hint">
        Next-round fixtures and results auto-sync from the feed on a schedule. Use these to sync now, or to enter/correct a result by hand.
      </p>

      <button className="btn btn-ghost" disabled={busy} onClick={syncFixtures} style={{ marginBottom: 12 }}>
        ＋ Sync fixtures now
      </button>
      <button className="btn btn-ghost" disabled={busy} onClick={autoImport} style={{ marginBottom: 12 }}>
        ⤓ Auto-import results now
      </button>
      <button className="btn btn-ghost" disabled={busy} onClick={recomputeAll} style={{ marginBottom: 20 }}>
        ♻ Recompute all scored matches
      </button>

      <div className="card slot">
        <div className="field">
          <label>Match</label>
          <select className="player-select" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.home_team} vs {m.away_team}
              </option>
            ))}
          </select>
        </div>

        <div className="board-teams" style={{ margin: '16px 0' }}>
          <div className="board-team">
            <span className="board-team-name">{match?.home_team}</span>
            <ScoreBox value={home} onChange={setHome} />
          </div>
          <div className="board-sep" style={{ paddingTop: 8 }}>–</div>
          <div className="board-team">
            <span className="board-team-name">{match?.away_team}</span>
            <ScoreBox value={away} onChange={setAway} />
          </div>
        </div>

        <label className="field" style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            How it ended
          </span>
        </label>
        <div className="settle-toggle" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 }}>
          {(['FT', 'ET', 'PENS'] as DecidedStage[]).map((s) => (
            <button
              key={s}
              className={`card settle-btn ${decided === s ? 'on' : ''}`}
              style={{ padding: 11 }}
              onClick={() => setDecided(s)}
            >
              <span className="settle-label">{s === 'FT' ? 'Full time' : s === 'ET' ? 'Extra time' : 'Penalties'}</span>
            </button>
          ))}
        </div>
        {decided === 'PENS' && (
          <div className="settle-teams" style={{ marginBottom: 12 }}>
            {(['home', 'away'] as Side[]).map((side) => (
              <button
                key={side}
                className={`settle-btn ${penWinner === side ? 'on' : ''}`}
                onClick={() => setPenWinner(side)}
              >
                <span className="settle-label">{side === 'home' ? match?.home_team : match?.away_team} win pens</span>
              </button>
            ))}
          </div>
        )}

        <label className="field" style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            Goalscorers
          </span>
        </label>
        {goals.map((g, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 34px', gap: 6, marginBottom: 8 }}>
            <select
              className="player-select"
              value={`${g.team}:${g.playerId}`}
              onChange={(e) => {
                const [team, playerId] = e.target.value.split(':');
                const next = [...goals];
                next[i] = { ...next[i], team: team as Side, playerId };
                setGoals(next);
              }}
            >
              <option value="home:">— pick scorer —</option>
              <optgroup label={match?.home_team}>
                {teamSquad('home').map((p) => (
                  <option key={p.api_player_id} value={`home:${p.api_player_id}`}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label={match?.away_team}>
                {teamSquad('away').map((p) => (
                  <option key={p.api_player_id} value={`away:${p.api_player_id}`}>{p.name}</option>
                ))}
              </optgroup>
            </select>
            <input
              className="input"
              style={{ padding: 10, textAlign: 'center' }}
              inputMode="numeric"
              placeholder="min"
              value={g.minute}
              onChange={(e) => {
                const next = [...goals];
                next[i] = { ...next[i], minute: e.target.value.replace(/\D/g, '') };
                setGoals(next);
              }}
            />
            <button className="step" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button
          className="btn btn-ghost"
          style={{ padding: 11 }}
          onClick={() => setGoals([...goals, { team: 'home', playerId: '', minute: '' }])}
        >
          + Add goal
        </button>

        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : 'Save result & score everyone'}
        </button>
        {msg && <p className={`msg ${msg.startsWith('✓') ? 'ok' : 'err'}`}>{msg}</p>}
      </div>
    </div>
  );
}

function ScoreBox({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="stepper-num" style={{ fontSize: 42 }}>{value}</span>
      <div className="stepper-btns">
        <button className="step" disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
        <button className="step" onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}
