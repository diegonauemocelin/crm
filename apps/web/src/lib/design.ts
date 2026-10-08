/** Editor visual de pop-ups e formulários: tipos, padrões e modelos prontos (o servidor confere tudo de novo). */
import type { LucideIcon } from 'lucide-react'
import { ImageIcon, MinusIcon, MoveVerticalIcon, TextIcon, TicketIcon, TypeIcon, UndoIcon, ClipboardListIcon } from 'lucide-react'

export type Align = 'esquerda' | 'centro' | 'direita'
export type Position = 'centro' | 'inferior_direita' | 'inferior_esquerda'
export type MobilePosition = 'centro' | 'inferior' | 'tela_cheia'
export type Shadow = 'nenhuma' | 'suave' | 'forte'
export type Font = 'sistema' | 'moderna' | 'arredondada' | 'serifada' | 'condensada'

export interface Box {
  width: number
  radius: number
  shadow: Shadow
  bg: string
  text: string
  font: Font
  padding: number
  position: Position
  overlay: boolean
  overlayOpacity: number
  closeColor: string
}
export interface Mobile {
  position: MobilePosition
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

export type BlockType = Block['type']

export interface Design {
  v: 1
  box: Box
  mobile: Mobile
  blocks: Block[]
}

export type EditorKind = 'popup' | 'form'

export interface EditorData {
  kind: EditorKind
  id: string
  name: string
  active: boolean
  design: Design | null
  popup: { id: string; formId: string; title: string; text: string | null; imageUrl: string | null; color: string } | null
  form: { id: string; name: string; fields: { key: string; label: string; required: boolean; type?: string; options?: string[] }[]; submitLabel: string; successMessage: string; consentText: string | null }
  privacyUrl: string | null
}

export const BLOCK_INFO: Record<BlockType, { label: string; icon: LucideIcon; hint: string; popupOnly?: boolean; unique?: boolean }> = {
  imagem: { label: 'Imagem', icon: ImageIcon, hint: 'Foto ou banner (envie do computador ou cole um link https)' },
  titulo: { label: 'Título', icon: TypeIcon, hint: 'Chamada principal' },
  texto: { label: 'Texto', icon: TextIcon, hint: 'Parágrafo de apoio' },
  formulario: { label: 'Formulário', icon: ClipboardListIcon, hint: 'Campos e botão de enviar', unique: true },
  cupom: { label: 'Cupom', icon: TicketIcon, hint: 'Código de desconto (pode aparecer só depois do envio)' },
  espaco: { label: 'Espaço', icon: MoveVerticalIcon, hint: 'Distância entre blocos' },
  divisor: { label: 'Divisor', icon: MinusIcon, hint: 'Linha fina' },
  recusar: { label: '“Não, obrigado”', icon: UndoIcon, hint: 'Link que fecha o pop-up', popupOnly: true },
}

export const FONT_LABEL: Record<Font, string> = { sistema: 'Padrão do aparelho', moderna: 'Moderna', arredondada: 'Arredondada', serifada: 'Serifada (clássica)', condensada: 'Condensada' }
export const POSITION_LABEL: Record<Position, string> = { centro: 'Centro da tela', inferior_direita: 'Canto inferior direito', inferior_esquerda: 'Canto inferior esquerdo' }
export const MOBILE_POSITION_LABEL: Record<MobilePosition, string> = { inferior: 'Gaveta de baixo', centro: 'Centro da tela', tela_cheia: 'Tela cheia' }
export const SHADOW_LABEL: Record<Shadow, string> = { nenhuma: 'Sem sombra', suave: 'Suave', forte: 'Forte' }

export const DEFAULT_BOX: Box = { width: 420, radius: 14, shadow: 'forte', bg: '#ffffff', text: '#0f172a', font: 'sistema', padding: 20, position: 'centro', overlay: true, overlayOpacity: 55, closeColor: '#0f172a' }
export const DEFAULT_MOBILE: Mobile = { position: 'inferior', fontScale: 100, hideImages: false }

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export function newBlock(type: BlockType, accent = '#1d4ed8'): Block {
  const id = uid()
  switch (type) {
    case 'imagem':
      return { id, type, url: '', height: 180, fit: 'cobrir', radius: 0, link: null, bleed: true }
    case 'titulo':
      return { id, type, text: 'Seu título aqui', size: 24, align: 'esquerda', color: '#0f172a', bold: true }
    case 'texto':
      return { id, type, text: 'Escreva aqui um texto curto que explique a oferta.', size: 14, align: 'esquerda', color: '#334155' }
    case 'formulario':
      return { id, type, columns: 1, showLabels: true, labelColor: '#111111', inputBg: '#ffffff', inputBorder: '#cbd5e1', inputRadius: 8, buttonText: null, buttonBg: accent, buttonColor: '#ffffff', buttonRadius: 8, buttonFull: true }
    case 'cupom':
      return { id, type, code: 'USAPARTS10', label: 'Use o cupom na finalização da compra', bg: '#fef3c7', color: '#92400e', afterSubmit: true }
    case 'espaco':
      return { id, type, height: 12 }
    case 'divisor':
      return { id, type, color: '#e2e8f0' }
    case 'recusar':
      return { id, type, text: 'Não, obrigado', color: '#64748b' }
  }
}

/** Ponto de partida quando o pop-up ainda não tem layout: o que já existe (imagem, título, texto, cor). */
export function fromLegacy(data: EditorData): Design {
  const accent = data.popup?.color ?? '#1d4ed8'
  const blocks: Block[] = []
  if (data.popup?.imageUrl) blocks.push({ ...(newBlock('imagem') as Extract<Block, { type: 'imagem' }>), url: data.popup.imageUrl })
  if (data.popup?.title) blocks.push({ ...(newBlock('titulo') as Extract<Block, { type: 'titulo' }>), text: data.popup.title, size: 20 })
  if (data.popup?.text) blocks.push({ ...(newBlock('texto') as Extract<Block, { type: 'texto' }>), text: data.popup.text })
  blocks.push(newBlock('formulario', accent))
  return { v: 1, box: { ...DEFAULT_BOX }, mobile: { ...DEFAULT_MOBILE }, blocks }
}

export interface Template {
  id: string
  name: string
  description: string
  tip?: string
  build: (kind: EditorKind) => Design
}

const form = (patch: Partial<Extract<Block, { type: 'formulario' }>>) => ({ ...(newBlock('formulario') as Extract<Block, { type: 'formulario' }>), ...patch })
const title = (text: string, patch: Partial<Extract<Block, { type: 'titulo' }>> = {}) => ({ ...(newBlock('titulo') as Extract<Block, { type: 'titulo' }>), text, ...patch })
const para = (text: string, patch: Partial<Extract<Block, { type: 'texto' }>> = {}) => ({ ...(newBlock('texto') as Extract<Block, { type: 'texto' }>), text, ...patch })
const decline = (text: string, color = '#64748b'): Block => ({ id: uid(), type: 'recusar', text, color })
const onlyPopup = (kind: EditorKind, blocks: Block[]) => (kind === 'popup' ? blocks : blocks.filter((b) => b.type !== 'recusar'))

export const TEMPLATES: Template[] = [
  {
    id: 'orcamento',
    name: 'Orçamento de peças',
    description: 'Chamada direta para pedir orçamento, campos em duas colunas.',
    build: (kind) => ({
      v: 1,
      box: { ...DEFAULT_BOX, width: 520 },
      mobile: { ...DEFAULT_MOBILE },
      blocks: onlyPopup(kind, [
        title('Peça seu orçamento de peças', { size: 24 }),
        para('Diga qual peça você procura e para qual máquina. Um especialista responde rapidinho.'),
        form({ columns: 2, buttonText: 'Quero meu orçamento', buttonBg: '#1d4ed8' }),
        decline('Agora não'),
      ]),
    }),
  },
  {
    id: 'cupom',
    name: 'Cupom de desconto',
    description: 'Fundo escuro, cupom revelado depois do cadastro.',
    tip: 'Troque o código pelo cupom criado na loja virtual.',
    build: (kind) => ({
      v: 1,
      box: { ...DEFAULT_BOX, width: 420, bg: '#0f172a', text: '#ffffff', closeColor: '#ffffff', radius: 18 },
      mobile: { ...DEFAULT_MOBILE },
      blocks: onlyPopup(kind, [
        title('Ganhe 10% OFF na primeira compra', { size: 26, align: 'centro', color: '#facc15' }),
        para('Cadastre-se e receba o cupom na hora.', { align: 'centro', color: '#e2e8f0' }),
        form({ showLabels: false, labelColor: '#ffffff', inputBorder: '#334155', buttonText: 'Quero meu cupom', buttonBg: '#facc15', buttonColor: '#111111', buttonRadius: 999 }),
        { id: uid(), type: 'cupom', code: 'USAPARTS10', label: 'Seu cupom de desconto', bg: '#1e293b', color: '#facc15', afterSubmit: true },
        decline('Não, obrigado', '#94a3b8'),
      ]),
    }),
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    description: 'Caixa discreta no canto, sem escurecer o site.',
    build: (kind) => ({
      v: 1,
      box: { ...DEFAULT_BOX, width: 340, position: 'inferior_direita', overlay: false, shadow: 'suave', padding: 18 },
      mobile: { ...DEFAULT_MOBILE, position: 'inferior' },
      blocks: onlyPopup(kind, [
        title('Receba ofertas e novidades', { size: 18 }),
        para('Promoções de peças e dicas de manutenção, no máximo uma vez por semana.', { size: 13 }),
        form({ showLabels: false, buttonText: 'Quero receber' }),
      ]),
    }),
  },
  {
    id: 'saida',
    name: 'Saída da página',
    description: 'Para quem está indo embora: última chance de falar com um especialista.',
    tip: 'Nas configurações do pop-up, escolha “Ao tentar sair da página”.',
    build: (kind) => ({
      v: 1,
      box: { ...DEFAULT_BOX, width: 460, radius: 16 },
      mobile: { ...DEFAULT_MOBILE, position: 'centro' },
      blocks: onlyPopup(kind, [
        title('Espere! Antes de sair…', { size: 26, align: 'centro' }),
        para('Não achou a peça? Deixe seu contato que um especialista encontra para você.', { align: 'centro' }),
        form({ buttonText: 'Falar com um especialista', buttonBg: '#16a34a' }),
        decline('Não, obrigado. Vou continuar procurando.'),
      ]),
    }),
  },
]
