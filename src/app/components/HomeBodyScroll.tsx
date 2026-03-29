"use client"

import { useLayoutEffect } from "react"

const SCROLL_CLASS = "orbifall-home-scroll"

/**
 * Mirrors globals.css :has(.orbifall-home-shell) rules for html/body.
 * Some WebKit builds lag or omit :has(); without these, body keeps overflow:hidden
 * and the home layout matches the old “stuck viewport” look.
 */
export default function HomeBodyScroll() {
  useLayoutEffect(() => {
    document.documentElement.classList.add(SCROLL_CLASS)
    document.body.classList.add(SCROLL_CLASS)
    return () => {
      document.documentElement.classList.remove(SCROLL_CLASS)
      document.body.classList.remove(SCROLL_CLASS)
    }
  }, [])
  return null
}
