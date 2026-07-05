-- "How it's settled" bonus: predict FT/ET (decisive) or Penalties + who advances (draw).
create type decided_stage as enum ('FT', 'ET', 'PENS');

alter table predictions
  add column decided_stage decided_stage,   -- 'FT'|'ET' for a decisive pick, 'PENS' for a draw
  add column advancer team_side;            -- for a draw pick: who wins the shootout

alter table matches
  add column decided_stage decided_stage,   -- actual, derived from the feed (ft/et/penalties)
  add column pen_winner team_side;          -- actual shootout winner, when decided on penalties
