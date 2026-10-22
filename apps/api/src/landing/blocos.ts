/**
 * Landing pages: catálogo de blocos, tema e limpeza do que a tela manda. Uma única definição serve para validar no
 * servidor e para a tela montar os campos de cada bloco. Funções puras (testadas em test/landing.spec.ts).
 */

export type FieldType = 'text' | 'textarea' | 'url' | 'image' | 'datetime' | 'select' | 'icon' | 'list' | 'form' | 'whatsapp' | 'boolean'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  max?: number
  hint?: string
  placeholder?: string
  options?: { value: string; label: string }[]
  /** Itens da lista (type = list). */
  item?: FieldDef[]
  maxItems?: number
  /** Só aparece quando outro campo tem um destes valores (ex.: url só com ação "link"). */
  showIf?: { key: string; values: string[] }
}

export interface BlockDef {
  type: string
  label: string
  description: string
  variants?: { value: string; label: string }[]
  fields: FieldDef[]
}

export type Block = { id: string; type: string; variant?: string; background?: Background } & Record<string, unknown>
export type Background = 'padrao' | 'suave' | 'destaque' | 'escuro'

export const BACKGROUNDS: { value: Background; label: string }[] = [
  { value: 'padrao', label: 'Fundo da página' },
  { value: 'suave', label: 'Suave (tom claro da cor principal)' },
  { value: 'destaque', label: 'Destaque (cor principal)' },
  { value: 'escuro', label: 'Escuro' },
]

