/**
 * Imagem (logo da empresa) para o PDF escrito à mão: JPEG vai como está (DCTDecode); PNG é aberto, os filtros de
 * linha são desfeitos e vira RGB + transparência (SMask), as duas compactadas de novo. Sem bibliotecas pesadas.
 * Formato que não der para ler devolve null (o PDF sai com o nome da empresa no lugar do logo).
 */
import { unzlibSync, zlibSync } from 'fflate'

export interface PdfImage {
  width: number
  height: number
  /** Dicionário + dados (latin1) do objeto da imagem; smask usa "{SMASK}" para o número do objeto da transparência. */
  image: { dict: string; data: Buffer }
  smask: { dict: string; data: Buffer } | null
}

const MAX_PIXELS = 4_000_000

export function pdfImage(content: Buffer, mime: string | null): PdfImage | null {
  try {
    if (mime === 'image/jpeg' || (content[0] === 0xff && content[1] === 0xd8)) return jpeg(content)
    if (mime === 'image/png' || content.subarray(1, 4).toString('latin1') === 'PNG') return png(content)
  } catch {
    return null
  }
  return null
}

function jpeg(b: Buffer): PdfImage | null {
  // Procura o marcador SOF (início do quadro) para a largura, altura e número de cores.
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = b.readUInt16BE(i + 5)
      const width = b.readUInt16BE(i + 7)
      const comps = b[i + 9]!
      const space = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB'
      if (!width || !height) return null
      return { width, height, image: { dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode${comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''}`, data: b }, smask: null }
    }
    i += 2 + len
  }
  return null
}

function png(b: Buffer): PdfImage | null {
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let type = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos)
    const kind = b.subarray(pos + 4, pos + 8).toString('latin1')
    const data = b.subarray(pos + 8, pos + 8 + len)
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]!
      type = data[9]!
      interlace = data[12]!
    } else if (kind === 'PLTE') palette = data
    else if (kind === 'tRNS') trns = data
    else if (kind === 'IDAT') idat.push(data)
    else if (kind === 'IEND') break
    pos += 12 + len
  }
  if (!width || !height || width * height > MAX_PIXELS || interlace || !idat.length) return null
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6]
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (type === 3 && !palette)) return null
  const raw = unzlibSync(new Uint8Array(Buffer.concat(idat)))
  const bitsPerPixel = channels * depth
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const pixels = new Uint8Array(stride * height)
  // Desfaz os filtros de cada linha (nenhum, sub, up, média, Paeth).
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[dst + x - bpp]! : 0
      const up = y ? pixels[dst - stride + x]! : 0
      const c = y && x >= bpp ? pixels[dst - stride + x - bpp]! : 0
      const v = raw[src + x]!
      let out = v
      if (f === 1) out = v + a
      else if (f === 2) out = v + up
      else if (f === 3) out = v + ((a + up) >> 1)
      else if (f === 4) {
        const p = a + up - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - c)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)
      }
      pixels[dst + x] = out & 0xff
    }
  }
  // Amostra (0..255) do canal ch do pixel x da linha y.
  const sample = (y: number, x: number, ch: number) => {
    if (depth === 8) return pixels[y * stride + x * channels + ch]!
    if (depth === 16) return pixels[y * stride + (x * channels + ch) * 2]!
    const bitPos = x * depth
    const byte = pixels[y * stride + (bitPos >> 3)]!
    const v = (byte >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1)
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1))
  }
  const rgb = new Uint8Array(width * height * 3)
  const alpha = new Uint8Array(width * height)
  let transparent = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let r: number, g: number, bl: number, a = 255
      if (type === 3) {
        const idx = sample(y, x, 0)
        r = palette![idx * 3] ?? 0
        g = palette![idx * 3 + 1] ?? 0
        bl = palette![idx * 3 + 2] ?? 0
        if (trns && idx < trns.length) a = trns[idx]!
      } else if (type === 0 || type === 4) {
        r = g = bl = sample(y, x, 0)
        if (type === 4) a = sample(y, x, 1)
      } else {
        r = sample(y, x, 0)
        g = sample(y, x, 1)
        bl = sample(y, x, 2)
        if (type === 6) a = sample(y, x, 3)
      }
      rgb[i * 3] = r
      rgb[i * 3 + 1] = g
      rgb[i * 3 + 2] = bl
      alpha[i] = a
      if (a < 255) transparent = true
    }
  }
  const base = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /Filter /FlateDecode`
  return {
    width,
    height,
    image: { dict: `${base} /ColorSpace /DeviceRGB${transparent ? ' /SMask {SMASK} 0 R' : ''}`, data: Buffer.from(zlibSync(rgb, { level: 6 })) },
    smask: transparent ? { dict: `${base} /ColorSpace /DeviceGray`, data: Buffer.from(zlibSync(alpha, { level: 6 })) } : null,
  }
}
