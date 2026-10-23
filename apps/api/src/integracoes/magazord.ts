/**
 * Regras puras da integração com a loja virtual Magazord (testadas em test/magazord.spec.ts):
 * situação dos pedidos, leitura de clientes e carrinhos e mensagem de recuperação.
 * API: https://docs-v2.api.magazord.com.br (Basic Auth com token + senha do usuário WebService).
 */
import { normalizePhone } from '../atendimento/br'

/** Situações do pedido (tabela "Definição dos dados" da Magazord). */
const PAID = new Set([4, 5, 6, 7, 8, 12, 19, 23, 27, 29, 30])
const CANCELED = new Set([2, 14, 24, 26])

export type OrderGroup = 'pago' | 'pendente' | 'cancelado' | 'outro'

export function orderGroup(code: number): OrderGroup {
  if (PAID.has(code)) return 'pago'
  if (CANCELED.has(code)) return 'cancelado'
  if ([1, 3, 13, 15, 18].includes(code)) return 'pendente'
  return 'outro'
}

/** Só endereços da Magazord (evita que o painel seja usado para o servidor chamar outro lugar). */
export function cleanBaseUrl(input: string): string | null {
  let u: URL
  try {
    u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.magazord\.com\.br$/.test(host)) return null
  return `https://${host}`
}

export interface MagazordPessoa {
  id: number | string
  tipo?: number
  nome?: string | null
  nomeFantasia?: string | null
  email?: string | null
  dataCadastro?: string | null
  pessoaContato?: { tipo?: number; contato?: string | null }[] | null
  pessoaEndereco?: { cidadeNome?: string | null; estadoSigla?: string | null }[] | null
}

export interface CustomerData {
  externalId: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  city: string | null
  state: string | null
  registeredAt: Date | null
}

/** Datas da Magazord vêm sem fuso ("2024-07-29" ou "2024-07-29 10:00:00"): são horário de Brasília. */
export function parseMzDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v)
  if (!m) return null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Formato que a API espera nos filtros de carrinho ("2024-03-21 22:00:38", horário de Brasília). */
export function mzDateTime(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

/** Cliente da loja -> dados do lead. CPF/CNPJ não é lido nem guardado (não é necessário para o marketing). */
export function customerFrom(p: MagazordPessoa): CustomerData {
  const email = p.email?.trim().toLowerCase() || null
  let phone: string | null = null
  for (const c of p.pessoaContato ?? []) {
    const v = c?.contato?.trim()
    if (!v || v.includes('@')) continue
    const n = normalizePhone(v)
    // Celular (9 dígitos) tem preferência: é o que funciona no WhatsApp.
    if (n && (!phone || (/^\+55\d{2}9/.test(n) && !/^\+55\d{2}9/.test(phone)))) phone = n
  }
  const addr = (p.pessoaEndereco ?? []).find((a) => a?.cidadeNome || a?.estadoSigla) ?? null
  const juridica = p.tipo === 2
  return {
    externalId: String(p.id),
    name: p.nome?.trim() || null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone,
    company: juridica ? p.nomeFantasia?.trim() || p.nome?.trim() || null : null,
    city: addr?.cidadeNome?.trim() || null,
    state: addr?.estadoSigla?.trim().toUpperCase().slice(0, 2) || null,
    registeredAt: parseMzDate(p.dataCadastro),
  }
}

export interface CartItem {
  code: string
  name: string
  qty: number
  image: string | null
  url: string | null
}

/** Nome legível a partir do endereço da página do produto ("filtro-de-combustivel-re539465"). */
export function nameFromUrl(url: string | null | undefined, code: string) {
  if (!url) return code
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    const text = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim()
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : code
  } catch {
    return code
  }
}

export function cartItems(itens: { codigo_produto?: string | null; quantidade?: number | null; midia_url?: string | null; url_pagina?: string | null }[] | null | undefined): CartItem[] {
  const safe = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u.slice(0, 500) : null)
  return (itens ?? []).slice(0, 50).map((i) => {
    const code = String(i?.codigo_produto ?? '').slice(0, 60)
    return { code, name: nameFromUrl(i?.url_pagina, code).slice(0, 160), qty: Math.max(1, Number(i?.quantidade) || 1), image: safe(i?.midia_url), url: safe(i?.url_pagina) }
  })
}

