"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as Matter from "matter-js"
import {
  runCountUp,
  runImpactScale,
  runDiffReveal,
  STOP_RESULT_TIMING
} from "@/lib/stopResultAnimation"

type Stats = {
  played: number
  best: number | null
  totalDiff: number
  streak: number
  maxStreak: number
  lastPlayed: string
  earthCollected: number
}

const GAME = {
  width: 380,
  height: 520,
  /** First calendar day of “Orbidrop #1” (local date). Bump to reset the public day counter. */
  startDate: "2026-03-29",
  minTarget: 80,
  targetRange: 80,
  maxAttempts: 3
} as const

/**
 * Layered SFX: UI bus (start/stop/celebration); physics bus (collisions) — warm, tactile.
 * Peaks are pre-bus; buses scale to destination.
 */
const AUDIO = {
  UI_BUS: 1,
  /** Physics SFX; per-hit gain also scaled by ball mass/radius/impact */
  PHYSICS_BUS: 0.4,
  /** DROP — airy lift + soft body */
  START_PEAK: 0.052,
  START_MS: 0.11,
  /** STOP — warm sine layers; peaks are body loudness (very gentle) */
  STOP_PEAK_DEFAULT: 0.016,
  STOP_PEAK_NEAR: 0.021,
  STOP_PEAK_PERFECT: 0.028,
  STOP_MS_DEFAULT: 0.3,
  STOP_MS_NEAR: 0.34,
  STOP_MS_PERFECT: 0.4,
  /** Ball hit — ceiling; actual peak uses impact + body physics */
  BOUNCE_PEAK_MAX: 0.036,
  BOUNCE_MS: 0.055,
  /** Max collision SFX per rolling second */
  BOUNCE_MAX_PER_SEC: 5
} as const

/** Matter collision → audio: kind + closing speed along normal drive pitch and timbre. */
type BounceCollisionKind = "floor" | "wall" | "ball"

type BounceAudioParams = {
  impact01: number
  kind: BounceCollisionKind
  /** Closing speed along collision normal (Matter velocity units). */
  approach: number
  /** Primary collider radius (px); ball–ball uses geometric mean of both. */
  radius: number
  /** Matter body mass (or reduced mass for ball–ball). */
  mass: number
  /** Scalar speed: |v| of dynamic body, or relative speed for ball–ball. */
  speed: number
}

/** Matches `ground` body in Matter (floor collision top = playfieldHeight - this). */
const JAR_GROUND_HEIGHT = 20
const BALL_COLORS = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#e9c46a"] as const

const EARTH_TEXTURE_SIZE = 64
const EARTH_DIAMETER = 24
const EARTH_RADIUS = EARTH_DIAMETER / 2
const EARTH_TEXTURE_DATA_URI =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${EARTH_TEXTURE_SIZE}" height="${EARTH_TEXTURE_SIZE}" viewBox="0 0 ${EARTH_TEXTURE_SIZE} ${EARTH_TEXTURE_SIZE}">
      <defs>
        <radialGradient id="ocean" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#7dd3fc"/>
          <stop offset="55%" stop-color="#2563eb"/>
          <stop offset="100%" stop-color="#0b2a6b"/>
        </radialGradient>
        <radialGradient id="shine" cx="28%" cy="28%" r="45%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
          <stop offset="20%" stop-color="rgba(255,255,255,0.35)"/>
          <stop offset="45%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill="url(#ocean)"/>

      <!-- continents -->
      <path d="M39 22c5 2 8 6 6 10-2 4-8 6-13 4-5-2-7-6-5-10 2-4 7-6 12-4z" fill="#22c55e" opacity="0.95"/>
      <path d="M23 36c4-1 7 1 9 4 2 3 1 7-3 9-4 2-9 0-11-4-2-4 1-8 5-9z" fill="#16a34a" opacity="0.92"/>
      <path d="M26 18c3-2 6-1 8 1 2 2 1 5-2 7-3 2-7 1-9-2-2-3 0-5 3-6z" fill="#22c55e" opacity="0.85"/>

      <!-- highlight -->
      <circle cx="32" cy="32" r="30" fill="url(#shine)"/>

      <!-- subtle rim -->
      <circle cx="32" cy="32" r="30" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>
    </svg>`
  )

const EARTH_DROP_KEY_PREFIX = "orbifallEarthDrop:"
const BALL_TEXTURE_SIZE = 100

function makeBallTextureUri(baseColor: string, brightnessDelta: number) {
  // Bucket brightness a bit to keep caching effective.
  const bucket = Math.max(-24, Math.min(24, Math.round(brightnessDelta / 3) * 3))

  // Create a subtle "3D" look: radial gradient + soft highlight.
  const top = varyHexBrightness(baseColor, 18 + Math.round(bucket / 2))
  const mid = varyHexBrightness(baseColor, 5 + Math.round(bucket / 4))
  const bottom = varyHexBrightness(baseColor, -15 + Math.round(bucket / 2))
  const stroke = varyHexBrightness(baseColor, 22 + Math.round(bucket / 4))

  const rim = "rgba(255,255,255,0.22)"

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BALL_TEXTURE_SIZE}" height="${BALL_TEXTURE_SIZE}" viewBox="0 0 ${BALL_TEXTURE_SIZE} ${BALL_TEXTURE_SIZE}">
      <defs>
        <radialGradient id="g" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stop-color="${top}"/>
          <stop offset="55%" stop-color="${mid}"/>
          <stop offset="100%" stop-color="${bottom}"/>
        </radialGradient>
      </defs>
      <circle cx="${BALL_TEXTURE_SIZE / 2}" cy="${BALL_TEXTURE_SIZE / 2}" r="46" fill="url(#g)" stroke="${stroke}" stroke-width="5" opacity="0.98"/>
      <!-- subtle rim + highlight (light source from upper-right) -->
      <circle cx="${BALL_TEXTURE_SIZE / 2}" cy="${BALL_TEXTURE_SIZE / 2}" r="46" fill="none" stroke="${rim}" stroke-width="2" opacity="0.18"/>
      <ellipse cx="46" cy="34" rx="16" ry="11" fill="white" opacity="0.18"/>
      <ellipse cx="40" cy="42" rx="9" ry="6" fill="white" opacity="0.10"/>
    </svg>`

  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svg)
  )
}

function getStorageItem(key: string) {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function setStorageItem(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {}
}

const ORBIFALL_STATS_STORAGE_KEY = "orbifallStats"

function readStoredOrbifallStats(): Stats | null {
  const raw = getStorageItem(ORBIFALL_STATS_STORAGE_KEY)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<Stats>
    return {
      played: Math.max(0, Number(p.played) || 0),
      best: typeof p.best === "number" && Number.isFinite(p.best) ? p.best : null,
      totalDiff: Math.max(0, Number(p.totalDiff) || 0),
      streak: Math.max(0, Number(p.streak) || 0),
      maxStreak: Math.max(0, Number(p.maxStreak) || 0),
      lastPlayed: typeof p.lastPlayed === "string" ? p.lastPlayed : "",
      earthCollected: Math.max(0, Number(p.earthCollected) || 0)
    }
  } catch {
    return null
  }
}

/** After refresh: keep local backup when the server row is missing or stale. */
function mergeHydratedPlayerStats(server: Stats, local: Stats): Stats {
  const sp = server.played
  const lp = local.played
  if (lp > sp) {
    return {
      ...local,
      earthCollected: Math.max(local.earthCollected, server.earthCollected)
    }
  }
  if (sp > lp) {
    return {
      ...server,
      earthCollected: Math.max(server.earthCollected, local.earthCollected)
    }
  }
  return {
    played: sp,
    best:
      server.best === null
        ? local.best
        : local.best === null
          ? server.best
          : Math.min(server.best, local.best),
    totalDiff: Math.max(server.totalDiff, local.totalDiff),
    streak: Math.max(server.streak, local.streak),
    maxStreak: Math.max(server.maxStreak, local.maxStreak),
    lastPlayed:
      server.lastPlayed && local.lastPlayed
        ? server.lastPlayed >= local.lastPlayed
          ? server.lastPlayed
          : local.lastPlayed
        : server.lastPlayed || local.lastPlayed,
    earthCollected: Math.max(server.earthCollected, local.earthCollected)
  }
}

function getISODate(date = new Date()) {
  return date.toISOString().split("T")[0]
}

/** Local calendar YYYY-MM-DD — use for daily quota APIs (UTC ISO date was wrong for many timezones). */
function getLocalDateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function attemptFromPeekPayload(peekData: {
  completedAttempts?: unknown
  attemptsUsed?: unknown
  limitReached?: unknown
}): number {
  const completed = Math.min(
    GAME.maxAttempts,
    Number(peekData?.completedAttempts ?? 0)
  )
  const quota = Math.min(
    GAME.maxAttempts,
    Number(peekData?.attemptsUsed ?? 0)
  )
  const limitReached =
    peekData?.limitReached === true ||
    completed >= GAME.maxAttempts ||
    quota >= GAME.maxAttempts
  if (limitReached) return GAME.maxAttempts + 1
  /** Next round: at least one more than finished rows; quota reflects reserved DROPs (can be ahead if submit failed). */
  const slot = Math.max(completed + 1, quota)
  return Math.min(GAME.maxAttempts + 1, slot)
}

const OFFLINE_DAILY_KEY = "orbifall_offline_daily_v1:"

type OfflineDaily = { r: number; c: number }

/** When quota/peek APIs fail (500/503), still advance rounds in-session so localhost is playable. */
function readOfflineDaily(day: string): OfflineDaily {
  if (typeof window === "undefined") return { r: 0, c: 0 }
  try {
    const raw = sessionStorage.getItem(OFFLINE_DAILY_KEY + day)
    if (!raw) return { r: 0, c: 0 }
    const j = JSON.parse(raw) as Partial<OfflineDaily>
    return {
      r: Math.min(GAME.maxAttempts, Math.max(0, Number(j.r) || 0)),
      c: Math.min(GAME.maxAttempts, Math.max(0, Number(j.c) || 0))
    }
  } catch {
    return { r: 0, c: 0 }
  }
}

function writeOfflineDaily(day: string, st: OfflineDaily) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(
      OFFLINE_DAILY_KEY + day,
      JSON.stringify({
        r: Math.min(GAME.maxAttempts, Math.max(0, st.r)),
        c: Math.min(GAME.maxAttempts, Math.max(0, st.c))
      })
    )
  } catch {}
}

function clearOfflineDaily(day: string) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(OFFLINE_DAILY_KEY + day)
  } catch {}
}

/** r = DROPs reserved offline; c = rounds finished offline. */
function attemptFromOfflineState(st: OfflineDaily): number {
  const { r, c } = st
  if (c >= GAME.maxAttempts) return GAME.maxAttempts + 1
  const slot = c >= r ? Math.min(GAME.maxAttempts + 1, c + 1) : r
  return Math.min(GAME.maxAttempts + 1, Math.max(1, slot))
}

/** Survives tab close (unlike sessionStorage). Same device + calendar day = same quota snapshot. */
const ORBIFALL_DAILY_PROGRESS_KEY = "orbifall_daily_progress_v1:"

type DailyProgressStored = { c: number; r: number; exhausted: boolean }

function readDailyProgressStored(day: string): DailyProgressStored | null {
  const raw = getStorageItem(ORBIFALL_DAILY_PROGRESS_KEY + day)
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<DailyProgressStored>
    return {
      c: Math.min(GAME.maxAttempts, Math.max(0, Number(j.c) || 0)),
      r: Math.min(GAME.maxAttempts, Math.max(0, Number(j.r) || 0)),
      exhausted: j.exhausted === true
    }
  } catch {
    return null
  }
}

function writeDailyProgressStored(day: string, st: DailyProgressStored) {
  setStorageItem(
    ORBIFALL_DAILY_PROGRESS_KEY + day,
    JSON.stringify({
      c: Math.min(GAME.maxAttempts, Math.max(0, st.c)),
      r: Math.min(GAME.maxAttempts, Math.max(0, st.r)),
      exhausted: st.exhausted === true
    })
  )
}

const ORBIFALL_RULES_SEEN_KEY = "orbifallRulesSeen"

/** True if this browser has seen the rules, played before, or has saved daily/orb progress. */
function isReturningOrbifallUser(): boolean {
  if (typeof window === "undefined") return true
  try {
    if (localStorage.getItem(ORBIFALL_RULES_SEEN_KEY) === "true") return true

    const stats = readStoredOrbifallStats()
    if (stats) {
      if (stats.played > 0 || stats.totalDiff > 0) return true
      if (stats.lastPlayed && String(stats.lastPlayed).trim().length > 0) return true
    }

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith(ORBIFALL_DAILY_PROGRESS_KEY)) {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        try {
          const j = JSON.parse(raw) as Partial<DailyProgressStored>
          const c = Number(j.c) || 0
          const r = Number(j.r) || 0
          if (c > 0 || r > 0 || j.exhausted === true) return true
        } catch {
          continue
        }
      }
      if (k.startsWith(EARTH_DROP_KEY_PREFIX)) return true
    }

    if (typeof sessionStorage !== "undefined") {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (!k?.startsWith(OFFLINE_DAILY_KEY)) continue
        const raw = sessionStorage.getItem(k)
        if (!raw) continue
        try {
          const j = JSON.parse(raw) as Partial<OfflineDaily>
          const c = Number(j.c) || 0
          const r = Number(j.r) || 0
          if (c > 0 || r > 0) return true
        } catch {
          continue
        }
      }
    }
  } catch {
    return true
  }
  return false
}

type PeekLike = {
  completedAttempts?: unknown
  attemptsUsed?: unknown
  limitReached?: unknown
}

/** Union device-local snapshot with server peek (take max so we never grant extra plays). */
function mergeStoredDailyWithPeek(
  stored: DailyProgressStored | null,
  peek: PeekLike
): { completedAttempts: number; attemptsUsed: number; limitReached: boolean } {
  const pc = Math.min(GAME.maxAttempts, Math.max(0, Number(peek.completedAttempts ?? 0)))
  const pr = Math.min(GAME.maxAttempts, Math.max(0, Number(peek.attemptsUsed ?? 0)))
  const pLimit =
    peek.limitReached === true || pc >= GAME.maxAttempts || pr >= GAME.maxAttempts
  if (!stored) {
    return {
      completedAttempts: pc,
      attemptsUsed: pr,
      limitReached: pLimit
    }
  }
  const c = Math.max(stored.c, pc)
  const r = Math.max(stored.r, pr)
  const limitReached =
    stored.exhausted || pLimit || c >= GAME.maxAttempts || r >= GAME.maxAttempts
  return { completedAttempts: c, attemptsUsed: r, limitReached }
}

function persistMergedDailyProgress(
  day: string,
  merged: ReturnType<typeof mergeStoredDailyWithPeek>
) {
  writeDailyProgressStored(day, {
    c: merged.completedAttempts,
    r: merged.attemptsUsed,
    exhausted: merged.limitReached
  })
}

function getDiffDaysSinceStart(today = new Date()) {
  const [y, m, d] = GAME.startDate.split("-").map(Number)
  const startLocal = new Date(y, m - 1, d)
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round(
    (todayLocal.getTime() - startLocal.getTime()) / (1000 * 60 * 60 * 24)
  )
}

function getDailyTarget(today = new Date()) {
  const diffDays = getDiffDaysSinceStart(today)
  const seed = diffDays * 9301 + 49297
  const random = (seed % 233280) / 233280
  return Math.floor(random * GAME.targetRange) + GAME.minTarget
}

/** TARGET=120 → 1 (same spawn gaps as before); scales with DROP_SPEED / DROP_SPEED@120, clamped [0.5, 1.8]. */
function dropSpawnSpeedRelForTarget(target: number) {
  const DROP_SPEED = (target / 3.2) * (target / 120)
  const DROP_SPEED_REF_120 = (120 / 3.2) * (120 / 120)
  const ratio = DROP_SPEED_REF_120 > 0 ? DROP_SPEED / DROP_SPEED_REF_120 : 1
  return Math.min(1.8, Math.max(0.5, ratio))
}

