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
        className="pointer-events-auto flex w-full max-w-full shrink-0 flex-wrap items-center justify-center gap-x-0.5 gap-y-px border-t border-black/[0.05] bg-white/80 px-2 py-1 text-center text-[10px] font-normal text-gray-400 opacity-60 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-neutral-950/85 dark:text-neutral-500 dark:opacity-70"
        aria-label="Site links"
      >
        <Link
          href="/links"
          className="rounded px-0.5 py-px font-medium text-inherit no-underline hover:opacity-100 hover:underline"
        >
          Links &amp; guide
        </Link>
        {sep}
        <Link
          href="/imprint"
          className="rounded px-0.5 py-px font-medium text-inherit no-underline hover:opacity-100 hover:underline"
        >
          Imprint
        </Link>
        {sep}
        <Link
          href="/privacy"
          className="rounded px-0.5 py-px font-medium text-inherit no-underline hover:opacity-100 hover:underline"
        >
          Privacy Policy
        </Link>
        {sep}
        <Link
          href="/terms"
          className="rounded px-0.5 py-px font-medium text-inherit no-underline hover:opacity-100 hover:underline"
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
        "orbifall-home-shell box-border flex min-h-[100dvh] flex-col bg-neutral-50 " +
        "pt-[env(safe-area-inset-top)] pb-[calc(22px+env(safe-area-inset-bottom))] dark:bg-neutral-950"
      }
    >
      <HomeBodyScroll />
      <h1 className="sr-only">Orbidrop – The Addictive Browser Game</h1>

      <div className="flex min-h-0 flex-1 flex-col px-3">
        <div className="mx-auto flex min-h-0 w-full max-w-[420px] flex-1 flex-col gap-2">
          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-white shadow-md dark:bg-neutral-900">
            <ScaleToFit>
              <GameCanvasLoader />
            </ScaleToFit>
          </div>
        </div>
      </div>

      <SiteFooterLinks />
    </main>
  )
}
