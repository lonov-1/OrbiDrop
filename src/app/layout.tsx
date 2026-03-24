import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/react"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const siteUrl = "https://orbidrop.com"
const defaultTitle = "Orbidrop – Addictive Free Browser Skill Game"
const defaultDescription =
  "Play Orbidrop – a fast-paced, addictive browser game. Drop, aim and survive before the glass fills up. Free and no download needed."

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: "%s | Orbidrop",
  },
  description: defaultDescription,
  keywords: [
    "free browser game",
    "addictive game",
    "skill game",
    "online game",
    "physics game",
    "Orbidrop",
  ],
  applicationName: "Orbidrop",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Orbidrop",
    title: defaultTitle,
    description: defaultDescription,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Orbidrop – Addictive Browser Game",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
    images: ["/og-image.png"],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Orbidrop",
    statusBarStyle: "default",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/icon-192.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#2a9d8f",
}

const videoGameJsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Orbidrop",
  description: "Addictive browser-based skill game",
  applicationCategory: "Game",
  operatingSystem: "Any",
  url: siteUrl,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(videoGameJsonLd),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("orbifallDarkMode");var d=window.matchMedia("(prefers-color-scheme:dark)").matches;document.documentElement.dataset.theme=t==="dark"||(t!=="light"&&d)?"dark":"light";})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  )
}