/**
 * ORB_SCALE raw = 0.75 + (TARGET/120)*0.5, clamp [0.75, 1.3], then ÷ scale-at-120 so TARGET 120 matches current radii.
 */
function orbRadiusScaleForTarget(target: number) {
  const ORB_SCALE_RAW = 0.75 + (target / 120) * 0.5
  const ORB_SCALE_CLAMPED = Math.min(1.3, Math.max(0.75, ORB_SCALE_RAW))
  const ORB_AT_120 = 0.75 + (120 / 120) * 0.5
  return ORB_AT_120 > 0
    ? Math.min(1.3, Math.max(0.75, ORB_SCALE_CLAMPED / ORB_AT_120))
    : 1
}

function getDayNumber(today = new Date()) {
  return getDiffDaysSinceStart(today) + 1
}

function diffToEmoji(diff: number) {
  if (diff <= 2) return "🟢"
  if (diff <= 5) return "🟡"
  if (diff <= 10) return "🟠"
  return "🔴"
}

function diffToFeedback(diff: number) {
  if (diff === 0) return "Perfect! 🎯"
  if (diff <= 3) return "So close! 🔥"
  if (diff <= 10) return "So close!"
  if (diff <= 20) return "Nice try!"
  return "Not even close..."
}

/** Stat row Diff value: green ≤5, orange ≤20, red above (uses absolute diff). */
function diffStatDisplayColor(absDiff: number) {
  if (absDiff <= 5) return "#10b981"
  if (absDiff <= 20) return "#f97316"
  return "#ef4444"
}

function diffToColor(diff: number) {
  if (diff === 0) return "#10b981" /* emerald-500 */
  if (diff <= 3) return "#14b8a6" /* teal-500 */
  if (diff <= 6) return "#eab308" /* yellow-500 */
  if (diff <= 10) return "#f97316" /* orange-500 */
  return "#ef4444" /* red-500 */
}

function bestDiffToColor(diff: number) {
  if (diff <= 3) return "#10b981"
  if (diff <= 6) return "#14b8a6"
  if (diff <= 10) return "#0ea5e9"
  return "#ef4444"
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "")
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map(ch => ch + ch)
          .join("")
      : normalized

  if (full.length !== 6) return `rgba(0,0,0,${alpha})`

  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function varyHexBrightness(hex: string, delta: number) {
  const normalized = hex.replace("#", "")
  const full =
    normalized.length === 3
      ? normalized.split("").map(ch => ch + ch).join("")
      : normalized

  if (full.length !== 6) return hex

  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)

  const nextR = clampByte(r + delta)
  const nextG = clampByte(g + delta)
  const nextB = clampByte(b + delta)

  return `rgb(${nextR}, ${nextG}, ${nextB})`
}

