-- Who advances — the knockout "result" that scoring rewards.
-- Previously the winner was read only from the regulation scoreline, so a tie settled in extra time
-- or on penalties (regulation = a draw) scored nobody the result points, even when they picked the
-- team that went through. This column records the advancing side for every finished tie, so the
-- scorer can award the result to a correct winner regardless of how the tie was settled.

alter table matches
  add column advancer team_side;   -- actual side that advances (higher score, ET winner, or shootout winner)

-- Backfill the rows we can derive from stored data:
--   FT / regulation-decisive → the higher regulation score
--   PENS                     → the recorded shootout winner
-- Extra-time wins (regulation level, no pen_winner) can't be derived here — the ET winner isn't
-- stored. score-match's backfillAdvancers() fills those from the feed on the next rescore-all.
update matches
  set advancer = case
    when home_score_reg > away_score_reg then 'home'::team_side
    when away_score_reg > home_score_reg then 'away'::team_side
    when pen_winner is not null then pen_winner
    else null
  end
where home_score_reg is not null;