/** Mensagem de WhatsApp para recuperar o carrinho. Variáveis: {nome}, {produtos}, {link}, {cupom} e {empresa}. */
export function cartMessage(template: string, v: { name: string | null; items: CartItem[]; link: string | null; coupon: string; company?: string }) {
  const first = v.name?.trim().split(/\s+/)[0] ?? ''
  const products = v.items.length ? (v.items.length > 2 ? `${v.items.slice(0, 2).map((i) => i.name).join(', ')} e mais ${v.items.length - 2}` : v.items.map((i) => i.name).join(' e ')) : 'os produtos'
  return template
    .replaceAll('{nome}', first)
    .replaceAll('{produtos}', products)
    .replaceAll('{link}', v.link ?? '')
    .replaceAll('{cupom}', v.coupon)
    .replaceAll('{empresa}', v.company ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export const DEFAULT_CART_MESSAGE =
  'Olá, {nome}! Aqui é da {empresa}. Vi que você deixou {produtos} no carrinho. Posso te ajudar a finalizar? Use o cupom {cupom} para ganhar um desconto: {link}'

// ---------- Catálogo de produtos (para os e-mails) ----------

/** Item de GET /v2/site/frontend/produto/{loja}. */
export interface MzSiteProduct {
  produto_id?: number | string | null
  derivacao_id?: number | string | null
  codigo?: string | null
  nome?: string | null
  titulo?: string | null
  derivacao_nome?: string | null
  marca?: string | null
  valor?: number | string | null
  valor_de?: number | string | null
  qtde_estoque?: number | string | null
  link?: string | null
  ativo?: boolean | null
  midias?: { path?: string | null; arquivo_nome?: string | null; ordem?: number | null }[] | null
}

export interface ProductData {
  externalId: string
  code: string
  name: string
  brand: string | null
  price: number | null
  priceFrom: number | null
  stock: number | null
  image: string | null
  url: string | null
  active: boolean
}

/** Endereço https (site da loja ou servidor das imagens), sem usuário/senha; sem barra no fim. */
export function cleanHttpsBase(input: string | null | undefined): string | null {
  const v = (input ?? '').trim()
  if (!v) return null
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Link absoluto: já completo, "//host/..." ou relativo ao endereço base. */
export function absoluteUrl(value: string | null | undefined, base: string | null): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  try {
    if (/^https:\/\//i.test(v)) return new URL(v).toString().slice(0, 500)
    if (v.startsWith('//')) return new URL(`https:${v}`).toString().slice(0, 500)
    if (/^[a-z]+:/i.test(v) || !base) return null
    return new URL(v.replace(/^\/+/, ''), `${base}/`).toString().slice(0, 500)
  } catch {
    return null
  }
}

const money = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export function productFrom(p: MzSiteProduct, o: { siteUrl: string | null; imageBase: string | null }): ProductData | null {
  const externalId = String(p.derivacao_id ?? p.produto_id ?? p.codigo ?? '').trim()
  const base = String(p.nome ?? p.titulo ?? '').trim()
  if (!externalId || !base) return null
  const variant = String(p.derivacao_nome ?? '').trim()
  const name = variant && !base.toLowerCase().includes(variant.toLowerCase()) && !/^(único|unico|padrão|padrao)$/i.test(variant) ? `${base} - ${variant}` : base
  const media = [...(p.midias ?? [])].filter((m) => m?.path || m?.arquivo_nome).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))[0]
  let image: string | null = null
  if (media) {
    const path = String(media.path ?? '').trim()
    const file = String(media.arquivo_nome ?? '').trim()
    const full = file && !path.endsWith(file) ? `${path.replace(/\/?$/, '/')}${file}` : path || file
    image = absoluteUrl(full, o.imageBase)
  }
  const price = money(p.valor)
  const from = money(p.valor_de)
  const stock = Number(p.qtde_estoque)
  return {
    externalId: externalId.slice(0, 60),
    code: String(p.codigo ?? '').trim().slice(0, 60),
    name: name.slice(0, 200),
    brand: p.marca?.trim().slice(0, 80) || null,
    price,
    priceFrom: from && price && from > price ? from : null,
    stock: Number.isFinite(stock) ? Math.trunc(stock) : null,
    image,
    url: absoluteUrl(p.link, o.siteUrl),
    active: p.ativo !== false,
  }
}

// ---------- Catálogo de produtos: 1 vez por dia, de madrugada ----------

/** Tentativas por dia quando a cópia do catálogo falha (com 1 hora entre elas); depois disso, aviso por e-mail. */
export const PRODUCTS_MAX_ATTEMPTS = 3
export const PRODUCTS_RETRY_MS = 3_600_000

/** Dia (AAAA-MM-DD) e hora no horário de Brasília. */
export function spDay(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}
export function spHour(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).getUTCHours()
}

