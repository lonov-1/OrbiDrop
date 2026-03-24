import type { Metadata } from "next"
import { LegalBackLink } from "@/app/components/LegalBackLink"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Orbidrop: how we handle data, hosting, and your rights when you play our browser game.",
  alternates: {
    canonical: "/privacy",
  },
}

export default function Privacy() {
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
      <h1>Privacy Policy</h1>

      <p>
        We take your privacy seriously. This website is designed to collect as little
        personal data as possible.
      </p>

      <h3>Data We Process</h3>
      <p>When you use Orbidrop, we may process:</p>
      <ul>
        <li>Anonymous PlayID</li>
        <li>Game scores and progress</li>
        <li>Technical data (e.g. errors, performance)</li>
      </ul>
      <p>This data is not used to identify you personally.</p>

      <h3>Storage</h3>
      <p>
        Data is stored locally in your browser and on servers provided by Supabase.
      </p>

      <h2>Hosting</h2>
      <p>
        This website is hosted by Vercel (USA). Your IP address may be processed as part
        of normal operation.
      </p>

      <h3>Cookies</h3>
      <p>
        We do not use tracking cookies. Only necessary local storage is used to make the
        game work.
      </p>

      <h3>Purpose</h3>
      <p>Data is used only to run and improve the game.</p>

      <h3>Your Rights</h3>
      <p>
        You have the right to request access or deletion of your data. Contact:{" "}
        <a href="mailto:leon1992@hotmail.de">leon1992@hotmail.de</a>
      </p>
    </main>
  )
}
