import { IMAGE_RATIOS, type ImageRatio } from './email'

/**
 * Contas do editor de imagem do e-mail (recorte, zoom, ajustes): funções puras, usadas pelo diálogo
 * (components/email/image-editor.tsx).
 */

/** Mesmo limite do envio de imagens do e-mail (o servidor confere de novo). */
export const EMAIL_IMAGE_LIMIT = 1.5 * 1024 * 1024
/** Largura máxima do arquivo gerado: o dobro dos 600 px do e-mail, nítida em tela de alta resolução. */
export const OUTPUT_MAX_WIDTH = 1200
const MIN_CROP = 16
export const MAX_ZOOM = 5

export type RatioChoice = 'livre' | 'original' | ImageRatio
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Adjust {
  /** Em %, 100 = sem mudança. */
  brightness: number
  contrast: number
  saturation: number
}
export const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturation: 100 }

/** Proporção (largura / altura) do formato escolhido; null = livre. */
export function ratioValue(choice: RatioChoice, w: number, h: number): number | null {
  if (choice === 'livre') return null
  if (choice === 'original') return w / h
  return IMAGE_RATIOS.find((r) => r.id === choice)?.value ?? null
}

/** Maior retângulo com a proporção dada, centralizado na imagem (w x h). */
export function fitRect(w: number, h: number, ratio: number | null): Rect {
  if (!ratio) return { x: 0, y: 0, w, h }
  let cw = w
  let ch = w / ratio
  if (ch > h) {
    ch = h
    cw = h * ratio
  }
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }
}

/** Aproxima (zoom > 1) ou afasta o recorte, mantendo o centro e a proporção e sem sair da imagem. */
export function zoomRect(r: Rect, w: number, h: number, ratio: number | null, zoom: number): Rect {
  const base = fitRect(w, h, ratio ?? r.w / r.h)
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom))
  const nw = Math.max(MIN_CROP, base.w / z)
  const nh = Math.max(MIN_CROP, base.h / z)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return { x: Math.min(Math.max(0, cx - nw / 2), w - nw), y: Math.min(Math.max(0, cy - nh / 2), h - nh), w: nw, h: nh }
}

/** Quanto o recorte está aproximado (1 = o maior possível na proporção). */
export function zoomOf(r: Rect, w: number, h: number): number {
  const base = fitRect(w, h, r.w / r.h)
  return Math.min(MAX_ZOOM, Math.max(1, base.w / r.w))
}

export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/** Arrastar o recorte (move) ou um canto dele (o canto oposto fica parado); dx/dy em pixels da imagem. */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, w: number, h: number, ratio: number | null): Rect {
  if (handle === 'move') return { ...start, x: Math.min(Math.max(0, start.x + dx), w - start.w), y: Math.min(Math.max(0, start.y + dy), h - start.h) }
  const sx = handle === 'ne' || handle === 'se' ? 1 : -1
  const sy = handle === 'sw' || handle === 'se' ? 1 : -1
  const ax = sx > 0 ? start.x : start.x + start.w
  const ay = sy > 0 ? start.y : start.y + start.h
  const maxW = sx > 0 ? w - ax : ax
  const maxH = sy > 0 ? h - ay : ay
  let nw = Math.min(maxW, Math.max(MIN_CROP, start.w + sx * dx))
  let nh = Math.min(maxH, Math.max(MIN_CROP, start.h + sy * dy))
  if (ratio) {
    // Segue o lado que mais mudou e acerta o outro pela proporção.
    nw = Math.abs(dx) >= Math.abs(dy * ratio) ? nw : nh * ratio
    nw = Math.min(nw, maxW, maxH * ratio)
    nh = nw / ratio
  }
  return { x: sx > 0 ? ax : ax - nw, y: sy > 0 ? ay : ay - nh, w: nw, h: nh }
}

/** Tamanho do arquivo final: até 1200 px de largura, nunca maior que o recorte (não estica). */
export function outputSize(r: Rect, max = OUTPUT_MAX_WIDTH) {
  const w = Math.max(1, Math.round(Math.min(max, r.w)))
  return { w, h: Math.max(1, Math.round((r.h * w) / r.w)) }
}

/** Formato do arquivo gerado: o mesmo da imagem de origem (GIF e outros viram PNG). */
export function outputType(mime: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  return mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png'
}

/** Brilho, contraste e saturação nos pixels (mesmas fórmulas do filtro do navegador, na mesma ordem). */
export function applyAdjust(data: Uint8ClampedArray, a: Adjust) {
  const b = a.brightness / 100
  const c = a.contrast / 100
  const s = a.saturation / 100
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s] as const
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]! * b
    let g = data[i + 1]! * b
    let bl = data[i + 2]! * b
    r = (r - 127.5) * c + 127.5
    g = (g - 127.5) * c + 127.5
    bl = (bl - 127.5) * c + 127.5
    data[i] = m[0] * r + m[1] * g + m[2] * bl
    data[i + 1] = m[3] * r + m[4] * g + m[5] * bl
    data[i + 2] = m[6] * r + m[7] * g + m[8] * bl
  }
}

/** Nome do arquivo editado: "<nome> (editada).<ext>". */
export function editedName(name: string | null | undefined, type: string) {
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
  const base = (name ?? '').replace(/\.(png|jpe?g|gif|webp)$/i, '').replace(/\s*\(editada\)$/i, '').trim().slice(0, 100) || 'imagem'
  return `${base} (editada).${ext}`
}

/**
 * Endereço para abrir a imagem no editor: as imagens do próprio sistema são lidas pelo mesmo endereço do painel
 * (o canvas só exporta imagens do mesmo site ou com permissão).
 */
export function editableUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href)
    if (/^\/api\/files\/public\/[0-9a-fA-F-]{36}$/.test(u.pathname)) return u.pathname
    return u.toString()
  } catch {
    return url
  }
}