/** Ícones (desenhos do Lucide, licença ISC) usados nos benefícios e números. */
export const ICONS: Record<string, { label: string; svg: string }> = {
  check: { label: 'Confirmado', svg: '<path d="M20 6 9 17l-5-5"/>' },
  caminhao: { label: 'Entrega', svg: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>' },
  garantia: { label: 'Garantia', svg: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>' },
  suporte: { label: 'Suporte técnico', svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
  estoque: { label: 'Estoque', svg: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>' },
  relogio: { label: 'Rapidez', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
  local: { label: 'Localização', svg: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>' },
  telefone: { label: 'Telefone', svg: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
  estrela: { label: 'Qualidade', svg: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' },
  premio: { label: 'Prêmio / referência', svg: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>' },
  raio: { label: 'Desempenho', svg: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>' },
  cartao: { label: 'Pagamento', svg: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>' },
  conversa: { label: 'Atendimento', svg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' },
  mundo: { label: 'Brasil e América Latina', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
}
const ICON_OPTIONS = Object.entries(ICONS).map(([value, i]) => ({ value, label: i.label }))

const ACTIONS = [
  { value: 'formulario', label: 'Ir para o formulário' },
  { value: 'whatsapp', label: 'Abrir o WhatsApp' },
  { value: 'link', label: 'Abrir um endereço' },
]
const cta = (prefix = ''): FieldDef[] => [
  { key: `${prefix}ctaText`, label: 'Texto do botão', type: 'text', max: 40, placeholder: 'Ex.: Pedir orçamento' },
  { key: `${prefix}action`, label: 'O botão leva para', type: 'select', options: ACTIONS },
  { key: `${prefix}url`, label: 'Endereço do botão', type: 'url', showIf: { key: `${prefix}action`, values: ['link'] } },
]

export const BLOCKS: BlockDef[] = [
  {
    type: 'hero',
    label: 'Topo (chamada principal)',
    description: 'A primeira coisa que o visitante vê: título forte, subtítulo, imagem e o botão principal.',
    variants: [
      { value: 'imagem-direita', label: 'Texto à esquerda, imagem à direita' },
      { value: 'centro', label: 'Centralizado' },
      { value: 'imagem-fundo', label: 'Imagem de fundo' },
    ],
    fields: [
      { key: 'eyebrow', label: 'Selo acima do título', type: 'text', max: 60, placeholder: 'Ex.: Importação direta desde 1997' },
      { key: 'title', label: 'Título', type: 'text', max: 140 },
      { key: 'subtitle', label: 'Subtítulo', type: 'textarea', max: 400 },
      { key: 'image', label: 'Imagem', type: 'image' },
      ...cta(),
      { key: 'note', label: 'Texto pequeno abaixo do botão', type: 'text', max: 80, placeholder: 'Ex.: Atendemos todo o Brasil' },
    ],
  },
  {
    type: 'numeros',
    label: 'Números',
    description: 'Até 4 números que dão confiança (anos de mercado, marcas atendidas, estados).',
    fields: [{ key: 'items', label: 'Números', type: 'list', maxItems: 4, item: [{ key: 'value', label: 'Número', type: 'text', max: 14 }, { key: 'label', label: 'Descrição', type: 'text', max: 60 }] }],
  },
  {
    type: 'beneficios',
    label: 'Benefícios',
    description: 'Por que comprar com a empresa: ícone, título curto e explicação.',
    variants: [
      { value: 'cartoes', label: 'Cartões' },
      { value: 'lista', label: 'Lista com ícones' },
    ],
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'subtitle', label: 'Subtítulo', type: 'textarea', max: 300 },
      { key: 'items', label: 'Benefícios', type: 'list', maxItems: 8, item: [{ key: 'icon', label: 'Ícone', type: 'icon', options: ICON_OPTIONS }, { key: 'title', label: 'Título', type: 'text', max: 60 }, { key: 'text', label: 'Texto', type: 'textarea', max: 220 }] },
    ],
  },
  {
    type: 'imagem-texto',
    label: 'Imagem e texto',
    description: 'Uma imagem ao lado de um texto explicativo, com botão opcional.',
    variants: [
      { value: 'imagem-esquerda', label: 'Imagem à esquerda' },
      { value: 'imagem-direita', label: 'Imagem à direita' },
    ],
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'text', label: 'Texto', type: 'textarea', max: 1500 },
      { key: 'image', label: 'Imagem', type: 'image' },
      ...cta(),
    ],
  },
  {
    type: 'produtos',
    label: 'Produtos',
    description: 'Vitrine de peças com imagem, nome e botão. Preço só se alguém informar (a IA nunca preenche).',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'subtitle', label: 'Subtítulo', type: 'textarea', max: 300 },
      {
        key: 'items',
        label: 'Produtos',
        type: 'list',
        maxItems: 12,
        item: [
          { key: 'image', label: 'Imagem', type: 'image' },
          { key: 'name', label: 'Nome', type: 'text', max: 100 },
          { key: 'text', label: 'Descrição curta', type: 'textarea', max: 200 },
          { key: 'price', label: 'Preço (opcional)', type: 'text', max: 30, hint: 'Confira com o Comercial antes de publicar.' },
          { key: 'ctaText', label: 'Texto do botão', type: 'text', max: 30 },
          { key: 'url', label: 'Endereço do botão (vazio = formulário)', type: 'url' },
        ],
      },
    ],
  },
  {
    type: 'marcas',
    label: 'Marcas atendidas',
    description: 'Faixa com as marcas de máquina (nome ou logo).',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'items', label: 'Marcas', type: 'list', maxItems: 24, item: [{ key: 'name', label: 'Marca', type: 'text', max: 40 }, { key: 'image', label: 'Logo (opcional)', type: 'image' }] },
    ],
  },
  {
    type: 'depoimentos',
    label: 'Depoimentos',
    description: 'O que os clientes dizem. Use só depoimentos reais, com autorização.',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'items', label: 'Depoimentos', type: 'list', maxItems: 6, item: [{ key: 'text', label: 'Depoimento', type: 'textarea', max: 400 }, { key: 'name', label: 'Nome', type: 'text', max: 60 }, { key: 'role', label: 'Empresa ou cidade', type: 'text', max: 60 }] },
    ],
  },
  {
    type: 'oferta',
    label: 'Oferta com prazo',
    description: 'Destaque de uma condição com contagem regressiva até a data informada.',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'text', label: 'Texto', type: 'textarea', max: 400 },
      { key: 'endsAt', label: 'Termina em', type: 'datetime', hint: 'Horário de Brasília. Depois disso, a contagem some.' },
      ...cta(),
    ],
  },
  {
    type: 'galeria',
    label: 'Galeria de fotos',
    description: 'Fotos de peças, estoque, lojas ou máquinas.',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'items', label: 'Fotos', type: 'list', maxItems: 12, item: [{ key: 'image', label: 'Foto', type: 'image' }, { key: 'caption', label: 'Legenda', type: 'text', max: 80 }] },
    ],
  },
  {
    type: 'video',
    label: 'Vídeo',
    description: 'Vídeo do YouTube.',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'url', label: 'Endereço do vídeo no YouTube', type: 'url' },
    ],
  },
  {
    type: 'faq',
    label: 'Perguntas frequentes',
    description: 'Dúvidas comuns com as respostas (abre e fecha).',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'items', label: 'Perguntas', type: 'list', maxItems: 12, item: [{ key: 'q', label: 'Pergunta', type: 'text', max: 160 }, { key: 'a', label: 'Resposta', type: 'textarea', max: 700 }] },
    ],
  },
  {
    type: 'formulario',
    label: 'Formulário (gera o lead)',
    description: 'O formulário de captura escolhido. Só quem preenche vira lead.',
    variants: [
      { value: 'lado-a-lado', label: 'Texto ao lado do formulário' },
      { value: 'cartao', label: 'Formulário centralizado' },
    ],
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'text', label: 'Texto', type: 'textarea', max: 600 },
      { key: 'bullets', label: 'Itens com ✓ (um por linha)', type: 'textarea', max: 400 },
      { key: 'formId', label: 'Formulário de captura', type: 'form', hint: 'Os campos, a mensagem de sucesso e o consentimento vêm do formulário (Captura).' },
    ],
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    description: 'Chamada para conversar pelo WhatsApp.',
    fields: [
      { key: 'title', label: 'Título', type: 'text', max: 120 },
      { key: 'text', label: 'Texto', type: 'textarea', max: 400 },
      { key: 'buttonText', label: 'Texto do botão', type: 'text', max: 40 },
      {
        key: 'mode',
        label: 'Como funciona',
        type: 'select',
        options: [
          { value: 'direto', label: 'Abre o WhatsApp direto (não gera lead)' },
          { value: 'captura', label: 'Pede nome e WhatsApp antes (gera lead)' },
        ],
      },
      { key: 'whatsappId', label: 'Botão de WhatsApp da captura', type: 'whatsapp', showIf: { key: 'mode', values: ['captura'] } },
    ],
  },
  {
    type: 'cta',
    label: 'Chamada final',
    description: 'Faixa de fechamento com um botão.',
    fields: [{ key: 'title', label: 'Título', type: 'text', max: 120 }, { key: 'text', label: 'Texto', type: 'textarea', max: 300 }, ...cta()],
  },
  {
    type: 'texto',
    label: 'Texto',
    description: 'Texto corrido (condições, sobre a empresa).',
    fields: [{ key: 'title', label: 'Título', type: 'text', max: 120 }, { key: 'text', label: 'Texto', type: 'textarea', max: 4000 }],
  },
]
export const BLOCK_TYPES = new Set(BLOCKS.map((b) => b.type))
export const MAX_BLOCKS = 30

