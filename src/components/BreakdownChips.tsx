import { SCORING } from '../lib/scoring/config';

/** The pill row summarising how a scored prediction earned its points. */
export function BreakdownChips({ b }: { b: Record<string, unknown> }) {
  const exact = b.exactScore === true;
  const result = b.correctResult === true;
  const scorers = Number(b.correctScorers ?? 0);
  const timings = Number(b.correctTimings ?? 0);
  const scorersPts = Number(b.scorersPoints ?? 0);
  const timingPts = Number(b.timingPoints ?? 0);
  const card = (b.card as { played?: boolean; outcome?: string } | undefined) ?? {};
  return (
    <div className="brk">
      <span className={`brk-chip ${exact ? 'hit' : result ? 'hit' : 'miss'}`}>
        {exact ? 'Exact score ✓' : result ? 'Right result ✓' : 'Score ✗'}
      </span>
      <span className={`brk-chip ${scorers > 0 ? 'hit' : 'miss'}`}>
        {scorers} scorer{scorers === 1 ? '' : 's'} {scorers > 0 ? `✓ +${scorersPts}` : '✗'}
      </span>
      <span className={`brk-chip ${timings > 0 ? 'hit' : 'miss'}`}>
        {timings} timing{timings === 1 ? '' : 's'} {timings > 0 ? `✓ +${timingPts}` : '✗'}
      </span>
      {Number(b.decidedBonus ?? 0) > 0 && <span className="brk-chip hit">Settled ✓ +{SCORING.decidedBonus}</span>}
      {card.played && (
        <span className="brk-chip gold">
          🃏 {card.outcome === 'double' ? 'Doubled!' : card.outcome === 'penalty' ? '−5' : 'Card spent'}
        </span>
      )}
    </div>
  );
}
