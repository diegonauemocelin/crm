/**
 * Artes e vídeos montados no navegador (sem servidor de imagem): enquadra a foto no tamanho do Instagram, coloca a
 * marca e o texto, e grava JPEG (o Instagram só aceita JPEG). O vídeo é gravado do canvas com o MediaRecorder.
 */

export type Frame = 'quadrado' | 'retrato' | 'stories'
export const FRAMES: Record<Frame, { label: string; w: number; h: number }> = {
  quadrado: { label: 'Quadrado 1:1 (feed)', w: 1080, h: 1080 },
  retrato: { label: 'Retrato 4:5 (feed)', w: 1080, h: 1350 },
  stories: { label: 'Vertical 9:16 (Stories e Reels)', w: 1080, h: 1920 },
}

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = typeof src === 'string' ? src : URL.createObjectURL(src)
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => reject(new Error('Não foi possível abrir a imagem.'))
    img.src = url
  })
}

export interface ArtOptions {
  frame: Frame
  /** cobrir: preenche o quadro (corta as sobras); caber: mostra a foto inteira com fundo colorido. */
  fit: 'cobrir' | 'caber'
  background: string
  headline: string
  subtitle: string
  /** Faixa da marca embaixo, com o texto (cor da marca). */
  bar: boolean
  barColor: string
  barText: string
  logo: HTMLImageElement | null
  textColor: string
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = test
    }
    lines.push(line)
  }
  return lines.filter((l, i, a) => l || i < a.length - 1)
}

/** Desenha a arte no canvas (já no tamanho do quadro). */
export function drawArt(canvas: HTMLCanvasElement, photo: HTMLImageElement | null, o: ArtOptions) {
  const { w, h } = FRAMES[o.frame]
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = o.background
  ctx.fillRect(0, 0, w, h)
  const barH = o.bar ? Math.round(h * 0.11) : 0
  const area = { x: 0, y: 0, w, h: h - barH }
  if (photo) {
    const s = o.fit === 'cobrir' ? Math.max(area.w / photo.width, area.h / photo.height) : Math.min(area.w / photo.width, area.h / photo.height) * 0.92
    const pw = photo.width * s
    const ph = photo.height * s
    ctx.drawImage(photo, area.x + (area.w - pw) / 2, area.y + (area.h - ph) / 2, pw, ph)
  }
  const pad = Math.round(w * 0.06)
  if (o.headline.trim() || o.subtitle.trim()) {
    // Degradê atrás do texto, para ler sobre qualquer foto.
    const g = ctx.createLinearGradient(0, 0, 0, area.h * 0.45)
    g.addColorStop(0, 'rgba(0,0,0,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, area.h * 0.45)
    ctx.fillStyle = o.textColor
    ctx.textBaseline = 'top'
    let y = pad
    if (o.headline.trim()) {
      const size = Math.round(w * 0.075)
      ctx.font = `800 ${size}px Inter, Arial, sans-serif`
      for (const l of wrap(ctx, o.headline.trim(), w - pad * 2).slice(0, 4)) {
        ctx.fillText(l, pad, y)
        y += size * 1.15
      }
      y += size * 0.2
    }
    if (o.subtitle.trim()) {
      const size = Math.round(w * 0.04)
      ctx.font = `500 ${size}px Inter, Arial, sans-serif`
      for (const l of wrap(ctx, o.subtitle.trim(), w - pad * 2).slice(0, 4)) {
        ctx.fillText(l, pad, y)
        y += size * 1.3
      }
    }
  }
  if (o.bar) {
    ctx.fillStyle = o.barColor
    ctx.fillRect(0, h - barH, w, barH)
    let x = pad
    if (o.logo) {
      const lh = barH * 0.6
      const lw = (o.logo.width / o.logo.height) * lh
      ctx.drawImage(o.logo, pad, h - barH + (barH - lh) / 2, lw, lh)
      x += lw + pad * 0.6
    }
    if (o.barText.trim()) {
      const size = Math.round(barH * 0.3)
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`
      ctx.fillStyle = contrastOn(o.barColor)
      ctx.textBaseline = 'middle'
      ctx.fillText(o.barText.trim(), x, h - barH / 2, w - x - pad)
    }
  } else if (o.logo) {
    const lh = Math.round(h * 0.06)
    const lw = (o.logo.width / o.logo.height) * lh
    ctx.drawImage(o.logo, w - pad - lw, h - pad - lh, lw, lh)
  }
}

/** Texto preto ou branco, o que ler melhor sobre a cor. */
export function contrastOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1]!, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff'
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/jpeg', quality))
}

/** Formato de vídeo que o navegador grava e o Instagram aceita (MP4/H.264). Null = este navegador não grava MP4. */
export function mp4Type(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

/**
 * Vídeo a partir de fotos: cada foto aparece por alguns segundos com um leve zoom, no quadro escolhido, com a arte
 * (texto e marca) por cima. Grava o canvas em tempo real (o vídeo leva o mesmo tempo para ficar pronto).
 */
export async function photosToVideo(photos: HTMLImageElement[], o: ArtOptions & { seconds: number }, onProgress?: (p: number) => void): Promise<Blob> {
  const type = mp4Type()
  if (!type) throw new Error('Este navegador não grava vídeo MP4 (o formato do Instagram). Use o Google Chrome atualizado ou o Microsoft Edge.')
  const canvas = document.createElement('canvas')
  const { w, h } = FRAMES[o.frame]
  canvas.width = w
  canvas.height = h
  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }))))
  const total = photos.length * o.seconds * 1000
  const tmp = document.createElement('canvas')
  rec.start(500)
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = performance.now() - start
      if (t >= total) return resolve()
      const i = Math.min(photos.length - 1, Math.floor(t / (o.seconds * 1000)))
      const local = (t % (o.seconds * 1000)) / (o.seconds * 1000)
      drawArt(tmp, photos[i]!, o)
      const ctx = canvas.getContext('2d')!
      const zoom = 1 + 0.06 * local
      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.scale(zoom, zoom)
      ctx.drawImage(tmp, -w / 2, -h / 2)
      ctx.restore()
      onProgress?.(t / total)
      requestAnimationFrame(frame)
    }
    frame()
  })
  rec.stop()
  stream.getTracks().forEach((t) => t.stop())
  onProgress?.(1)
  return done
}
