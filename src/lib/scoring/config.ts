// Point values for scoring. Tunable in one place.
// Timing equals scorer (both 3), but it's additive — a timing point is only
// earned when the scorer is also right, so a correct scorer+window is worth 6.

export const SCORING = {
  /** Exact scoreline correct. */
  exactScore: 10,
  /** Correct result (right winner or draw) but wrong scoreline. */
  correctResult: 4,
  /** Per correctly predicted goalscorer (multiset match). */
  perScorer: 3,
  /** Per correct scorer whose 15-min bucket also matches. */
  perTiming: 3,
  /** Correctly calling how the tie is settled (FT/ET, or penalties + who advances). */
  decidedBonus: 1,
  /** Penalty when the Double-or-Nothing card is played and all three categories miss. */
  cardPenalty: -5,
} as const;
