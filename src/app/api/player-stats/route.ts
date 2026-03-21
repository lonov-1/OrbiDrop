import { cookies } from "next/headers"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"
import {
  ORBIFALL_PLAYER_COOKIE,
  getOrMintOrbifallPlayerId,
  jsonWithOrbifallCookie
} from "@/lib/orbifallPlayerCookie"

export const dynamic = "force-dynamic"

const MAX_DAILY_ATTEMPTS = 3

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const { playerId, isNew } = getOrMintOrbifallPlayerId(cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value)

  const j = (body: unknown, init?: ResponseInit) => jsonWithOrbifallCookie(body, init, playerId, isNew)

  try {
    const admin = tryGetSupabaseAdmin()
    if (!admin.ok) {
      return j({ error: admin.message }, { status: 503 })
    }
    const supabase = admin.supabase

    const url = new URL(req.url)
    const day = url.searchParams.get("date")?.trim()

    let attemptsUsedToday: number | undefined
    if (day) {
      const { count, error: countErr } = await supabase
        .from("player_daily_attempts")
        .select("id", { count: "exact", head: true })
        .eq("day", day)
        .eq("player_id", playerId)

      if (!countErr) {
        attemptsUsedToday = Math.min(MAX_DAILY_ATTEMPTS, count ?? 0)
      }
    }

    const { data, error } = await supabase
      .from("player_stats")
      .select("played,best,total_diff,streak,max_streak,last_played,earth_collected")
      .eq("player_id", playerId)
      .maybeSingle()

    if (error) {
      return j({ error: error.message, code: error.code, details: error.details }, { status: 500 })
    }

    if (!data) {
      return j({
        stats: {
          played: 0,
          best: null,
          totalDiff: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayed: "",
          earthCollected: 0
        },
        ...(attemptsUsedToday !== undefined && { attemptsUsedToday })
      })
    }

    return j({
      stats: {
        played: data.played ?? 0,
        best: data.best ?? null,
        totalDiff: data.total_diff ?? 0,
        streak: data.streak ?? 0,
        maxStreak: data.max_streak ?? 0,
        lastPlayed: data.last_played ? String(data.last_played) : "",
        earthCollected: data.earth_collected ?? 0
      },
      ...(attemptsUsedToday !== undefined && { attemptsUsedToday })
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return jsonWithOrbifallCookie({ error: message }, { status: 500 }, playerId, isNew)
  }
}
