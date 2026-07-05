import { useEffect, useMemo, useState } from 'react';
import type { MatchRow, SquadPlayerRow, FullPrediction, RevealedPrediction } from '../lib/db';
import { getSquad, savePrediction } from '../lib/db';
import { matchState, kickoffLabel, countdown, ALL_BUCKETS, bucketLabel } from '../lib/format';
import { SCORING } from '../lib/scoring/config';
import type { Bucket, DecidedStage, Side } from '../lib/scoring/types';
import { predictedWinner } from '../lib/reveal';
import { BreakdownChips } from './BreakdownChips';
import { ScorerPicker } from './ScorerPicker';

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
  meId: string;
  revealed?: RevealedPrediction[];
  onOpenPlayer?: (userId: string) => void;
  onBack: () => void;
  onSaved: () => void;
}

export function Predict({ match, existing, cardUsedElsewhere, breakdown, meId, revealed, onOpenPlayer, onBack, onSaved }: Props) {
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
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState('');
  // Goals half-filled at save time (a scorer without a timing, or vice versa) —
  // highlighted so nothing gets silently dropped.
  const [badSlots, setBadSlots] = useState<Set<string>>(new Set());

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
    setBadSlots(new Set());
  }

  async function save() {
    setErr('');
    // Block half-filled goals instead of silently dropping them: a slot must have
    // BOTH a scorer and a timing, or be left entirely blank.
    const bad = new Set<string>();
    homeSlots.forEach((s, i) => { if (!!s.playerId !== !!s.bucket) bad.add(`home-${i}`); });
    awaySlots.forEach((s, i) => { if (!!s.playerId !== !!s.bucket) bad.add(`away-${i}`); });
    if (bad.size) {
      setBadSlots(bad);
      setErr('Finish the highlighted goal — pick a scorer and a timing — or clear it to leave that goal open.');
      return;
    }
    setBadSlots(new Set());
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
      setJustSaved(true);
      onSaved(); // refresh list data in the background
      // Brief confirmation, then drop back to the matches list (pick now shows on the card).
      setTimeout(onBack, 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save. It may have just locked.');
      setBusy(false);
    }
  }

  const renderSlots = (slots: Slot[], setSlots: (s: Slot[]) => void, squadList: SquadPlayerRow[], side: Side, flag: string | null, team: string) =>
    slots.map((s, i) => (
      <div className={`card slot ${badSlots.has(`${side}-${i}`) ? 'slot-bad' : ''}`} key={`${side}-${i}`}>
        <div className="slot-head">
          <span className="slot-badge">{i + 1}</span>
          <span className="slot-title">
            <span className="flag-sm">{flag}</span> {team} goal {slots.length > 1 ? i + 1 : ''}
          </span>
          {badSlots.has(`${side}-${i}`) && <span className="slot-warn">needs scorer + timing</span>}
        </div>
        <ScorerPicker
          players={squadList}
          value={s.playerId}
          disabled={!editable}
          onChange={(id) => {
            const next = [...slots];
            next[i] = { ...next[i], playerId: id };
            setSlots(next);
            dirty();
          }}
        />
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

      {/* How it's settled bonus */}
      {(editable || decided) && (
        <>
          <p className="eyebrow">How's it settled? <span style={{ color: 'var(--gold)' }}>+{SCORING.decidedBonus}</span></p>
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

      {/* Everyone's picks — revealed once the match locks */}
      {state !== 'open' && (
        <RevealSection
          match={match}
          squad={squad}
          revealed={revealed ?? []}
          meId={meId}
          onOpenPlayer={onOpenPlayer}
        />
      )}

      {/* Save */}
      {editable && (
        <div className="lockbar">
          <button className="btn btn-primary" disabled={busy || justSaved} onClick={save}>
            {justSaved ? '✓ Prediction saved' : busy ? 'Saving…' : savedAt ? '✓ Saved — tap to update' : 'Lock it in'}
          </button>
          <p className="lock-note">
            {justSaved ? (
              <span className="saved-stamp">Taking you back to matches…</span>
            ) : savedAt ? (
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
  return (
    <div className="card slot" style={{ marginTop: 14 }}>
      <div className="slot-head" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="slot-title">Your points</span>
        <span className="lb-pts" style={{ fontSize: 28 }}>{points > 0 ? `+${points}` : points}</span>
      </div>
      <BreakdownChips b={b} />
    </div>
  );
}

// ─── Everyone's picks for a locked match ──────────────────────────────────────
function RevealSection({
  match,
  squad,
  revealed,
  meId,
  onOpenPlayer,
}: {
  match: MatchRow;
  squad: SquadPlayerRow[];
  revealed: RevealedPrediction[];
  meId: string;
  onOpenPlayer?: (userId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const nameOf = (id: string) => squad.find((s) => s.api_player_id === id)?.name ?? 'Unknown';

  // Sort: highest points first once scored, else by predicted home score. You first within ties.
  const rows = useMemo(() => {
    return [...revealed].sort((a, b) => {
      const ap = a.points ?? -Infinity;
      const bp = b.points ?? -Infinity;
      if (ap !== bp) return bp - ap;
      return Number(b.user_id === meId) - Number(a.user_id === meId);
    });
  }, [revealed, meId]);

  // Consensus: who does the room back, and the most-predicted scoreline.
  const consensus = useMemo(() => {
    if (!revealed.length) return null;
    const backers = new Map<string, { flag: string | null; n: number }>();
    const lines = new Map<string, number>();
    for (const p of revealed) {
      const w = predictedWinner(p, match);
      const b = backers.get(w.label) ?? { flag: w.flag, n: 0 };
      b.n += 1;
      backers.set(w.label, b);
      const key = `${p.home_score}–${p.away_score}`;
      lines.set(key, (lines.get(key) ?? 0) + 1);
    }
    const topBack = [...backers.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    const topLine = [...lines.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total: revealed.length,
      backLabel: topBack[0],
      backFlag: topBack[1].flag,
      backN: topBack[1].n,
      line: topLine[0],
      lineN: topLine[1],
    };
  }, [revealed, match]);

  return (
    <>
      <p className="eyebrow">Everyone's picks · {revealed.length}</p>

      {consensus ? (
        <div className="card consensus">
          <span className="cons-flag">{consensus.backFlag}</span>
          <div>
            <div className="cons-line">
              <b>{consensus.backN} of {consensus.total}</b> back{' '}
              {consensus.backLabel === 'a draw' ? 'a draw' : consensus.backLabel}
            </div>
            <div className="cons-sub">Most-picked scoreline: <b>{consensus.line}</b> ({consensus.lineN})</div>
          </div>
        </div>
      ) : (
        <p className="section-hint">No one predicted this match.</p>
      )}

      {rows.map((p) => {
        const isOpen = open === p.user_id;
        const winner = predictedWinner(p, match);
        return (
          <div key={p.user_id} className={`card reveal-row ${p.user_id === meId ? 'mine' : ''}`}>
            <button className="reveal-head" onClick={() => setOpen(isOpen ? null : p.user_id)}>
              <span className="rv-name">
                {p.display_name}
                {p.user_id === meId && <span className="you">YOU</span>}
                {p.card_played && <span className="rv-card">🃏</span>}
              </span>
              <span className="rv-right">
                <span className="rv-score">{p.home_score}–{p.away_score}</span>
                {p.points != null && (
                  <span className="rv-pts">{p.points > 0 ? `+${p.points}` : p.points}</span>
                )}
                <span className={`rv-chev ${isOpen ? 'up' : ''}`}>⌄</span>
              </span>
            </button>

            {isOpen && (
              <div className="reveal-body">
                <div className="rv-detail">
                  <span className="rv-detail-k">Sees through</span>
                  <span className="rv-detail-v">{winner.flag} {winner.label}</span>
                </div>
                {p.scorers.length > 0 ? (
                  <div className="rv-scorers">
                    {p.scorers.map((s, i) => (
                      <span key={i} className="rv-scorer">
                        <span className="rv-scorer-flag">{s.team === 'home' ? match.home_flag : match.away_flag}</span>
                        {nameOf(s.api_player_id)}
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
                {onOpenPlayer && (
                  <button className="rv-season" onClick={() => onOpenPlayer(p.user_id)}>
                    See {p.user_id === meId ? 'my' : `${p.display_name}'s`} full season →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
