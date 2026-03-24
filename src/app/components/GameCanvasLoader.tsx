"use client"

import dynamic from "next/dynamic"

const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-xl border border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]"
      style={{ width: 380, height: 520 }}
      role="status"
      aria-live="polite"
      aria-label="Loading game"
    >
      <span className="text-sm opacity-60">Loading…</span>
    </div>
  ),
})

export default function GameCanvasLoader() {
  return <GameCanvas />
}