// ---------- Tema ----------

export interface Theme {
  /** Cor principal: títulos de destaque, fundos "destaque" e "suave". */
  primary: string
  /** Cor dos botões. */
  accent: string
  mode: 'claro' | 'escuro'
  font: string
  radius: 'reto' | 'suave' | 'arredondado'
  button: 'solido' | 'contorno' | 'pilula'
  width: 'normal' | 'larga'
  /** Barra do topo com o logo (e um botão). */
  header: 'logo' | 'logo-botao' | 'nenhum'
  headerCta: string
  /** Telefone do WhatsApp para os botões "Abrir o WhatsApp" (só dígitos com DDI). */
  whatsapp: string
  whatsappMessage: string
}

export const FONTS = ['Sistema', 'Inter', 'Poppins', 'Montserrat', 'Roboto', 'Open Sans', 'Lato'] as const

export const DEFAULT_THEME: Theme = {
  primary: '#1d4ed8',
  accent: '#1d4ed8',
  mode: 'claro',
  font: 'Inter',
  radius: 'suave',
  button: 'solido',
  width: 'normal',
  header: 'logo-botao',
  headerCta: 'Fale conosco',
  whatsapp: '',
  whatsappMessage: 'Olá! Vim pela página {pagina} e gostaria de um orçamento.',
}

export interface Seo {
  title: string
  description: string
  image: string
  /** Página só para anúncios: não aparece no Google. */
  noindex: boolean
}
export const DEFAULT_SEO: Seo = { title: '', description: '', image: '', noindex: false }

// ---------- Limpeza ----------

const HEX = /^#[0-9a-f]{6}$/i
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '')
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)

