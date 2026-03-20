import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseServer"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const day = url.searchParams.get("date") // YYYY-MM-DD
  const playerId = url.searchParams.get("playerId")

  if (!day || !playerId) {
    return NextResponse.json({ error: "Missing date or playerId" }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { count } = await supabase
    .from("player_daily_attempts")
    .select("id", { count: "exact", head: true })
    .eq("day", day)
    .eq("player_id", playerId)

  // Best diff for the day (needed for the “Game finished” stats modal).
  const { data: bestRows } = await supabase
    .from("player_daily_attempts")
    .select("diff")
    .eq("day", day)
    .eq("player_id", playerId)

  const bestDiff =
    bestRows && bestRows.length > 0 ? Math.min(...bestRows.map(r => r.diff)) : null

  return NextResponse.json({
    attemptsUsed: count ?? 0,
    maxAttempts: 3,
    bestDiff
  })
}

