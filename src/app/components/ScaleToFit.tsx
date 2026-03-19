"use client"

import { useEffect, useState } from "react"

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 960
const MAX_WIDTH = 400

export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const update = () => {
      const availableW = Math.min(window.innerWidth * 0.9, MAX_WIDTH)
      const availableH =
        typeof window === "undefined"
          ? FRAME_HEIGHT
          : (window.visualViewport?.height ?? window.innerHeight)
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
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  )
}
