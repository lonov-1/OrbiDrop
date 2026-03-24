import sharp from "sharp"
import { writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, "..", "public", "og-image.png")

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#134e48"/>
      <stop offset="100%" style="stop-color:#2a9d8f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="300" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="92" font-weight="700" fill="#ffffff">Orbidrop</text>
  <text x="600" y="392" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="34" fill="rgba(255,255,255,0.92)">Addictive Browser Game</text>
</svg>`

const buf = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync(out, buf)
console.log("Wrote", out)
