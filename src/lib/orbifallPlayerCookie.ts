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

/**
 * Always set the httpOnly player id cookie when we know it.
 * (Previously only on `isNew`, which broke sessions if the browser dropped the cookie
 * or the first Set-Cookie was missed — DROP and STOP then used different player_ids.)
 */
export function applyOrbifallPlayerCookie(
  res: NextResponse,
  playerId: string,
  _isNew?: boolean
): NextResponse {
  const id = playerId?.trim()
  if (id) {
    res.cookies.set(ORBIFALL_PLAYER_COOKIE, id, orbifallPlayerCookieOptions())
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
