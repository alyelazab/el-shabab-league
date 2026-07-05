// Pure scoring engine for El Shabab League. No I/O — fully deterministic and testable.
// score(prediction, actual) -> breakdown.

import { SCORING } from './config';
import type { ActualResult, Bucket, Prediction, ScoreBreakdown } from './types';

/** Map an elapsed minute to its 15-minute window. Stoppage folds into its half. */
export function bucketForMinute(minute: number): Bucket {
  if (minute <= 15) return '1-15';
  if (minute <= 30) return '16-30';
  if (minute <= 45) return '31-45';
  if (minute <= 60) return '46-60';
  if (minute <= 75) return '61-75';
  if (minute <= 90) return '76-90+';
  if (minute <= 105) return '91-105';
  return '106-120';
}

/** Count how many predicted keys are matched by actual keys, respecting multiplicity. */
function multisetOverlap(predicted: string[], actual: string[]): number {
  const actualCounts = new Map<string, number>();
  for (const key of actual) actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);

  let overlap = 0;
  for (const key of predicted) {
    const remaining = actualCounts.get(key) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      actualCounts.set(key, remaining - 1);
    }
  }
  return overlap;
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

export function scorePrediction(prediction: Prediction, actual: ActualResult): ScoreBreakdown {
  // --- Match score ---
  const exactScore = prediction.homeScore === actual.homeScore && prediction.awayScore === actual.awayScore;
  const correctResult = sign(prediction.homeScore - prediction.awayScore) === sign(actual.homeScore - actual.awayScore);
  const scorePoints = exactScore ? SCORING.exactScore : correctResult ? SCORING.correctResult : 0;

  // --- Goalscorers (multiset by player) ---
  const correctScorers = multisetOverlap(
    prediction.scorers.map((s) => s.playerId),
    actual.goals.map((g) => g.playerId),
  );
  const scorersPoints = correctScorers * SCORING.perScorer;

  // --- Goal timing (multiset by player+bucket) ---
  const correctTimings = multisetOverlap(
    prediction.scorers.map((s) => `${s.playerId}@${s.bucket}`),
    actual.goals.map((g) => `${g.playerId}@${bucketForMinute(g.minute)}`),
  );
  const timingPoints = correctTimings * SCORING.perTiming;

  // --- "How it's settled" bonus (independent of the card's three categories) ---
  let decidedBonus = 0;
  if (prediction.decidedStage === 'PENS') {
    // Draw pick: correct only if it actually went to penalties AND the right team advanced.
    if (actual.decidedStage === 'PENS' && prediction.advancer && prediction.advancer === actual.penWinner) {
      decidedBonus = SCORING.decidedBonus;
    }
  } else if (prediction.decidedStage) {
    // Decisive pick (FT / ET): correct if the settle stage matches.
    if (actual.decidedStage && prediction.decidedStage === actual.decidedStage) {
      decidedBonus = SCORING.decidedBonus;
    }
  }

  // The card acts only on the three core categories; the settle bonus always stands.
  const coreBase = scorePoints + scorersPoints + timingPoints;
  const base = coreBase + decidedBonus;

  const hits = (scorePoints > 0 ? 1 : 0) + (scorersPoints > 0 ? 1 : 0) + (timingPoints > 0 ? 1 : 0);

  let points = base;
  let outcome: ScoreBreakdown['card']['outcome'] = null;
  if (prediction.cardPlayed) {
    if (hits === 3) {
      outcome = 'double';
      points = base * 2; // doubles the core score and the settle bonus
    } else if (hits === 0) {
      outcome = 'penalty';
      points = SCORING.cardPenalty + decidedBonus; // −5, but the settle bonus survives
    } else {
      outcome = 'neutral';
      points = base;
    }
  }

  return {
    points,
    base,
    scorePoints,
    scorersPoints,
    timingPoints,
    decidedBonus,
    exactScore,
    correctResult,
    correctScorers,
    correctTimings,
    card: { played: prediction.cardPlayed, hits, outcome },
  };
}
