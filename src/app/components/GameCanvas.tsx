"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as Matter from "matter-js"

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
  startDate: "2024-01-01",
  minTarget: 80,
  targetRange: 80,
  maxAttempts: 3
} as const

/** Web Audio peak gain multiplier — applied to all SFX (capped per layer to limit clipping). */
const SFX_GAIN_MUL = 1.75

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
const ORBIFALL_HOME_SCREEN_PROMPT_KEY = "orbifallHomeScreenPromptDismissed"
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
  limitReached?: unknown
}): number {
  const completed = Math.min(
    GAME.maxAttempts,
    Number(peekData?.completedAttempts ?? 0)
  )
  const limitReached =
    peekData?.limitReached === true || completed >= GAME.maxAttempts
  if (limitReached) return GAME.maxAttempts + 1
  return Math.min(GAME.maxAttempts + 1, completed + 1)
}

function getDiffDaysSinceStart(today = new Date()) {
  const start = new Date(GAME.startDate)
  return Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
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
  if (absDiff <= 5) return "#16a34a"
  if (absDiff <= 20) return "#ea580c"
  return "#dc2626"
}

function diffToColor(diff: number) {
  // "Very close" should read as green up to diff <= 3.
  if (diff === 0) return "#16a34a"
  if (diff <= 3) return "#2a9d8f"
  // Medium: yellow/orange band.
  if (diff <= 6) return "#e9c46a"
  if (diff <= 10) return "#f4a261"
  return "#e63946"
}

