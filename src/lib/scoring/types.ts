// Domain types for El Shabab League scoring.
// These are shared by the scoring engine, the UI, and the ingestion layer.

/**
 * The 15-minute windows a goal can fall into. Six across regulation (stoppage folds into its
 * half) plus two for extra time (each ET half is 15 min; ET stoppage folds down).
 */
export type Bucket = '1-15' | '16-30' | '31-45' | '46-60' | '61-75' | '76-90+' | '91-105' | '106-120';

export const BUCKETS: Bucket[] = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90+', '91-105', '106-120'];

export type Side = 'home' | 'away';

/** How a knockout tie was decided. */
export type DecidedStage = 'FT' | 'ET' | 'PENS';

/** One goal a player predicts, tied to a team side and a 15-min window. */
export interface ScorerPick {
  playerId: string;
  team: Side;
  bucket: Bucket;
}

/** A player's full prediction for one match. */
export interface Prediction {
  homeScore: number;
  awayScore: number;
  /** One entry per predicted goal. The same playerId may appear multiple times (brace). */
  scorers: ScorerPick[];
  /** Whether the one-time Double-or-Nothing card is played on this match. */
  cardPlayed: boolean;
  /**
   * How the player thinks the tie is settled. For a decisive scoreline this is 'FT' or 'ET';
   * for a predicted draw it is 'PENS' (a knockout can't stay level) with `advancer` set.
   */
  decidedStage?: DecidedStage | null;
  /** For a draw prediction (PENS): which side the player thinks wins the shootout. */
  advancer?: Side | null;
}

/** One goal that actually happened, as delivered by the football API (regulation only). */
export interface ActualGoal {
  playerId: string;
  team: Side;
  /** Elapsed minute (stoppage folds down, e.g. 45+2 -> 45, 90+4 -> 90). */
  minute: number;
}

/** The real regulation result of a match (extra time / penalties excluded). */
export interface ActualResult {
  homeScore: number;
  awayScore: number;
  goals: ActualGoal[];
  /** How the tie was actually settled (from the feed's ft/et/penalty fields). */
  decidedStage?: DecidedStage;
  /** Which side won the shootout, when decided on penalties. */
  penWinner?: Side | null;
  /**
   * Which side advances when regulation was level (won in extra time, or the shootout winner).
   * Regulation-decisive results don't need this — the winner is read off the scoreline.
   */
  advancer?: Side | null;
}

export type CardOutcome = 'double' | 'neutral' | 'penalty';

/** Full, human-readable breakdown of how a prediction scored. */
export interface ScoreBreakdown {
  /** Final points awarded for the match (after any card effect). */
  points: number;
  /** Points before the card is applied. */
  base: number;
  scorePoints: number;
  scorersPoints: number;
  timingPoints: number;
  /** +1 for correctly calling how the tie is settled (FT/ET, or penalties + who advances). */
  decidedBonus: number;
  exactScore: boolean;
  correctResult: boolean;
  correctScorers: number;
  correctTimings: number;
  card: {
    played: boolean;
    /** Number of the three categories (score / scorers / timing) that earned points. */
    hits: number;
    outcome: CardOutcome | null;
  };
}
