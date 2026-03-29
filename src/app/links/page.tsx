import type { Metadata } from "next"
import Link from "next/link"
import { LegalBackLink } from "@/app/components/LegalBackLink"
import { ScrollToHash } from "@/app/components/ScrollToHash"

export const metadata: Metadata = {
  title: "Links & guide",
  description:
    "Orbidrop — free browser skill game: how to play, high-score tips, and links to imprint, privacy policy, and terms of use.",
  alternates: {
    canonical: "/links",
  },
}

export default function LinksPage() {
  return (
    <main
      className="orbifall-legal-main"
      style={{
        maxWidth: "700px",
        margin: "0 auto",
        padding: "40px 20px 48px",
        lineHeight: 1.6,
      }}
    >
      <ScrollToHash />
      <LegalBackLink />

      <header className="text-center">
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Orbidrop – The Addictive Browser Game
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-black/75 dark:text-white/75">
          Orbidrop is a free browser-based skill game where you drop and combine elements
          before the container fills up. Easy to play, hard to master.
        </p>
      </header>

      <nav
        className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm"
        aria-label="On this page"
      >
        <a href="#how-to-play" className="text-[#2a9d8f] underline-offset-4 hover:underline">
          How to play
        </a>
        <a href="#tips" className="text-[#2a9d8f] underline-offset-4 hover:underline">
          Tips
        </a>
        <Link href="/imprint" className="text-[#2a9d8f] underline-offset-4 hover:underline">
          Imprint
        </Link>
        <Link href="/privacy" className="text-[#2a9d8f] underline-offset-4 hover:underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="text-[#2a9d8f] underline-offset-4 hover:underline">
          Terms of Use
        </Link>
      </nav>

      <section id="how-to-play" className="mt-12 scroll-mt-8">
        <h2 className="text-xl font-semibold">How to play Orbidrop</h2>
        <p className="mt-3">
          Aim each drop toward the target number and release when you are ready. You have three
          attempts per day—use them wisely.
        </p>
        <p className="mt-3">
          Orbidrop is a{" "}
          <Link href="/" className="text-[#2a9d8f] underline-offset-4 hover:underline">
            free browser skill game
          </Link>{" "}
          built around careful aiming the target number. Each day gives you a
          new target number and three attempts.
        </p>
        
        <p className="mt-3">
          For quick improvement, read the{" "}
          <a href="#tips" className="text-[#2a9d8f] underline-offset-4 hover:underline">
            tips for a high score
          </a>{" "}
          below, then return to the{" "}
          <Link href="/" className="text-[#2a9d8f] underline-offset-4 hover:underline">
            Orbidrop game
          </Link>
          .
        </p>
      </section>

      <section id="tips" className="mt-12 scroll-mt-8">
        <h2 className="text-xl font-semibold">Tips to get a high score in Orbidrop</h2>
        <h3 className="mt-6 text-lg font-semibold">Quick tips</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            Prioritize the feeling for the glass filling up.
          </li>
          <li>
            Watch the jar height early.
          </li>
          <li>
            Save your last attempt for a attempt trying to count the orbs and feeling the glass filling up.
          </li>
        </ul>
        <p className="mt-6">
          A strong Orbidrop round is about feeling and timing.
        </p>
        <p className="mt-3">
          Treat your attempts like a small budget. 
        </p>
        <p className="mt-3">
          When you are ready to apply this, jump back to the{" "}
          <Link href="/" className="text-[#2a9d8f] underline-offset-4 hover:underline">
            Orbidrop game
          </Link>
          . New to the rules? See{" "}
          <a href="#how-to-play" className="text-[#2a9d8f] underline-offset-4 hover:underline">
            how to play
          </a>{" "}
          above.
        </p>
      </section>

      <footer
        className="mt-14 border-t border-black/10 pt-8 text-center text-xs opacity-60 dark:border-white/10"
      >
        <Link href="/" className="hover:opacity-100">
          Play
        </Link>
        {" · "}
        <Link href="/imprint" className="hover:opacity-100">
          Imprint
        </Link>
        {" · "}
        <Link href="/privacy" className="hover:opacity-100">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:opacity-100">
          Terms of Use
        </Link>
      </footer>
    </main>
  )
}
