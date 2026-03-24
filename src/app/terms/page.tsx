import type { Metadata } from "next"
import { LegalBackLink } from "@/app/components/LegalBackLink"

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms of Use for Orbidrop: fair play, availability, liability, and conditions for using the free browser game.",
  alternates: {
    canonical: "/terms",
  },
}

export default function Terms() {
  return (
    <main
      className="orbifall-legal-main"
      style={{
        maxWidth: "700px",
        margin: "40px auto",
        padding: "20px",
        lineHeight: "1.6"
      }}
    >
      <LegalBackLink />
      <h1>Terms of Use</h1>

      <h3>1. General</h3>
      <p>Orbidrop is a free browser game provided for entertainment.</p>

      <h3>2. No Guarantee</h3>
      <p>
        We do not guarantee that the game will always work perfectly or be available at
        all times.
      </p>

      <h2>3. Data</h2>
      <p>
        Game progress may be stored locally or online. We do not guarantee permanent
        storage.
      </p>

      <h3>4. Fair Play</h3>
      <p>Do not cheat, exploit bugs, or use bots.</p>

      <h3>5. Liability</h3>
      <p>We are not responsible for any damages or data loss.</p>

      <h2>6. Changes</h2>
      <p>The game may be changed or removed at any time.</p>

      <h3>7. Law</h3>
      <p>Austrian law applies.</p>
    </main>
  )
}
