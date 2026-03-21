import { NextResponse } from "next/server"
import { randomInt } from "crypto"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"

function isUniqueViolation(err: { code?: string; message?: string }) {
  if (err.code === "23505") return true
  const m = (err.message ?? "").toLowerCase()
  return m.includes("duplicate") || m.includes("unique")
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const day = url.searchParams.get("date") // YYYY-MM-DD
    const playerId = url.searchParams.get("playerId")

    if (!day || !playerId) {
      return NextResponse.json({ error: "Missing date or playerId" }, { status: 400 })
    }

    const admin = tryGetSupabaseAdmin()
    if (!admin.ok) {
      return NextResponse.json({ error: admin.message }, { status: 503 })
    }
    const supabase = admin.supabase

    const { error: profileErr } = await supabase
      .from("player_profiles")
      .upsert({ player_id: playerId }, { onConflict: "player_id" })

    if (profileErr) {
      return NextResponse.json(
        { error: profileErr.message, code: profileErr.code },
        { status: 500 }
      )
    }

    const { data: existing, error: existingErr } = await supabase
      .from("earth_winners")
      .select("winner_player_id")
      .eq("day", day)
      .maybeSingle()

    if (existingErr) {
      return NextResponse.json(
        { error: existingErr.message, code: existingErr.code },
        { status: 500 }
      )
    }

    if (existing?.winner_player_id) {
      return NextResponse.json({
        isWinner: existing.winner_player_id === playerId
      })
    }

    const { data: players, error: playersErr } = await supabase
      .from("player_profiles")
      .select("player_id")

    if (playersErr) {
      return NextResponse.json(
        { error: playersErr.message, code: playersErr.code },
        { status: 500 }
      )
    }

    const pool = (players ?? [])
      .map(p => p.player_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)

    const winnerPlayerId =
      pool.length === 0 ? playerId : pool[randomInt(0, pool.length)]!

    // Insert only: first successful insert wins the day (avoids upsert overwriting a concurrent pick).
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
          return NextResponse.json(
            { error: raceErr.message, code: raceErr.code },
            { status: 500 }
          )
        }
        if (raced?.winner_player_id) {
          return NextResponse.json({
            isWinner: raced.winner_player_id === playerId
          })
        }
      }

      return NextResponse.json(
        { error: insertErr.message, code: insertErr.code },
        { status: 500 }
      )
    }

    return NextResponse.json({
      isWinner: winnerPlayerId === playerId
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
