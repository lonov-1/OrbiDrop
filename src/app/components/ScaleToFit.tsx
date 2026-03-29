"use client"

import { useLayoutEffect, useState } from "react"

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 960
const MAX_WIDTH = 430

export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const update = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : FRAME_WIDTH
      const narrow = w <= 480
      // Use almost full width on phones; MAX_WIDTH allows full-bleed on wide iPhones.
      const widthFactor = narrow ? 0.98 : 0.9
      /*
       * Light reserve: footer is position:fixed and does not consume flow height.
       * We only shave a few px so the scaled block does not sit under the OS home indicator.
       */
      const footerReservePx = narrow ? 28 : 0
      const availableW = Math.min(w * widthFactor, MAX_WIDTH)
      const vh =
        typeof window === "undefined"
          ? FRAME_HEIGHT
          : window.visualViewport?.height ?? window.innerHeight
      const availableH = Math.max(200, vh - footerReservePx)
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
      window.visualViewport.addEventListener("scroll", update)
    }
    return () => {
      window.removeEventListener("resize", update)
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", update)
        window.visualViewport.removeEventListener("scroll", update)
      }
    }
  }, [])

  const outerW = FRAME_WIDTH * scale
  const outerH = FRAME_HEIGHT * scale

  return (
    <div
      style={{
        width: outerW,
        height: outerH,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <div
        style={{
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          left: 0,
          top: 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}
