import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseServer"

type Body = {
  date: string // YYYY-MM-DD
  playerId: string
  ballCount: number
  target: number
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Body>
  const day = body.date
  const playerId = body.playerId
  const ballCount = body.ballCount
  const target = body.target

  if (!day || !playerId || typeof ballCount !== "number" || typeof target !== "number") {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Ensure player exists.
  await supabase
    .from("player_profiles")
    .upsert({ player_id: playerId }, { onConflict: "player_id" })

  // How many attempts already submitted today?
  const { count: attemptsCount } = await supabase
    .from("player_daily_attempts")
    .select("id", { count: "exact", head: true })
    .eq("day", day)
    .eq("player_id", playerId)

  const attemptsUsed = attemptsCount ?? 0
  const maxAttempts = 3

  if (attemptsUsed >= maxAttempts) {
    return NextResponse.json(
      {
        ok: false,
        reason: "limit_reached",
        attemptsUsed
      },
      { status: 403 }
    )
  }

  const diff = Math.abs(ballCount - target)
  const attemptIndex = attemptsUsed + 1

  const { error: insertErr } = await supabase.from("player_daily_attempts").insert({
    player_id: playerId,
    day,
    attempt_index: attemptIndex,
    ball_count: ballCount,
    diff
  })

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: insertErr.message ?? "Insert failed" },
      { status: 500 }
    )
  }

  const attemptsUsedNext = attemptsUsed + 1
  const isDayComplete = attemptsUsedNext >= maxAttempts

  let bestDiff: number | null = null
  if (isDayComplete) {
    // Best diff among the 3 attempts for this player/day.
    const { data: bestRow } = await supabase
      .from("player_daily_attempts")
      .select("diff")
      .eq("day", day)
      .eq("player_id", playerId)

    if (bestRow && bestRow.length > 0) {
      bestDiff = Math.min(...bestRow.map(r => r.diff))
    }

    const { data: existingStats } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .maybeSingle()

    const prev = existingStats
    const prevPlayed = prev?.played ?? 0
    const prevBest = prev?.best ?? null
    const prevTotalDiff = prev?.total_diff ?? 0
    const prevStreak = prev?.streak ?? 0
    const prevMaxStreak = prev?.max_streak ?? 0
    const prevEarthCollected = prev?.earth_collected ?? 0

    const nextBest = bestDiff === null ? prevBest : prevBest === null ? bestDiff : Math.min(prevBest, bestDiff)
    const nextStreak = prevStreak + 1
    const nextMaxStreak = Math.max(prevMaxStreak, nextStreak)

    await supabase.from("player_stats").upsert(
      {
        player_id: playerId,
        played: prevPlayed + 1,
        best: nextBest,
        total_diff: prevTotalDiff + (bestDiff ?? 0),
        streak: nextStreak,
        max_streak: nextMaxStreak,
        last_played: day,
        earth_collected: prevEarthCollected,
        updated_at: new Date().toISOString()
      },
      { onConflict: "player_id" }
    )
  }

  return NextResponse.json({
    ok: true,
    attemptsUsed: attemptsUsedNext,
    maxAttempts,
    diff,
    isDayComplete,
    bestDiff
  })
}

