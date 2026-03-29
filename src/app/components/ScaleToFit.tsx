"use client"

import { useLayoutEffect, useState } from "react"

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 960
const MAX_WIDTH = 430

/** Fixed footer link bar — subtract from visible height when fitting scale (px). */
const MOBILE_FOOTER_BAR_PX = 32

function computeScale(): number {
  if (typeof window === "undefined") return 1
  const w = window.innerWidth
  const narrow = w <= 480
  const widthFactor = narrow ? 1 : 0.9
  const availableW = Math.min(w * widthFactor, MAX_WIDTH)

  const ih = window.innerHeight
  const vv = window.visualViewport?.height ?? ih
  const clientH = document.documentElement?.clientHeight ?? ih
  /*
   * Production iOS: vv can be smaller than the drawable area when the chrome animates.
   * Use the largest of vv / innerHeight / clientHeight so the game scales up to fill.
   */
  const vhBase = narrow
    ? Math.max(vv, ih, clientH) * 0.998
    : Math.max(vv, clientH)

  const availableH = Math.max(
    200,
    narrow ? vhBase - MOBILE_FOOTER_BAR_PX : vhBase
  )

  return Math.min(
    Math.max(0, availableW / FRAME_WIDTH),
    Math.max(0, availableH / FRAME_HEIGHT)
  )
}

export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const update = () => setScale(computeScale())
    update()
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update)
      window.visualViewport.addEventListener("scroll", update)
    }
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
      if (window.visualViewport) {
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
