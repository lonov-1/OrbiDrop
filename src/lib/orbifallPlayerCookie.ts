import { NextResponse } from "next/server"
import { randomUUID } from "crypto"

export const ORBIFALL_PLAYER_COOKIE = "orbifall_player_id"

export function orbifallPlayerCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/"
  }
}

/** Read existing id from request cookies, or mint a new UUID (caller must Set-Cookie if new). */
export function getOrMintOrbifallPlayerId(cookieValue: string | undefined): {
  playerId: string
  isNew: boolean
} {
  if (cookieValue && cookieValue.trim().length > 0) {
    return { playerId: cookieValue.trim(), isNew: false }
  }
  return { playerId: randomUUID(), isNew: true }
}

export function applyOrbifallPlayerCookie(
  res: NextResponse,
  playerId: string,
  isNew: boolean
): NextResponse {
  if (isNew) {
    res.cookies.set(ORBIFALL_PLAYER_COOKIE, playerId, orbifallPlayerCookieOptions())
  }
  return res
}

export function jsonWithOrbifallCookie(
  body: unknown,
  init: ResponseInit | undefined,
  playerId: string,
  isNew: boolean
) {
  return applyOrbifallPlayerCookie(NextResponse.json(body, init), playerId, isNew)
}
