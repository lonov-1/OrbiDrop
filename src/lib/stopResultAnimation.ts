/**
 * STOP result reveal: count-up (rAF), impact scale (WAAPI), optional helpers.
 * Keeps logic framework-agnostic — wire timings from STOP_RESULT_TIMING in UI code.
 */

export const STOP_RESULT_TIMING = {
  /** Pause after physics settle, before count starts (80–120ms band). */
  PAUSE_MS: 100,
  /** Count-up duration (300–450ms band). */
  COUNT_MS: 560,
  /** 1 → 1.08 → 1 on the result value. */
  IMPACT_MS: 120,
  /** After impact, before Diff fades in. */
  DIFF_STAGGER_MS: 100,
  DIFF_FADE_MS: 220,
  /** Clear busy state / pulse after full sequence. */
  UI_SETTLE_MS: 1180
} as const

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export type CountUpOptions = {
  from: number
  to: number
  durationMs: number
  /** Current value (fractional) and linear progress 0..1 */
  onUpdate: (value: number, linearT: number) => void
  onComplete?: () => void
}

/**
 * Animates from → to using requestAnimationFrame and ease-out cubic.
 * Calls onUpdate with interpolated value; final frame snaps to `to`.
 * Returns a cancel function (cancels rAF, skips onComplete).
 */
export function runCountUp(opts: CountUpOptions): () => void {
  const { from, to, durationMs, onUpdate, onComplete } = opts
  const start = performance.now()
  let raf = 0
  let cancelled = false

  const tick = (now: number) => {
    if (cancelled) return
    const elapsed = now - start
    const linearT = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs)
    const easedT = easeOutCubic(linearT)
    const value = from + (to - from) * easedT
    onUpdate(value, linearT)

    if (linearT < 1) {
      raf = requestAnimationFrame(tick)
    } else if (!cancelled) {
      onComplete?.()
    }
  }

  raf = requestAnimationFrame(tick)

  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
}

/**
 * Quick scale punch on a node: 1 → 1.08 → 1.
 * Returns the Web Animations API handle (optional chaining onfinish).
 */
export function runImpactScale(
  el: HTMLElement,
  durationMs: number = STOP_RESULT_TIMING.IMPACT_MS
): Animation {
  return el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.08)" },
      { transform: "scale(1)" }
    ],
    {
      duration: durationMs,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both"
    }
  )
}

/**
 * Diff row: fade + slight rise (opacity 0→1, translateY 5px→0).
 */
export function runDiffReveal(
  el: HTMLElement,
  durationMs: number = STOP_RESULT_TIMING.DIFF_FADE_MS
): Animation {
  return el.animate(
    [
      { opacity: 0, transform: "translateY(5px)" },
      { opacity: 1, transform: "translateY(0)" }
    ],
    {
      duration: durationMs,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards"
    }
  )
}
