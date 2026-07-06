// Point values for scoring. Tunable in one place.
// Scorer and timing are scored independently (both 3). Timing is earned for the
// correct team + 15-min window even if the exact scorer is wrong; getting the
// scorer right too adds its own 3, so a correct scorer+window is worth 6.

export const SCORING = {
  /** Exact scoreline correct. */
  exactScore: 10,
  /** Correct result (right winner or draw) but wrong scoreline. */
  correctResult: 4,
  /** Per correctly predicted goalscorer (multiset match). */
  perScorer: 3,
  /** Per correct goal timing — right team in the right 15-min window (scorer need not match). */
  perTiming: 3,
  /** Correctly calling how the tie is settled (FT/ET, or penalties + who advances). */
  decidedBonus: 1,
  /** Penalty when the Double-or-Nothing card is played and all three categories miss. */
  cardPenalty: -5,
} as const;
