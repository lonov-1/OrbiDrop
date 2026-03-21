import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"

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

    let winnerPlayerId = playerId
    if (players && players.length > 0) {
      let bestHash: string | null = null
      for (const p of players) {
        if (!p.player_id) continue
        const h = createHash("sha256").update(`${day}::${p.player_id}`).digest("hex")
        if (bestHash === null || h < bestHash) {
          bestHash = h
          winnerPlayerId = p.player_id
        }
      }
    }

    const { error: upsertErr } = await supabase
      .from("earth_winners")
      .upsert({ day, winner_player_id: winnerPlayerId }, { onConflict: "day" })

    if (upsertErr) {
      return NextResponse.json(
        { error: upsertErr.message, code: upsertErr.code },
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
