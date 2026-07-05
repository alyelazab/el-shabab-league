-- Extra-time timing windows + squad position (for picker sort order).
--
-- Two new goal-timing buckets covering extra time (each ET half is 15 min; ET
-- stoppage folds down into its window). Regulation windows are unchanged.
alter type goal_bucket add value if not exists '91-105';
alter type goal_bucket add value if not exists '106-120';

-- Player position (GK/DF/MF/FW), used to sort the scorer picker so likely
-- scorers surface first. Nullable; reference data only.
alter table squad_players add column if not exists position text;
