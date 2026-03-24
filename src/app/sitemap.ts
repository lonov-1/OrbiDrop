import type { MetadataRoute } from "next"

const base = "https://orbidrop.com"

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "", changeFrequency: "weekly" as const, priority: 1 },
    { path: "/imprint", changeFrequency: "monthly" as const, priority: 0.6 },
    { path: "/privacy", changeFrequency: "monthly" as const, priority: 0.6 },
    { path: "/terms", changeFrequency: "monthly" as const, priority: 0.6 },
    { path: "/links", changeFrequency: "monthly" as const, priority: 0.85 },
  ]

  const now = new Date()

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: path === "" ? base : `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }))
}