export default function GameCanvas() {

  const sceneRef = useRef<HTMLDivElement>(null)
  const glassRef = useRef<HTMLDivElement>(null)
  const earthIconRef = useRef<HTMLSpanElement>(null)
  const shakeRef = useRef<HTMLDivElement | null>(null)
  const perfectBurstContainerRef = useRef<HTMLDivElement | null>(null)
  const rewardBurstContainerRef = useRef<HTMLDivElement | null>(null)

  const engineRef = useRef<Matter.Engine | null>(null)
  const runnerRef = useRef<Matter.Runner | null>(null)
  const ballsRef = useRef<Matter.Body[]>([])
  /** Decorative orbs before first DROP — not in `ballsRef`, do not affect score. */
  const idleDecorBallsRef = useRef<Matter.Body[]>([])
  const hasPressedDropRef = useRef(false)
  const jarShakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ballTextureCacheRef = useRef<Map<string, string>>(new Map())
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spawnBallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const earthSpawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countRafRef = useRef<number | null>(null)
  const earthDroppedRef = useRef(false)
  const earthWonThisRunRef = useRef(false)
  /** True until the first real ball of this DROP (spawnBall or spawnEarthBall) is created. */
  const firstDropOfAttemptRef = useRef(false)
  const prevGameOverRef = useRef(false)

  const [ballCount, setBallCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [gameFinished, setGameFinished] = useState(false)
  const [timeLeft, setTimeLeft] = useState("")
  const [scoreReveal, setScoreReveal] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [isCounting, setIsCounting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [countDisplay, setCountDisplay] = useState(0)
  const [showStats, setShowStats] = useState(false)
  const [statsDismissed, setStatsDismissed] = useState(false)
  // Auto-open stats once when the game finishes.
  // After the user closes stats, header stats still opens the modal; statsDismissed affects other flows.
  const [statsAutoOpened, setStatsAutoOpened] = useState(false)
  const [showEarthWin, setShowEarthWin] = useState(false)
  const [stopImpact, setStopImpact] = useState(false)
  const [dropImpact, setDropImpact] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [idleJarAtmosphere, setIdleJarAtmosphere] = useState(false)
  const [jarShakeActive, setJarShakeActive] = useState(false)
  const [statsPopUpReady, setStatsPopUpReady] = useState(false)
  const [rulesPopUpReady, setRulesPopUpReady] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  const [stopDiff, setStopDiff] = useState<number | null>(null)
  /** Diff number stays hidden until after count-up + impact + stagger (see STOP_RESULT_TIMING). */
  const [diffRevealVisible, setDiffRevealVisible] = useState(false)
  const [stopPulse, setStopPulse] = useState(false)
  const [perfectBurstId, setPerfectBurstId] = useState(0)
  const [rewardBurstId, setRewardBurstId] = useState(0)
  // Compact sizing for phones (keeps the layout balanced without scrolling).
  const isCompact = isSmallScreen

  // Daily quota + submits go through /api/* → Supabase (same on localhost and production).
  // If those routes error (500/503), play still works and sessionStorage keeps round progress for the day.

  const [soundEnabled, setSoundEnabled] = useState(() => {
    return getStorageItem("orbidropSoundEnabled") !== "false"
  })
  /** Mutable copy for audio callbacks (e.g. Matter collision) that sit behind stale closures. */
  const soundEnabledRef = useRef(soundEnabled)
  soundEnabledRef.current = soundEnabled

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof document === "undefined") return false
    return document.documentElement.dataset.theme === "dark"
  })

  const [actionButtonPressed, setActionButtonPressed] = useState(false)
  const [actionButtonHovered, setActionButtonHovered] = useState(false)

  const resultValueRef = useRef<HTMLDivElement | null>(null)
  const diffValueRef = useRef<HTMLDivElement | null>(null)
  /** Cancel count-up + pending stagger timeouts if DROP starts mid-sequence. */
  const stopResultSequenceCleanupRef = useRef<(() => void) | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const uiBusRef = useRef<GainNode | null>(null)
  const physicsBusRef = useRef<GainNode | null>(null)
  const stopClickUntilRef = useRef<number>(0)
  const bounceHitTimesRef = useRef<number[]>([])
  /** True while STOP settle animation runs; bounce SFX only for soft “last drops”. */
  const isStoppingRef = useRef(false)
  /** performance.now() when STOP began — skip harsh early collisions in slow-mo. */
  const stopBouncePhaseStartMsRef = useRef(0)
  /** Matter collision handler keeps a stable ref so throttling / volumes stay current. */
  const playBounceSoundRef = useRef<(p: BounceAudioParams) => void>(() => {})
  const lastHapticAtRef = useRef<number>(0)
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const actionButtonPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumeAttemptInFlightRef = useRef(false)
  /** Avoid double-applying end-of-day local stats when deps re-fire (e.g. Strict Mode). */
  const appliedEndOfDayStatsRef = useRef(false)

  const ensureAudioBuses = (ctx: AudioContext) => {
    if (uiBusRef.current && physicsBusRef.current) return
    const ui = ctx.createGain()
    const phys = ctx.createGain()
    ui.gain.value = AUDIO.UI_BUS
    phys.gain.value = AUDIO.PHYSICS_BUS
    ui.connect(ctx.destination)
    phys.connect(ctx.destination)
    uiBusRef.current = ui
    physicsBusRef.current = phys
  }

  const withAudioContext = (fn: (ctx: AudioContext) => void) => {
    if (typeof window === "undefined") return
    if (!soundEnabledRef.current) return
    const AnyWindow = window as any
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || AnyWindow.webkitAudioContext
      if (!Ctx) return
      audioCtxRef.current = new Ctx()
    }

    const ctx = audioCtxRef.current
    if (!ctx) return

    const run = () => {
      ensureAudioBuses(ctx)
      fn(ctx)
    }

    if (ctx.state === "suspended") {
      ctx.resume().then(run).catch(() => {})
      return
    }

    run()
  }

  useEffect(() => {
    try {
      localStorage.setItem("orbidropSoundEnabled", soundEnabled ? "true" : "false")
    } catch {}

    if (!audioCtxRef.current) return
    if (soundEnabled) audioCtxRef.current.resume().catch(() => {})
    else audioCtxRef.current.suspend().catch(() => {})
  }, [soundEnabled])

  useEffect(() => {
    const theme = darkMode ? "dark" : "light"
    document.documentElement.dataset.theme = theme
    try {
      setStorageItem("orbifallDarkMode", theme)
    } catch {}
  }, [darkMode])

  const theme = darkMode
    ? {
        text: "#e5e5e5",
        muted: "#9ca3af",
        muted2: "#6b7280",
        card: "#1f1f1f",
        cardLight: "#262626",
        cardLighter: "#2d2d2d",
        glass: "linear-gradient(to bottom,#2a2a2a 0%, #1f1f1f 55%, #161616 100%)",
        glassHighlight: "rgba(255,255,255,0.04)",
        border: "rgba(255,255,255,0.08)",
        modal: "#1a1a1a",
        modalText: "#e5e5e5",
        modalMuted: "#9ca3af",
        overlay: "rgba(0,0,0,0.75)",
        buttonMuted: "#374151",
        feedbackText: "#fff",
        divider: "rgba(255,255,255,0.06)"
      }
    : {
        text: "#171717",
        muted: "#666",
        muted2: "#777",
        card: "#f7f8fa",
        cardLight: "#f1f3f5",
        cardLighter: "#e9ecef",
        glass: "linear-gradient(to bottom,#ffffff 0%, #f7f9fc 50%, #f0f3f8 100%)",
        glassHighlight: "rgba(255,255,255,0.06)",
        border: "rgba(0,0,0,0.06)",
        modal: "#ffffff",
        modalText: "#171717",
        modalMuted: "#666",
        overlay: "rgba(0,0,0,0.55)",
        buttonMuted: "#e9ecef",
        feedbackText: "#000",
        divider: "rgba(0,0,0,0.06)"
      }

  /** START / DROP — layered lift (sine + detuned triangle) + soft “air”. */
  const playStartSound = () => {
    withAudioContext(ctx => {
      const ui = uiBusRef.current
      if (!ui) return
      const now = ctx.currentTime
      const pm = 0.97 + Math.random() * 0.06
      const f0 = 215 * pm
      const f1 = 380 * pm
      const dur = AUDIO.START_MS

      const mkOsc = (type: OscillatorType, f: number, fEnd: number, peak: number, rel: number) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(f, now)
        osc.frequency.exponentialRampToValueAtTime(Math.max(85, fEnd), now + dur * 0.45)
        g.gain.setValueAtTime(0.0001, now)
        g.gain.exponentialRampToValueAtTime(peak, now + 0.014)
        g.gain.exponentialRampToValueAtTime(peak * rel, now + dur * 0.55)
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
        osc.connect(g)
        g.connect(ui)
        osc.start(now)
        osc.stop(now + dur + 0.02)
      }

      mkOsc("sine", f0, f1 * 0.92, AUDIO.START_PEAK * 0.55, 0.35)
      mkOsc("triangle", f0 * 1.02, f1 * 1.08, AUDIO.START_PEAK * 0.42, 0.28)
    })
  }

  type StopTier = "perfect" | "near" | "default"

  /**
   * STOP — warm, non-harsh: all-sine “bloom” + soft major third; triangle removed.
   * Long linear attack, gentle pitch falloff — reads as satisfying confirmation, not a click.
   */
  const playStopClickSound = (tier: StopTier = "default") => {
    withAudioContext(ctx => {
      const ui = uiBusRef.current
      if (!ui) return
      const now = ctx.currentTime
      if (now < stopClickUntilRef.current) return

      const ms =
        tier === "perfect"
          ? AUDIO.STOP_MS_PERFECT
          : tier === "near"
            ? AUDIO.STOP_MS_NEAR
            : AUDIO.STOP_MS_DEFAULT
      const bodyPeak =
        tier === "perfect"
          ? AUDIO.STOP_PEAK_PERFECT
          : tier === "near"
            ? AUDIO.STOP_PEAK_NEAR
            : AUDIO.STOP_PEAK_DEFAULT

      stopClickUntilRef.current = now + ms + 0.06
      const pm = 0.992 + Math.random() * 0.016

      const f0 =
        (tier === "perfect" ? 142 : tier === "near" ? 128 : 112) * pm
      const fThird = f0 * 1.259921 // 2^(4/12) major third — pleasant, not edgy
      const fAir = f0 * 4 // two octaves — breathy tail (very quiet)

      const attack = tier === "perfect" ? 0.078 : tier === "near" ? 0.07 : 0.062
      const thirdMul = tier === "perfect" ? 0.44 : tier === "near" ? 0.36 : 0.28
      const airMul = tier === "perfect" ? 0.14 : tier === "near" ? 0.1 : 0.065
      const end = now + ms

      const oscBody = ctx.createOscillator()
      const gBody = ctx.createGain()
      oscBody.type = "sine"
      oscBody.frequency.setValueAtTime(f0 * 1.04, now)
      oscBody.frequency.exponentialRampToValueAtTime(Math.max(62, f0 * 0.68), end)

      gBody.gain.setValueAtTime(0.0001, now)
      gBody.gain.linearRampToValueAtTime(bodyPeak, now + attack)
      gBody.gain.exponentialRampToValueAtTime(Math.max(0.0001, bodyPeak * 0.38), now + ms * 0.38)
      gBody.gain.exponentialRampToValueAtTime(0.0001, end)

      const oscThird = ctx.createOscillator()
      const gThird = ctx.createGain()
      oscThird.type = "sine"
      const tThird = now + 0.018
      oscThird.frequency.setValueAtTime(fThird, tThird)
      oscThird.frequency.exponentialRampToValueAtTime(Math.max(95, fThird * 0.82), end)

      gThird.gain.setValueAtTime(0.0001, tThird)
      gThird.gain.linearRampToValueAtTime(bodyPeak * thirdMul, tThird + 0.058)
      gThird.gain.exponentialRampToValueAtTime(0.0001, tThird + ms * 0.78)

      const oscAir = ctx.createOscillator()
      const gAir = ctx.createGain()
      oscAir.type = "sine"
      const tAir = now + 0.028
      oscAir.frequency.setValueAtTime(fAir, tAir)
      oscAir.frequency.exponentialRampToValueAtTime(fAir * 0.72, now + Math.min(0.2, ms * 0.45))

      gAir.gain.setValueAtTime(0.0001, tAir)
      gAir.gain.linearRampToValueAtTime(bodyPeak * airMul, tAir + 0.05)
      gAir.gain.exponentialRampToValueAtTime(0.0001, tAir + 0.24)

      oscBody.connect(gBody)
      gBody.connect(ui)
      oscThird.connect(gThird)
      gThird.connect(ui)
      oscAir.connect(gAir)
      gAir.connect(ui)

      oscBody.start(now)
      oscThird.start(tThird)
      oscAir.start(tAir)
      oscBody.stop(end + 0.03)
      oscThird.stop(end + 0.03)
      oscAir.stop(now + 0.32)
    })
  }

  /**
   * Ball collision — dual partials; pitch/decay from closing speed + kind (floor vs wall vs ball–ball).
   */
  const playBounceSound = (p: BounceAudioParams) => {
    if (!soundEnabledRef.current) return
    const { impact01, kind, approach, radius, mass, speed } = p
    if (impact01 < 0.085) return

    if (isStoppingRef.current) {
      const t = performance.now()
      if (t - stopBouncePhaseStartMsRef.current < 95) return
      if (impact01 > 0.38 || approach > 4.4) return
      if (kind === "ball" && (impact01 > 0.24 || approach > 1.85)) return
    }

    const tMs = performance.now()
    const win = bounceHitTimesRef.current
    while (win.length && tMs - win[0] > 1000) win.shift()
    if (win.length >= AUDIO.BOUNCE_MAX_PER_SEC) return
    win.push(tMs)

    withAudioContext(ctx => {
      const bus = physicsBusRef.current
      if (!bus) return
      const now = ctx.currentTime
      const pitchMul = 0.985 + Math.random() * 0.03
      const volMul = 0.92 + Math.random() * 0.06

      // Per-body physics: larger / heavier → lower pitch, slightly longer ring.
      const r = Math.max(5.5, Math.min(26, radius))
      const radiusPitchMul = Math.pow(11 / r, 0.38)
      const massPitchMul = Math.pow(Math.max(0.008, mass) / 0.22, -0.06)
      const speedNorm = Math.min(1, speed / 22)

      // Map closing speed along normal → 0..1 (gentle curve).
      const approachNorm = Math.min(1, approach / 24)

      let baseMin: number
      let baseSpan: number
      let partialMul: number
      let triGain: number
      let decayBody: number
      if (kind === "floor") {
        baseMin = 82
        baseSpan = 118
        partialMul = 1.48
        triGain = 0.12
        decayBody = 0.58
      } else if (kind === "wall") {
        baseMin = 108
        baseSpan = 148
        partialMul = 1.58
        triGain = 0.14
        decayBody = 0.52
      } else {
        baseMin = 128
        baseSpan = 168
        partialMul = 1.68
        triGain = 0.16
        decayBody = 0.48
      }

      let base =
        (baseMin + approachNorm * baseSpan + impact01 * 14 + speedNorm * 18) *
        pitchMul *
        radiusPitchMul *
        massPitchMul

      base = Math.max(55, Math.min(520, base))

      const dur =
        AUDIO.BOUNCE_MS *
        (0.68 + (1 - impact01) * 0.32 + (1 - approachNorm) * 0.1 + (r / 11 - 1) * 0.06)

      // Loudness ~ impact energy proxy: sqrt(m)*|v| and normal impulse; keep subtle.
      const energy01 = Math.min(
        1,
        0.35 * impact01 + 0.28 * approachNorm + 0.22 * speedNorm + 0.15 * Math.sqrt(mass / 0.35)
      )
      const peak = Math.min(
        AUDIO.BOUNCE_PEAK_MAX,
        AUDIO.BOUNCE_PEAK_MAX * (0.28 + 0.72 * energy01) * volMul * (0.82 + 0.18 * (r / 11))
      )

      const body = ctx.createOscillator()
      const gBody = ctx.createGain()
      body.type = "sine"
      body.frequency.setValueAtTime(base, now)
      body.frequency.exponentialRampToValueAtTime(
        Math.max(48, base * decayBody),
        now + dur * 0.82
      )

      const part = ctx.createOscillator()
      const gPart = ctx.createGain()
      part.type = "triangle"
      part.frequency.setValueAtTime(base * partialMul, now)
      part.frequency.exponentialRampToValueAtTime(
        Math.max(70, base * (partialMul * 0.45)),
        now + dur * 0.72
      )

      gBody.gain.setValueAtTime(0.0001, now)
      gBody.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.92), now + 0.004)
      gBody.gain.exponentialRampToValueAtTime(0.0001, now + dur)

      gPart.gain.setValueAtTime(0.0001, now)
      gPart.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, peak * triGain),
        now + 0.0025
      )
      gPart.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.88)

      body.connect(gBody)
      gBody.connect(bus)
      part.connect(gPart)
      gPart.connect(bus)
      body.start(now)
      part.start(now)
      body.stop(now + dur + 0.012)
      part.stop(now + dur + 0.012)
    })
  }

  playBounceSoundRef.current = playBounceSound

  /**
   * Close / perfect result — major pentatonic sparkle (perfect) or warm triad (close).
   */
  const playResultSting = (diff: number, isPerfect: boolean) => {
    withAudioContext(ctx => {
      const ui = uiBusRef.current
      if (!ui) return
      const now = ctx.currentTime
      const pm = 0.985 + Math.random() * 0.03

      if (isPerfect) {
        // Lower-register major lift + soft sparkle (less shrill than prior C6 band)
        const freqs = [261.63, 329.63, 392.0, 523.25, 1046.5].map(f => f * pm)
        const peaks = [0.1, 0.092, 0.085, 0.105, 0.044]
        freqs.forEach((f, i) => {
          const osc = ctx.createOscillator()
          const g = ctx.createGain()
          osc.type = i === 4 ? "sine" : "triangle"
          const t0 = now + i * 0.038
          osc.frequency.setValueAtTime(f, t0)
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(peaks[i] ?? 0.06, t0 + 0.012 + i * 0.004)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28 + i * 0.02)
          osc.connect(g)
          g.connect(ui)
          osc.start(t0)
          osc.stop(t0 + 0.35)
        })
        return
      }

      if (diff <= 3) {
        const freqs = [293.66, 369.99, 440.0].map(f => f * pm)
        const notePeak = 0.074
        freqs.forEach((f, i) => {
          const osc = ctx.createOscillator()
          const g = ctx.createGain()
          osc.type = "sine"
          const t0 = now + i * 0.055
          osc.frequency.setValueAtTime(f, t0)
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(notePeak * (1 - i * 0.08), t0 + 0.014)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2)
          osc.connect(g)
          g.connect(ui)
          osc.start(t0)
          osc.stop(t0 + 0.22)
        })
      }
    })
  }

  /** Short “pop” when the result value hits — pairs with impact scale. */
  const playResultImpactPop = () => {
    withAudioContext(ctx => {
      const ui = uiBusRef.current
      if (!ui) return
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = "sine"
      osc.frequency.setValueAtTime(1046.5, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.014, now + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.042)
      osc.connect(g)
      g.connect(ui)
      osc.start(now)
      osc.stop(now + 0.05)
    })
  }

  const triggerActionButtonFeedback = () => {
          if (isCounting || isStopping) return

    setActionButtonPressed(true)
    if (actionButtonPressTimeoutRef.current) {
      clearTimeout(actionButtonPressTimeoutRef.current)
      actionButtonPressTimeoutRef.current = null
    }

    actionButtonPressTimeoutRef.current = setTimeout(() => {
      setActionButtonPressed(false)
      actionButtonPressTimeoutRef.current = null
    }, 140)
  }

  const triggerHaptic = (kind: "press" | "stop" | "great" | "near" | "perfect") => {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return

    const pattern: number | number[] =
      kind === "press"
        ? 24
        : kind === "stop"
        ? 64
        : kind === "near"
        ? 96
        : kind === "perfect"
        ? [120, 60, 120]
        : [30, 20, 30]

    const now = performance.now()
    const totalDuration = Array.isArray(pattern)
      ? pattern.reduce((sum, n) => sum + n, 0)
      : pattern
    const minGapMs = totalDuration + 90

    if (now - lastHapticAtRef.current < minGapMs) return
    lastHapticAtRef.current = now

    try {
      navigator.vibrate(pattern)
    } catch {
      // Some browsers/devices may throw; ignore
    }
  }

  const todayKey = getLocalDateKey()
  const [isEarthDropPlayerToday, setIsEarthDropPlayerToday] = useState(false)
  const earthKey = `${EARTH_DROP_KEY_PREFIX}${todayKey}`
  const earthCollectedToday = getStorageItem(earthKey) === "true"
  const earthWinSeenKey = `orbidropEarthWinSeen:${todayKey}`
  const forceEarthEveryRun = getStorageItem("orbidropForceEarthEveryRun") === "true"

  const playfieldWidth = GAME.width
  const playfieldHeight = GAME.height

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        await fetch(`/api/player-stats`, { credentials: "include" })
      } catch {
        // ignore
      }
      if (cancelled) return
      try {
        const res = await fetch(`/api/earth-winner?date=${encodeURIComponent(todayKey)}`, {
          credentials: "include"
        })
        const data = await res.json()
        if (!cancelled && data?.isWinner === true) setIsEarthDropPlayerToday(true)
      } catch {
        // ignore
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [todayKey])

  /** Same local calendar as `todayKey` + countdown (next midnight) — must not be frozen from first mount. */
  const target = useMemo(() => getDailyTarget(), [todayKey])
  const dayNumber = useMemo(() => getDayNumber(), [todayKey])

  const [attempt, setAttempt] = useState(1)
  const [attemptResults, setAttemptResults] = useState<number[]>([])
  const [bestDiff, setBestDiff] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats>(() => {
    const stored = readStoredOrbifallStats()
    return (
      stored ?? {
        played: 0,
        best: null,
        totalDiff: 0,
        streak: 0,
        maxStreak: 0,
        lastPlayed: "",
        earthCollected: 0
      }
    )
  })

  // Before paint: restore today’s attempt slot from localStorage (survives tab close).
  useLayoutEffect(() => {
    const stored = readDailyProgressStored(todayKey)
    if (!stored) return
    if (stored.c === 0 && stored.r === 0 && !stored.exhausted) return
    setAttempt(
      attemptFromPeekPayload({
        completedAttempts: stored.c,
        attemptsUsed: stored.r,
        limitReached:
          stored.exhausted ||
          stored.c >= GAME.maxAttempts ||
          stored.r >= GAME.maxAttempts
      })
    )
  }, [todayKey])

  // All-time stats (player-stats) + today's quota/completions (peek — does not consume attempts).
  useEffect(() => {
    const run = async () => {
      try {
        const [statsRes, peekRes] = await Promise.all([
          fetch(`/api/player-stats?date=${encodeURIComponent(todayKey)}`, {
            credentials: "include"
          }),
          fetch(
            `/api/daily-attempts?date=${encodeURIComponent(todayKey)}&peek=true`,
            { credentials: "include" }
          )
        ])
        const statsData = await statsRes.json().catch(() => ({}))
        const peekData = await peekRes.json().catch(() => ({}))

        const serverStats = statsData?.stats as Stats | undefined
        const localStats = readStoredOrbifallStats()
        if (serverStats && localStats) {
          setStats(mergeHydratedPlayerStats(serverStats, localStats))
        } else if (serverStats) {
          setStats(serverStats)
        } else if (localStats) {
          setStats(localStats)
        }

        if (!peekRes.ok) {
          const stored = readDailyProgressStored(todayKey)
          const offline = readOfflineDaily(todayKey)
          const merged = mergeStoredDailyWithPeek(stored, {
            completedAttempts: offline.c,
            attemptsUsed: offline.r,
            limitReached:
              offline.c >= GAME.maxAttempts || offline.r >= GAME.maxAttempts
          })
          persistMergedDailyProgress(todayKey, merged)
          setAttempt(attemptFromPeekPayload(merged))
          return
        }

        clearOfflineDaily(todayKey)
        const stored = readDailyProgressStored(todayKey)
        const merged = mergeStoredDailyWithPeek(stored, peekData)
        persistMergedDailyProgress(todayKey, merged)
        setAttempt(attemptFromPeekPayload(merged))
      } catch {
        const stored = readDailyProgressStored(todayKey)
        if (stored) {
          const merged = mergeStoredDailyWithPeek(stored, {
            completedAttempts: 0,
            attemptsUsed: 0,
            limitReached: stored.exhausted
          })
          setAttempt(attemptFromPeekPayload(merged))
        }
      }
    }

    run()
  }, [todayKey])

  const gameOver = attempt > GAME.maxAttempts

  // When a new game finishes (gameOver flips from false -> true),
  // reset the stats-open locks so the stats can appear again.
  useEffect(() => {
    const next = gameOver
    if (next && !prevGameOverRef.current) {
      setStatsDismissed(false)
      setStatsAutoOpened(false)
    }
    prevGameOverRef.current = next
  }, [gameOver])

  // When the day is finished (3 results + game over), bump local all-time stats from session data.
  // Uses attemptResults so we still update if bestDiff/submit races or the server returns stale zeros.
  useEffect(() => {
    if (!gameOver) {
      appliedEndOfDayStatsRef.current = false
      return
    }
    if (appliedEndOfDayStatsRef.current) return
    if (attemptResults.length < GAME.maxAttempts) return

    appliedEndOfDayStatsRef.current = true

    const sessionBest = Math.min(...attemptResults)
    const today = getLocalDateKey()

    setStats(prev => {
      const newStats: Stats = {
        played: prev.played + 1,
        best: prev.best === null ? sessionBest : Math.min(prev.best, sessionBest),
        totalDiff: prev.totalDiff + sessionBest,
        streak: prev.streak + 1,
        maxStreak: Math.max(prev.maxStreak, prev.streak + 1),
        lastPlayed: today,
        earthCollected: prev.earthCollected
      }
      setStorageItem(ORBIFALL_STATS_STORAGE_KEY, JSON.stringify(newStats))
      return newStats
    })

    setBestDiff(prev => (prev === null ? sessionBest : Math.min(prev, sessionBest)))

    persistMergedDailyProgress(today, {
      completedAttempts: GAME.maxAttempts,
      attemptsUsed: GAME.maxAttempts,
      limitReached: true
    })
  }, [gameOver, attemptResults])

  useEffect(() => {
    if (
      !gameOver ||
      bestDiff === null ||
      showStats ||
      statsAutoOpened ||
      statsDismissed
    )
      return

    // Give the final result/diff/reveal a moment to finish
    // before mounting the full Statistics modal.
    const delayMs = isSmallScreen ? 850 : 750
    const t = window.setTimeout(() => {
      setStatsAutoOpened(true)
      setShowStats(true)
    }, delayMs)

    return () => window.clearTimeout(t)
  }, [gameOver, bestDiff, showStats, statsAutoOpened, isSmallScreen])

  useEffect(() => {
    if (!showStats) {
      setStatsPopUpReady(false)
      return
    }

    setStatsPopUpReady(false)
    const raf = requestAnimationFrame(() => {
      setStatsPopUpReady(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [showStats])

  useEffect(() => {
    if (!showRules) {
      setRulesPopUpReady(false)
      return
    }

    setRulesPopUpReady(false)
    const raf = requestAnimationFrame(() => {
      setRulesPopUpReady(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [showRules])

  useEffect(() => {
    const check = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : 400
      const h =
        typeof window !== "undefined"
          ? (window.visualViewport?.height ?? window.innerHeight)
          : 700
      setIsSmallScreen(w < 400 || h < 600)
    }
    check()
    window.addEventListener("resize", check)
    if (typeof window !== "undefined" && window.visualViewport) {
      window.visualViewport.addEventListener("resize", check)
    }
    return () => {
      window.removeEventListener("resize", check)
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", check)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (countRafRef.current !== null) {
        cancelAnimationFrame(countRafRef.current)
        countRafRef.current = null
      }

      if (feedbackTimeoutRef.current !== null) {
        clearTimeout(feedbackTimeoutRef.current)
        feedbackTimeoutRef.current = null
      }

      if (actionButtonPressTimeoutRef.current !== null) {
        clearTimeout(actionButtonPressTimeoutRef.current)
        actionButtonPressTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {

    const Engine = Matter.Engine
    const Render = Matter.Render
    const Runner = Matter.Runner
    const Bodies = Matter.Bodies
    const World = Matter.World

    if (sceneRef.current) {
      // Prevent stacked canvases when viewport changes in responsive/dev mode.
      sceneRef.current.innerHTML = ""
    }

    const engine = Engine.create()
    engineRef.current = engine

    const pixelRatio = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1

    const render = Render.create({
      element: sceneRef.current!,
      engine: engine,
      options: {
        width: playfieldWidth,
        height: playfieldHeight,
        pixelRatio,
        wireframes: false,
        background: "transparent"
      }
    })

    // Keep a robust physics ground so balls can't tunnel through the floor.
    // The visual border is minimal; the collision surface can be slightly thicker.
    const groundHeight = 20
    const ground = Bodies.rectangle(
      playfieldWidth / 2,
      playfieldHeight - groundHeight / 2,
      playfieldWidth,
      groundHeight,
      {
      isStatic: true,
      render: { visible: false },
      label: "ground"
      }
    )

    const leftWall = Bodies.rectangle(0, playfieldHeight / 2, 20, playfieldHeight, {
      isStatic: true,
      render: { visible: false }
    })

    const rightWall = Bodies.rectangle(playfieldWidth, playfieldHeight / 2, 20, playfieldHeight, {
      isStatic: true,
      render: { visible: false }
    })

    World.add(engine.world, [ground, leftWall, rightWall])

    const runner = Runner.create()
    runnerRef.current = runner

    Runner.run(runner, engine)
    Render.run(render)

    const isDecor = (b: Matter.Body) =>
      Boolean((b as Matter.Body & { orbifallIdleDecor?: boolean }).orbifallIdleDecor)

    const circleRadiusPx = (b: Matter.Body) =>
      typeof b.circleRadius === "number" && b.circleRadius > 0 ? b.circleRadius : 11

    const endFirstDropGlow = (b: Matter.Body) => {
      const ext = b as Matter.Body & { orbifallFirstDropGlow?: boolean }
      if (ext.orbifallFirstDropGlow) ext.orbifallFirstDropGlow = false
    }

    const onCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
      const pairs = event.pairs || []
      let best: BounceAudioParams | null = null

      const consider = (candidate: BounceAudioParams) => {
        if (!best || candidate.impact01 > best.impact01) best = candidate
      }

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]
        const { bodyA, bodyB } = pair
        const collision = pair.collision
        if (!(isDecor(bodyA) && isDecor(bodyB))) {
          if (!isDecor(bodyA)) endFirstDropGlow(bodyA)
          if (!isDecor(bodyB)) endFirstDropGlow(bodyB)
        }
        if (!collision?.normal) continue

        const nx = collision.normal.x
        const ny = collision.normal.y

        if (isDecor(bodyA) || isDecor(bodyB)) continue

        // Ball–ball: relative velocity along normal (closing speed).
        if (!bodyA.isStatic && !bodyB.isStatic) {
          if (bodyA.isSleeping && bodyB.isSleeping) continue
          const rvx = bodyB.velocity.x - bodyA.velocity.x
          const rvy = bodyB.velocity.y - bodyA.velocity.y
          const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy)
          if (relSpeed < 1.15) continue
          const approach = Math.abs(rvx * nx + rvy * ny)
          if (approach < 0.3 && relSpeed < 3.5) continue
          const impact01 = Math.min(1, approach * 0.17 + relSpeed * 0.036)
          if (impact01 < 0.07) continue
          const rA = circleRadiusPx(bodyA)
          const rB = circleRadiusPx(bodyB)
          const radius = Math.sqrt(rA * rB)
          const mass =
            (bodyA.mass * bodyB.mass) / Math.max(1e-9, bodyA.mass + bodyB.mass)
          consider({
            impact01,
            kind: "ball",
            approach,
            radius,
            mass,
            speed: relSpeed
          })
          continue
        }

        const staticB = bodyA.isStatic ? bodyA : bodyB.isStatic ? bodyB : null
        const dynamic = bodyA.isStatic ? bodyB : bodyB.isStatic ? bodyA : null
        if (!staticB || !dynamic || dynamic.isStatic) continue
        if (isDecor(dynamic)) continue
        if (dynamic.isSleeping) continue

        const { x: vx, y: vy } = dynamic.velocity
        const speedSq = vx * vx + vy * vy
        if (speedSq < 2.25) continue
        const speed = Math.sqrt(speedSq)
        const approach = Math.abs(vx * nx + vy * ny)
        if (approach < 0.72 && speedSq < 10) continue

        const impact01 = Math.min(1, approach * 0.19 + speed * 0.04)
        if (impact01 < 0.07) continue

        const radius = circleRadiusPx(dynamic)
        const mass = dynamic.mass

        if (staticB === ground) {
          consider({
            impact01,
            kind: "floor",
            approach,
            radius,
            mass,
            speed
          })
        } else if (staticB === leftWall || staticB === rightWall) {
          consider({
            impact01,
            kind: "wall",
            approach,
            radius,
            mass,
            speed
          })
        }
      }

      if (best) playBounceSoundRef.current(best)
    }

    Matter.Events.on(engine, "collisionStart", onCollisionStart)

    const onAfterRender = () => {
      const ctx = render.context
      const bodies = Matter.Composite.allBodies(engine.world)
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i] as Matter.Body & { orbifallFirstDropGlow?: boolean }
        if (!b.orbifallFirstDropGlow || b.isStatic) continue
        const r = circleRadiusPx(b)
        const { x, y } = b.position
        const outer = r * 2.35
        ctx.save()
        ctx.globalCompositeOperation = "lighter"
        const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, outer)
        g.addColorStop(0, "rgba(45, 212, 191, 0)")
        g.addColorStop(0.5, "rgba(42, 157, 143, 0.22)")
        g.addColorStop(0.85, "rgba(45, 212, 191, 0.1)")
        g.addColorStop(1, "rgba(42, 157, 143, 0)")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, outer, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    Matter.Events.on(render, "afterRender", onAfterRender)

    return () => {
      Matter.Events.off(render, "afterRender", onAfterRender)
      Matter.Events.off(engine, "collisionStart", onCollisionStart)
      Runner.stop(runner)
      Render.stop(render)
      if (runnerRef.current === runner) runnerRef.current = null
      World.clear(engine.world, false)
      Engine.clear(engine)
      render.canvas.remove()
      render.textures = {}
    }
  }, [playfieldWidth, playfieldHeight])

  useEffect(() => {
    if (hasPressedDropRef.current) return
    let cancelled = false
    let innerRaf = 0
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled || !engineRef.current || hasPressedDropRef.current) return
        spawnIdleDecorBalls()
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(outerRaf)
      if (innerRaf) cancelAnimationFrame(innerRaf)
      clearIdleDecorBalls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idle spawn reads latest playfield/target via deps
  }, [playfieldWidth, playfieldHeight, target, isSmallScreen])

  useEffect(() => {
    if (isReturningOrbifallUser()) {
      try {
        if (localStorage.getItem(ORBIFALL_RULES_SEEN_KEY) !== "true") {
          localStorage.setItem(ORBIFALL_RULES_SEEN_KEY, "true")
        }
      } catch {
        /* ignore */
      }
      return
    }
    setShowRules(true)
  }, [])

  const spawnBall = () => {

    if (!engineRef.current) return

    const isFirstDropOfAttempt = firstDropOfAttemptRef.current
    if (isFirstDropOfAttempt) {
      firstDropOfAttemptRef.current = false
    }

    // Base radii +~18% vs prior small-orbs pass → ~60% jar fill at TARGET; still scaled by daily TARGET.
    const baseR = isSmallScreen ? Math.random() * 4.7 + 8.3 : Math.random() * 5.3 + 10
    const radius = baseR * orbRadiusScaleForTarget(target)

    const baseColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
    const brightnessDelta = Math.floor(Math.random() * 24) - 10
    const ballOpacity = 0.92 + Math.random() * 0.08

    // Shaded "3D-ish" texture (cached) for less-flat-looking balls.
    const keyBucket = Math.max(-24, Math.min(24, Math.round(brightnessDelta / 3) * 3))
    const textureKey = `${baseColor}_${keyBucket}`
    let textureUri = ballTextureCacheRef.current.get(textureKey) ?? ""
    if (!textureUri) {
      textureUri = makeBallTextureUri(baseColor, brightnessDelta)
      ballTextureCacheRef.current.set(textureKey, textureUri)
    }

    const xScale = (radius * 2) / BALL_TEXTURE_SIZE
    const yScale = xScale

    const ball = Matter.Bodies.circle(
      playfieldWidth / 2 + (Math.random() * 80 - 40),
      0,
      radius,
      {
        restitution: 0.85,
        friction: 0.02,
        frictionAir: 0.002,
        density: 0.001,
        render: {
          sprite: {
            texture: textureUri,
            xScale,
            yScale
          },
          opacity: ballOpacity
        }
      }
    )

    if (isFirstDropOfAttempt) {
      ;(ball as Matter.Body & { orbifallFirstDropGlow?: boolean }).orbifallFirstDropGlow = true
    }

    Matter.World.add(engineRef.current.world, ball)

    Matter.Body.setVelocity(ball, {
      x: (Math.random() - 0.5) * 4,
      y: 0
    })

    ballsRef.current.push(ball)
    setBallCount(ballsRef.current.length)

  }

  const spawnEarthBall = () => {

    if (!engineRef.current) return

    const isFirstDropOfAttempt = firstDropOfAttemptRef.current
    if (firstDropOfAttemptRef.current) {
      firstDropOfAttemptRef.current = false
    }

    const radius = EARTH_RADIUS

    const ball = Matter.Bodies.circle(
      playfieldWidth / 2 + (Math.random() * 60 - 30),
      0,
      radius,
      {
        restitution: 0.85,
        friction: 0.02,
        frictionAir: 0.002,
        density: 0.0012,
        render: {
          sprite: {
            texture: EARTH_TEXTURE_DATA_URI,
            xScale: (EARTH_DIAMETER) / EARTH_TEXTURE_SIZE,
            yScale: (EARTH_DIAMETER) / EARTH_TEXTURE_SIZE
          }
        }
      }
    )

    if (isFirstDropOfAttempt) {
      ;(ball as Matter.Body & { orbifallFirstDropGlow?: boolean }).orbifallFirstDropGlow = true
    }

    Matter.World.add(engineRef.current.world, ball)
    Matter.Body.setVelocity(ball, {
      x: (Math.random() - 0.5) * 4,
      y: 0
    })

    ballsRef.current.push(ball)
    setBallCount(ballsRef.current.length)
  }

  const clearIdleDecorBalls = () => {
    const world = engineRef.current?.world
    if (!world) return
    idleDecorBallsRef.current.forEach(ball => {
      try {
        Matter.World.remove(world, ball)
      } catch {
        /* already removed */
      }
    })
    idleDecorBallsRef.current = []
    setIdleJarAtmosphere(false)
  }

  const spawnIdleDecorBalls = () => {
    if (!engineRef.current || hasPressedDropRef.current) return
    clearIdleDecorBalls()
    const world = engineRef.current.world
    const n = 8 + Math.floor(Math.random() * 5)
    for (let i = 0; i < n; i++) {
      const baseR = isSmallScreen ? Math.random() * 4.7 + 8.3 : Math.random() * 5.3 + 10
      const radius = baseR * orbRadiusScaleForTarget(target)
      const baseColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
      const brightnessDelta = Math.floor(Math.random() * 24) - 10
      const ballOpacity = 0.92 + Math.random() * 0.08
      const keyBucket = Math.max(-24, Math.min(24, Math.round(brightnessDelta / 3) * 3))
      const textureKey = `${baseColor}_${keyBucket}`
      let textureUri = ballTextureCacheRef.current.get(textureKey)
      if (!textureUri) {
        textureUri = makeBallTextureUri(baseColor, brightnessDelta)
        ballTextureCacheRef.current.set(textureKey, textureUri)
      }
      const xScale = (radius * 2) / BALL_TEXTURE_SIZE
      const yScale = xScale
      const ball = Matter.Bodies.circle(
        playfieldWidth / 2 + (Math.random() * 80 - 40),
        -20 - i * 14,
        radius,
        {
          restitution: 0.85,
          friction: 0.02,
          frictionAir: 0.002,
          density: 0.001,
          render: {
            sprite: {
              texture: textureUri,
              xScale,
              yScale
            },
            opacity: ballOpacity
          }
        }
      )
      ;(ball as Matter.Body & { orbifallIdleDecor?: boolean }).orbifallIdleDecor = true
      Matter.World.add(world, ball)
      Matter.Body.setVelocity(ball, {
        x: (Math.random() - 0.5) * 3,
        y: 0.5
      })
      idleDecorBallsRef.current.push(ball)
    }
    setIdleJarAtmosphere(true)
  }

  const animateEarthIntoGlass = () => {
    const iconEl = earthIconRef.current
    const glassEl = glassRef.current
    if (!iconEl || !glassEl) return

    const iconRect = iconEl.getBoundingClientRect()
    const glassRect = glassEl.getBoundingClientRect()

    const startX = iconRect.left + iconRect.width / 2
    const startY = iconRect.top + iconRect.height / 2
    const endX = glassRect.left + glassRect.width / 2
    const endY = glassRect.top + 18

    // hide the static header icon while its "ghost" travels
    const previousVisibility = iconEl.style.visibility
    iconEl.style.visibility = "hidden"

    const ghost = document.createElement("div")
    ghost.setAttribute("aria-hidden", "true")
    ghost.style.position = "fixed"
    ghost.style.left = `${startX}px`
    ghost.style.top = `${startY}px`
    ghost.style.width = `${iconRect.width}px`
    ghost.style.height = `${iconRect.height}px`
    ghost.style.borderRadius = "50%"
    ghost.style.transform = "translate(-50%, -50%)"
    ghost.style.pointerEvents = "none"
    ghost.style.zIndex = "3000"
    ghost.style.backgroundImage = `url("${EARTH_TEXTURE_DATA_URI}")`
    ghost.style.backgroundSize = "cover"
    ghost.style.boxShadow = "0 2px 6px rgba(0,0,0,0.22), inset -2px -3px 4px rgba(0,0,0,0.28)"
    ghost.style.border = "1px solid rgba(255,255,255,0.55)"

    document.body.appendChild(ghost)

    // Physical fall: straight path from header to glass, gravity-like easing (slow start, fast impact)
    const dx = endX - startX
    const dy = endY - startY

    const anim = ghost.animate(
      [
        { transform: `translate(-50%, -50%) translate(0, 0) scale(1)`, opacity: 1 },
        {
          transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1)`,
          opacity: 1
        }
      ],
      { duration: 800, easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" }
    )

    anim.onfinish = () => {
      ghost.remove()
      iconEl.style.visibility = previousVisibility
    }
  }

  const resetBalls = () => {

    if (!engineRef.current) return

    ballsRef.current.forEach(ball => {
      Matter.World.remove(engineRef.current!.world, ball)
    })

    ballsRef.current = []
    setBallCount(0)

  }

  const startGame = async () => {
    if (running || gameOver || isCounting || isStopping) return
    if (consumeAttemptInFlightRef.current) return
    consumeAttemptInFlightRef.current = true

    let okToStart = false
    try {
      const res = await fetch("/api/daily-attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ date: todayKey })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const quotaApiServerError = res.status >= 500 && res.status < 600
        if (quotaApiServerError) {
          const st = readOfflineDaily(todayKey)
          const r2 = Math.min(GAME.maxAttempts, st.r + 1)
          writeOfflineDaily(todayKey, { ...st, r: r2 })
          setAttempt(Math.min(GAME.maxAttempts, Math.max(1, r2)))
          const merged = mergeStoredDailyWithPeek(readDailyProgressStored(todayKey), {
            completedAttempts: st.c,
            attemptsUsed: r2,
            limitReached:
              st.c >= GAME.maxAttempts || r2 >= GAME.maxAttempts
          })
          persistMergedDailyProgress(todayKey, merged)
        }
        okToStart = quotaApiServerError
      } else if (data?.limitReached === true) {
        setAttempt(GAME.maxAttempts + 1)
        persistMergedDailyProgress(
          todayKey,
          mergeStoredDailyWithPeek(readDailyProgressStored(todayKey), {
            completedAttempts: GAME.maxAttempts,
            attemptsUsed: GAME.maxAttempts,
            limitReached: true
          })
        )
        okToStart = false
      } else {
        clearOfflineDaily(todayKey)
        const used = Number(data?.attemptsUsed ?? 0)
        setAttempt(Math.min(GAME.maxAttempts, Math.max(1, used)))
        const stored = readDailyProgressStored(todayKey)
        persistMergedDailyProgress(
          todayKey,
          mergeStoredDailyWithPeek(stored, {
            completedAttempts: stored?.c ?? 0,
            attemptsUsed: used,
            limitReached: used >= GAME.maxAttempts
          })
        )
        okToStart = true
      }
    } catch {
      const st = readOfflineDaily(todayKey)
      const r2 = Math.min(GAME.maxAttempts, st.r + 1)
      writeOfflineDaily(todayKey, { ...st, r: r2 })
      setAttempt(Math.min(GAME.maxAttempts, Math.max(1, r2)))
      const merged = mergeStoredDailyWithPeek(readDailyProgressStored(todayKey), {
        completedAttempts: st.c,
        attemptsUsed: r2,
        limitReached: st.c >= GAME.maxAttempts || r2 >= GAME.maxAttempts
      })
      persistMergedDailyProgress(todayKey, merged)
      okToStart = true
    } finally {
      consumeAttemptInFlightRef.current = false
    }

    if (!okToStart) return
    if (running || gameOver || isCounting || isStopping) return

    // Impact moment for DROP
    setDropImpact(true)
    setTimeout(() => setDropImpact(false), 320)

    playStartSound()
    triggerHaptic("press") // fallback for keyboard
    stopResultSequenceCleanupRef.current?.()
    stopResultSequenceCleanupRef.current = null
    setGameFinished(false)
    setStopDiff(null)
    setStopPulse(false)
    setScoreReveal(false)
    setStopImpact(false)
    setIsCounting(false)
    setCountDisplay(0)
    setDiffRevealVisible(false)
    earthWonThisRunRef.current = false

    hasPressedDropRef.current = true
    clearIdleDecorBalls()
    resetBalls()
    firstDropOfAttemptRef.current = true

    const earthKey = `${EARTH_DROP_KEY_PREFIX}${todayKey}`
    earthDroppedRef.current = localStorage.getItem(earthKey) === "true"

    setRunning(true)

    const spawnLoop = () => {

      if ((forceEarthEveryRun || isEarthDropPlayerToday) && !earthDroppedRef.current) {
        // daily Earth orb: animate from header into glass, then spawn the physics orb
        animateEarthIntoGlass()
        earthSpawnTimeoutRef.current = setTimeout(() => {
          spawnEarthBall()
          earthSpawnTimeoutRef.current = null
        }, 800)

        earthWonThisRunRef.current = true
        earthDroppedRef.current = true
        localStorage.setItem(earthKey, "true")
        setStats(prev => {
          const next = { ...prev, earthCollected: prev.earthCollected + 1 }
          setStorageItem(ORBIFALL_STATS_STORAGE_KEY, JSON.stringify(next))
          return next
        })
      } else {
        spawnBall()
      }

      if (Math.random() < 0.2) {
        spawnBallTimeoutRef.current = setTimeout(spawnBall, 48)
      }

      const baseSpeed = Math.max(80, 220 - target)
      const speedRel = dropSpawnSpeedRelForTarget(target)
      const randomDelay = Math.max(
        8,
        Math.floor(((Math.random() * baseSpeed + 80) / speedRel) * 0.8)
      )

      intervalRef.current = setTimeout(spawnLoop, randomDelay)

    }

    spawnLoop()

  }

  const stopGame = () => {
    if (isStopping || !running) return

    if (jarShakeTimeoutRef.current) {
      clearTimeout(jarShakeTimeoutRef.current)
      jarShakeTimeoutRef.current = null
    }
    setJarShakeActive(true)
    jarShakeTimeoutRef.current = setTimeout(() => {
      setJarShakeActive(false)
      jarShakeTimeoutRef.current = null
    }, 400)

    // STOP should feel punchy:
    // 1) Freeze the physics briefly
    // 2) Then quickly reveal Result + Diff with a pop + color feedback
    const finalCount = ballsRef.current.length
    const diff = Math.abs(finalCount - target)

    // Performance band
    const isPerfect = diff === 0
    const isClose = diff > 0 && diff <= 3
    const isMedium = diff > 3 && diff <= 10

    const submitAttemptPromise = fetch("/api/daily-submit-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        date: todayKey,
        ballCount: finalCount,
        target
      })
    })
      .then(async r => {
        try {
          return await r.json()
        } catch {
          return null
        }
      })
      .catch(() => null)

    setStopDiff(diff)
    setStopPulse(false)

    // Haptics + sound on STOP (stronger when close/perfect)
    if (isPerfect) triggerHaptic("perfect")
    else if (diff <= 3) triggerHaptic("near")
    else triggerHaptic("stop")

    playStopClickSound(isPerfect ? "perfect" : diff <= 3 ? "near" : "default")

    // Smooth slow-down -> settle -> reveal
    const rampDownMs = 175 // 150-250ms target
    const settleHoldMs = 25 // delay before result reveal
    const revealAtMs = rampDownMs + settleHoldMs
    const settleBoostMs = 120

    stopBouncePhaseStartMsRef.current = performance.now()
    isStoppingRef.current = true
    setIsStopping(true)
    setRunning(false)
    setStopImpact(true)
    window.setTimeout(() => setStopImpact(false), revealAtMs + 60)

    // Stop new spawns immediately.
    if (intervalRef.current) {
      clearTimeout(intervalRef.current)
      intervalRef.current = null
    }
    if (spawnBallTimeoutRef.current) {
      clearTimeout(spawnBallTimeoutRef.current)
      spawnBallTimeoutRef.current = null
    }
    if (earthSpawnTimeoutRef.current) {
      clearTimeout(earthSpawnTimeoutRef.current)
      earthSpawnTimeoutRef.current = null
    }

    if (countRafRef.current !== null) {
      cancelAnimationFrame(countRafRef.current)
      countRafRef.current = null
    }

    const engine = engineRef.current
    const prevTimeScale = engine?.timing?.timeScale ?? 1
    const prevGravityY = engine?.world?.gravity?.y ?? 1

    const rampTimeScale = (from: number, to: number, ms: number) => {
      if (!engineRef.current) return
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms)
        const eased = 1 - Math.pow(1 - t, 3) // ease-out
        if (engineRef.current) {
          engineRef.current.timing.timeScale = from + (to - from) * eased
        }
        if (t < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    const dampBallsForSettle = () => {
      const bodies = ballsRef.current
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]
        const v = b.velocity
        // Gentle damping instead of instant hard-stop.
        Matter.Body.setVelocity(b, { x: v.x * 0.52, y: v.y * 0.25 })
        Matter.Body.setAngularVelocity(b, b.angularVelocity * 0.6)
      }
    }

    const revealFn = () => {
      setGameFinished(true)
      setBallCount(finalCount)
      setAttemptResults(prev => [...prev, diff])
      setBestDiff(prev => (prev === null ? diff : Math.min(prev, diff)))

      // Persist this attempt + sync rounds from server (peek is source of truth for UI).
      submitAttemptPromise?.then(async (data: any) => {
        try {
          if (data?.ok) {
            const completed = Number(data.attemptsUsed ?? 0)
            const nextSlot = Math.min(GAME.maxAttempts + 1, completed + 1)
            setAttempt(nextSlot)

            void fetch(`/api/earth-winner?date=${encodeURIComponent(todayKey)}`, {
              credentials: "include"
            })
              .then(r => r.json())
              .then(ew => {
                if (ew?.isWinner === true) setIsEarthDropPlayerToday(true)
              })
              .catch(() => {})

            if (typeof data.bestDiff === "number") {
              setBestDiff(prev =>
                prev === null ? data.bestDiff : Math.min(prev, data.bestDiff as number)
              )
            }

            if (data.isDayComplete) {
              fetch(`/api/player-stats`, { credentials: "include" })
                .then(r => r.json())
                .then(statsRes => {
                  if (statsRes?.stats) {
                    setStats(prev => {
                      const s = statsRes.stats as Stats
                      const sp = s.played ?? 0
                      // Server can lag or fail to persist — never wipe a higher local count.
                      if (sp < prev.played) {
                        return {
                          ...prev,
                          earthCollected: Math.max(prev.earthCollected, s.earthCollected ?? 0)
                        }
                      }
                      return {
                        ...s,
                        earthCollected: Math.max(prev.earthCollected, s.earthCollected ?? 0)
                      }
                    })
                  }
                })
                .catch(() => {})
            }
          } else if (data && typeof data.attemptsUsed === "number") {
            const completed = Number(data.attemptsUsed)
            setAttempt(Math.min(GAME.maxAttempts + 1, completed + 1))
            const stored = readDailyProgressStored(todayKey)
            persistMergedDailyProgress(
              todayKey,
              mergeStoredDailyWithPeek(stored, {
                completedAttempts: completed,
                attemptsUsed: Math.max(completed, stored?.r ?? 0),
                limitReached: completed >= GAME.maxAttempts
              })
            )
          }
        } finally {
          // Always re-fetch peek (even when submit body was empty / JSON parse failed) so rounds advance.
          try {
            const peekRes = await fetch(
              `/api/daily-attempts?date=${encodeURIComponent(todayKey)}&peek=true`,
              { credentials: "include" }
            )
            if (peekRes.ok) {
              clearOfflineDaily(todayKey)
              const peekData = await peekRes.json()
              const merged = mergeStoredDailyWithPeek(
                readDailyProgressStored(todayKey),
                peekData
              )
              persistMergedDailyProgress(todayKey, merged)
              const next = attemptFromPeekPayload(merged)
              setAttempt(next)
            } else if (data?.ok) {
              const completed = Number(data.attemptsUsed ?? 0)
              const stored = readDailyProgressStored(todayKey)
              const merged = mergeStoredDailyWithPeek(stored, {
                completedAttempts: completed,
                attemptsUsed: Math.max(completed, stored?.r ?? 0),
                limitReached:
                  data?.isDayComplete === true || completed >= GAME.maxAttempts
              })
              persistMergedDailyProgress(todayKey, merged)
              const next = attemptFromPeekPayload(merged)
              setAttempt(next)
            } else if (
              !data?.ok &&
              !(data && typeof data.attemptsUsed === "number")
            ) {
              const st = readOfflineDaily(todayKey)
              const c2 = Math.min(GAME.maxAttempts, st.c + 1)
              const nextSt = { ...st, c: c2 }
              writeOfflineDaily(todayKey, nextSt)
              const merged = mergeStoredDailyWithPeek(
                readDailyProgressStored(todayKey),
                {
                  completedAttempts: c2,
                  attemptsUsed: nextSt.r,
                  limitReached:
                    c2 >= GAME.maxAttempts || nextSt.r >= GAME.maxAttempts
                }
              )
              persistMergedDailyProgress(todayKey, merged)
              const next = attemptFromOfflineState(nextSt)
              setAttempt(next)
            }
          } catch {
            if (data?.ok) {
              const completed = Number(data.attemptsUsed ?? 0)
              const stored = readDailyProgressStored(todayKey)
              const merged = mergeStoredDailyWithPeek(stored, {
                completedAttempts: completed,
                attemptsUsed: Math.max(completed, stored?.r ?? 0),
                limitReached:
                  data?.isDayComplete === true || completed >= GAME.maxAttempts
              })
              persistMergedDailyProgress(todayKey, merged)
              const next = attemptFromPeekPayload(merged)
              setAttempt(next)
            } else if (
              !data?.ok &&
              !(data && typeof data.attemptsUsed === "number")
            ) {
              const st = readOfflineDaily(todayKey)
              const c2 = Math.min(GAME.maxAttempts, st.c + 1)
              const nextSt = { ...st, c: c2 }
              writeOfflineDaily(todayKey, nextSt)
              const merged = mergeStoredDailyWithPeek(
                readDailyProgressStored(todayKey),
                {
                  completedAttempts: c2,
                  attemptsUsed: nextSt.r,
                  limitReached:
                    c2 >= GAME.maxAttempts || nextSt.r >= GAME.maxAttempts
                }
              )
              persistMergedDailyProgress(todayKey, merged)
              const next = attemptFromOfflineState(nextSt)
              setAttempt(next)
            }
          }
        }
      })

      stopResultSequenceCleanupRef.current?.()
      const revealTimeouts: number[] = []
      let cancelCountUp: (() => void) | undefined
      const cleanupSequence = () => {
        cancelCountUp?.()
        revealTimeouts.forEach(clearTimeout)
      }
      stopResultSequenceCleanupRef.current = cleanupSequence

      setDiffRevealVisible(false)
      setScoreReveal(true)
      setStopPulse(diff <= 5)

      const finishImpactPhase = () => {
        setIsCounting(false)
        setCountDisplay(finalCount)

        if (isPerfect) setPerfectBurstId(prev => prev + 1)
        if (!isPerfect && diff <= 5) setRewardBurstId(prev => prev + 1)
        if (diff <= 3) playResultSting(diff, isPerfect)
        playResultImpactPop()

        const elResult = resultValueRef.current
        if (elResult) runImpactScale(elResult, STOP_RESULT_TIMING.IMPACT_MS)

        revealTimeouts.push(
          window.setTimeout(() => {
            setDiffRevealVisible(true)
          }, STOP_RESULT_TIMING.DIFF_STAGGER_MS)
        )
      }

      const afterPause = () => {
        if (finalCount === 0) {
          finishImpactPhase()
          return
        }
        setIsCounting(true)
        setCountDisplay(0)
        cancelCountUp = runCountUp({
          from: 0,
          to: finalCount,
          durationMs: STOP_RESULT_TIMING.COUNT_MS,
          onUpdate: v => {
            const n = Math.min(finalCount, Math.max(0, Math.round(v)))
            setCountDisplay(n)
          },
          onComplete: finishImpactPhase
        })
      }

      revealTimeouts.push(
        window.setTimeout(afterPause, STOP_RESULT_TIMING.PAUSE_MS)
      )

      revealTimeouts.push(
        window.setTimeout(() => {
          setScoreReveal(false)
          setStopPulse(false)
          isStoppingRef.current = false
          setIsStopping(false)
        }, STOP_RESULT_TIMING.UI_SETTLE_MS)
      )

      if (
        earthWonThisRunRef.current &&
        (forceEarthEveryRun || localStorage.getItem(earthWinSeenKey) !== "true")
      ) {
        if (!forceEarthEveryRun) localStorage.setItem(earthWinSeenKey, "true")
        setShowEarthWin(true)
      }
    }

    const unfreezeAndDropIntoPlace = () => {
      if (!engineRef.current) return
      const mult = isPerfect ? 1.35 : isClose ? 1.22 : isMedium ? 1.16 : 1.1
      engineRef.current.world.gravity.y = prevGravityY * mult

      // Smoothly bring physics back.
      rampTimeScale(engineRef.current.timing.timeScale, prevTimeScale, 95)

      window.setTimeout(() => {
        if (engineRef.current) engineRef.current.world.gravity.y = prevGravityY
      }, settleBoostMs)
    }

    // Smoothly slow down instead of instantly stopping.
    if (engineRef.current) {
      dampBallsForSettle()
      const start = performance.now()
      const from = prevTimeScale
      const to = 0.08

      const downTick = (now: number) => {
        const t = Math.min(1, (now - start) / rampDownMs)
        const eased = 1 - Math.pow(1 - t, 3) // ease-out
        if (engineRef.current) engineRef.current.timing.timeScale = from + (to - from) * eased

        if (t < 1) {
          // Gentle damping mid-way.
          if (t > 0.5 && t < 0.55) dampBallsForSettle()
          requestAnimationFrame(downTick)
          return
        }

        // Hold a bit so the scene feels like it "settles" before UI reveal.
        window.setTimeout(() => {
          revealFn()
          // After reveal starts, let balls drop into place naturally.
          window.setTimeout(unfreezeAndDropIntoPlace, 40)
        }, settleHoldMs)
      }

      requestAnimationFrame(downTick)
    } else {
      window.setTimeout(() => {
        revealFn()
      }, revealAtMs)
    }

  }

  useLayoutEffect(() => {
    if (!diffRevealVisible) return
    const el = diffValueRef.current
    if (!el) return
    runDiffReveal(el)
  }, [diffRevealVisible])

  // Subtle perfect celebration burst (no heavy confetti library).
  useEffect(() => {
    if (perfectBurstId === 0) return
    const container = perfectBurstContainerRef.current
    if (!container) return

    container.innerHTML = ""
    const colors = ["#16a34a", "#2a9d8f", "#e9c46a"]

    const particles = 14
    for (let i = 0; i < particles; i++) {
      const el = document.createElement("span")
      const left = 0.5 + (Math.random() - 0.5) * 0.28
      const top = 0.38 + Math.random() * 0.08
      const color = colors[Math.floor(Math.random() * colors.length)]
      const width = 4 + Math.random() * 4
      const height = 2 + Math.random() * 3
      const rot = Math.random() * 180

      el.style.position = "absolute"
      el.style.left = `${left * 100}%`
      el.style.top = `${top * 100}%`
      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.style.background = color
      el.style.borderRadius = "2px"
      el.style.opacity = "1"
      el.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(1)`
      el.style.pointerEvents = "none"

      container.appendChild(el)

      const fall = 60 + Math.random() * 40
      const dx = (Math.random() - 0.5) * 40
      const dur = 520 + Math.random() * 120

      el.animate(
        [
          { transform: `translate(-50%, -50%) rotate(${rot}deg) translateX(0px) translateY(0px) scale(1)`, opacity: 1 },
          { transform: `translate(-50%, -50%) rotate(${rot + 150}deg) translateX(${dx}px) translateY(${fall}px) scale(0.8)`, opacity: 0.0 }
        ],
        { duration: dur, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
      ).onfinish = () => {
        el.remove()
      }
    }

    return () => {
      container.innerHTML = ""
    }
  }, [perfectBurstId])

  // Subtle reward burst for good results (diff <= 5, excluding perfect).
  useEffect(() => {
    if (rewardBurstId === 0) return
    const container = rewardBurstContainerRef.current
    if (!container) return

    container.innerHTML = ""

    const isGreen = stopDiff !== null && stopDiff <= 3
    const colors = isGreen ? ["#2a9d8f", "#16a34a"] : ["#e9c46a", "#f4a261"]

    const particles = 10
    for (let i = 0; i < particles; i++) {
      const el = document.createElement("span")
      const left = 0.5 + (Math.random() - 0.5) * 0.22
      const top = 0.42 + Math.random() * 0.08
      const color = colors[Math.floor(Math.random() * colors.length)]
      const width = 3 + Math.random() * 4
      const height = 2 + Math.random() * 3
      const rot = Math.random() * 180

      el.style.position = "absolute"
      el.style.left = `${left * 100}%`
      el.style.top = `${top * 100}%`
      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.style.background = color
      el.style.borderRadius = "2px"
      el.style.opacity = "0.95"
      el.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(1)`
      el.style.pointerEvents = "none"

      container.appendChild(el)

      const fall = 50 + Math.random() * 40
      const dx = (Math.random() - 0.5) * 28
      const dur = 420 + Math.random() * 90

      el.animate(
        [
          { transform: `translate(-50%, -50%) rotate(${rot}deg) translateX(0px) translateY(0px) scale(1)`, opacity: 1 },
          { transform: `translate(-50%, -50%) rotate(${rot + 120}deg) translateX(${dx}px) translateY(${fall}px) scale(0.8)`, opacity: 0.0 }
        ],
        { duration: dur, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
      ).onfinish = () => {
        el.remove()
      }
    }

    return () => {
      container.innerHTML = ""
    }
  }, [rewardBurstId, stopDiff])

  const shareResult = async () => {
    if (bestDiff === null) return

    let text = `Orbidrop #${dayNumber}\n`
    text += `🎯 ${target}\n\n`

    attemptResults.forEach(diff => {
      let emoji = "🔴"

      if (diff === 0) emoji = "🟢"
      else if (diff <= 2) emoji = "🟢"
      else if (diff <= 5) emoji = "🟡"
      else if (diff <= 10) emoji = "🟠"

      const row = emoji.repeat(Math.min(diff + 1, 5))

      text += row + "\n"
    })

    text += `\nBest diff: ${bestDiff}`

    text += `\nCan you beat me?`

    text += `\n\nPlay: https://orbidrop.com`

    const title = `Orbidrop #${dayNumber}`
    const sharePayload: ShareData = { title, text }

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      const allowed =
        typeof navigator.canShare !== "function" || navigator.canShare(sharePayload)
      if (allowed) {
        try {
          await navigator.share(sharePayload)
          return
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return
          /* fall through to clipboard */
        }
      }
    }

    try {
      await navigator.clipboard.writeText(text)
      alert("Result copied! Share it with friends 🚀")
    } catch {
      console.log(text)
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return
      if (e.repeat) return
      const el = e.target as HTMLElement
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return
      if (showRules || showStats) return
      if (isCounting || isStopping) return
      e.preventDefault()
      if (gameOver) {
        void shareResult()
        return
      }
      if (running) stopGame()
      else startGame()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    gameOver,
    running,
    isCounting,
    isStopping,
    isSmallScreen,
    statsDismissed,
    showRules,
    showStats,
    isEarthDropPlayerToday,
    shareResult
  ])

  const shareEarthWin = async () => {
    const diff = Math.abs(ballCount - target)
    const text =
      `Orbidrop #${dayNumber}\n` +
      `🌍 I collected the Global Orb!\n` +
      `🎯 Target ${target}\n` +
      `✅ Result ${ballCount}\n` +
      `📏 Diff ${diff}\n\n` +
      `Play: https://orbidrop.com`

    try {
      await navigator.clipboard.writeText(text)
      alert("Global Orb win copied — share it!")
    } catch {
      console.log(text)
    }
  }

  let percentile: number | null = null

  const statsModalBestDiff =
    bestDiff ??
    (gameOver && attemptResults.length >= GAME.maxAttempts
      ? Math.min(...attemptResults)
      : null)

  const avgDiffNum = stats.played > 0 ? stats.totalDiff / stats.played : null
  const averageDiff = avgDiffNum !== null ? avgDiffNum.toFixed(1) : "-"

  const avgDiffMeta = (() => {
    if (avgDiffNum === null) return { color: "#666", emoji: "", label: "—" }
    if (avgDiffNum <= 2) return { color: "#2a9d8f", emoji: "🔥", label: "Elite" }
    if (avgDiffNum <= 5) return { color: "#e9c46a", emoji: "✨", label: "Solid" }
    if (avgDiffNum <= 10) return { color: "#f4a261", emoji: "💪", label: "Getting there" }
    return { color: "#e63946", emoji: "🎯", label: "Keep pushing" }
  })()

  if (statsModalBestDiff !== null) {
    const score = 100 - statsModalBestDiff * 4
    percentile = Math.max(1, Math.min(99, Math.round(score)))
  }

  useEffect(() => {

  const updateTimer = () => {

    const now = new Date()

    const midnight = new Date()

    midnight.setHours(24, 0, 0, 0)

    const diff = midnight.getTime() - now.getTime()

    const hours = Math.floor(diff / (1000 * 60 * 60))

    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    const seconds = Math.floor((diff % (1000 * 60)) / 1000)

    const formatted =
      `${String(hours).padStart(2,"0")}:` +
      `${String(minutes).padStart(2,"0")}:` +
      `${String(seconds).padStart(2,"0")}`

    setTimeLeft(formatted)

  }

  updateTimer()

  const interval = setInterval(updateTimer, 1000)

  return () => clearInterval(interval)

}, [])
const revealStyle = gameFinished
  ? { transform: "scale(1.1)", transition: "transform 0.15s ease" }
  : { transform: "scale(1)" }

  // Show feedback only after the result finished counting
  const activeDiff = gameFinished ? Math.abs(ballCount - target) : null

  const feedbackMessage = activeDiff !== null ? diffToFeedback(activeDiff) : ""

  const countingDiff = isCounting ? Math.abs(countDisplay - target) : null
  const countingDiffColor =
    countingDiff === null ? theme.text : diffToColor(countingDiff)

  const hasResultNumbers = isCounting || gameFinished
  const finishedDiff = gameFinished ? Math.abs(ballCount - target) : null
  const finishedDiffColor =
    finishedDiff === null ? theme.text : diffToColor(finishedDiff)
  const hasBestNumber = bestDiff !== null
  const bestNumberColor = hasBestNumber ? bestDiffToColor(bestDiff as number) : "#10b981"

  // STOP moment feedback (near-miss + perfect)
  const stopIsPerfect = stopDiff !== null && stopDiff === 0
  const stopIsClose = stopDiff !== null && stopDiff > 0 && stopDiff <= 3
  const stopIsMedium = stopDiff !== null && stopDiff > 3 && stopDiff <= 5
  const stopIsFar = stopDiff !== null && stopDiff > 5

  const stopPulseColor = stopIsPerfect
    ? "#16a34a"
    : stopIsClose
    ? "#2a9d8f"
    : stopIsMedium
    ? "#e9c46a"
    : theme.text

  useEffect(() => {
    if (!feedbackMessage) {
      setShowFeedback(false)
      return
    }

    setShowFeedback(true)

    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current)
      feedbackTimeoutRef.current = null
    }

    feedbackTimeoutRef.current = setTimeout(() => {
      setShowFeedback(false)
      feedbackTimeoutRef.current = null
    }, 2000)

    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current)
        feedbackTimeoutRef.current = null
      }
    }
  }, [feedbackMessage])

  const liveCountForJar = isCounting ? countDisplay : ballCount
  const jarProximityGlow =
    (running || isCounting) && !gameOver && liveCountForJar >= target - 10

  const showDropPulse =
    !running && !gameOver && !isCounting && !isStopping

  const dropButtonClassName =
    "w-full max-w-full rounded-2xl py-4 text-base font-semibold shadow-lg transition duration-200 ease-out will-change-transform touch-manipulation " +
    (isCounting || isStopping
      ? "cursor-default bg-gradient-to-r from-slate-400 to-slate-600 text-white/90 active:scale-100 "
      : gameOver
        ? "bg-gradient-to-r from-teal-400 to-teal-600 text-white active:scale-[0.97] hover:brightness-[1.03] "
        : running
          ? "bg-gradient-to-r from-rose-400 to-red-600 text-white active:scale-[0.97] hover:brightness-[1.03] "
          : "bg-gradient-to-r from-teal-400 to-teal-600 text-white active:scale-[0.97] hover:brightness-[1.03] ") +
    (showDropPulse ? "orbifall-drop-btn-pulse " : "")

  const diffStatAbs =
    diffRevealVisible && gameFinished
      ? Math.abs(ballCount - target)
      : null

  const glassShadowBase = darkMode
    ? "inset 2px 0 0 rgba(255,255,255,0.06), inset -2px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.2), inset 0 -10px 14px rgba(0,0,0,0.15), 0 12px 30px rgba(0,0,0,0.22)"
    : "inset 4px 0 0 rgba(110,110,110,0.40), inset -4px 0 0 rgba(110,110,110,0.40), inset 0 -1px 0 rgba(70,70,70,0.26), inset 0 -10px 14px rgba(0,0,0,0.05), inset 0 -26px 26px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.03), 0 12px 30px rgba(0,0,0,0.08)"
  const glassJarProximityGlow = jarProximityGlow
    ? darkMode
      ? ", 0 0 0 1px rgba(251, 191, 36, 0.2), 0 0 36px rgba(234, 88, 12, 0.16)"
      : ", 0 0 0 2px rgba(251, 146, 60, 0.2), 0 0 32px rgba(251, 146, 60, 0.2)"
    : ""

  return (

    <div
      ref={shakeRef}
      className="flex min-h-0 w-full max-w-[420px] flex-col items-center max-[480px]:px-0.5"
      style={{
        position:"relative",
        zIndex:0,
        width:"100%",
        maxWidth:"100%",
        padding: isCompact ? "2px 4px 0" : "0",
        touchAction: isCompact ? "manipulation" : undefined,
        overflow: isCompact ? "hidden" : undefined
      }}
    >
      <div
        className="relative flex w-full flex-col items-center overflow-hidden"
        style={{
          paddingBottom: isCompact
            ? "max(4px, var(--orbifall-game-bottom-pad, 8px))"
            : "max(8px, var(--orbifall-game-bottom-pad, 40px))"
        }}
      >

     <div
       ref={perfectBurstContainerRef}
       aria-hidden="true"
       style={{
         position:"absolute",
         inset:0,
         pointerEvents:"none",
         zIndex:4
       }}
     />

     <div
       ref={rewardBurstContainerRef}
       aria-hidden="true"
       style={{
         position:"absolute",
         inset:0,
         pointerEvents:"none",
         zIndex:4
       }}
     />

      {/* Top chrome — compact app-style header */}
      <div
        className={
          "mx-auto mb-1 flex w-full max-w-md flex-col gap-2 rounded-xl border border-black/[0.06] bg-white/80 p-2 shadow-sm backdrop-blur-md max-[480px]:mb-0 max-[480px]:gap-1.5 max-[480px]:p-1.5 dark:border-white/[0.08] dark:bg-neutral-900/80 sm:mb-1.5 sm:gap-2 sm:p-2.5"
        }
      >
        {/* Header: title + streak/actions on one row */}
        <div
          className="flex min-h-[24px] max-h-[80px] max-[480px]:min-h-[20px] items-center justify-between gap-1.5 text-[13px] font-semibold leading-none max-[480px]:gap-1 max-[480px]:text-[12px] sm:min-h-[26px] sm:gap-2 sm:text-sm"
          style={{ color: theme.text }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            {!earthCollectedToday && (
              <span
                ref={earthIconRef}
                aria-hidden="true"
                style={{
                  width: `${EARTH_DIAMETER}px`,
                  height: `${EARTH_DIAMETER}px`,
                  borderRadius: "50%",
                  display: "inline-block",
                  flexShrink: 0,
                  backgroundImage: `url("${EARTH_TEXTURE_DATA_URI}")`,
                  backgroundSize: "cover",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.22), inset -2px -3px 4px rgba(0,0,0,0.28)",
                  border: "1px solid rgba(255,255,255,0.55)"
                }}
              />
            )}
            <span className="truncate tracking-tight" style={{ color: theme.text }}>
              Orbidrop #{dayNumber}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 max-[480px]:gap-0.5">
            <div
              className="text-[13px] font-semibold max-[480px]:text-[12px] sm:text-sm"
              style={{ color: theme.muted }}
            >
              🔥 {stats.streak}
            </div>
            {gameOver && (
              <button
                type="button"
                onClick={() => {
                  setStatsDismissed(false)
                  setStatsAutoOpened(true)
                  setShowStats(true)
                }}
                aria-label="Show your stats"
                style={{
                  width: isCompact ? "32px" : "28px",
                  height: isCompact ? "32px" : "28px",
                  borderRadius: "999px",
                  border: "none",
                  background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isCompact ? "15px" : "14px",
                  cursor: "pointer",
                  color: theme.muted,
                  boxShadow: "none"
                }}
              >
                📊
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowRules(true)}
              aria-label="Show how to play"
              style={{
                width: isCompact ? "32px" : "28px",
                height: isCompact ? "32px" : "28px",
                borderRadius: "999px",
                border: "none",
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isCompact ? "14px" : "13px",
                fontWeight: 700,
                cursor: "pointer",
                color: theme.muted,
                boxShadow: "none"
              }}
            >
              i
            </button>
          </div>
        </div>

        {/* Target (primary) + Rounds (secondary) — full-width pill, tight vertical rhythm */}
        <div
          className={
            "w-full rounded-xl border border-black/[0.06] bg-white/90 px-1.5 py-1.5 shadow-sm sm:px-2 sm:py-1.5 dark:border-white/10 dark:bg-black/25"
          }
        >
          <div className="flex w-full flex-col items-center gap-0.5">
            {/* Primary: target — spans inner width */}
            <div
              className={
                (running && !isCounting && !gameOver ? "orbifall-target--live " : "") +
                "flex w-full items-center justify-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border px-5 py-2 font-extrabold leading-none tracking-tight max-[480px]:gap-1.5 max-[480px]:px-3 max-[480px]:py-1 sm:px-6 sm:py-2.5 " +
                (isCompact ? "text-[15px] sm:text-[17px]" : "text-[17px] sm:text-lg") +
                " " +
                (darkMode
                  ? "border-white/[0.11] text-neutral-100"
                  : "border-black/[0.07] text-neutral-900")
              }
              style={{
                background:
                  stopPulse && stopDiff !== null && stopDiff <= 5
                    ? stopIsClose
                      ? darkMode
                        ? `linear-gradient(to bottom, ${hexToRgba(stopPulseColor, 0.2)} 0%, ${hexToRgba(
                            stopPulseColor,
                            0.08
                          )} 70%)`
                        : `linear-gradient(to bottom, ${hexToRgba(stopPulseColor, 0.14)} 0%, ${hexToRgba(
                            stopPulseColor,
                            0.06
                          )} 70%)`
                      : darkMode
                      ? `linear-gradient(to bottom, ${hexToRgba(stopPulseColor, 0.14)} 0%, ${hexToRgba(
                          stopPulseColor,
                          0.06
                        )} 70%)`
                      : `linear-gradient(to bottom, ${hexToRgba(stopPulseColor, 0.1)} 0%, ${hexToRgba(
                          stopPulseColor,
                          0.04
                        )} 70%)`
                    : darkMode
                    ? "linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.04))"
                    : "linear-gradient(to bottom, rgba(255,255,255,0.96), rgba(247,248,250,0.92))",
                boxShadow:
                  stopPulse && stopDiff !== null && stopDiff <= 5
                    ? stopIsPerfect
                      ? `0 0 0 2px ${hexToRgba(stopPulseColor, 0.18)}, 0 3px 12px rgba(0,0,0,0.07)`
                      : stopIsClose
                      ? `0 0 0 2px ${hexToRgba(stopPulseColor, 0.14)}, 0 3px 10px rgba(0,0,0,0.06)`
                      : `0 0 0 2px ${hexToRgba(stopPulseColor, 0.11)}, 0 2px 8px rgba(0,0,0,0.05)`
                    : darkMode
                    ? "0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)"
                    : "0 2px 10px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
                transition: "box-shadow 220ms ease, border-color 220ms ease, background 220ms ease"
              }}
            >
              <span aria-hidden className="shrink-0 text-[0.95em] leading-none opacity-90">
                🎯
              </span>
              <span className="flex min-w-0 shrink-0 items-baseline gap-2">
                <span
                  className={
                    "text-[0.72em] font-medium leading-none text-gray-500 dark:text-neutral-400"
                  }
                >
                  Target
                </span>
                <span className="font-semibold tabular-nums leading-none text-gray-900 dark:text-neutral-100">
                  {target}
                </span>
              </span>
            </div>

            {/* Secondary: rounds — minimal gap under target */}
            <div className="flex w-full flex-col items-center gap-0 pt-0">
              <span
                className={
                  "text-[7px] font-semibold uppercase leading-none tracking-[0.14em] sm:text-[8px] " +
                  (darkMode ? "text-neutral-500" : "text-neutral-400")
                }
              >
                Rounds
              </span>
              <div className="flex items-center justify-center gap-0.5 sm:gap-1">
                {[1, 2, 3].map(i => {
                  const done = attempt > i
                  const active = i === attempt && attempt <= GAME.maxAttempts && !gameOver
                  const showLivePulse = active && !done && running && !isCounting
                  return (
                    <div
                      key={i}
                      className={
                        (showLivePulse ? "orbifall-attempt--live " : "") +
                        "flex size-[15px] shrink-0 items-center justify-center rounded-full border text-[7px] font-semibold transition-all duration-150 sm:size-4 sm:text-[8px] " +
                        (done
                          ? "border-transparent bg-[#2a9d8f] text-white shadow-sm"
                          : active
                          ? darkMode
                            ? "border-teal-400/70 bg-teal-950/45 text-teal-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-teal-400/25"
                            : "border-teal-600/70 bg-teal-50 text-teal-900 shadow-sm ring-1 ring-teal-600/20"
                          : darkMode
                          ? "border-white/10 bg-neutral-900/50 text-neutral-500"
                          : "border-neutral-200/90 bg-white/80 text-neutral-400") +
                        (active && !done && !showLivePulse ? " scale-105" : " scale-100")
                      }
                    >
                      {i}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Stats — equal thirds, tight to rounds */}
        <div
          className={
            "mt-0.5 grid w-full grid-cols-3 gap-1 rounded-xl p-1 max-[480px]:mt-0 max-[480px]:gap-0.5 max-[480px]:p-0.5 sm:gap-1.5 sm:p-1.5 " +
            (darkMode
              ? "border border-white/[0.06] bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
              : "border border-black/[0.05] bg-black/[0.028] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]") +
            " transition-[border-color,box-shadow] duration-200"
          }
          style={{
            borderColor: isCounting ? hexToRgba("#2a9d8f", darkMode ? 0.28 : 0.2) : undefined
          }}
        >

  {/* RESULT */}

  <div
    className="min-w-0 flex min-h-[34px] max-[480px]:min-h-[28px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] max-[480px]:gap-px max-[480px]:px-1 max-[480px]:py-1 sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
    style={{
      background: darkMode
        ? "linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 58%)," +
          theme.card
        : "linear-gradient(to bottom, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.42) 100%)," +
          theme.card,
      border:
        stopPulse && stopDiff !== null && stopDiff <= 5
          ? `1px solid ${hexToRgba(stopPulseColor, darkMode ? 0.38 : 0.30)}`
          : `1px solid ${darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"}`,
      boxShadow:
        stopPulse && stopDiff !== null && stopDiff <= 5
          ? stopIsPerfect
            ? `0 0 0 2px ${hexToRgba(stopPulseColor, 0.16)}, 0 4px 12px rgba(0,0,0,0.05)`
            : `0 0 0 2px ${hexToRgba(stopPulseColor, 0.13)}, 0 4px 12px rgba(0,0,0,0.045)`
          : darkMode
          ? "0 1px 3px rgba(0,0,0,0.32)"
          : "0 1px 3px rgba(0,0,0,0.045)",
      transform: isCounting
        ? "translateY(-2px) scale(1.12)"
        : scoreReveal
        ? stopIsPerfect
          ? "translateY(-2px) scale(1.08)"
          : stopIsClose
          ? "translateY(-1.5px) scale(1.05)"
          : stopIsMedium
          ? "translateY(-1px) scale(1.03)"
          : "scale(1)"
        : "scale(1)",
      transition:
        "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease"
    }}
  >
    <div className="text-[10px] font-medium leading-none text-gray-500 max-[480px]:text-[9px] dark:text-neutral-400 sm:text-[11px]">
      Result
    </div>
    <div
      ref={resultValueRef}
      className="text-base font-semibold tabular-nums leading-none sm:text-[17px]"
      style={{
        color: hasResultNumbers
          ? isCounting
            ? countingDiffColor
            : finishedDiffColor
          : undefined,
        transition: "color 180ms ease"
      }}
    >
      {isCounting ? countDisplay : gameFinished ? ballCount : "–"}
    </div>
  </div>

  {/* DIFF */}

  <div
    className="min-w-0 flex min-h-[34px] max-[480px]:min-h-[28px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] max-[480px]:gap-px max-[480px]:px-1 max-[480px]:py-1 sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
    style={{
      background: darkMode
        ? "linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 58%)," +
          theme.card
        : "linear-gradient(to bottom, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.42) 100%)," +
          theme.card,
      border:
        stopPulse && stopDiff !== null && stopDiff <= 5
          ? `1px solid ${hexToRgba(stopPulseColor, darkMode ? 0.38 : 0.30)}`
          : `1px solid ${darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"}`,
      boxShadow:
        stopPulse && stopDiff !== null && stopDiff <= 5
          ? stopIsPerfect
            ? `0 0 0 2px ${hexToRgba(stopPulseColor, 0.16)}, 0 4px 12px rgba(0,0,0,0.05)`
            : `0 0 0 2px ${hexToRgba(stopPulseColor, 0.13)}, 0 4px 12px rgba(0,0,0,0.045)`
          : darkMode
          ? "0 1px 3px rgba(0,0,0,0.32)"
          : "0 1px 3px rgba(0,0,0,0.045)",
      transform: isCounting
        ? "translateY(-2px) scale(1.12)"
        : scoreReveal
        ? stopIsPerfect
          ? "translateY(-2px) scale(1.08)"
          : stopIsClose
          ? "translateY(-1.5px) scale(1.05)"
          : stopIsMedium
          ? "translateY(-1px) scale(1.03)"
          : "scale(1)"
        : "scale(1)",
      transition:
        "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease"
    }}
  >
    <div className="text-[10px] font-medium leading-none text-gray-500 max-[480px]:text-[9px] dark:text-neutral-400 sm:text-[11px]">
      Diff
    </div>
    <div
      ref={diffValueRef}
      className="text-base font-semibold tabular-nums leading-none sm:text-[17px]"
      style={{
        color:
          diffStatAbs !== null
            ? diffStatDisplayColor(diffStatAbs)
            : hasResultNumbers
            ? theme.text
            : undefined,
        transition: "color 180ms ease"
      }}
    >
      {gameFinished && diffRevealVisible ? ballCount - target : "–"}
    </div>
  </div>

  {/* BEST */}

  <div
    className="min-w-0 flex min-h-[34px] max-[480px]:min-h-[28px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] max-[480px]:gap-px max-[480px]:px-1 max-[480px]:py-1 sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
    style={{
      background: darkMode
        ? "linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 58%)," +
          theme.card
        : "linear-gradient(to bottom, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.42) 100%)," +
          theme.card,
      border:`1px solid ${darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"}`,
      boxShadow: darkMode ? "0 1px 3px rgba(0,0,0,0.32)" : "0 1px 3px rgba(0,0,0,0.045)",
      transition:
        "background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease"
    }}
  >
    <div className="text-[10px] font-medium leading-none text-gray-500 max-[480px]:text-[9px] dark:text-neutral-400 sm:text-[11px]">
      Best
    </div>
    <div
      className="text-base font-semibold tabular-nums leading-none sm:text-[17px]"
      style={{
        color: hasBestNumber
          ? bestNumberColor
          : undefined,
        transition: "color 180ms ease"
      }}
    >
      {bestDiff ?? "–"}
    </div>
  </div>

        </div>
        {/* end stats strip */}

      </div>
      {/* end top control panel */}

        <hr
          style={{
            width:`${playfieldWidth}px`,
            margin:isCompact ? "0px 0" : "1px 0",
            border:"none",
            height:"1px",
            background: darkMode
              ? "linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.06), rgba(255,255,255,0))"
              : "linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.06), rgba(0,0,0,0))"
          }}
        />

      <div
        className={jarShakeActive ? "orbifall-jar-shake-once" : undefined}
        style={{
          width: `${playfieldWidth}px`,
          height: `${playfieldHeight}px`,
          marginTop: isCompact ? "0px" : "2px",
          position: "relative",
          borderRadius: "0 0 16px 16px",
          boxShadow: darkMode
            ? "0 18px 55px rgba(0,0,0,0.35)"
            : "0 18px 55px rgba(0,0,0,0.08)"
        }}
      >
        {/* Slightly darker area behind the glass (background separation). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-18px -10px -14px -10px",
            borderRadius: "18px",
            background: darkMode
              ? "radial-gradient(circle at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.14) 100%)"
              : "radial-gradient(circle at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.035) 100%)",
            filter: "blur(10px)",
            pointerEvents: "none",
            zIndex: 0
          }}
        />

        <div
          className={
            idleJarAtmosphere && !running && !isStopping ? "orbifall-jar-idle-breathe" : undefined
          }
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "0 0 16px 16px",
            overflow: "hidden",
            position: "relative",
            zIndex: 1
          }}
        >
        <div
          ref={glassRef}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "0 0 16px 16px",
            background: theme.glass,
            border: `1px solid ${
              jarProximityGlow
                ? darkMode
                  ? "rgba(251, 191, 36, 0.28)"
                  : "rgba(251, 146, 60, 0.35)"
                : darkMode
                ? "rgba(255,255,255,0.12)"
                : "rgba(0,0,0,0.10)"
            }`,
            overflow: "hidden",
            position: "relative",
            boxShadow: glassShadowBase + glassJarProximityGlow,
          transform:
            stopImpact || dropImpact
              ? "translateY(-1px) scale(1.02)"
              : running && !isCounting
              ? "translateY(-2px) scale(1)"
              : "scale(1)",
          transition:
            "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 220ms ease, box-shadow 320ms ease, border-color 320ms ease"
          }}
        >

          {/* Very light top-edge highlight */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: "18px",
              background: darkMode
                ? "linear-gradient(to bottom, rgba(255,255,255,0.11), rgba(255,255,255,0.00))"
                : "linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0.00))",
              pointerEvents: "none",
              zIndex: 0
            }}
          />

          {/* Subtle inner shadow at the bottom */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "46px",
              background: darkMode
                ? "linear-gradient(to top, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.14) 45%, rgba(0,0,0,0.00) 100%)"
                : "linear-gradient(to top, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.00) 100%)",
              filter: "blur(0.25px)",
              pointerEvents: "none",
              zIndex: 0
            }}
          />

          {/* Faint left/right edge highlight to define the glass shape */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "3px",
              background: darkMode
                ? "linear-gradient(to bottom, rgba(255,255,255,0.12), rgba(255,255,255,0.00) 70%)"
                : "linear-gradient(to bottom, rgba(255,255,255,0.30), rgba(255,255,255,0.00) 70%)",
              pointerEvents: "none",
              zIndex: 0
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "3px",
              background: darkMode
                ? "linear-gradient(to bottom, rgba(255,255,255,0.12), rgba(255,255,255,0.00) 70%)"
                : "linear-gradient(to bottom, rgba(255,255,255,0.30), rgba(255,255,255,255,0.00) 70%)",
              pointerEvents: "none",
              zIndex: 0
            }}
          />

          {/* Thin base line: makes the bottom feel like a settling surface */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "3px",
              background: darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)",
              pointerEvents: "none",
              zIndex: 0
            }}
          />

        {isCounting && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.glassHighlight,
              pointerEvents: "none",
              zIndex: 1,
              opacity: 1,
              transition: "opacity 200ms ease"
            }}
          />
        )}

        <div
          className={
            "pointer-events-none text-center antialiased " +
            (isCompact
              ? "max-w-[min(92%,280px)] text-[0.9375rem] sm:text-[1rem]"
              : "max-w-[min(92%,300px)] text-[1rem] sm:text-[1.0625rem]")
          }
          style={{
            position: "absolute",
            top: "12%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontFamily:
              'var(--font-geist-sans, ui-sans-serif), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            color: darkMode ? "rgba(228, 228, 231, 0.42)" : "rgba(64, 64, 67, 0.45)",
            textShadow: darkMode
              ? "0 1px 2px rgba(0,0,0,0.35)"
              : "0 1px 0 rgba(255,255,255,0.65)",
            zIndex: 2,
            opacity: showFeedback ? 0.92 : 0,
            transition: showFeedback
              ? "opacity 700ms ease"
              : "opacity 120ms ease"
          }}
        >
          {feedbackMessage}
        </div>

        <div
          aria-hidden="true"
          className="orbifall-target-watermark pointer-events-none absolute left-1/2 z-0"
          style={{
            top: "28%",
            fontSize: isCompact ? "118px" : "138px",
            color: theme.feedbackText,
            textShadow: "none",
            letterSpacing: "-0.02em",
            filter: "blur(0.45px)"
          }}
        >
          {target}
        </div>

        <div
          aria-hidden="true"
          style={{
            position:"absolute",
            top:0,
            bottom:0,
            left:0,
            width:"14px",
            background:
              "linear-gradient(to right, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.04) 72%, rgba(255,255,255,0) 100%)",
            pointerEvents:"none"
          }}
        />

        <div
          aria-hidden="true"
          style={{
            position:"absolute",
            top:0,
            bottom:0,
            right:0,
            width:"14px",
            background:
              "linear-gradient(to left, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.04) 72%, rgba(255,255,255,0) 100%)",
            pointerEvents:"none"
          }}
        />

        <div
          ref={sceneRef}
          style={{
            width: "100%",
            height: "100%"
          }}
        />

        {/* After 3rd try: show once stats modal has opened; keep until next day (gameOver clears). */}
        {gameOver && (showStats || statsDismissed) && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 z-[6] max-w-[min(94%,300px)] -translate-x-1/2 px-4 py-2 text-center text-[12px] font-semibold leading-tight tracking-tight sm:text-[13px] sm:px-5 sm:py-2.5"
            style={{
              top: "6%",
              color: theme.text,
              borderRadius: "999px",
              background: darkMode
                ? "linear-gradient(180deg, rgba(42,42,42,0.92) 0%, rgba(24,24,24,0.88) 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(248,250,252,0.94) 100%)",
              border: darkMode
                ? "1px solid rgba(255,255,255,0.14)"
                : "1px solid rgba(0,0,0,0.1)",
              boxShadow: darkMode
                ? "0 4px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset"
                : "0 4px 18px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.8) inset"
            }}
          >
            New challenge in{" "}
            <span
              className="font-bold tabular-nums tracking-wide"
              style={{ color: "#2a9d8f", textShadow: darkMode ? "0 0 20px rgba(42,157,143,0.35)" : "none" }}
            >
              {timeLeft || "–"}
            </span>
          </div>
        )}

        <div
          aria-hidden="true"
          style={{
            position:"absolute",
            left:0,
            right:0,
            bottom:0,
            height:"14%",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.028) 38%, rgba(0,0,0,0) 100%)",
            pointerEvents:"none",
            zIndex: 1
          }}
        />

        </div>
        </div>
      </div>

      </div>

      <div className="mt-2 flex w-full shrink-0 justify-center px-0.5">
      <button
        className={dropButtonClassName}
        onClick={() => {
          triggerActionButtonFeedback()
      if (gameOver) {
        void shareResult()
        return
      }
          if (running) {
            stopGame()
          } else {
            startGame()
          }
        }}
        onPointerDown={() => {
          if (isCounting || isStopping) return
          // Haptic at touch start maximizes mobile support (user-gesture context)
          if (gameOver) triggerHaptic("press")
          else if (running) triggerHaptic("stop")
          else triggerHaptic("press")
          triggerActionButtonFeedback()
        }}
        onPointerUp={() => {}}
        onPointerCancel={() => setActionButtonPressed(false)}
        onPointerLeave={() => setActionButtonPressed(false)}
        onMouseEnter={() => setActionButtonHovered(true)}
        onMouseLeave={() => {
          setActionButtonHovered(false)
          setActionButtonPressed(false)
        }}
        disabled={isCounting || isStopping}
        style={{
          border: "none",
          transform: actionButtonPressed
            ? "scale(0.97)"
            : actionButtonHovered && !isCounting && !isStopping
              ? "scale(1.01)"
              : undefined,
        }}
      >
        {gameOver
          ? "Share result"
          : running
            ? "STOP"
            : isStopping
              ? "STOP"
              : "DROP"}
      </button>
      </div>

      {gameOver && showStats && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position:"fixed",
            inset:0,
            width:"100vw",
            height:"100dvh",
            minHeight:"100vh",
            background: theme.overlay,
            display:"flex",
            alignItems:"flex-start",
            justifyContent:"center",
            paddingTop: isSmallScreen
              ? "calc(16vh + env(safe-area-inset-top))"
              : "calc(18vh + env(safe-area-inset-top))",
            zIndex:10000
          }}
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            setShowStats(false)
            setStatsDismissed(true)
          }}
        >

          <div
            style={{
              background: theme.modal,
              color: theme.modalText,
              padding:"26px 26px 24px",
              borderRadius:"16px",
              textAlign:"center",
              width:"340px",
              boxShadow: darkMode ? "0 15px 50px rgba(0,0,0,0.6)" : "0 15px 50px rgba(0,0,0,0.35)",
              position:"relative",
              opacity: statsPopUpReady ? 1 : 0,
              transform: statsPopUpReady ? "translateY(0px)" : "translateY(10px)",
              transition:"opacity 650ms ease, transform 650ms ease"
            }}
          >

            <button
              type="button"
              onClick={() => {
                setShowStats(false)
                setStatsDismissed(true)
              }}
              aria-label="Close stats"
              style={{
                position:"absolute",
                top:"calc(8px + env(safe-area-inset-top))",
                right:"calc(8px + env(safe-area-inset-right))",
                width:"34px",
                height:"34px",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                border:"none",
                background:"transparent",
                cursor:"pointer",
                fontSize:"18px",
                lineHeight:1,
                color: theme.modalText
              }}
            >
              ×
            </button>

            <h2 style={{marginTop:"4px", color: theme.modalText}}>🎉 Game finished!</h2>
             <p style={{marginTop:"10px", color: theme.modalText}}>
              ⭐Best diff:{" "}
              <b>{statsModalBestDiff !== null ? statsModalBestDiff : "–"}</b>
            </p>
            {percentile && (
              <p style={{ color: theme.modalText }}>
                🌍You beat <b>{percentile}%</b> of players today
              </p>
            )}

             <h3
  style={{
    marginTop:"20px",
    borderBottom: `2px solid ${theme.border}`,
    paddingBottom:"6px",
    color: theme.modalText
  }}
