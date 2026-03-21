import { cookies } from "next/headers"
import { randomInt } from "crypto"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"
import {
  ORBIFALL_PLAYER_COOKIE,
  getOrMintOrbifallPlayerId,
  jsonWithOrbifallCookie
} from "@/lib/orbifallPlayerCookie"

export const dynamic = "force-dynamic"

function isUniqueViolation(err: { code?: string; message?: string }) {
  if (err.code === "23505") return true
  const m = (err.message ?? "").toLowerCase()
  return m.includes("duplicate") || m.includes("unique")
}

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const { playerId, isNew } = getOrMintOrbifallPlayerId(cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value)

  const j = (body: unknown, init?: ResponseInit) => jsonWithOrbifallCookie(body, init, playerId, isNew)

  try {
    const url = new URL(req.url)
    const day = url.searchParams.get("date")

    if (!day) {
      return j({ error: "Missing date" }, { status: 400 })
    }

    const admin = tryGetSupabaseAdmin()
    if (!admin.ok) {
      return j({ error: admin.message }, { status: 503 })
    }
    const supabase = admin.supabase

    const { error: profileErr } = await supabase
      .from("player_profiles")
      .upsert({ player_id: playerId }, { onConflict: "player_id" })

    if (profileErr) {
      return j({ error: profileErr.message, code: profileErr.code }, { status: 500 })
    }

    const { data: existing, error: existingErr } = await supabase
      .from("earth_winners")
      .select("winner_player_id")
      .eq("day", day)
      .maybeSingle()

    if (existingErr) {
      return j({ error: existingErr.message, code: existingErr.code }, { status: 500 })
    }

    if (existing?.winner_player_id) {
      return j({
        isWinner: existing.winner_player_id === playerId
      })
    }

    const { data: players, error: playersErr } = await supabase
      .from("player_profiles")
      .select("player_id")

    if (playersErr) {
      return j({ error: playersErr.message, code: playersErr.code }, { status: 500 })
    }

    const pool = (players ?? [])
      .map(p => p.player_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)

    const winnerPlayerId =
      pool.length === 0 ? playerId : pool[randomInt(0, pool.length)]!

    const { error: insertErr } = await supabase.from("earth_winners").insert({
      day,
      winner_player_id: winnerPlayerId
    })

    if (insertErr) {
      if (isUniqueViolation(insertErr)) {
        const { data: raced, error: raceErr } = await supabase
          .from("earth_winners")
          .select("winner_player_id")
          .eq("day", day)
          .maybeSingle()

        if (raceErr) {
          return j({ error: raceErr.message, code: raceErr.code }, { status: 500 })
        }
        if (raced?.winner_player_id) {
          return j({
            isWinner: raced.winner_player_id === playerId
          })
        }
      }

      return j({ error: insertErr.message, code: insertErr.code }, { status: 500 })
    }

    return j({
      isWinner: winnerPlayerId === playerId
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return jsonWithOrbifallCookie({ error: message }, { status: 500 }, playerId, isNew)
  }
}
