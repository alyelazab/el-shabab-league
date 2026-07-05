import { describe, it, expect } from 'vitest';
import { scorePrediction, bucketForMinute } from './engine';
import type { Prediction, ActualResult } from './types';

// Helpers to build predictions/results tersely.
const pred = (p: Partial<Prediction> = {}): Prediction => ({
  homeScore: 0,
  awayScore: 0,
  scorers: [],
  cardPlayed: false,
  ...p,
});

const result = (r: Partial<ActualResult> = {}): ActualResult => ({
  homeScore: 0,
  awayScore: 0,
  goals: [],
  ...r,
});

describe('bucketForMinute', () => {
  it('maps minutes to the six 15-min windows', () => {
    expect(bucketForMinute(1)).toBe('1-15');
    expect(bucketForMinute(15)).toBe('1-15');
    expect(bucketForMinute(16)).toBe('16-30');
    expect(bucketForMinute(45)).toBe('31-45');
    expect(bucketForMinute(46)).toBe('46-60');
    expect(bucketForMinute(75)).toBe('61-75');
    expect(bucketForMinute(76)).toBe('76-90+');
    expect(bucketForMinute(90)).toBe('76-90+');
  });
});

describe('match score', () => {
  it('awards 10 for an exact scoreline', () => {
    const b = scorePrediction(pred({ homeScore: 2, awayScore: 1 }), result({ homeScore: 2, awayScore: 1 }));
    expect(b.scorePoints).toBe(10);
    expect(b.exactScore).toBe(true);
    expect(b.correctResult).toBe(true);
  });

  it('awards 4 for the correct result but wrong scoreline', () => {
    const b = scorePrediction(pred({ homeScore: 2, awayScore: 1 }), result({ homeScore: 3, awayScore: 0 }));
    expect(b.scorePoints).toBe(4);
    expect(b.exactScore).toBe(false);
    expect(b.correctResult).toBe(true);
  });

  it('awards 4 for correctly predicting a draw with the wrong scoreline', () => {
    const b = scorePrediction(pred({ homeScore: 1, awayScore: 1 }), result({ homeScore: 2, awayScore: 2 }));
    expect(b.scorePoints).toBe(4);
  });

  it('awards 0 for the wrong result', () => {
    const b = scorePrediction(pred({ homeScore: 2, awayScore: 1 }), result({ homeScore: 0, awayScore: 1 }));
    expect(b.scorePoints).toBe(0);
    expect(b.correctResult).toBe(false);
  });
});

describe('goalscorers (multiset match)', () => {
  it('awards 3 per correctly predicted scorer', () => {
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 0,
        scorers: [
          { playerId: 'salah', team: 'home', bucket: '1-15' },
          { playerId: 'mane', team: 'home', bucket: '61-75' },
        ],
      }),
      result({
        homeScore: 2,
        awayScore: 0,
        goals: [
          { playerId: 'salah', team: 'home', minute: 5 },
          { playerId: 'mane', team: 'home', minute: 80 },
        ],
      }),
    );
    expect(b.correctScorers).toBe(2);
    expect(b.scorersPoints).toBe(6);
  });

  it('handles the same player scoring twice (a brace)', () => {
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 0,
        scorers: [
          { playerId: 'salah', team: 'home', bucket: '1-15' },
          { playerId: 'salah', team: 'home', bucket: '61-75' },
        ],
      }),
      result({
        homeScore: 2,
        awayScore: 0,
        goals: [
          { playerId: 'salah', team: 'home', minute: 5 },
          { playerId: 'salah', team: 'home', minute: 70 },
        ],
      }),
    );
    expect(b.correctScorers).toBe(2);
    expect(b.scorersPoints).toBe(6);
  });

  it('caps credit when you over-predict a player who scored once', () => {
    // Predicted Salah twice, he only scored once -> only 1 correct scorer.
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 0,
        scorers: [
          { playerId: 'salah', team: 'home', bucket: '1-15' },
          { playerId: 'salah', team: 'home', bucket: '61-75' },
        ],
      }),
      result({ homeScore: 1, awayScore: 0, goals: [{ playerId: 'salah', team: 'home', minute: 5 }] }),
    );
    expect(b.correctScorers).toBe(1);
  });

  it('gives no scorer credit for a player who did not score', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 0, scorers: [{ playerId: 'firmino', team: 'home', bucket: '1-15' }] }),
      result({ homeScore: 1, awayScore: 0, goals: [{ playerId: 'salah', team: 'home', minute: 5 }] }),
    );
    expect(b.correctScorers).toBe(0);
    expect(b.scorersPoints).toBe(0);
  });
});

describe('goal timing', () => {
  it('adds 1 per correct scorer whose bucket also matches', () => {
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 0,
        scorers: [
          { playerId: 'salah', team: 'home', bucket: '1-15' }, // right bucket
          { playerId: 'mane', team: 'home', bucket: '1-15' }, // wrong bucket
        ],
      }),
      result({
        homeScore: 2,
        awayScore: 0,
        goals: [
          { playerId: 'salah', team: 'home', minute: 5 }, // 1-15
          { playerId: 'mane', team: 'home', minute: 80 }, // 76-90+
        ],
      }),
    );
    expect(b.correctScorers).toBe(2);
    expect(b.correctTimings).toBe(1);
    expect(b.timingPoints).toBe(1);
  });

  it('never awards timing beyond correct scorers', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 0, scorers: [{ playerId: 'salah', team: 'home', bucket: '61-75' }] }),
      result({ homeScore: 1, awayScore: 0, goals: [{ playerId: 'salah', team: 'home', minute: 5 }] }),
    );
    expect(b.correctScorers).toBe(1);
    expect(b.correctTimings).toBe(0);
  });
});

