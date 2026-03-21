import { NextResponse } from "next/server"
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
      return NextResponse.json(
        {
          error: admin.message,
          hint: "Set env on Vercel: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
        },
        { status: 503 }
      )
    }
    const supabase = admin.supabase

    const { count, error: countErr } = await supabase
      .from("player_daily_attempts")
      .select("id", { count: "exact", head: true })
      .eq("day", day)
      .eq("player_id", playerId)

    if (countErr) {
      return NextResponse.json(
        { error: countErr.message, code: countErr.code, details: countErr.details },
        { status: 500 }
      )
    }

    const { data: bestRows, error: bestErr } = await supabase
      .from("player_daily_attempts")
      .select("diff")
      .eq("day", day)
      .eq("player_id", playerId)

    if (bestErr) {
      return NextResponse.json(
        { error: bestErr.message, code: bestErr.code, details: bestErr.details },
        { status: 500 }
      )
    }

    const bestDiff =
      bestRows && bestRows.length > 0 ? Math.min(...bestRows.map(r => r.diff)) : null

    return NextResponse.json({
      attemptsUsed: count ?? 0,
      maxAttempts: 3,
      bestDiff
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
