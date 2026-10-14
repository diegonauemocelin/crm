// Gera os ícones das redes sociais usados nos e-mails (PNG 96x96, mostrados em 32 px: nítidos em tela retina).
// E-mail não mostra SVG (Gmail/Outlook), e ícone de site de terceiros pode sumir: por isso PNG próprio, servido pelo CRM.
// Uso: node scripts/gerar-icones-redes.mjs  -> grava apps/api/src/email/icones.ts
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 96
const SS = 4 // amostras por eixo (antisserrilhado)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// Formas em coordenadas de 0 a 1.
const disk = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
function rrect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (!rect(x0, y0, x1, y1)(x, y)) return false
    const cx = Math.min(Math.max(x, x0 + r), x1 - r)
    const cy = Math.min(Math.max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
}
const tri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const s = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy)
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx, cy), d3 = s(cx, cy, ax, ay)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
const or = (...f) => (x, y) => f.some((g) => g(x, y))
const and = (...f) => (x, y) => f.every((g) => g(x, y))
const not = (f) => (x, y) => !f(x, y)

const GLYPH = {
  // "f": haste com a curva no alto e a barra do meio.
  facebook: or(rect(0.45, 0.33, 0.58, 0.8), and(disk(0.6, 0.35, 0.15), rect(0.45, 0.2, 0.6, 0.35), not(disk(0.6, 0.35, 0.02))), rect(0.6, 0.2, 0.68, 0.31), rect(0.36, 0.44, 0.66, 0.54)),
  // Câmera: quadrado arredondado vazado, círculo vazado e o ponto do flash.
  instagram: or(and(rrect(0.25, 0.25, 0.75, 0.75, 0.15), not(rrect(0.31, 0.31, 0.69, 0.69, 0.1))), and(disk(0.5, 0.5, 0.125), not(disk(0.5, 0.5, 0.068))), disk(0.635, 0.365, 0.032)),
  // Tela arredondada com o triângulo do play recortado.
  youtube: and(rrect(0.2, 0.31, 0.8, 0.69, 0.1), not(tri(0.44, 0.4, 0.44, 0.6, 0.615, 0.5))),
  // Nota musical: bolinha, haste e a bandeira.
  tiktok: or(disk(0.44, 0.65, 0.115), rect(0.5, 0.22, 0.585, 0.66), and(disk(0.585, 0.22, 0.17), rect(0.585, 0.22, 0.76, 0.39), not(disk(0.76, 0.39, 0.12)))),
}
const COLOR = { facebook: [0x18, 0x77, 0xf2], instagram: [0xe4, 0x40, 0x5f], youtube: [0xff, 0x00, 0x00], tiktok: [0x00, 0x00, 0x00] }
const GRAY = [0x4b, 0x55, 0x63]

function icon(glyph, bg) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const circle = disk(0.5, 0.5, 0.5)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let inC = 0
      let inG = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / SIZE
          const v = (y + (sy + 0.5) / SS) / SIZE
          if (circle(u, v)) {
            inC++
            if (glyph(u, v)) inG++
          }
        }
      }
      const a = inC / (SS * SS)
      const g = inC ? inG / inC : 0
      const i = (y * SIZE + x) * 4
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(bg[k] * (1 - g) + 255 * g)
      px[i + 3] = Math.round(a * 255)
    }
  }
  return png(px).toString('base64')
}

let out = `// Gerado por scripts/gerar-icones-redes.mjs (não edite à mão). Ícones PNG 96x96 das redes sociais para os e-mails.\n\nexport type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'tiktok'\nexport type SocialStyle = 'cor' | 'cinza'\n\nexport const SOCIAL_ICONS: Record<SocialNetwork, Record<SocialStyle, string>> = {\n`
for (const n of Object.keys(GLYPH)) out += `  ${n}: {\n    cor: '${icon(GLYPH[n], COLOR[n])}',\n    cinza: '${icon(GLYPH[n], GRAY)}',\n  },\n`
out += '}\n'
writeFileSync(new URL('../apps/api/src/email/icones.ts', import.meta.url), out)
console.log('ok', out.length, 'bytes')
