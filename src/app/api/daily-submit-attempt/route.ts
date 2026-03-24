import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"
import {
  applyOrbifallPlayerCookie,
  getOrMintOrbifallPlayerId,
  ORBIFALL_PLAYER_COOKIE
} from "@/lib/orbifallPlayerCookie"

export const dynamic = "force-dynamic"

type Body = {
  date: string // YYYY-MM-DD
  ballCount: number
  target: number
}

const MAX_ATTEMPTS = 3

function jsonWithPlayerCookie(
  body: unknown,
  status: number,
  playerId: string,
  isNew: boolean
) {
  return applyOrbifallPlayerCookie(NextResponse.json(body, { status }), playerId, isNew)
}

export async function POST(req: Request) {
  let playerId = ""
  let isNew = false

  try {
    const cookieStore = await cookies()
    const minted = getOrMintOrbifallPlayerId(
      cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value
    )
    playerId = minted.playerId
    isNew = minted.isNew

    if (!playerId.trim()) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 })
    }

    const body = (await req.json()) as Partial<Body>
    const day = body.date
    const ballCount = body.ballCount
    const target = body.target

    if (!day || typeof ballCount !== "number" || typeof target !== "number") {
      return jsonWithPlayerCookie(
        { error: "Missing or invalid fields" },
        400,
        playerId,
        isNew
      )
    }

    const admin = tryGetSupabaseAdmin()
    if (!admin.ok) {
      return jsonWithPlayerCookie({ error: admin.message }, 503, playerId, isNew)
    }
    const supabase = admin.supabase

    const { error: profileErr } = await supabase
      .from("player_profiles")
      .upsert({ player_id: playerId }, { onConflict: "player_id" })

    if (profileErr) {
      return jsonWithPlayerCookie(
        { ok: false, error: profileErr.message, code: profileErr.code },
        500,
        playerId,
        isNew
      )
    }

    const { count: attemptsCount, error: countErr } = await supabase
      .from("player_daily_attempts")
      .select("id", { count: "exact", head: true })
      .eq("day", day)
      .eq("player_id", playerId)

    if (countErr) {
      return jsonWithPlayerCookie(
        { ok: false, error: countErr.message, code: countErr.code },
        500,
        playerId,
        isNew
      )
    }

    const rowsUsed = attemptsCount ?? 0

    if (rowsUsed >= MAX_ATTEMPTS) {
      return jsonWithPlayerCookie(
        {
          ok: false,
          reason: "limit_reached",
          attemptsUsed: rowsUsed
        },
        403,
        playerId,
        isNew
      )
    }

    const { data: quotaRow, error: quotaErr } = await supabase
      .from("player_daily_quota")
      .select("attempts_used")
      .eq("player_id", playerId)
      .eq("day", day)
      .maybeSingle()

    if (quotaErr) {
      return jsonWithPlayerCookie(
        { ok: false, error: quotaErr.message, code: quotaErr.code },
        500,
        playerId,
        isNew
      )
    }

    let quotaUsed = quotaRow?.attempts_used ?? 0

    /*
     * If DROP reserve failed (503 / offline) but the client still played, quota can stay 0
     * while rowsUsed is 0 → old check `quotaUsed <= rowsUsed` blocked every save.
     * Heal: ensure attempts_used >= rowsUsed + 1 so this STOP can record one completion.
     */
    if (quotaUsed <= rowsUsed && rowsUsed < MAX_ATTEMPTS) {
      const needed = rowsUsed + 1
      const nextQuota = Math.min(MAX_ATTEMPTS, Math.max(quotaUsed, needed))
      const { error: healErr } = await supabase.from("player_daily_quota").upsert(
        {
          player_id: playerId,
          day,
          attempts_used: nextQuota
        },
        { onConflict: "player_id,day" }
      )
      if (healErr) {
        return jsonWithPlayerCookie(
          { ok: false, error: healErr.message, code: healErr.code },
          500,
          playerId,
          isNew
        )
      }
      quotaUsed = nextQuota
    }

    if (quotaUsed <= rowsUsed) {
      return jsonWithPlayerCookie(
        {
          ok: false,
          reason: "reserved_attempt_required",
          attemptsUsed: rowsUsed,
          quotaUsed
        },
        403,
        playerId,
        isNew
      )
    }

    const attemptsUsed = rowsUsed
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
      return jsonWithPlayerCookie(
        { ok: false, error: insertErr.message ?? "Insert failed" },
        500,
        playerId,
        isNew
      )
    }

    const attemptsUsedNext = attemptsUsed + 1
    const isDayComplete = attemptsUsedNext >= MAX_ATTEMPTS

    let bestDiff: number | null = null
    if (isDayComplete) {
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

      const nextBest =
        bestDiff === null ? prevBest : prevBest === null ? bestDiff : Math.min(prevBest, bestDiff)
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

    return jsonWithPlayerCookie(
      {
        ok: true,
        attemptsUsed: attemptsUsedNext,
        maxAttempts: MAX_ATTEMPTS,
        diff,
        isDayComplete,
        bestDiff
      },
      200,
      playerId,
      isNew
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    if (playerId.trim()) {
      return jsonWithPlayerCookie({ ok: false, error: message }, 500, playerId, isNew)
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
