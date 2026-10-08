/**
 * Layout visual de pop-ups e formulários (editor visual). O que o editor manda é conferido aqui, valor por valor:
 * só tipos de bloco conhecidos, cores #rrggbb, números dentro de faixas, links e imagens só https.
 * No site, o script monta tudo com createElement/textContent (nunca HTML livre). Funções puras (test/captura.spec.ts).
 */

export const POSITIONS = ['centro', 'inferior_direita', 'inferior_esquerda'] as const
export const MOBILE_POSITIONS = ['centro', 'inferior', 'tela_cheia'] as const
export const SHADOWS = ['nenhuma', 'suave', 'forte'] as const
export const FONTS = ['sistema', 'moderna', 'arredondada', 'serifada', 'condensada'] as const
export const ALIGNS = ['esquerda', 'centro', 'direita'] as const
export const BLOCK_TYPES = ['imagem', 'titulo', 'texto', 'formulario', 'cupom', 'espaco', 'divisor', 'recusar'] as const

export type BlockType = (typeof BLOCK_TYPES)[number]
type Align = (typeof ALIGNS)[number]

export interface Box {
  width: number
  radius: number
  shadow: (typeof SHADOWS)[number]
  bg: string
  text: string
  font: (typeof FONTS)[number]
  padding: number
  position: (typeof POSITIONS)[number]
  overlay: boolean
  overlayOpacity: number
  closeColor: string
}
export interface Mobile {
  position: (typeof MOBILE_POSITIONS)[number]
  fontScale: number
  hideImages: boolean
}

export type Block =
  | { id: string; type: 'imagem'; url: string; height: number; fit: 'cobrir' | 'conter'; radius: number; link: string | null; bleed: boolean }
  | { id: string; type: 'titulo'; text: string; size: number; align: Align; color: string; bold: boolean }
  | { id: string; type: 'texto'; text: string; size: number; align: Align; color: string }
  | {
      id: string
      type: 'formulario'
      columns: 1 | 2
      showLabels: boolean
      labelColor: string
      inputBg: string
      inputBorder: string
      inputRadius: number
      buttonText: string | null
      buttonBg: string
      buttonColor: string
      buttonRadius: number
      buttonFull: boolean
    }
  | { id: string; type: 'cupom'; code: string; label: string; bg: string; color: string; afterSubmit: boolean }
  | { id: string; type: 'espaco'; height: number }
  | { id: string; type: 'divisor'; color: string }
  | { id: string; type: 'recusar'; text: string; color: string }

export interface Design {
  v: 1
  box: Box
  mobile: Mobile
  blocks: Block[]
}

const COLOR = /^#[0-9a-f]{6}$/i
const ID = /^[A-Za-z0-9_-]{1,40}$/

const color = (v: unknown, fallback: string) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : fallback)
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
/** Texto puro: sem caracteres de controle (quebra de linha é permitida no texto). */
const text = (v: unknown, max: number, multiline = false) =>
  String(v ?? '')
    .replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '')
    .slice(0, max)
/** Só https (ou o endereço do próprio CRM, para as imagens enviadas pelo editor). */
const https = (v: unknown, own?: string): string | null => {
  const s = String(v ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.username || u.password) return null
    return u.protocol === 'https:' || (own && u.origin === own) ? u.toString() : null
  } catch {
    return null
  }
}

export const DEFAULT_BOX: Box = {
  width: 420,
  radius: 14,
  shadow: 'forte',
  bg: '#ffffff',
  text: '#0f172a',
  font: 'sistema',
  padding: 20,
  position: 'centro',
  overlay: true,
  overlayOpacity: 55,
  closeColor: '#0f172a',
}
export const DEFAULT_MOBILE: Mobile = { position: 'inferior', fontScale: 100, hideImages: false }