function bestDiffToColor(diff: number) {
  // Distinct palette for the Best box (feels "achievements" oriented)
  if (diff <= 3) return "#16a34a"
  if (diff <= 6) return "#2a9d8f"
  if (diff <= 10) return "#457b9d"
  return "#e63946"
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
  /** True only after finishing the 3rd try this session — hides glass countdown until stats are dismissed. Reload clears this so hydrated "game over" still shows the countdown. */
  const [glassCountdownBlocked, setGlassCountdownBlocked] = useState(false)
  // Auto-open stats once when the game finishes.
  // After the user closes, the STATS button is spam-locked via statsDismissed.
  const [statsAutoOpened, setStatsAutoOpened] = useState(false)
  const [showEarthWin, setShowEarthWin] = useState(false)
  const [stopImpact, setStopImpact] = useState(false)
  const [dropImpact, setDropImpact] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [idleJarAtmosphere, setIdleJarAtmosphere] = useState(false)
  const [jarShakeActive, setJarShakeActive] = useState(false)
  const [homeScreenPromptDismissed, setHomeScreenPromptDismissed] = useState(false)
  const [homeScreenPromptReady, setHomeScreenPromptReady] = useState(false)
  const [statsPopUpReady, setStatsPopUpReady] = useState(false)
  const [rulesPopUpReady, setRulesPopUpReady] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  const [stopDiff, setStopDiff] = useState<number | null>(null)
  const [stopPulse, setStopPulse] = useState(false)
  const [perfectBurstId, setPerfectBurstId] = useState(0)
  const [rewardBurstId, setRewardBurstId] = useState(0)
  // Compact sizing for phones (keeps the layout balanced without scrolling).
  const isCompact = isSmallScreen

  // Supabase is configured via .env.local. Even if env values aren't exposed to the client,
  // the API routes may still work; we'll attempt Supabase syncing and gracefully fall back.
  const supabaseEnabled = true

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

  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastBounceAtRef = useRef<number>(0)
  const lastHapticAtRef = useRef<number>(0)
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const actionButtonPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumeAttemptInFlightRef = useRef(false)

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

    if (ctx.state === "suspended") {
      ctx.resume().then(() => fn(ctx)).catch(() => {})
      return
    }

    fn(ctx)
  }

  useEffect(() => {
    setHomeScreenPromptDismissed(getStorageItem(ORBIFALL_HOME_SCREEN_PROMPT_KEY) === "true")
    setHomeScreenPromptReady(true)
  }, [])

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

  const playClickSound = () => {
    withAudioContext(ctx => {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = "triangle"
      osc.frequency.setValueAtTime(560, now)
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.04)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(Math.min(0.12, 0.05 * SFX_GAIN_MUL), now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.07)
    })
  }

  const playStopImpactSound = () => {
    // A soft, short "thump" to make STOP feel impactful.
    withAudioContext(ctx => {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = "sine"
      osc.frequency.setValueAtTime(260, now)
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.05)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(Math.min(0.12, 0.045 * SFX_GAIN_MUL), now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.10)
    })
  }

  const playBounceSound = () => {
    const nowMs = performance.now()
    if (nowMs - lastBounceAtRef.current < 70) return
    if (!soundEnabledRef.current) return
    lastBounceAtRef.current = nowMs

    withAudioContext(ctx => {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = "sine"
      const base = 180 + Math.random() * 120
      osc.frequency.setValueAtTime(base, now)
      osc.frequency.exponentialRampToValueAtTime(base * 0.7, now + 0.03)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(Math.min(0.1, 0.035 * SFX_GAIN_MUL), now + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.045)
    })
  }

  const playSuccessSound = () => {
    withAudioContext(ctx => {
      const now = ctx.currentTime

      const freqs = [660, 880, 990]
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "triangle"
        osc.frequency.setValueAtTime(f, now + i * 0.06)

        gain.gain.setValueAtTime(0.0001, now + i * 0.06)
        gain.gain.exponentialRampToValueAtTime(
          Math.min(0.11, 0.06 * SFX_GAIN_MUL),
          now + i * 0.06 + 0.01
        )
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.12)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + i * 0.06)
        osc.stop(now + i * 0.06 + 0.14)
      })
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

  const [target] = useState(getDailyTarget())
  const [dayNumber] = useState(getDayNumber())

  const [attempt, setAttempt] = useState(1)
  const [attemptResults, setAttemptResults] = useState<number[]>([])
  const [bestDiff, setBestDiff] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats>({
    played: 0,
    best: null,
    totalDiff: 0,
    streak: 0,
    maxStreak: 0,
    lastPlayed: "",
    earthCollected: 0
  })

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

        if (statsData?.stats) setStats(statsData.stats as Stats)

        if (!peekRes.ok) return

        setAttempt(attemptFromPeekPayload(peekData))
      } catch {
        // ignore
      }
    }

    run()
  }, [todayKey])

  const gameOver = attempt > GAME.maxAttempts

  useEffect(() => {
    if (!gameOver) setGlassCountdownBlocked(false)
  }, [gameOver])

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

  useEffect(() => {
    if (!gameOver || bestDiff === null) return

    const diff = bestDiff
    const today = getLocalDateKey()

    setStats(prev => {
      const newStats: Stats = {
        played: prev.played + 1,
        best: prev.best === null ? diff : Math.min(prev.best, diff),
        totalDiff: prev.totalDiff + diff,
        streak: prev.streak + 1,
        maxStreak: Math.max(prev.maxStreak, prev.streak + 1),
        lastPlayed: today,
        earthCollected: prev.earthCollected
      }

      localStorage.setItem("orbifallStats", JSON.stringify(newStats))
      return newStats
    })
  }, [gameOver, bestDiff])

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

    const onCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
      const pairs = event.pairs || []
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]
        const { bodyA, bodyB } = pair
        const dynamic = bodyA === ground ? bodyB : bodyB === ground ? bodyA : null
        if (!dynamic || dynamic.isStatic) continue
        if ((dynamic as Matter.Body & { orbifallIdleDecor?: boolean }).orbifallIdleDecor) continue
        // No sound for sleeping / settled piles — only real impacts while moving.
        if (dynamic.isSleeping) continue
        const { x: vx, y: vy } = dynamic.velocity
        const speedSq = vx * vx + vy * vy
        if (speedSq < 2.56) continue
        const collision = pair.collision
        if (collision?.normal) {
          const nx = collision.normal.x
          const ny = collision.normal.y
          const approach = Math.abs(vx * nx + vy * ny)
          if (approach < 0.85 && speedSq < 12) continue
        }
        playBounceSound()
        break
      }
    }

    Matter.Events.on(engine, "collisionStart", onCollisionStart)

    return () => {
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
  if (supabaseEnabled) return

  const savedStats = localStorage.getItem("orbifallStats")

  if (savedStats !== null) {
    const parsed = JSON.parse(savedStats) as Partial<Stats>
    setStats(prev => ({
      ...prev,
      ...parsed,
      earthCollected: parsed.earthCollected ?? prev.earthCollected
    }))
  }

}, [])