export interface ProductsSchedule {
  productsSyncedAt?: string | null
  productsAttemptAt?: string | null
  productsAttemptDay?: string | null
  productsAttempts?: number
}

/**
 * Hora de copiar o catálogo? Uma vez por dia a partir da hora escolhida (de madrugada, longe do movimento da loja).
 * Nunca copiado: copia já. Falhou: tenta de novo depois de 1 hora, até 3 vezes no dia.
 */
export function productsDue(now: Date, st: ProductsSchedule, hour: number) {
  if (!st.productsSyncedAt) return !st.productsAttemptAt || now.getTime() - Date.parse(st.productsAttemptAt) >= PRODUCTS_RETRY_MS
  const today = spDay(now)
  if (spDay(new Date(st.productsSyncedAt)) === today) return false
  if (spHour(now) < hour) return false
  if (st.productsAttemptDay === today) {
    if ((st.productsAttempts ?? 0) >= PRODUCTS_MAX_ATTEMPTS) return false
    if (st.productsAttemptAt && now.getTime() - Date.parse(st.productsAttemptAt) < PRODUCTS_RETRY_MS) return false
  }
  return true
}

/**
 * Proteção: se a Magazord devolver uma lista vazia ou bem menor que o catálogo atual (falha do lado dela),
 * não desativa os produtos que "sumiram". O botão "Atualizar agora" aceita uma queda grande (não a lista vazia).
 */
export function shrinkError(count: number, activeBefore: number, manual: boolean) {
  if (count === 0) return activeBefore > 0 ? 'A Magazord não devolveu nenhum produto. O catálogo atual foi mantido.' : null
  if (!manual && activeBefore >= 50 && count < activeBefore * 0.5) {
    return `A Magazord devolveu só ${count} produtos (eram ${activeBefore} ativos). Para não tirar produtos do catálogo por engano, nenhum foi desativado. Se a loja realmente diminuiu, use “Atualizar agora” no Catálogo.`
  }
  return null
}

const ORIGINS: Record<number, string> = { 1: 'Site', 2: 'Marketplace', 3: 'Manual', 4: 'PDV (loja física)' }

/**
 * Canal de venda do pedido: nome do marketplace (ex.: Mercado Livre) quando veio de um; senão a origem
 * (1 site, 2 marketplace, 3 manual, 4 PDV). A lista de pedidos só traz o nome da loja do marketplace.
 */
export function orderChannel(o: { origem?: unknown; marketplaceNome?: unknown; lojaDoMarketplaceNome?: unknown } | null | undefined): string | null {
  if (!o) return null
  const name = [o.marketplaceNome, o.lojaDoMarketplaceNome].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  const origin = Number(o.origem)
  if (name && origin !== 1 && origin !== 4) return name.trim().slice(0, 60)
  return ORIGINS[origin] ?? (name ? name.trim().slice(0, 60) : null)
}

export interface OrderLine {
  sku: string | null
  name: string
  brand: string | null
  quantity: number
  total: number
}

/** Itens do detalhe do pedido (arrayPedidoRastreio[].pedidoItem[]); item de kit conta pelo kit. */
export function orderLines(detail: unknown): OrderLine[] {
  const d = detail as { arrayPedidoRastreio?: unknown } | null
  const out: OrderLine[] = []
  for (const r of Array.isArray(d?.arrayPedidoRastreio) ? d.arrayPedidoRastreio : []) {
    const items = (r as { pedidoItem?: unknown } | null)?.pedidoItem
    for (const raw of Array.isArray(items) ? items : []) {
      const i = raw as Record<string, unknown>
      if (!i || typeof i !== 'object' || i.pedidoItemKitId) continue
      const quantity = Math.round(Number(i.quantidade) || 0)
      if (quantity <= 0) continue
      const name = [i.produtoNome, i.descricao, i.produtoTitulo].find((v) => typeof v === 'string' && v.trim()) as string | undefined
      const total = Number(i.valorItem)
      out.push({
        sku: typeof i.produtoDerivacaoCodigo === 'string' && i.produtoDerivacaoCodigo.trim() ? i.produtoDerivacaoCodigo.trim().slice(0, 60) : null,
        name: (name ?? 'Produto sem nome').trim().slice(0, 200),
        brand: typeof i.marcaNome === 'string' && i.marcaNome.trim() ? i.marcaNome.trim().slice(0, 80) : null,
        quantity,
        total: Math.round((Number.isFinite(total) && total > 0 ? total : (Number(i.valorUnitario) || 0) * quantity) * 100) / 100,
      })
    }
  }
  return out
}

