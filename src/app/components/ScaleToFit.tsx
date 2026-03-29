"use client"

import { useEffect, useState } from "react"

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 960
const MAX_WIDTH = 400

export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const update = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : FRAME_WIDTH
      const narrow = w <= 480
      // Slightly wider use of screen on phones; reserve space for fixed footer so scale fits the visible column.
      const widthFactor = narrow ? 0.94 : 0.9
      const footerReservePx = narrow ? 52 : 0
      const availableW = Math.min(w * widthFactor, MAX_WIDTH)
      const vh =
        typeof window === "undefined"
          ? FRAME_HEIGHT
          : window.visualViewport?.height ?? window.innerHeight
      const availableH = Math.max(220, vh - footerReservePx)
      const s = Math.min(
        Math.max(0, availableW / FRAME_WIDTH),
        Math.max(0, availableH / FRAME_HEIGHT)
      )
      setScale(s)
    }
    update()
    window.addEventListener("resize", update)
    if (typeof window !== "undefined" && window.visualViewport) {
      window.visualViewport.addEventListener("resize", update)
    }
    return () => {
      window.removeEventListener("resize", update)
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", update)
      }
    }
  }, [])

  return (
    <div
      style={{
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        transform: `scale(${scale})`,
        transformOrigin: "top center",
      }}
    >
      {children}
    </div>
  )
}