useEffect(() => {

  const seenRules = localStorage.getItem("orbifallRulesSeen")

  if (!seenRules) {
    setShowRules(true)
  }

}, [])

  const spawnBall = () => {

    if (!engineRef.current) return

    // Base radii +~18% vs prior small-orbs pass → ~60% jar fill at TARGET; still scaled by daily TARGET.
    const baseR = isSmallScreen ? Math.random() * 4.7 + 8.3 : Math.random() * 5.3 + 10
    const radius = baseR * orbRadiusScaleForTarget(target)

    const baseColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
    const brightnessDelta = Math.floor(Math.random() * 24) - 10
    const ballOpacity = 0.92 + Math.random() * 0.08

    // Shaded "3D-ish" texture (cached) for less-flat-looking balls.
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
        okToStart = quotaApiServerError
      } else if (data?.limitReached === true) {
        setAttempt(GAME.maxAttempts + 1)
        okToStart = false
      } else {
        const used = Number(data?.attemptsUsed ?? 0)
        setAttempt(Math.min(GAME.maxAttempts, Math.max(1, used)))
        okToStart = true
      }
    } catch {
      okToStart = true
    } finally {
      consumeAttemptInFlightRef.current = false
    }

    if (!okToStart) return
    if (running || gameOver || isCounting || isStopping) return

    // Impact moment for DROP
    setDropImpact(true)
    setTimeout(() => setDropImpact(false), 320)

    playClickSound()
    triggerHaptic("press") // fallback for keyboard
    setGameFinished(false)
    setStopDiff(null)
    setStopPulse(false)
    setScoreReveal(false)
    setStopImpact(false)
    setIsCounting(false)
    setCountDisplay(0)
    earthWonThisRunRef.current = false

    hasPressedDropRef.current = true
    clearIdleDecorBalls()
    resetBalls()

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
          localStorage.setItem("orbifallStats", JSON.stringify(next))
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
      .then(r => r.json())
      .catch(() => null)

    setStopDiff(diff)
    setStopPulse(false)

    // Haptics + sound on STOP (stronger when close/perfect)
    if (isPerfect) triggerHaptic("perfect")
    else if (diff <= 3) triggerHaptic("near")
    else triggerHaptic("stop")

    playStopImpactSound()

    // Smooth slow-down -> settle -> reveal
    const rampDownMs = 175 // 150-250ms target
    const settleHoldMs = 25 // delay before result reveal
    const popMs = 175 // fade/pop duration
    const revealAtMs = rampDownMs + settleHoldMs
    const settleBoostMs = 120

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
      // Reveal + feedback while balls are visually settling.
      setIsCounting(false)
      setCountDisplay(finalCount)
      setGameFinished(true)
      setAttemptResults(prev => [...prev, diff])
      setBestDiff(prev => (prev === null ? diff : Math.min(prev, diff)))

      // Persist this attempt + sync rounds from server (peek is source of truth for UI).
      submitAttemptPromise?.then(async (data: any) => {
        if (!data) return
        if (data?.ok) {
          const completed = Number(data.attemptsUsed ?? 0)
          const nextSlot = Math.min(GAME.maxAttempts + 1, completed + 1)
          setAttempt(nextSlot)
          if (nextSlot > GAME.maxAttempts) setGlassCountdownBlocked(true)

          if (typeof data.bestDiff === "number") {
            setBestDiff(data.bestDiff)
          }

          if (data.isDayComplete) {
            fetch(`/api/player-stats`, { credentials: "include" })
              .then(r => r.json())
              .then(statsRes => {
                if (statsRes?.stats) {
                  setStats(prev => {
                    const serverStats = statsRes.stats as Stats
                    return {
                      ...serverStats,
                      earthCollected: Math.max(prev.earthCollected, serverStats.earthCollected ?? 0)
                    }
                  })
                }
              })
              .catch(() => {})
          }
        } else if (typeof data.attemptsUsed === "number") {
          const completed = Number(data.attemptsUsed)
          setAttempt(Math.min(GAME.maxAttempts + 1, completed + 1))
        }

        try {
          const peekRes = await fetch(
            `/api/daily-attempts?date=${encodeURIComponent(todayKey)}&peek=true`,
            { credentials: "include" }
          )
          if (peekRes.ok) {
            const peekData = await peekRes.json()
            setAttempt(attemptFromPeekPayload(peekData))
          }
        } catch {
          // ignore
        }
      })

      if (isPerfect) setPerfectBurstId(prev => prev + 1)
      // Small “dopamine” burst for diff 1..5 (very light, not noisy).
      if (!isPerfect && diff <= 5) setRewardBurstId(prev => prev + 1)

      if (diff <= 3) {
        playSuccessSound()
        if (isPerfect) window.setTimeout(() => playSuccessSound(), 70)
      }

      // Visual reward only for decent results (diff <= 5).
      setStopPulse(diff <= 5)
      setScoreReveal(true)

      window.setTimeout(() => {
        setScoreReveal(false)
        setStopPulse(false)
        setIsStopping(false)
      }, popMs)

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
        setStatsDismissed(false)
        setStatsAutoOpened(true)
        setShowStats(true)
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
    isEarthDropPlayerToday
  ])

  useEffect(() => {
    if (!scoreReveal) return
    const diff = stopDiff
    const perf =
      diff === 0
        ? "perfect"
        : diff !== null && diff <= 3
        ? "close"
        : diff !== null && diff <= 10
        ? "medium"
        : "far"

    // Smooth, natural appearance: 0.95 -> (tiny overshoot) -> 1.0
    const startScale = 0.95
    const overScale = perf === "perfect" ? 1.06 : perf === "close" ? 1.035 : perf === "medium" ? 1.015 : 1.01

    const elResult = resultValueRef.current
    const elDiff = diffValueRef.current
    elResult?.animate(
      [
        { opacity: 0, transform: `translateY(4px) scale(${startScale})` },
        { opacity: 1, transform: `translateY(0px) scale(${overScale})` },
        { opacity: 1, transform: "translateY(0px) scale(1)" }
      ],
      { duration: 170, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "forwards" }
    )
    elDiff?.animate(
      [
        { opacity: 0, transform: `translateY(4px) scale(${startScale})` },
        { opacity: 1, transform: `translateY(0px) scale(${overScale})` },
        { opacity: 1, transform: "translateY(0px) scale(1)" }
      ],
      { duration: 170, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "forwards" }
    )
  }, [scoreReveal, stopDiff])

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

  try {

    await navigator.clipboard.writeText(text)

    alert("Result copied! Share it with friends 🚀")

  } catch {

    console.log(text)

  }

}

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

  const avgDiffNum = stats.played > 0 ? stats.totalDiff / stats.played : null
  const averageDiff = avgDiffNum !== null ? avgDiffNum.toFixed(1) : "-"

  const avgDiffMeta = (() => {
    if (avgDiffNum === null) return { color: "#666", emoji: "", label: "—" }
    if (avgDiffNum <= 2) return { color: "#2a9d8f", emoji: "🔥", label: "Elite" }
    if (avgDiffNum <= 5) return { color: "#e9c46a", emoji: "✨", label: "Solid" }
    if (avgDiffNum <= 10) return { color: "#f4a261", emoji: "💪", label: "Getting there" }
    return { color: "#e63946", emoji: "🎯", label: "Keep pushing" }
  })()

