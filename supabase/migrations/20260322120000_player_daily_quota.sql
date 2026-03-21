-- Server-side daily attempt quota (atomic, race-safe). Run in Supabase SQL Editor if not using CLI migrations.
-- Enforces max 3 "reserved" attempts per player per calendar day; pairs with /api/daily-attempts (consume) + POST submit.

CREATE TABLE IF NOT EXISTS public.player_daily_quota (
  player_id text NOT NULL,
  day date NOT NULL,
  attempts_used integer NOT NULL DEFAULT 0,
  CONSTRAINT player_daily_quota_attempts_range CHECK (attempts_used >= 0 AND attempts_used <= 3),
  PRIMARY KEY (player_id, day)
);

-- Backfill from existing attempt rows so peek/consume stay in sync.
INSERT INTO public.player_daily_quota (player_id, day, attempts_used)
SELECT player_id, day::date, LEAST(COUNT(*)::integer, 3)
FROM public.player_daily_attempts
GROUP BY player_id, day
ON CONFLICT (player_id, day) DO UPDATE SET
  attempts_used = GREATEST(public.player_daily_quota.attempts_used, EXCLUDED.attempts_used);

CREATE OR REPLACE FUNCTION public.consume_daily_attempt(p_player_id text, p_day date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old integer;
  v_new integer;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RETURN json_build_object('error', 'invalid_player');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_player_id), hashtext(p_day::text));

  SELECT attempts_used INTO v_old
  FROM public.player_daily_quota
  WHERE player_id = p_player_id AND day = p_day;

  IF v_old IS NULL THEN
    INSERT INTO public.player_daily_quota (player_id, day, attempts_used)
    VALUES (p_player_id, p_day, 1);
    RETURN json_build_object('attemptsUsed', 1, 'limitReached', false);
  END IF;

  IF v_old >= 3 THEN
    RETURN json_build_object('attemptsUsed', 3, 'limitReached', true);
  END IF;

  v_new := v_old + 1;
  UPDATE public.player_daily_quota
  SET attempts_used = v_new
  WHERE player_id = p_player_id AND day = p_day;

  RETURN json_build_object('attemptsUsed', v_new, 'limitReached', false);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_daily_attempt(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_daily_attempt(text, date) TO service_role;

ALTER TABLE public.player_daily_quota ENABLE ROW LEVEL SECURITY;
