"use client"

import { useEffect } from "react"

/** Scrolls to `window.location.hash` on mount (e.g. after navigating to /links#how-to-play). */
export function ScrollToHash() {
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  return null
}