function cleanBlock(raw: unknown, i: number, own?: string): Block | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>
  const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : `b${i + 1}`
  const type = b.type as BlockType
  switch (type) {
    case 'imagem': {
      const url = https(b.url, own)
      if (!url) return { error: 'Imagem precisa de um endereço https:// (ou envie a imagem pelo editor).' }
      return { id, type, url, height: num(b.height, 60, 480, 180), fit: b.fit === 'conter' ? 'conter' : 'cobrir', radius: num(b.radius, 0, 32, 0), link: https(b.link), bleed: b.bleed !== false }
    }
    case 'titulo': {
      const t = text(b.text, 160).trim()
      if (!t) return { error: 'Título vazio.' }
      return { id, type, text: t, size: num(b.size, 14, 48, 22), align: pick(b.align, ALIGNS, 'esquerda'), color: color(b.color, '#0f172a'), bold: b.bold !== false }
    }
    case 'texto': {
      const t = text(b.text, 1000, true).trim()
      if (!t) return { error: 'Bloco de texto vazio.' }
      return { id, type, text: t, size: num(b.size, 11, 24, 14), align: pick(b.align, ALIGNS, 'esquerda'), color: color(b.color, '#334155') }
    }
    case 'formulario':
      return {
        id,
        type,
        columns: Number(b.columns) === 2 ? 2 : 1,
        showLabels: b.showLabels !== false,
        labelColor: color(b.labelColor, '#111111'),
        inputBg: color(b.inputBg, '#ffffff'),
        inputBorder: color(b.inputBorder, '#cbd5e1'),
        inputRadius: num(b.inputRadius, 0, 24, 8),
        buttonText: text(b.buttonText, 60).trim() || null,
        buttonBg: color(b.buttonBg, '#1d4ed8'),
        buttonColor: color(b.buttonColor, '#ffffff'),
        buttonRadius: num(b.buttonRadius, 0, 40, 8),
        buttonFull: b.buttonFull !== false,
      }
    case 'cupom': {
      const code = text(b.code, 40).trim().toUpperCase()
      if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return { error: 'Cupom: use só letras, números, hífen ou sublinhado (2 a 40).' }
      return { id, type, code, label: text(b.label, 120).trim(), bg: color(b.bg, '#fef3c7'), color: color(b.color, '#92400e'), afterSubmit: b.afterSubmit !== false }
    }
    case 'espaco':
      return { id, type, height: num(b.height, 4, 80, 12) }
    case 'divisor':
      return { id, type, color: color(b.color, '#e2e8f0') }
    case 'recusar': {
      const t = text(b.text, 80).trim()
      return { id, type, text: t || 'Não, obrigado', color: color(b.color, '#64748b') }
    }
    default:
      return { error: 'Tipo de bloco desconhecido.' }
  }
}

/** Confere o layout. Pop-up e formulário precisam de exatamente um bloco "formulário"; "Não, obrigado" só no pop-up. */
export function cleanDesign(raw: unknown, kind: 'popup' | 'form', own?: string): { design: Design } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const bx = (r.box ?? {}) as Record<string, unknown>
  const mb = (r.mobile ?? {}) as Record<string, unknown>
  const box: Box = {
    width: num(bx.width, 280, 760, DEFAULT_BOX.width),
    radius: num(bx.radius, 0, 32, DEFAULT_BOX.radius),
    shadow: pick(bx.shadow, SHADOWS, DEFAULT_BOX.shadow),
    bg: color(bx.bg, DEFAULT_BOX.bg),
    text: color(bx.text, DEFAULT_BOX.text),
    font: pick(bx.font, FONTS, DEFAULT_BOX.font),
    padding: num(bx.padding, 8, 48, DEFAULT_BOX.padding),
    position: pick(bx.position, POSITIONS, DEFAULT_BOX.position),
    overlay: bx.overlay !== false,
    overlayOpacity: num(bx.overlayOpacity, 0, 90, DEFAULT_BOX.overlayOpacity),
    closeColor: color(bx.closeColor, DEFAULT_BOX.closeColor),
  }
  const mobile: Mobile = {
    position: pick(mb.position, MOBILE_POSITIONS, DEFAULT_MOBILE.position),
    fontScale: num(mb.fontScale, 80, 120, DEFAULT_MOBILE.fontScale),
    hideImages: mb.hideImages === true,
  }
  const list = Array.isArray(r.blocks) ? r.blocks : []
  if (list.length > 20) return { error: 'Use no máximo 20 blocos.' }
  const blocks: Block[] = []
  const ids = new Set<string>()
  for (const [i, raw] of list.entries()) {
    const b = cleanBlock(raw, i, own)
    if ('error' in b) return { error: b.error }
    if (ids.has(b.id)) b.id = `${b.id}-${i}`
    ids.add(b.id)
    if (b.type === 'recusar' && kind === 'form') continue
    blocks.push(b)
  }
  const forms = blocks.filter((b) => b.type === 'formulario').length
  if (forms !== 1) return { error: forms === 0 ? 'Inclua o bloco “Formulário” (os campos e o botão de enviar).' : 'Use só um bloco “Formulário”.' }
  return { design: { v: 1, box, mobile, blocks } }
}
