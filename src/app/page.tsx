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
        className="pointer-events-auto flex w-full max-w-full flex-wrap items-center justify-center gap-x-0.5 gap-y-px border-t border-black/[0.06] bg-white/65 px-2 py-0.5 text-center text-[10px] font-normal leading-tight text-neutral-400 opacity-[0.65] shadow-[0_-1px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.07] dark:bg-neutral-950/72 dark:text-neutral-500 dark:shadow-[0_-2px_14px_rgba(0,0,0,0.35)]"
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
        "orbifall-home-shell box-border flex min-h-[100dvh] flex-col px-2 " +
        "pt-[max(4px,env(safe-area-inset-top))] " +
        "pb-[calc(24px+env(safe-area-inset-bottom))]"
      }
    >
      <HomeBodyScroll />
      <h1 className="sr-only">Orbidrop – The Addictive Browser Game</h1>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
        <div className="flex w-full max-w-[420px] flex-col items-center">
          <div className="aspect-[3/4] max-h-[65vh] w-full min-h-0 max-w-full">
            <div className="h-full min-h-0 w-full">
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