>
  Your all-time stats
</h3>

           
<div
  style={{
    marginTop:"18px",
    display:"grid",
    gridTemplateColumns:"1fr 1fr",
    gap:"10px",
    fontSize:"14px"
  }}
>

  <div style={{ color: theme.modalText }}>
    <strong>🎮 Played</strong>
    <div>{stats.played}</div>
  </div>

  <div style={{ color: theme.modalText }}>
    <strong>🏆 Best</strong>
    <div>{stats.best ?? "-"}</div>
  </div>
  

  <div>
    <strong>📊 Avg diff</strong>
    <div
      style={{
        color:
          averageDiff !== "-" && Number(averageDiff) <= 2
            ? "#2a9d8f"
            : averageDiff !== "-" && Number(averageDiff) <= 5
            ? "#e9c46a"
            : "#e63946"
      }}
    >
      {averageDiff}
    </div>
  </div>

  <div style={{ color: theme.modalText }}>
    <strong>🔥 Streak</strong>
    <div>{stats.streak}</div>
  </div>

  <div style={{ color: theme.modalText }}>
    <strong>🌍 Global Orbs</strong>
    <div>{stats.earthCollected}</div>
  </div>

  <div>
    <strong>🌍 Global today</strong>
    <div style={{color: earthCollectedToday ? "#2a9d8f" : isEarthDropPlayerToday ? "#e9c46a" : theme.modalMuted}}>
      {earthCollectedToday
        ? "Collected (you)"
        : isEarthDropPlayerToday
        ? "Available for you"
        : "Not assigned to you"}
    </div>
  </div>

  <div
  style={{
    gridColumn:"1 / span 2",
    textAlign:"center",
    color: theme.modalText
  }}
