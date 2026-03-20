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
  height: 570,
  startDate: "2024-01-01",
  minTarget: 80,
  targetRange: 80,
  maxAttempts: 3
} as const

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
const PLAYER_ID_KEY = "orbifallPlayerId"
const BALL_TEXTURE_SIZE = 100

function makeBallTextureUri(baseColor: string, brightnessDelta: number) {
  // Bucket brightness a bit to keep caching effective.
  const bucket = Math.max(-20, Math.min(20, Math.round(brightnessDelta / 5) * 5))

  // Create a subtle "3D" look: radial gradient + soft highlight.
  const top = varyHexBrightness(baseColor, 22 + bucket)
  const mid = varyHexBrightness(baseColor, 6 + Math.round(bucket / 2))
  const bottom = varyHexBrightness(baseColor, -12 + bucket)
  const stroke = varyHexBrightness(baseColor, 28)

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BALL_TEXTURE_SIZE}" height="${BALL_TEXTURE_SIZE}" viewBox="0 0 ${BALL_TEXTURE_SIZE} ${BALL_TEXTURE_SIZE}">
      <defs>
        <radialGradient id="g" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stop-color="${top}"/>
          <stop offset="55%" stop-color="${mid}"/>
          <stop offset="100%" stop-color="${bottom}"/>
        </radialGradient>
      </defs>
      <circle cx="${BALL_TEXTURE_SIZE / 2}" cy="${BALL_TEXTURE_SIZE / 2}" r="48" fill="url(#g)" stroke="${stroke}" stroke-width="6" opacity="0.98"/>
      <ellipse cx="42" cy="38" rx="20" ry="14" fill="white" opacity="0.22"/>
      <ellipse cx="36" cy="44" rx="10" ry="7" fill="white" opacity="0.14"/>
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
  if (diff === 0) return "Perfect hit!"
  if (diff <= 10) return "So close!"
  if (diff <= 20) return "Nice try!"
  return "Not even close..."
}

function diffToColor(diff: number) {
  if (diff <= 2) return "#2a9d8f"
  if (diff <= 5) return "#e9c46a"
  if (diff <= 10) return "#f4a261"
  return "#e63946"
}

