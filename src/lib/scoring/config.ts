// Point values for scoring. Tunable in one place — the weight order
// (score > scorers > timing) must always hold.

export const SCORING = {
  /** Exact scoreline correct. */
  exactScore: 10,
  /** Correct result (right winner or draw) but wrong scoreline. */
  correctResult: 4,
  /** Per correctly predicted goalscorer (multiset match). */
  perScorer: 3,
  /** Per correct scorer whose 15-min bucket also matches. */
  perTiming: 1,
  /** Correctly calling how the tie is settled (FT/ET, or penalties + who advances). */
  decidedBonus: 2,
  /** Penalty when the Double-or-Nothing card is played and all three categories miss. */
  cardPenalty: -5,
} as const;
