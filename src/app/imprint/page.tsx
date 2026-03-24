import type { Metadata } from "next"
import { LegalBackLink } from "@/app/components/LegalBackLink"

export const metadata: Metadata = {
  title: "Imprint",
  description:
    "Legal imprint for Orbidrop (orbidrop.com): operator contact and site information.",
  alternates: {
    canonical: "/imprint",
  },
}

export default function Imprint() {
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
      <h1>Imprint</h1>

      <p>This website is operated by:</p>

      <p>
        Leon Ring
        <br />
        Thurngasse 19/10
        <br />
        1090 Vienna
        <br />
        Austria
      </p>

      <p>
        Email:{" "}
        <a href="mailto:leon1992@hotmail.de">leon1992@hotmail.de</a>
      </p>

      <p>
        Website:{" "}
        <a href="https://orbidrop.com" rel="noopener noreferrer">
          https://orbidrop.com
        </a>
      </p>

      <p>This is a private, non-commercial project.</p>
    </main>
  )
}
