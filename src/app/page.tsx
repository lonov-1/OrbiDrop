import type { Metadata } from "next"
import Link from "next/link"
import GameCanvasLoader from "./components/GameCanvasLoader"
import HomeBodyScroll from "./components/HomeBodyScroll"
import ScaleToFit from "./components/ScaleToFit"

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
}

function SiteFooterLinks() {
  const sep = (
    <span className="mx-0.5 select-none opacity-35 font-light" aria-hidden>
      ·
    </span>
  )

  return (
    <footer
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-[1200] flex justify-center pb-[env(safe-area-inset-bottom)]"
      role="contentinfo"
    >
      <nav
        className="pointer-events-auto flex w-full max-w-full shrink-0 flex-wrap items-center justify-center gap-x-0.5 gap-y-px border-t border-black/[0.06] bg-white/65 px-2 py-1 text-center text-[10px] font-normal leading-tight text-gray-400 opacity-60 shadow-[0_-1px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.07] dark:bg-neutral-950/72 dark:text-neutral-400 dark:opacity-70 dark:shadow-[0_-2px_14px_rgba(0,0,0,0.35)]"
        aria-label="Site links"
      >
        <Link
          href="/links"
          className="rounded px-0.5 py-px text-inherit no-underline opacity-80 hover:opacity-100 hover:underline"
        >
          Links &amp; guide
        </Link>
        {sep}
        <Link
          href="/imprint"
          className="rounded px-0.5 py-px text-inherit no-underline opacity-80 hover:opacity-100 hover:underline"
        >
          Imprint
        </Link>
        {sep}
        <Link
          href="/privacy"
          className="rounded px-0.5 py-px text-inherit no-underline opacity-80 hover:opacity-100 hover:underline"
        >
          Privacy Policy
        </Link>
        {sep}
        <Link
          href="/terms"
          className="rounded px-0.5 py-px text-inherit no-underline opacity-80 hover:opacity-100 hover:underline"
        >
          Terms of Use
        </Link>
      </nav>
    </footer>
  )
}

export default function Home() {
  return (
    <main
      className={
        "orbifall-home-shell box-border flex min-h-[100dvh] flex-col " +
        "pb-[calc(24px+env(safe-area-inset-bottom))]"
      }
    >
      <HomeBodyScroll />
      <h1 className="sr-only">Orbidrop – The Addictive Browser Game</h1>

      <div
        className="shrink-0 px-3 pt-[max(4px,env(safe-area-inset-top))] pb-2"
        aria-hidden
      />

      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="flex min-h-0 flex-1">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[420px] flex-col">
            <div className="relative min-h-0 w-full flex-1">
              <ScaleToFit>
                <GameCanvasLoader />
              </ScaleToFit>
            </div>
          </div>
        </div>
      </div>

      <SiteFooterLinks />
    </main>
  )
}
