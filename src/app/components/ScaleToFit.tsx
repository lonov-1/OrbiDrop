"use client"

import { useEffect, useState } from "react"

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 900
const EDGE_MARGIN = 24

export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth - EDGE_MARGIN * 2
      const h = window.innerHeight - EDGE_MARGIN * 2
      const s = Math.min(Math.max(0, w / FRAME_WIDTH), Math.max(0, h / FRAME_HEIGHT))
      setScale(s)
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
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