if (bestDiff !== null) {

  const score = 100 - bestDiff * 4

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
  const bestNumberColor = hasBestNumber ? bestDiffToColor(bestDiff as number) : "#16a34a"

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

  const diffStatAbs =
    hasResultNumbers && (isCounting || gameFinished)
      ? Math.abs(isCounting ? countDisplay - target : ballCount - target)
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
      style={{
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        position:"relative",
        zIndex:0,
        width:"100%",
        padding: isCompact ? "4px 6px 4px" : "0 0 8px 0",
        paddingBottom: isCompact
          ? "max(4px, var(--orbifall-game-bottom-pad, 8px))"
          : "max(8px, var(--orbifall-game-bottom-pad, 40px))",
        touchAction: isCompact ? "manipulation" : undefined,
        overflow: isCompact ? "hidden" : undefined
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

      {/* Unified top control panel — dense column, capped width (centered) */}
      <div
        className={
          "mx-auto mb-1 flex w-full max-w-md flex-col gap-1.5 rounded-2xl border p-2 sm:mb-1.5 sm:gap-2 sm:p-2.5 " +
          (darkMode
            ? "border-white/[0.07] bg-[rgba(34,34,36,0.94)] shadow-[0_4px_20px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.05)]"
            : "border-black/[0.055] bg-white/[0.96] shadow-[0_4px_18px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.88)]")
        }
      >
        {/* Header: title + streak/actions on one row */}
        <div
          className="flex min-h-[24px] items-center justify-between gap-1.5 text-[13px] font-semibold leading-none sm:min-h-[26px] sm:gap-2 sm:text-sm"
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
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <div className="text-[13px] font-semibold sm:text-sm" style={{ color: theme.muted }}>
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
            "w-full rounded-xl border px-1.5 py-1.5 sm:px-2 sm:py-1.5 " +
            (darkMode
              ? "border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              : "border-black/[0.06] bg-black/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]")
          }
        >
          <div className="flex w-full flex-col items-center gap-0.5">
            {/* Primary: target — spans inner width */}
            <div
              className={
                (running && !isCounting && !gameOver ? "orbifall-target--live " : "") +
                "flex w-full items-center justify-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border px-5 py-2 font-extrabold leading-none tracking-tight sm:px-6 sm:py-2.5 " +
                (isCompact ? "text-base sm:text-[17px]" : "text-[17px] sm:text-lg") +
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
              <span
                className={
                  "shrink-0 text-[0.72em] font-semibold leading-none " +
                  (darkMode ? "text-neutral-400" : "text-neutral-500")
                }
              >
                Target
              </span>
              <span className="tabular-nums">{target}</span>
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
                          ? "border-transparent bg-[#2a9d8f] text-white"
                          : active
                          ? darkMode
                            ? "border-teal-400/45 bg-neutral-700/90 text-neutral-100"
                            : "border-teal-600/35 bg-neutral-100 text-neutral-800"
                          : darkMode
                          ? "border-white/[0.07] bg-neutral-800/60 text-neutral-500"
                          : "border-black/[0.06] bg-neutral-100/90 text-neutral-400") +
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
            "mt-0.5 grid w-full grid-cols-3 gap-1 rounded-xl p-1 sm:gap-1.5 sm:p-1.5 " +
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
    className="min-w-0 flex min-h-[34px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
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
    <div className="text-[10px] leading-none sm:text-[11px]" style={{ color: theme.muted2 }}>
      Result
    </div>
    <div
      ref={resultValueRef}
      className="text-[14px] sm:text-[15px]"
      style={{
        fontWeight:"600",
        lineHeight:1,
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
    className="min-w-0 flex min-h-[34px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
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
    <div className="text-[10px] leading-none sm:text-[11px]" style={{ color: theme.muted2 }}>
      Diff
    </div>
    <div
      ref={diffValueRef}
      className="text-[14px] sm:text-[15px]"
      style={{
        fontWeight:"600",
        lineHeight:1,
        color:
          diffStatAbs !== null
            ? diffStatDisplayColor(diffStatAbs)
            : hasResultNumbers
            ? theme.text
            : undefined,
        transition: "color 180ms ease"
      }}
    >
      {isCounting ? countDisplay - target : gameFinished ? ballCount - target : "–"}
    </div>
  </div>

  {/* BEST */}

  <div
    className="min-w-0 flex min-h-[34px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center text-[11px] leading-none ring-1 ring-inset ring-black/[0.05] sm:min-h-[36px] sm:gap-1 sm:px-2.5 sm:py-2 sm:text-xs dark:ring-white/[0.07]"
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
    <div className="text-[10px] leading-none sm:text-[11px]" style={{ color: theme.muted2 }}>
      Best
    </div>
    <div
      className="text-[14px] sm:text-[15px]"
      style={{
        fontWeight:"600",
        lineHeight:1,
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
          style={{
            position: "absolute",
            top: "28%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${
              running && !isCounting ? 1.03 : 1
            })`,
            fontSize: isCompact ? "118px" : "138px",
            fontWeight: "800",
            color: theme.feedbackText,
            opacity: 0.06,
            textShadow: "none",
            letterSpacing: "-0.02em",
            filter: "blur(0.45px)",
            pointerEvents: "none",
            transition: "transform 200ms ease, opacity 200ms ease"
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

        {/* After last try: countdown only after user dismisses the end-of-game stats modal */}
        {gameOver && !showStats && statsDismissed && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 z-[4] max-w-[min(92%,280px)] -translate-x-1/2 px-3 py-1 text-center text-[10px] font-medium leading-snug tracking-wide sm:text-[11px]"
            style={{
              top: "8%",
              color: theme.muted2,
              borderRadius: "999px",
              background: darkMode ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.62)",
              border: darkMode
                ? "1px solid rgba(255,255,255,0.09)"
                : "1px solid rgba(0,0,0,0.07)",
              boxShadow: darkMode
                ? "0 2px 12px rgba(0,0,0,0.25)"
                : "0 2px 10px rgba(0,0,0,0.07)"
            }}
          >
            New challenge in{" "}
            <span className="font-semibold tabular-nums" style={{ color: theme.muted }}>
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

      <button
        className={showDropPulse ? "orbifall-drop-btn-pulse" : undefined}
        onClick={() => {
          triggerActionButtonFeedback()
      if (gameOver) {
        setStatsDismissed(false)
        setStatsAutoOpened(true)
        setShowStats(true)
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
          marginTop: isCompact ? "0px" : "2px",
          width: "min(85vw, 320px)",
          maxWidth: 320,
          padding: isCompact ? "12px 20px" : "14px 24px",
          fontSize: 20,
          fontWeight: 700,
          border:"none",
          borderRadius:"10px",
          color: isCounting || isStopping ? "#ddd" : "white",
          // Subtle highlight overlay + state color gradient.
          backgroundImage: isCounting || isStopping
            ? "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 62%), linear-gradient(180deg, #8b939b 0%, #6c757d 100%)"
            : gameOver
            ? "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 62%), linear-gradient(180deg, #5a8cad 0%, #457b9d 100%)"
            : running
            ? "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 62%), linear-gradient(180deg, #ef5a66 0%, #e63946 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 62%), linear-gradient(180deg, #39b2a2 0%, #2a9d8f 100%)",
          cursor: isCounting || isStopping ? "default" : "pointer",
          minHeight: 64,
          touchAction:"manipulation",
          willChange:"transform, box-shadow, filter",
          transform: actionButtonPressed
            ? "translateY(2px) scale(0.97)"
            : actionButtonHovered
            ? "translateY(-1px) scale(1.015)"
            : "scale(1)",
          filter: actionButtonPressed ? "brightness(0.96)" : actionButtonHovered ? "brightness(1.03)" : "brightness(1)",
          boxShadow: actionButtonPressed
            ? "0 2px 6px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.18)"
            : actionButtonHovered
            ? "0 16px 40px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.30)"
            : showDropPulse
            ? undefined
            : "0 14px 34px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.22)",
          transition: showDropPulse
            ? "transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 120ms ease"
            : "transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 120ms ease, filter 120ms ease"
        }}
      >
        {gameOver ? "STATS" : running ? "STOP" : isStopping ? "STOP" : "DROP"}
      </button>

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
            setGlassCountdownBlocked(false)
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
                setGlassCountdownBlocked(false)
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
              ⭐Best diff: <b>{bestDiff}</b>
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

            {stats.played === 1 &&
              homeScreenPromptReady &&
              !homeScreenPromptDismissed && (
                <div
                  role="status"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: `1px solid ${theme.border}`,
                    fontSize: 13,
                    lineHeight: 1.35,
                    color: theme.modalMuted,
                    textAlign: "left"
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    Play daily — add Orbidrop to your home screen
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss home screen tip"
                    onClick={() => {
                      setStorageItem(ORBIFALL_HOME_SCREEN_PROMPT_KEY, "true")
                      setHomeScreenPromptDismissed(true)
                    }}
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 28,
                      marginTop: -4,
                      border: "none",
                      borderRadius: 8,
                      background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      color: theme.modalText,
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}

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
            localStorage.setItem("orbifallRulesSeen","true")
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
                  localStorage.setItem("orbifallRulesSeen","true")
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

                localStorage.setItem("orbifallRulesSeen", "true")
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
            style={{
              position: "fixed",
              right: isSmallScreen
                ? "calc(10px + env(safe-area-inset-right))"
                : "calc(14px + env(safe-area-inset-right))",
              bottom: isSmallScreen
                ? "calc(10px + env(safe-area-inset-bottom))"
                : "calc(18px + env(safe-area-inset-bottom))",
              display: "flex",
              gap: "8px",
              alignItems: "center",
              zIndex: 2500,
              padding: "0 env(safe-area-inset-right) env(safe-area-inset-bottom) 0"
            }}
          >
            <button
              type="button"
              onClick={() => setDarkMode(prev => !prev)}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                width: isSmallScreen ? "34px" : "42px",
                height: isSmallScreen ? "34px" : "42px",
                borderRadius: "999px",
                border: "none",
                background: darkMode ? "#374151" : theme.buttonMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isSmallScreen ? "14px" : "16px",
                cursor: "pointer",
                color: darkMode ? "#e5e5e5" : theme.muted,
                boxShadow: "0 6px 16px rgba(0,0,0,0.18)"
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
              style={{
                width: isSmallScreen ? "34px" : "42px",
                height: isSmallScreen ? "34px" : "42px",
                borderRadius: "999px",
                border: "none",
                background: soundEnabled ? "#2a9d8f" : theme.buttonMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isSmallScreen ? "14px" : "16px",
                cursor: "pointer",
                color: soundEnabled ? "white" : theme.muted,
                boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
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