>
  <strong>⭐ Max streak</strong>
  <div>{stats.maxStreak}</div>
</div>

</div>

            

            <button
              onClick={shareResult}
              style={{
                marginTop:"18px",
                padding:"12px 26px",
                borderRadius:"10px",
                border:"none",
                backgroundImage:"linear-gradient(180deg, #39b2a2 0%, #2a9d8f 100%)",
                background:"#2a9d8f",
                color:"white",
                cursor:"pointer",
                boxShadow:"0 10px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.22)",
                fontSize:"16px"
              }}
            >
              Share result
            </button>

            <p style={{marginTop:"16px",fontSize:"14px",color: theme.modalMuted,fontWeight:"bold"}}>
              New challenge in {timeLeft}
            </p>

          </div>

        </div>,
        document.body
      )}

      {showEarthWin && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position:"fixed",
            inset:0,
            width:"100vw",
            height:"100dvh",
            minHeight:"100vh",
            background: theme.overlay,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            zIndex:10000,
            padding:"max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))"
          }}
        >
          <div
            style={{
              background: theme.modal,
              color: theme.modalText,
              padding:"22px 22px 18px",
              borderRadius:"16px",
              textAlign:"center",
              width:"340px",
              boxShadow: darkMode ? "0 15px 50px rgba(0,0,0,0.6)" : "0 15px 50px rgba(0,0,0,0.35)",
              position:"relative"
            }}
          >
            <button
              type="button"
              onClick={() => setShowEarthWin(false)}
              aria-label="Close Global Orb popup"
              style={{
                position:"absolute",
                top:"calc(10px + env(safe-area-inset-top))",
                right:"calc(10px + env(safe-area-inset-right))",
                border:"none",
                background:"transparent",
                cursor:"pointer",
                fontSize:"18px",
                lineHeight:1,
                color: theme.modalText
              }}
            >
              ×
            </button>

            <div style={{fontSize:"34px", marginTop:"2px"}}>🌍</div>
            <h3 style={{margin:"8px 0 6px", color: theme.modalText}}>Lucky drop!</h3>
            <p style={{margin:"0 0 12px", color: theme.modalMuted}}>
              You collected today&apos;s <b>Global Orb</b>!
            </p>

            <button
              onClick={shareEarthWin}
              style={{
                marginTop:"6px",
                padding:"12px 18px",
                borderRadius:"10px",
                border:"none",
                background:"#2563eb",
                color:"white",
                cursor:"pointer",
                fontSize:"15px",
                fontWeight:700,
                width:"100%"
              }}
            >
              Share Global Orb win
            </button>
          </div>
        </div>,
        document.body
      )}

      {showRules && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position:"fixed",
            inset:0,
            width:"100vw",
            height:"100dvh",
            minHeight:"100vh",
            background: theme.overlay,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            zIndex:10000,
            padding:"max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))"
          }}
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            localStorage.setItem(ORBIFALL_RULES_SEEN_KEY, "true")
            setShowRules(false)
          }}
        >

          <div
            style={{
              background: theme.modal,
              color: theme.modalText,
              padding:"24px 22px 20px",
              borderRadius:"18px",
              textAlign:"left",
              maxWidth:"360px",
              width:"100%",
              boxShadow: darkMode ? "0 18px 55px rgba(0,0,0,0.6)" : "0 18px 55px rgba(0,0,0,0.45)",
              fontSize:"14px",
              lineHeight:1.5,
              opacity: rulesPopUpReady ? 1 : 0,
              transform: rulesPopUpReady ? "translateY(0px)" : "translateY(10px)",
              transition:"opacity 650ms ease, transform 650ms ease"
            }}
          >
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h2 style={{margin:0,fontSize:"18px", color: theme.modalText}}>How Orbidrop works</h2>
              <button
                onClick={() => {
                  localStorage.setItem(ORBIFALL_RULES_SEEN_KEY, "true")
                  setShowRules(false)
                }}
                aria-label="Close"
                style={{
                  border:"none",
                  background:"transparent",
                  cursor:"pointer",
                  fontSize:"18px",
                  lineHeight:1,
                  color: theme.modalText,
                  width:"34px",
                  height:"34px",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center"
                }}
              >
                ×
              </button>
            </div>

            <div style={{marginTop:"14px",display:"grid",gap:"10px", color: theme.modalText}}>
              <div>
                <div style={{fontWeight:700}}>🎯 Goal</div>
                <div>Hit the Target number as closely as possible.</div>
              </div>

              <div>
                <div style={{fontWeight:700}}>▶️ DROP</div>
                <div>Start the flow of orbs.</div>
              </div>

              <div>
                <div style={{fontWeight:700}}>✋ STOP</div>
                <div>Stop when you think you&apos;ll land on the Target.</div>
              </div>

              <div>
                <div style={{fontWeight:700}}>📏 Diff</div>
                <div>How far you are from the Target. Lower is better.</div>
              </div>

              <div>
                <div style={{fontWeight:700}}>🎮 3 attempts</div>
                <div>You get 3 tries per day. Best Diff counts.</div>
              </div>

              <div>
                <div style={{fontWeight:700}}>🌍 Global Orb (rare)</div>
                <div>One random player per day gets a special Global Orb worth +1.</div>
              </div>
            </div>

            <button
              onClick={() => {

                localStorage.setItem(ORBIFALL_RULES_SEEN_KEY, "true")
                setShowRules(false)

              }}
              style={{
                marginTop:"16px",
                padding:"10px 22px",
                borderRadius:"10px",
                border:"none",
                background:"#2a9d8f",
                color:"white",
                cursor:"pointer",
                fontSize:"15px",
                fontWeight:600,
                width:"100%"
              }}
            >
              Got it, let&apos;s play
            </button>

          </div>

        </div>,
        document.body
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={
              "fixed z-[2500] flex gap-2 opacity-80 " +
              (isSmallScreen
                ? "bottom-[calc(3rem+env(safe-area-inset-bottom))] right-3"
                : "bottom-6 right-6")
            }
          >
            <button
              type="button"
              onClick={() => setDarkMode(prev => !prev)}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className="flex size-7 items-center justify-center rounded-full border-0 text-[11px] shadow-sm transition hover:opacity-100 sm:size-8 sm:text-xs"
              style={{
                background: darkMode
                  ? hexToRgba("#374151", 0.72)
                  : hexToRgba(theme.buttonMuted, 0.78),
                color: darkMode ? "rgba(229, 229, 229, 0.92)" : theme.muted
              }}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <button
              type="button"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setSoundEnabled(prev => !prev)
              }}
              onPointerDown={e => e.stopPropagation()}
              aria-label={
                soundEnabled
                  ? "Turn sound effects off"
                  : "Turn sound effects on"
              }
              className="flex size-7 items-center justify-center rounded-full border-0 text-[11px] shadow-sm transition hover:opacity-100 sm:size-8 sm:text-xs"
              style={{
                background: soundEnabled
                  ? hexToRgba("#2a9d8f", 0.82)
                  : hexToRgba(theme.buttonMuted, 0.78),
                color: soundEnabled ? "rgba(255,255,255,0.94)" : theme.muted,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent"
              }}
            >
              {soundEnabled ? "🔊" : "🔇"}
            </button>
          </div>,
          document.body
        )}

    </div>

  )
}