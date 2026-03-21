import { NextResponse } from "next/server"
import { tryGetSupabaseAdmin } from "@/lib/supabaseServer"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const playerId = url.searchParams.get("playerId")

    if (!playerId) {
      return NextResponse.json({ error: "Missing playerId" }, { status: 400 })
    }

    const admin = tryGetSupabaseAdmin()
    if (!admin.ok) {
      return NextResponse.json({ error: admin.message }, { status: 503 })
    }
    const supabase = admin.supabase

    const { data, error } = await supabase
      .from("player_stats")
      .select("played,best,total_diff,streak,max_streak,last_played,earth_collected")
      .eq("player_id", playerId)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json({
        stats: {
          played: 0,
          best: null,
          totalDiff: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayed: "",
          earthCollected: 0
        }
      })
    }

    return NextResponse.json({
      stats: {
        played: data.played ?? 0,
        best: data.best ?? null,
        totalDiff: data.total_diff ?? 0,
        streak: data.streak ?? 0,
        maxStreak: data.max_streak ?? 0,
        lastPlayed: data.last_played ? String(data.last_played) : "",
        earthCollected: data.earth_collected ?? 0
      }
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
