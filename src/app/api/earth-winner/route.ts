import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { getSupabaseAdmin } from "@/lib/supabaseServer"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const day = url.searchParams.get("date") // expect YYYY-MM-DD
  const playerId = url.searchParams.get("playerId")

  if (!day || !playerId) {
    return NextResponse.json({ error: "Missing date or playerId" }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Ensure the player exists in player_profiles so we have a candidate list.
  await supabase
    .from("player_profiles")
    .upsert({ player_id: playerId }, { onConflict: "player_id" })

  // If a winner already exists for the day, just return it.
  const { data: existing } = await supabase
    .from("earth_winners")
    .select("winner_player_id")
    .eq("day", day)
    .maybeSingle()

  if (existing?.winner_player_id) {
    return NextResponse.json({
      isWinner: existing.winner_player_id === playerId
    })
  }

  // Deterministic “random”: pick the player with the smallest sha256(day||player_id).
  const { data: players } = await supabase.from("player_profiles").select("player_id")

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

  await supabase
    .from("earth_winners")
    .upsert({ day, winner_player_id: winnerPlayerId }, { onConflict: "day" })

  return NextResponse.json({
    isWinner: winnerPlayerId === playerId
  })
}

