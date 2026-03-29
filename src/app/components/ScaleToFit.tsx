"use client"

import { useLayoutEffect, useRef, useState } from "react"

const FRAME_WIDTH = 390
/** Design frame tall enough for header + jar + action row; avoids clipping at scale 1. */
const FRAME_HEIGHT = 1024

function heightVisibleInViewport(el: HTMLElement): number {
  if (typeof window === "undefined") return el.getBoundingClientRect().height
  const r = el.getBoundingClientRect()
  const vv = window.visualViewport
  if (!vv) return r.height
  const vTop = vv.offsetTop
  const vBottom = vTop + vv.height
  const overlap = Math.min(r.bottom, vBottom) - Math.max(r.top, vTop)
  return Math.max(2, Math.min(r.height, overlap))
}

function computeScale(width: number, height: number): number {
  if (width < 2 || height < 2) return 1
  return Math.min(
    Math.max(0, width / FRAME_WIDTH),
    Math.max(0, height / FRAME_HEIGHT)
  )
}

/**
 * Scales the fixed design frame (390×FRAME_HEIGHT) to fit the parent. Parent should be a
 * flex child with min-h-0 so height resolves (fullscreen-style layout).
 */
export default function ScaleToFit({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => {
      const r = el.getBoundingClientRect()
      const h = heightVisibleInViewport(el)
      setScale(computeScale(r.width, h))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update)
      window.visualViewport.addEventListener("scroll", update)
    }
    return () => {
      ro.disconnect()
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
      ref={containerRef}
      className="flex h-full max-h-full w-full min-h-0 flex-col items-center justify-start"
    >
      <div
        style={{
          width: outerW,
          height: outerH,
          overflow: "hidden",
          position: "relative",
          flexShrink: 0,
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
    </div>
  )
}
