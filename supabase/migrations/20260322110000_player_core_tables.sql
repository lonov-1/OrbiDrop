-- Core tables for daily play + stats. Must run before 20260322120000_player_daily_quota.sql
-- (that migration backfills from player_daily_attempts).

CREATE TABLE IF NOT EXISTS public.player_profiles (
  player_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_daily_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id text NOT NULL,
  day date NOT NULL,
  attempt_index integer NOT NULL,
  ball_count integer NOT NULL,
  diff integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_daily_attempts_attempt_index_range CHECK (
    attempt_index >= 1 AND attempt_index <= 3
  ),
  CONSTRAINT player_daily_attempts_unique_slot UNIQUE (player_id, day, attempt_index)
);

CREATE INDEX IF NOT EXISTS player_daily_attempts_player_day_idx
  ON public.player_daily_attempts (player_id, day);

CREATE TABLE IF NOT EXISTS public.player_stats (
  player_id text PRIMARY KEY,
  played integer NOT NULL DEFAULT 0,
  best integer,
  total_diff integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  max_streak integer NOT NULL DEFAULT 0,
  last_played date,
  earth_collected integer NOT NULL DEFAULT 0,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.earth_winners (
  day date PRIMARY KEY,
  winner_player_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_daily_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earth_winners ENABLE ROW LEVEL SECURITY;