// ---------- SEO do e-commerce ----------

export interface MzProductDetail {
  codigoProduto?: string
  nomeProduto?: string
  derivacaoCodigo?: string
  ativo?: boolean
  marca?: { id?: number; nome?: string } | null
  categorias?: { id?: number; nome?: string; principal?: boolean }[]
  atributos?: { nome?: string; valor?: string }[]
  ean?: { codigo?: string; principal?: boolean }[]
  produtoLoja?: { loja?: number; titulo?: string | null; tituloComplemento?: string | null; descricao?: string | null; descricaoResumida?: string | null }[]
  imagens?: { url?: string; principal?: boolean }[]
}

export interface MzPage {
  id: number
  title?: string | null
  titleSeo?: string | null
  metaDescription?: string | null
  metaKeywords?: string | null
  url_pagina?: string | null
}

const txt = (v: unknown, n = 10_000) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** Detalhe do produto + página de SEO da Magazord nos campos do CRM. */
export function seoFromMagazord(d: MzProductDetail, page: MzPage | null, storeId: number) {
  const pl = (d.produtoLoja ?? []).find((l) => l.loja === storeId) ?? d.produtoLoja?.[0] ?? {}
  const cats = [...(d.categorias ?? [])].sort((a, b) => Number(!!b.principal) - Number(!!a.principal))
  const ean = (d.ean ?? []).find((e) => e.principal)?.codigo ?? d.ean?.[0]?.codigo ?? null
  return {
    productCode: String(d.codigoProduto),
    name: txt(d.nomeProduto, 300),
    brand: txt(d.marca?.nome, 120) || null,
    categories: cats.map((c) => txt(c.nome, 120)).filter(Boolean).slice(0, 6),
    attributes: (d.atributos ?? []).map((a) => ({ name: txt(a.nome, 80), value: txt(a.valor, 300) })).filter((a) => a.name && a.value).slice(0, 40),
    ean,
    image: txt((d.imagens ?? []).find((i) => i.principal)?.url ?? d.imagens?.[0]?.url, 1000) || null,
    pageId: page?.id ?? null,
    fields: {
      pageTitle: txt(page?.title, 300),
      seoTitle: txt(page?.titleSeo, 300),
      metaDescription: txt(page?.metaDescription, 1000),
      url: txt(page?.url_pagina, 300).replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, ''),
      title: txt(pl.titulo, 300),
      description: txt(pl.descricao, 20_000),
      summary: txt(pl.descricaoResumida, 2000),
      searchKeywords: '',
    },
  }
}

/** O que vai para a Magazord: o PATCH da página (aba SEO) e o PATCH do produto (Descrição Geral), só com o que mudou. */
export function seoToMagazord(f: Partial<Record<string, string>>, storeId: number) {
  const page: Record<string, unknown> = {}
  if (f.pageTitle !== undefined) page.title = f.pageTitle
  if (f.seoTitle !== undefined) page.titleSeo = f.seoTitle
  if (f.metaDescription !== undefined) page.metaDescription = f.metaDescription
  if (f.url !== undefined) page.url = f.url
  const loja: Record<string, unknown> = { loja: storeId }
  if (f.title !== undefined) loja.titulo = f.title
  if (f.description !== undefined) loja.descricao = f.description
  if (f.summary !== undefined) loja.descricaoResumida = f.summary
  const product: Record<string, unknown> = {}
  if (Object.keys(loja).length > 1) product.produtoLoja = [loja]
  if (f.searchKeywords !== undefined) product.palavraChave = f.searchKeywords
  return { page: Object.keys(page).length ? { loja: storeId, ...page } : null, product: Object.keys(product).length ? product : null }
}

// ---------- Carrinho abandonado no e-mail (automação) ----------

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Itens do carrinho para o bloco do e-mail: nome, foto, preço e link do catálogo da loja quando o produto está nele. */
export function cartEmailItems(items: CartItem[], catalog: Map<string, { name: string; image: string | null; url: string | null; price: number | null; priceFrom: number | null }>) {
  return items.slice(0, 12).map((i) => {
    const p = catalog.get(i.code)
    const name = p?.name || i.name
    return {
      name: i.qty > 1 ? `${name} (${i.qty} un.)` : name,
      image: p?.image ?? i.image ?? undefined,
      url: p?.url ?? i.url ?? undefined,
      price: p?.price ? brl(p.price) : undefined,
      oldPrice: p?.priceFrom && p.price && p.priceFrom > p.price ? brl(p.priceFrom) : undefined,
    }
  })
}
