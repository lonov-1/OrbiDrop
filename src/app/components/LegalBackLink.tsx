import Link from "next/link"

export function LegalBackLink() {
  return (
    <Link
      href="/"
      className="mb-6 inline-flex items-center gap-2 text-[15px] font-semibold text-[#2a9d8f] underline-offset-4 hover:underline"
    >
      ← Back to game
    </Link>
  )
}
