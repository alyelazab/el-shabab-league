import { useEffect, useMemo, useState } from 'react';
import type { MatchRow, SquadPlayerRow, FullPrediction } from '../lib/db';
import { getSquad, savePrediction } from '../lib/db';
import { matchState, kickoffLabel, countdown, ALL_BUCKETS, bucketLabel } from '../lib/format';
import type { Bucket, DecidedStage, Side } from '../lib/scoring/types';

interface Slot {
  playerId: string;
  bucket: Bucket | '';
}
const emptySlots = (n: number, from: Slot[] = []): Slot[] =>
  Array.from({ length: n }, (_, i) => from[i] ?? { playerId: '', bucket: '' });

interface Props {
  match: MatchRow;
  existing?: FullPrediction;
  cardUsedElsewhere: boolean;
  breakdown?: Record<string, unknown>;
  onBack: () => void;
  onSaved: () => void;
}

export function Predict({ match, existing, cardUsedElsewhere, breakdown, onBack, onSaved }: Props) {
  const state = matchState(match);
  const editable = state === 'open';

  const [squad, setSquad] = useState<SquadPlayerRow[]>([]);
  const [home, setHome] = useState(existing?.home_score ?? 0);
  const [away, setAway] = useState(existing?.away_score ?? 0);
  const [card, setCard] = useState(existing?.card_played ?? false);
  const [decided, setDecided] = useState<DecidedStage | null>(existing?.decided_stage ?? null);
  const [advancer, setAdvancer] = useState<Side | null>(existing?.advancer ?? null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(!!existing);
  const [err, setErr] = useState('');

  const initSlots = (side: Side, count: number): Slot[] => {
    const picks = (existing?.scorers ?? [])
      .filter((s) => s.team === side)
      .sort((a, b) => a.slot - b.slot)
      .map((s) => ({ playerId: s.api_player_id, bucket: s.bucket }));
    return emptySlots(count, picks);
  };

  const [homeSlots, setHomeSlots] = useState<Slot[]>(() => initSlots('home', existing?.home_score ?? 0));
  const [awaySlots, setAwaySlots] = useState<Slot[]>(() => initSlots('away', existing?.away_score ?? 0));

  useEffect(() => {
    getSquad(match.id).then(setSquad).catch(() => setSquad([]));
  }, [match.id]);

  useEffect(() => setHomeSlots((s) => emptySlots(home, s)), [home]);
  useEffect(() => setAwaySlots((s) => emptySlots(away, s)), [away]);

  // A predicted draw can't stand in a knockout → it's decided on penalties.
  const isDraw = home === away;
  useEffect(() => {
    if (isDraw) setDecided('PENS');
    else {
      setDecided((d) => (d === 'PENS' ? null : d));
      setAdvancer(null);
    }
  }, [isDraw]);

  const homeSquad = useMemo(() => squad.filter((p) => p.team === 'home'), [squad]);
  const awaySquad = useMemo(() => squad.filter((p) => p.team === 'away'), [squad]);

  function dirty() {
    setSavedAt(false);
    setErr('');
  }

  async function save() {
    setErr('');
    setBusy(true);
    const scorers: FullPrediction['scorers'] = [];
    let slot = 0;
    homeSlots.forEach((s) => {
      if (s.playerId && s.bucket) scorers.push({ slot: slot++, team: 'home', api_player_id: s.playerId, bucket: s.bucket });
    });
    awaySlots.forEach((s) => {
      if (s.playerId && s.bucket) scorers.push({ slot: slot++, team: 'away', api_player_id: s.playerId, bucket: s.bucket });
    });
    try {
      await savePrediction(match.id, {
        home_score: home,
        away_score: away,
        card_played: card,
        decided_stage: decided,
        advancer: isDraw ? advancer : null,
        scorers,
      });
      setSavedAt(true);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save. It may have just locked.');
    } finally {
      setBusy(false);
    }
  }

  const renderSlots = (slots: Slot[], setSlots: (s: Slot[]) => void, squadList: SquadPlayerRow[], side: Side, flag: string | null, team: string) =>
    slots.map((s, i) => (
      <div className="card slot" key={`${side}-${i}`}>
        <div className="slot-head">
          <span className="slot-badge">{i + 1}</span>
          <span className="slot-title">
            <span className="flag-sm">{flag}</span> {team} goal {slots.length > 1 ? i + 1 : ''}
          </span>
        </div>
        <select
          className="player-select"
          disabled={!editable}
          value={s.playerId}
          onChange={(e) => {
            const next = [...slots];
            next[i] = { ...next[i], playerId: e.target.value };
            setSlots(next);
            dirty();
          }}
        >
          <option value="">Who scores it?</option>
          {squadList.map((p) => (
            <option key={p.api_player_id} value={p.api_player_id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="buckets">
          {ALL_BUCKETS.map((b) => (
            <button
              key={b}
              className={`bucket ${s.bucket === b ? 'on' : ''}`}
              disabled={!editable}
              onClick={() => {
                const next = [...slots];
                next[i] = { ...next[i], bucket: s.bucket === b ? '' : b };
                setSlots(next);
                dirty();
              }}
            >
              {bucketLabel(b)}
            </button>
          ))}
        </div>
      </div>
    ));

  return (
    <div className="screen">
      <button className="back-btn" onClick={onBack}>
        ← All matches
      </button>

      {/* Scoreboard */}
      <div className="card board">
        <div className="board-teams">
          <div className="board-team">
            <span className="board-flag">{match.home_flag}</span>
            <span className="board-team-name">{match.home_team}</span>
            {editable ? (
              <Stepper value={home} onChange={(v) => { setHome(v); dirty(); }} />
            ) : (
              <span className="stepper-num">{state === 'final' ? match.home_score_reg ?? '–' : home}</span>
            )}
          </div>
          <div className="board-sep">VS</div>
          <div className="board-team">
            <span className="board-flag">{match.away_flag}</span>
            <span className="board-team-name">{match.away_team}</span>
            {editable ? (
              <Stepper value={away} onChange={(v) => { setAway(v); dirty(); }} />
            ) : (
              <span className="stepper-num">{state === 'final' ? match.away_score_reg ?? '–' : away}</span>
            )}
          </div>
        </div>
      </div>

      {state !== 'open' && (
        <p className="section-hint" style={{ marginTop: 14, textAlign: 'center' }}>
          {state === 'final'
            ? 'Final result shown above. Your prediction and points are below.'
            : `Locked at kickoff − 5 min. ${kickoffLabel(match.kickoff_utc)}.`}
        </p>
      )}

      {/* Result breakdown (final only) */}
      {state === 'final' && breakdown && <Breakdown b={breakdown} />}

      {/* Scorers */}
      {home + away > 0 ? (
        <>
          <p className="eyebrow first">Who scores — &amp; when?</p>
          {renderSlots(homeSlots, setHomeSlots, homeSquad, 'home', match.home_flag, match.home_team)}
          {renderSlots(awaySlots, setAwaySlots, awaySquad, 'away', match.away_flag, match.away_team)}
        </>
      ) : (
        editable && <p className="section-hint" style={{ marginTop: 16 }}>Predicting a 0–0? Bold. Add goals above to pick scorers.</p>
      )}

      {/* How it's settled (+2) */}
      {(editable || decided) && (
        <>
          <p className="eyebrow">How's it settled? <span style={{ color: 'var(--gold)' }}>+2</span></p>
          {isDraw ? (
            <div className="card slot">
              <p className="dbl-sub" style={{ marginBottom: 11 }}>
                Level after 90 — a knockout can't end level, so it's a shootout. Who goes through?
              </p>
              <div className="settle-teams">
                {(['home', 'away'] as Side[]).map((side) => (
                  <button
                    key={side}
                    className={`settle-btn ${advancer === side ? 'on' : ''}`}
                    disabled={!editable}
                    onClick={() => { setAdvancer(side); dirty(); }}
                  >
                    <span className="board-flag" style={{ fontSize: 28 }}>
                      {side === 'home' ? match.home_flag : match.away_flag}
                    </span>
                    <span className="settle-label">{side === 'home' ? match.home_team : match.away_team}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="settle-toggle">
              {([['FT', 'Full time', 'Winner in 90'], ['ET', 'Extra time', 'Winner in ET']] as const).map(
                ([val, label, sub]) => (
                  <button
                    key={val}
                    className={`card settle-btn ${decided === val ? 'on' : ''}`}
                    disabled={!editable}
                    onClick={() => { setDecided(decided === val ? null : (val as DecidedStage)); dirty(); }}
                  >
                    <span className="settle-label">{label}</span>
                    <span className="settle-sub">{sub}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </>
      )}

      {/* Double or Nothing */}
      {(editable || card) && (
        <>
          <p className="eyebrow">Power-up</p>
          <button
            className={`dbl ${card ? 'on' : ''}`}
            disabled={!editable}
            onClick={() => { setCard(!card); dirty(); }}
          >
            <span className="dbl-icon">{card ? '🃏' : '🎴'}</span>
            <span className="dbl-body">
              <span className="dbl-title">Double or Nothing</span>
              <span className="dbl-sub">
                {card
                  ? 'Playing it here. All 3 right → double points. All 3 wrong → −5.'
                  : cardUsedElsewhere
                    ? 'Currently on another match — turning on moves it here.'
                    : 'Your one card all tournament. Big swing, one shot.'}
              </span>
            </span>
            <span className={`switch ${card ? 'on' : ''}`} />
          </button>
        </>
      )}

      {/* Save */}
      {editable && (
        <div className="lockbar">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : savedAt ? '✓ Saved — tap to update' : 'Lock it in'}
          </button>
          <p className="lock-note">
            {savedAt ? (
              <span className="saved-stamp">✓ Prediction saved</span>
            ) : (
              <>You can change it until {countdown(match.lock_at)} before kickoff.</>
            )}
          </p>
          {err && <p className="msg err">{err}</p>}
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="stepper-num">{value}</span>
      <div className="stepper-btns">
        <button className="step" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} aria-label="minus">
          −
        </button>
        <button className="step" disabled={value >= 12} onClick={() => onChange(value + 1)} aria-label="plus">
          +
        </button>
      </div>
    </div>
  );
}

function Breakdown({ b }: { b: Record<string, unknown> }) {
  const points = Number(b.points ?? 0);
  const exact = b.exactScore === true;
  const result = b.correctResult === true;
  const scorers = Number(b.correctScorers ?? 0);
  const timings = Number(b.correctTimings ?? 0);
  const card = (b.card as { played?: boolean; outcome?: string } | undefined) ?? {};
  return (
    <div className="card slot" style={{ marginTop: 14 }}>
      <div className="slot-head" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="slot-title">Your points</span>
        <span className="lb-pts" style={{ fontSize: 28 }}>{points > 0 ? `+${points}` : points}</span>
      </div>
      <div className="brk">
        <span className={`brk-chip ${exact ? 'hit' : result ? 'hit' : 'miss'}`}>
          {exact ? 'Exact score ✓' : result ? 'Right result ✓' : 'Score ✗'}
        </span>
        <span className={`brk-chip ${scorers > 0 ? 'hit' : 'miss'}`}>
          {scorers} scorer{scorers === 1 ? '' : 's'} ✓
        </span>
        <span className={`brk-chip ${timings > 0 ? 'hit' : 'miss'}`}>
          {timings} timing{timings === 1 ? '' : 's'} ✓
        </span>
        {Number(b.decidedBonus ?? 0) > 0 && <span className="brk-chip hit">Settled ✓ +2</span>}
        {card.played && (
          <span className="brk-chip gold">
            🃏 {card.outcome === 'double' ? 'Doubled!' : card.outcome === 'penalty' ? '−5' : 'Card spent'}
          </span>
        )}
      </div>
    </div>
  );
}
