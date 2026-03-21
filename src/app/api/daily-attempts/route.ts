import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import {
  ORBIFALL_PLAYER_COOKIE,
  applyOrbifallPlayerCookie,
  getOrMintOrbifallPlayerId
} from "@/lib/orbifallPlayerCookie"

export const dynamic = "force-dynamic"

/**
 * Aggregate counter: (player_id, day, attempts_used).
 * Deployed table name is `player_daily_quota` (same columns as spec).
 */
const DAILY_COUNTER_TABLE = "player_daily_quota"
const MAX_ATTEMPTS = 3
const CONCURRENCY_RETRIES = 12

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const day = url.searchParams.get("date")?.trim()
    if (!day) {
      return NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 400 })
    }

    const cookieStore = await cookies()
    const { playerId, isNew } = getOrMintOrbifallPlayerId(cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl?.trim() || !serviceKey?.trim()) {
      const res = NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 503 })
      return applyOrbifallPlayerCookie(res, playerId, isNew)
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    for (let attempt = 0; attempt < CONCURRENCY_RETRIES; attempt++) {
      const { data: row, error: selErr } = await supabase
        .from(DAILY_COUNTER_TABLE)
        .select("attempts_used")
        .eq("player_id", playerId)
        .eq("day", day)
        .maybeSingle()

      if (selErr) {
        const res = NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 500 })
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }

      const used = row?.attempts_used

      if (used != null && used >= MAX_ATTEMPTS) {
        const res = NextResponse.json({
          attemptsUsed: MAX_ATTEMPTS,
          limitReached: true
        })
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }

      if (used == null) {
        const { error: insErr } = await supabase.from(DAILY_COUNTER_TABLE).insert({
          player_id: playerId,
          day,
          attempts_used: 1
        })

        if (!insErr) {
          const res = NextResponse.json({
            attemptsUsed: 1,
            limitReached: false
          })
          return applyOrbifallPlayerCookie(res, playerId, isNew)
        }

        if (insErr.code === "23505") {
          continue
        }

        const res = NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 500 })
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }

      const current = used as number
      const next = current + 1

      const { data: updated, error: upErr } = await supabase
        .from(DAILY_COUNTER_TABLE)
        .update({ attempts_used: next })
        .eq("player_id", playerId)
        .eq("day", day)
        .eq("attempts_used", current)
        .select("attempts_used")
        .maybeSingle()

      if (upErr) {
        const res = NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 500 })
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }

      if (updated?.attempts_used === next) {
        const res = NextResponse.json({
          attemptsUsed: next,
          limitReached: false
        })
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }
    }

    const res = NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 500 })
    return applyOrbifallPlayerCookie(res, playerId, isNew)
  } catch {
    return NextResponse.json({ attemptsUsed: 0, limitReached: false }, { status: 500 })
  }
}
