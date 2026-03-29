import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient, SupabaseClient, type PostgrestError } from "@supabase/supabase-js"
import {
  ORBIFALL_PLAYER_COOKIE,
  applyOrbifallPlayerCookie,
  getOrMintOrbifallPlayerId
} from "@/lib/orbifallPlayerCookie"

export const dynamic = "force-dynamic"

/**
 * Aggregate counter: (player_id, day, attempts_used).
 * Table: `player_daily_quota`.
 */
const DAILY_COUNTER_TABLE = "player_daily_quota"
const DAILY_ATTEMPTS_TABLE = "player_daily_attempts"
const MAX_ATTEMPTS = 3
const CONCURRENCY_RETRIES = 12

async function countCompletedAttempts(
  supabase: SupabaseClient,
  playerId: string,
  day: string
): Promise<{ completed: number; error: PostgrestError | null }> {
  const { count, error } = await supabase
    .from(DAILY_ATTEMPTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .eq("day", day)

  if (error) {
    return { completed: 0, error }
  }
  return { completed: Math.min(MAX_ATTEMPTS, count ?? 0), error: null }
}

function makeSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl?.trim() || !serviceKey?.trim()) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

/**
 * GET ?date=YYYY-MM-DD&peek=true — read quota + completed rows; does not consume an attempt.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const day = url.searchParams.get("date")?.trim()
    const peek = url.searchParams.get("peek") === "true"

    if (!day) {
      return NextResponse.json(
        { attemptsUsed: 0, completedAttempts: 0, limitReached: false },
        { status: 400 }
      )
    }

    if (!peek) {
      return NextResponse.json(
        {
          error: "GET requires peek=true. Use POST /api/daily-attempts with { date } to reserve an attempt."
        },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    const { playerId, isNew } = getOrMintOrbifallPlayerId(cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value)

    const supabase = makeSupabase()
    if (!supabase) {
      const res = NextResponse.json(
        { attemptsUsed: 0, completedAttempts: 0, limitReached: false },
        { status: 503 }
      )
      return applyOrbifallPlayerCookie(res, playerId, isNew)
    }

    const { data: row, error: selErr } = await supabase
      .from(DAILY_COUNTER_TABLE)
      .select("attempts_used")
      .eq("player_id", playerId)
      .eq("day", day)
      .maybeSingle()

    if (selErr) {
      const res = NextResponse.json(
        {
          attemptsUsed: 0,
          completedAttempts: 0,
          limitReached: false,
          error: selErr.message,
          code: selErr.code
        },
        { status: 500 }
      )
      return applyOrbifallPlayerCookie(res, playerId, isNew)
    }

    const quota = row?.attempts_used ?? 0
    const { completed, error: countErr } = await countCompletedAttempts(supabase, playerId, day)

    if (countErr) {
      const res = NextResponse.json(
        {
          attemptsUsed: quota,
          completedAttempts: 0,
          limitReached: quota >= MAX_ATTEMPTS,
          error: countErr.message,
          code: countErr.code
        },
        { status: 500 }
      )
      return applyOrbifallPlayerCookie(res, playerId, isNew)
    }

    const limitReached = quota >= MAX_ATTEMPTS || completed >= MAX_ATTEMPTS

    const res = NextResponse.json({
      attemptsUsed: quota,
      completedAttempts: completed,
      limitReached
    })
    return applyOrbifallPlayerCookie(res, playerId, isNew)
  } catch {
    return NextResponse.json(
      { attemptsUsed: 0, completedAttempts: 0, limitReached: false },
      { status: 500 }
    )
  }
}

/**
 * POST { date } — atomically increment daily quota (reserve one DROP). Server source of truth.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { date?: string }
    const day = body.date?.trim()
    if (!day) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const { playerId, isNew } = getOrMintOrbifallPlayerId(cookieStore.get(ORBIFALL_PLAYER_COOKIE)?.value)

    const supabase = makeSupabase()
    if (!supabase) {
      const res = NextResponse.json(
        { attemptsUsed: 0, limitReached: false },
        { status: 503 }
      )
      return applyOrbifallPlayerCookie(res, playerId, isNew)
    }

    for (let attempt = 0; attempt < CONCURRENCY_RETRIES; attempt++) {
      const { data: row, error: selErr } = await supabase
        .from(DAILY_COUNTER_TABLE)
        .select("attempts_used")
        .eq("player_id", playerId)
        .eq("day", day)
        .maybeSingle()

      if (selErr) {
        const res = NextResponse.json(
          {
            attemptsUsed: 0,
            limitReached: false,
            error: selErr.message,
            code: selErr.code
          },
          { status: 500 }
        )
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

        const res = NextResponse.json(
          {
            attemptsUsed: 0,
            limitReached: false,
            error: insErr.message,
            code: insErr.code
          },
          { status: 500 }
        )
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
        const res = NextResponse.json(
          {
            attemptsUsed: 0,
            limitReached: false,
            error: upErr.message,
            code: upErr.code
          },
          { status: 500 }
        )
        return applyOrbifallPlayerCookie(res, playerId, isNew)
      }

      if (updated?.attempts_used === next) {
        // Successful reserve. Client treats limitReached as "POST did not reserve" (4th DROP).
        // The 3rd DROP also sets next === MAX_ATTEMPTS; it must still start the round.
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
