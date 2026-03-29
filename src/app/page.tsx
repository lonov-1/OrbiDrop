import type { Metadata } from "next"
import Link from "next/link"
import GameCanvasLoader from "./components/GameCanvasLoader"
import ScaleToFit from "./components/ScaleToFit"

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
}

function SiteFooterLinks() {
  const sep = (
    <span className="orbifall-site-footer-sep" aria-hidden>
      ·
    </span>
  )

  return (
    <footer className="orbifall-site-footer" role="contentinfo">
      <nav
        className="orbifall-site-footer-inner text-[var(--foreground)]"
        aria-label="Site links"
      >
        <Link href="/links">Links &amp; guide</Link>
        {sep}
        <Link href="/imprint">Imprint</Link>
        {sep}
        <Link href="/privacy">Privacy Policy</Link>
        {sep}
        <Link href="/terms">Terms of Use</Link>
      </nav>
    </footer>
  )
}

export default function Home() {
  return (
    <main className="orbifall-main orbifall-home">
      <h1 className="sr-only">Orbidrop – The Addictive Browser Game</h1>

      <div className="flex w-full max-w-[100vw] flex-col items-center px-1.5 sm:px-3">
        <ScaleToFit>
          <div className="orbifall-game-wrap">
            <GameCanvasLoader />
          </div>
        </ScaleToFit>
      </div>

      <SiteFooterLinks />
    </main>
  )
}