describe('total base points', () => {
  it('sums score + scorers + timing', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 0, scorers: [{ playerId: 'salah', team: 'home', bucket: '1-15' }] }),
      result({ homeScore: 1, awayScore: 0, goals: [{ playerId: 'salah', team: 'home', minute: 5 }] }),
    );
    // 10 exact + 3 scorer + 1 timing
    expect(b.base).toBe(14);
    expect(b.points).toBe(14);
  });
});

describe('Double or Nothing card (friendly rule)', () => {
  const perfectPred = pred({
    homeScore: 1,
    awayScore: 0,
    scorers: [{ playerId: 'salah', team: 'home', bucket: '1-15' }],
    cardPlayed: true,
  });
  const perfectResult = result({
    homeScore: 1,
    awayScore: 0,
    goals: [{ playerId: 'salah', team: 'home', minute: 5 }],
  });

  it('doubles points when all three categories hit', () => {
    const b = scorePrediction(perfectPred, perfectResult);
    expect(b.card.hits).toBe(3);
    expect(b.card.outcome).toBe('double');
    expect(b.base).toBe(14);
    expect(b.points).toBe(28);
  });

  it('gives normal points (no penalty) when one or two categories hit', () => {
    // Correct result (score hits) but wrong scorer (scorers + timing miss) -> 1 hit.
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 1,
        scorers: [{ playerId: 'ghost', team: 'home', bucket: '1-15' }],
        cardPlayed: true,
      }),
      result({ homeScore: 3, awayScore: 0, goals: [{ playerId: 'salah', team: 'home', minute: 5 }] }),
    );
    expect(b.card.hits).toBe(1);
    expect(b.card.outcome).toBe('neutral');
    expect(b.points).toBe(b.base);
    expect(b.points).toBe(4);
  });

  it('deducts 5 points when all three categories miss', () => {
    const b = scorePrediction(
      pred({
        homeScore: 2,
        awayScore: 0,
        scorers: [{ playerId: 'ghost', team: 'home', bucket: '1-15' }],
        cardPlayed: true,
      }),
      result({ homeScore: 0, awayScore: 1, goals: [{ playerId: 'kane', team: 'away', minute: 5 }] }),
    );
    expect(b.card.hits).toBe(0);
    expect(b.card.outcome).toBe('penalty');
    expect(b.base).toBe(0);
    expect(b.points).toBe(-5);
  });

  it('does not apply card effects when the card is not played', () => {
    const b = scorePrediction(
      pred({ homeScore: 5, awayScore: 5, scorers: [], cardPlayed: false }),
      result({ homeScore: 0, awayScore: 1, goals: [] }),
    );
    expect(b.card.played).toBe(false);
    expect(b.card.outcome).toBe(null);
    expect(b.points).toBe(0); // no penalty without the card
  });
});

describe('decided-stage bonus (+2)', () => {
  it('awards +2 when a decisive pick correctly calls Full Time', () => {
    const b = scorePrediction(
      pred({ homeScore: 2, awayScore: 1, decidedStage: 'FT' }),
      result({ homeScore: 2, awayScore: 1, decidedStage: 'FT' }),
    );
    expect(b.decidedBonus).toBe(2);
    expect(b.points).toBe(12); // exact score 10 + decided 2
  });

  it('awards +2 when a decisive pick correctly calls Extra Time', () => {
    const b = scorePrediction(
      pred({ homeScore: 2, awayScore: 1, decidedStage: 'ET' }),
      result({ homeScore: 2, awayScore: 1, decidedStage: 'ET' }),
    );
    expect(b.decidedBonus).toBe(2);
  });

  it('gives no bonus when the settle stage is wrong', () => {
    const b = scorePrediction(
      pred({ homeScore: 2, awayScore: 1, decidedStage: 'FT' }),
      result({ homeScore: 2, awayScore: 1, decidedStage: 'ET' }),
    );
    expect(b.decidedBonus).toBe(0);
  });

  it('awards +2 for a draw pick that correctly calls the shootout winner', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 1, decidedStage: 'PENS', advancer: 'home' }),
      result({ homeScore: 1, awayScore: 1, decidedStage: 'PENS', penWinner: 'home' }),
    );
    expect(b.decidedBonus).toBe(2);
    expect(b.points).toBe(12); // exact draw 10 + decided 2
  });

  it('gives no bonus for a draw pick with the wrong shootout winner', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 1, decidedStage: 'PENS', advancer: 'home' }),
      result({ homeScore: 1, awayScore: 1, decidedStage: 'PENS', penWinner: 'away' }),
    );
    expect(b.decidedBonus).toBe(0);
  });

  it('gives no bonus for a draw→pens pick when the match was decided in extra time', () => {
    const b = scorePrediction(
      pred({ homeScore: 1, awayScore: 1, decidedStage: 'PENS', advancer: 'home' }),
      result({ homeScore: 1, awayScore: 1, decidedStage: 'ET', penWinner: null }),
    );
    expect(b.decidedBonus).toBe(0);
  });

  it('keeps the decided bonus even when the card penalty applies', () => {
    // Card played, all three categories miss (−5), but the settle call was right (+2).
    const b = scorePrediction(
      pred({ homeScore: 2, awayScore: 0, scorers: [], cardPlayed: true, decidedStage: 'FT' }),
      result({ homeScore: 0, awayScore: 1, decidedStage: 'FT', goals: [] }),
    );
    expect(b.card.outcome).toBe('penalty');
    expect(b.decidedBonus).toBe(2);
    expect(b.points).toBe(-3); // −5 penalty + 2 bonus
  });
});