/** Endereço aceito em link e imagem: https (ou http), relativo do próprio CRM (/api/files/public/...) ou âncora. */
export function cleanUrl(v: unknown, kind: 'link' | 'image' = 'link'): string {
  const s = str(v, 1000)
  if (!s) return ''
  if (kind === 'image' && /^\/api\/files\/public\/[0-9a-f-]{36}$/.test(s)) return s
  if (kind === 'link' && /^#[a-z0-9-]{1,40}$/i.test(s)) return s
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}

export function cleanTheme(raw: unknown, base: Theme = DEFAULT_THEME): Theme {
  const t = (raw ?? {}) as Partial<Record<keyof Theme, unknown>>
  return {
    primary: HEX.test(String(t.primary)) ? String(t.primary) : base.primary,
    accent: HEX.test(String(t.accent)) ? String(t.accent) : base.accent,
    mode: pick(t.mode, ['claro', 'escuro'], base.mode),
    font: pick(t.font as string, FONTS as unknown as string[], base.font),
    radius: pick(t.radius, ['reto', 'suave', 'arredondado'], base.radius),
    button: pick(t.button, ['solido', 'contorno', 'pilula'], base.button),
    width: pick(t.width, ['normal', 'larga'], base.width),
    header: pick(t.header, ['logo', 'logo-botao', 'nenhum'], base.header),
    headerCta: t.headerCta === undefined ? base.headerCta : str(t.headerCta, 30),
    whatsapp: t.whatsapp === undefined ? base.whatsapp : String(t.whatsapp).replace(/\D/g, '').slice(0, 15),
    whatsappMessage: t.whatsappMessage === undefined ? base.whatsappMessage : str(t.whatsappMessage, 300),
  }
}

export function cleanSeo(raw: unknown): Seo {
  const s = (raw ?? {}) as Partial<Record<keyof Seo, unknown>>
  return { title: str(s.title, 70), description: str(s.description, 170), image: cleanUrl(s.image, 'image'), noindex: s.noindex === true }
}

/** Valor de um campo conforme a definição dele (texto curto, lista, imagem...). */
function cleanField(f: FieldDef, v: unknown): unknown {
  switch (f.type) {
    case 'text':
      return str(v, f.max ?? 200)
    case 'textarea':
      return str(v, f.max ?? 2000).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    case 'url':
      return cleanUrl(v, 'link')
    case 'image':
      return cleanUrl(v, 'image')
    case 'datetime':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : ''
    case 'select':
    case 'icon':
      return f.options?.some((o) => o.value === v) ? v : (f.options?.[0]?.value ?? '')
    case 'form':
    case 'whatsapp':
      return typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) ? v : ''
    case 'boolean':
      return v === true
    case 'list': {
      const arr = Array.isArray(v) ? v.slice(0, f.maxItems ?? 12) : []
      return arr.map((it) => Object.fromEntries((f.item ?? []).map((sub) => [sub.key, cleanField(sub, (it as Record<string, unknown> | null)?.[sub.key])])))
    }
  }
}

/** Limpa a lista de blocos: só tipos conhecidos, só campos da definição, textos curtos, endereços seguros. */
export function cleanBlocks(raw: unknown): { blocks: Block[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Lista de blocos inválida.' }
  if (raw.length > MAX_BLOCKS) return { error: `No máximo ${MAX_BLOCKS} blocos por página.` }
  const out: Block[] = []
  const ids = new Set<string>()
  for (const r of raw) {
    const b = (r ?? {}) as Record<string, unknown>
    const def = BLOCKS.find((d) => d.type === b.type)
    if (!def) return { error: `Tipo de bloco desconhecido: ${String(b.type)}` }
    let id = typeof b.id === 'string' && /^[a-z0-9-]{4,40}$/i.test(b.id) ? b.id : ''
    if (!id || ids.has(id)) id = `b${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`
    ids.add(id)
    const block: Block = { id, type: def.type, background: pick<Background>(b.background as Background, ['padrao', 'suave', 'destaque', 'escuro'], 'padrao') }
    if (def.variants) block.variant = pick(b.variant as string, def.variants.map((x) => x.value), def.variants[0]!.value)
    for (const f of def.fields) block[f.key] = cleanField(f, b[f.key])
    out.push(block)
  }
  return { blocks: out }
}

/** Endereço da página: minúsculas, sem acento, palavras separadas por hífen. */
export function cleanSlug(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Endereços reservados (rotas do servidor e do próprio subdomínio). */
export const RESERVED_SLUGS = new Set(['api', 'runtime', 'evento', 'enviar', 'robots-txt', 'sitemap', 'favicon', 'assets', 'admin', 'lp'])