function bestDiffToColor(diff: number) {
  // Distinct palette for the Best box (feels "achievements" oriented)
  if (diff <= 2) return "#16a34a"
  if (diff <= 5) return "#2a9d8f"
  if (diff <= 10) return "#457b9d"
  return "#e63946"
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

function getOrCreatePlayerId() {
  const existing = getStorageItem(PLAYER_ID_KEY)
  if (existing) return existing
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  setStorageItem(PLAYER_ID_KEY, id)
  return id
}

export default function GameCanvas() {

  const sceneRef = useRef<HTMLDivElement>(null)
  const glassRef = useRef<HTMLDivElement>(null)
  const earthIconRef = useRef<HTMLSpanElement>(null)

  const engineRef = useRef<Matter.Engine | null>(null)
  const ballsRef = useRef<Matter.Body[]>([])
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
  // Auto-open stats once when the game finishes.
  // After the user closes, the STATS button is spam-locked via statsDismissed.
  const [statsAutoOpened, setStatsAutoOpened] = useState(false)
  const [showEarthWin, setShowEarthWin] = useState(false)
  const [stopImpact, setStopImpact] = useState(false)
  const [dropImpact, setDropImpact] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [statsPopUpReady, setStatsPopUpReady] = useState(false)
  const [rulesPopUpReady, setRulesPopUpReady] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  // Compact sizing for phones (keeps the layout balanced without scrolling).
  const isCompact = isSmallScreen

  const [soundEnabled, setSoundEnabled] = useState(() => {
    return getStorageItem("orbidropSoundEnabled") !== "false"
  })

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

  const withAudioContext = (fn: (ctx: AudioContext) => void) => {
    if (typeof window === "undefined") return
    if (!soundEnabled) return
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
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.07)
    })
  }

  const playBounceSound = () => {
    const nowMs = performance.now()
    if (nowMs - lastBounceAtRef.current < 70) return
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
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.005)
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
        gain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.06 + 0.01)
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

  const triggerHaptic = (kind: "press" | "stop" | "great") => {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return

    const pattern: number | number[] =
      kind === "press" ? 24 : kind === "stop" ? 64 : [30, 20, 30]

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

  const [playerId] = useState(() => getOrCreatePlayerId())
  const todayKey = getISODate()
  const [isEarthDropPlayerToday, setIsEarthDropPlayerToday] = useState(false)
  const earthKey = `${EARTH_DROP_KEY_PREFIX}${todayKey}`
  const earthCollectedToday = getStorageItem(earthKey) === "true"
  const earthWinSeenKey = `orbidropEarthWinSeen:${todayKey}`
  const forceEarthEveryRun = getStorageItem("orbidropForceEarthEveryRun") === "true"

  const playfieldWidth = GAME.width
  const playfieldHeight = GAME.height

  useEffect(() => {
    let cancelled = false
    fetch(`/api/earth-winner?date=${encodeURIComponent(todayKey)}&playerId=${encodeURIComponent(playerId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.isWinner === true) setIsEarthDropPlayerToday(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [todayKey, playerId])

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

  useEffect(() => {

    if (!gameOver || bestDiff === null) return

    const diff = bestDiff
    const today = getISODate()

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

    Runner.run(runner, engine)
    Render.run(render)

    const onCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
      const pairs = event.pairs || []
      for (let i = 0; i < pairs.length; i++) {
        const { bodyA, bodyB } = pairs[i]
        // Bounce sound only when a dynamic body hits the ground
        if (bodyA === ground && !bodyB.isStatic) {
          playBounceSound()
          break
        }
        if (bodyB === ground && !bodyA.isStatic) {
          playBounceSound()
          break
        }
      }
    }

    Matter.Events.on(engine, "collisionStart", onCollisionStart)

    return () => {
      Matter.Events.off(engine, "collisionStart", onCollisionStart)
      Runner.stop(runner)
      Render.stop(render)
      World.clear(engine.world, false)
      Engine.clear(engine)
      render.canvas.remove()
      render.textures = {}
    }
  }, [playfieldWidth, playfieldHeight])

  useEffect(() => {

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

    const radius = isSmallScreen ? Math.random() * 5 + 7 : Math.random() * 6 + 8

    const baseColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
    const brightnessDelta = Math.floor(Math.random() * 24) - 10
    const ballOpacity = 0.92 + Math.random() * 0.08

    // Shaded "3D-ish" texture (cached) for less-flat-looking balls.
    const textureKey = `${baseColor}_${Math.round(brightnessDelta / 5) * 5}`
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

  const startGame = () => {

    if (running || gameOver || isCounting || isStopping) return

    // Impact moment for DROP
    setDropImpact(true)
    setTimeout(() => setDropImpact(false), 320)

    playClickSound()
    triggerHaptic("press") // fallback for keyboard
    setGameFinished(false)
    setIsCounting(false)
    setCountDisplay(0)
    earthWonThisRunRef.current = false

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
        spawnBallTimeoutRef.current = setTimeout(spawnBall, 60)
      }

      const baseSpeed = Math.max(80, 220 - target)

      const randomDelay =
        Math.floor(Math.random() * baseSpeed) + 80

      intervalRef.current = setTimeout(spawnLoop, randomDelay)

    }

    spawnLoop()

  }

  const stopGame = () => {
    if (isStopping || isCounting || !running) return

    // Impact moment: stop new spawns immediately, then reveal the result after a short pause
    playClickSound()
    triggerHaptic("stop") // fallback for keyboard
    setIsStopping(true)
    setRunning(false)
    setStopImpact(true)
    setTimeout(() => setStopImpact(false), 320)

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

    setTimeout(() => {
      const finalCount = ballsRef.current.length
      const durationMs = 2200
      const startedAt = performance.now()

      setIsCounting(true)
      setCountDisplay(0)

      const tick = (now: number) => {
        const t = Math.min(1, (now - startedAt) / durationMs)
        const eased = 1 - Math.pow(1 - t, 3)
        const value = Math.round(eased * finalCount)
        setCountDisplay(value)

        if (t < 1) {
          countRafRef.current = requestAnimationFrame(tick)
          return
        }

        countRafRef.current = null
        setIsCounting(false)
        setGameFinished(true)

        const diff = Math.abs(finalCount - target)
        setAttemptResults(prev => [...prev, diff])
        setBestDiff(prev => (prev === null ? diff : Math.min(prev, diff)))
        setAttempt(prev => prev + 1)

      // Reward sound for very low diff
      if (diff <= 2) {
        playSuccessSound()
        triggerHaptic("great")
      }

        setScoreReveal(true)
        setTimeout(() => {
          setScoreReveal(false)
          setIsStopping(false)
        }, 500)

        // Earth orb celebration (only once per day per player)
        if (
          earthWonThisRunRef.current &&
          (forceEarthEveryRun || localStorage.getItem(earthWinSeenKey) !== "true")
        ) {
          if (!forceEarthEveryRun) localStorage.setItem(earthWinSeenKey, "true")
          setShowEarthWin(true)
        }
      }

      countRafRef.current = requestAnimationFrame(tick)
    }, 300)

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
    const elResult = resultValueRef.current
    const elDiff = diffValueRef.current
    elResult?.animate(
      [
        { opacity: 0, transform: "translateY(4px) scale(0.98)" },
        { opacity: 1, transform: "translateY(0px) scale(1)" }
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
    )
    elDiff?.animate(
      [
        { opacity: 0, transform: "translateY(4px) scale(0.98)" },
        { opacity: 1, transform: "translateY(0px) scale(1)" }
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
    )
  }, [scoreReveal])

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

  return (

    <div
      style={{
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        position:"relative",
        zIndex:0,
        width:"100%",
        padding: isCompact ? "4px 6px 6px" : "0 0 16px 0",
        touchAction: isCompact ? "manipulation" : undefined,
        overflow: isCompact ? "hidden" : undefined
      }}
    >

     <div
  style={{
    textAlign:"center",
    marginBottom:isCompact ? "2px" : "8px"
  }}
>

<div style={{textAlign:"center", marginBottom:isCompact ? "2px" : "8px"}}>

  {/* Orbidrop + Streak + Info/Stats */}

  <div
    style={{
      display:"flex",
      alignItems:"center",
      justifyContent:"space-between",
      gap:isCompact ? "8px" : "16px",
      fontSize:isCompact ? "14px" : "16px",
      fontWeight:"600",
      width:"100%",
      maxWidth:`${playfieldWidth}px`,
      margin:"0 auto",
      color: theme.text
    }}
  >
    <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
      {!earthCollectedToday && (
        <span
          ref={earthIconRef}
          aria-hidden="true"
          style={{
            width:`${EARTH_DIAMETER}px`,
            height:`${EARTH_DIAMETER}px`,
            borderRadius:"50%",
            display:"inline-block",
            backgroundImage:`url("${EARTH_TEXTURE_DATA_URI}")`,
            backgroundSize:"cover",
            boxShadow:"0 2px 6px rgba(0,0,0,0.22), inset -2px -3px 4px rgba(0,0,0,0.28)",
            border:"1px solid rgba(255,255,255,0.55)"
          }}
        />
      )}
      <span style={{ color: theme.text }}>Orbidrop #{dayNumber}</span>
    </div>
      <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
      <div style={{fontSize:"14px", color: theme.muted}}>
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
            width:isCompact ? "32px" : "24px",
            height:isCompact ? "32px" : "24px",
            borderRadius:"999px",
            border:"none",
            background: theme.cardLight,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            fontSize:isCompact ? "16px" : "13px",
            cursor:"pointer",
            color: theme.muted,
            boxShadow: darkMode ? "0 1px 2px rgba(0,0,0,0.3)" : "0 1px 2px rgba(0,0,0,0.12)"
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
          width:isCompact ? "32px" : "24px",
          height:isCompact ? "32px" : "24px",
          borderRadius:"999px",
          border:"none",
          background: theme.cardLighter,
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          fontSize:isCompact ? "16px" : "13px",
          cursor:"pointer",
          color: theme.muted,
          boxShadow: darkMode ? "0 1px 2px rgba(0,0,0,0.3)" : "0 1px 2px rgba(0,0,0,0.12)"
        }}
      >
        i
      </button>
    </div>
  </div>

  {/* Target */}

  <div
    style={{
      marginTop: isCompact ? "2px" : "4px",
      display: "inline-block",
      padding: isCompact ? "3px 8px" : "4px 10px",
      borderRadius: "8px",
      background: theme.cardLight,
      boxShadow: darkMode ? "0 1px 3px rgba(0,0,0,0.2)" : "0 1px 3px rgba(0,0,0,0.06)",
      fontWeight: "500",
      fontSize: "13px",
      color: theme.muted,
      opacity: 0.9
    }}
  >
    🎯 Target {target}
  </div>

  {/* Attempts */}

  <div style={{marginTop:isCompact ? "2px" : "8px"}}>

    <div style={{fontSize:isCompact ? "11px" : "12px", color: theme.muted, marginBottom:isCompact ? "2px" : "4px"}}>
      Attempts
    </div>

    <div
      style={{
        display:"flex",
        justifyContent:"center",
        gap:"8px"
      }}
    >

      {[1,2,3].map(i => (

        <div
          key={i}
          style={{
            width:"22px",
            height:"22px",
            borderRadius:"50%",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            fontSize:"11px",
            background:
              attempt > i
                ? "#2a9d8f"
                : theme.cardLighter,
            color:
              attempt > i
                ? "white"
                : theme.muted2
          }}
        >
          {i}
        </div>

      ))}

    </div>

  </div>

</div>

</div>

      <div
        style={{
          height: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: `${playfieldWidth}px`
        }}
      >

 <div
  style={{
    display:"flex",
    justifyContent:"center",
    gap: isCompact ? "6px" : "8px",
    marginTop: isCompact ? "3px" : "5px"
  }}
>

  {/* RESULT */}

  <div
    style={{
      background: theme.card,
      padding: isCompact ? "4px 8px" : "6px 12px",
      borderRadius:"10px",
      fontSize: isCompact ? "12px" : "14px",
      minWidth: isCompact ? "56px" : "70px",
      textAlign:"center",
      border:`1px solid ${theme.border}`,
      boxShadow: darkMode ? "0 1px 3px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.06)",
      transform: isCounting
        ? "translateY(-2px) scale(1.12)"
        : scoreReveal
        ? "translateY(-3px) scale(1.26)"
        : "scale(1)",
      transition:
        "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease"
    }}
  >
    <div style={{fontSize: isCompact ? "10px" : "11px", color: theme.muted2}}>
      Result
    </div>
    <div
      ref={resultValueRef}
      style={{
        fontWeight:"600",
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
    style={{
      background: theme.card,
      padding: isCompact ? "4px 8px" : "6px 12px",
      borderRadius:"10px",
      fontSize: isCompact ? "12px" : "14px",
      minWidth: isCompact ? "56px" : "70px",
      textAlign:"center",
      border:`1px solid ${theme.border}`,
      boxShadow: darkMode ? "0 1px 3px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.06)",
      transform: isCounting
        ? "translateY(-2px) scale(1.12)"
        : scoreReveal
        ? "translateY(-3px) scale(1.26)"
        : "scale(1)",
      transition:
        "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease"
    }}
  >
    <div style={{fontSize: isCompact ? "10px" : "11px", color: theme.muted2}}>
      Diff
    </div>
    <div
      ref={diffValueRef}
      style={{
        fontWeight:"600",
        color: hasResultNumbers
          ? isCounting
            ? countingDiffColor
            : finishedDiffColor
          : undefined,
        transition: "color 180ms ease"
      }}
    >
      {isCounting ? countDisplay - target : gameFinished ? ballCount - target : "–"}
    </div>
  </div>

  {/* BEST */}

  <div
    style={{
      background: theme.card,
      padding: isCompact ? "4px 8px" : "6px 12px",
      borderRadius:"10px",
      fontSize: isCompact ? "12px" : "14px",
      minWidth: isCompact ? "56px" : "70px",
      textAlign:"center",
      border:`1px solid ${theme.border}`,
      boxShadow: darkMode ? "0 1px 3px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.06)",
      transition:
        "background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease"
    }}
  >
    <div style={{fontSize: isCompact ? "10px" : "11px", color: theme.muted2}}>
      Best
    </div>
    <div
      style={{
        fontWeight:"600",
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

        <hr
          style={{
            width:`${playfieldWidth}px`,
            margin:isCompact ? "2px 0" : "6px 0",
            border:"none",
            height:"1px",
            background: darkMode
              ? "linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.06), rgba(255,255,255,0))"
              : "linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.06), rgba(0,0,0,0))"
          }}
        />

      </div>

      <div
        style={{
          width: `${playfieldWidth}px`,
          height: `${playfieldHeight}px`,
          marginTop: isCompact ? "2px" : "6px",
          position: "relative",
          borderRadius: "0 0 16px 16px"
        }}
      >
        {/* Slightly darker area behind the glass (background separation). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-14px -14px -18px -14px",
            borderRadius: "18px",
            background: darkMode
              ? "radial-gradient(circle at center, rgba(0,0,0,0) 52%, rgba(0,0,0,0.22) 100%)"
              : "radial-gradient(circle at center, rgba(0,0,0,0) 52%, rgba(0,0,0,0.07) 100%)",
            pointerEvents: "none",
            zIndex: 0
          }}
        />

        <div
          ref={glassRef}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "0 0 16px 16px",
            background: theme.glass,
            border: `1px solid ${
              darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"
            }`,
            overflow: "hidden",
            position: "relative",
            zIndex: 1,
          boxShadow: darkMode
            ? "inset 2px 0 0 rgba(255,255,255,0.06), inset -2px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.2), inset 0 -10px 14px rgba(0,0,0,0.15), 0 12px 30px rgba(0,0,0,0.22)"
            : "inset 4px 0 0 rgba(110,110,110,0.40), inset -4px 0 0 rgba(110,110,110,0.40), inset 0 -1px 0 rgba(70,70,70,0.26), inset 0 -10px 14px rgba(0,0,0,0.05), inset 0 -26px 26px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.03), 0 12px 30px rgba(0,0,0,0.08)",
          transform:
            stopImpact || dropImpact
              ? "translateY(-1px) scale(1.02)"
              : running && !isCounting
              ? "translateY(-2px) scale(1)"
              : "scale(1)",
          transition:
            "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 220ms ease"
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
          style={{
            position: "absolute",
            top: "12%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "16px",
            fontWeight: 850,
            color: theme.feedbackText,
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
            textShadow: darkMode ? "0 1px 8px rgba(0,0,0,0.4)" : "0 1px 8px rgba(0,0,0,0.06)",
            zIndex: 2,
            opacity: showFeedback ? 1 : 0,
            transition: showFeedback
              ? "opacity 700ms ease"
              : "opacity 120ms ease"
          }}
        >
          {feedbackMessage}
        </div>

        <div
          style={{
            position: "absolute",
            top: "28%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${
              running && !isCounting ? 1.05 : 1
            })`,
            fontSize: isCompact ? "118px" : "138px",
            fontWeight: "800",
            color: theme.feedbackText,
            opacity:
              running && !isCounting
                ? 0.12
                : stopImpact || dropImpact
                ? 0.16
                : 0.18,
            textShadow: darkMode
              ? "0 0 18px rgba(255,255,255,0.12), 0 0 10px rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)"
              : "0 0 18px rgba(255,255,255,0.2), 0 0 10px rgba(255,255,255,0.1), 0 2px 10px rgba(0,0,0,0.06)",
            letterSpacing: "-0.02em",
            filter: "blur(0.35px)",
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
            pointerEvents:"none"
          }}
        />

        </div>
      </div>

      <button
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
          marginTop:isCompact ? "4px" : "10px",
          padding:isCompact ? "12px 28px" : "14px 40px",
          fontSize:"20px",
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
          minWidth:"140px",
          minHeight:"52px",
          touchAction:"manipulation",
          willChange:"transform, box-shadow, filter",
          transform: actionButtonPressed
            ? "translateY(1px) scale(0.975)"
            : actionButtonHovered
            ? "translateY(-1px) scale(1.015)"
            : "scale(1)",
          filter: actionButtonPressed ? "brightness(0.96)" : actionButtonHovered ? "brightness(1.03)" : "brightness(1)",
          boxShadow: actionButtonPressed
            ? "0 3px 10px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.22)"
            : actionButtonHovered
            ? "0 14px 34px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.30)"
            : "0 10px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.24)",
          transition:
            "transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease, filter 180ms ease"
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
             Next Orbidrop in {timeLeft}
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
              onClick={() => setSoundEnabled(prev => !prev)}
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
                boxShadow: "0 6px 16px rgba(0,0,0,0.18)"
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