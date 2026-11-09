/**
 * Tcar além dos produtos: fotos, orçamento/pré-nota (para a cotação de frete) e endereço do cliente. Só leituras (GET). Funções puras: sem banco, sem rede e sem Nest
 * (test/tcar-erp.spec.ts).
 */
import { detectImage } from '../files/image-type'

const str = (v: unknown, max = 200) => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/[\u0000-\u001f]/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** Corpo da resposta da Tcar: { data: {...} } ou o objeto direto. */
const dataOf = (body: unknown) => {
  const b = obj(body)
  return b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? obj(b.data) : b
}
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

// ---------- Consultas (actions do PingAlive) ----------

export type Query = Record<string, string | number>
export interface ActionDef {
  cmd: string
  query_params: Query
}

/** Fotos por produto: a capa e mais algumas (a resposta tem teto de 16 MB na Tcar). */
export const MAX_PHOTOS = 6
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024

export function photosQuery(code: string): ActionDef {
  return { cmd: `/produtos/${encodeURIComponent(code)}/fotos`, query_params: { max_fotos: MAX_PHOTOS } }
}

export type ErpDocType = 'ORCAMENTO' | 'PRE_NOTA'
/** Número de orçamento ou pré-nota: só dígitos (o caminho vai para a Tcar). */
export function docNumber(raw: string) {
  const n = String(raw ?? '').trim()
  return /^\d{1,12}$/.test(n) && Number(n) > 0 ? String(Number(n)) : null
}

/** Orçamento (sem serviços: frete é das peças) ou pré-nota (venda, na Tcar desta empresa). */
export function documentQuery(type: ErpDocType, number: string): ActionDef {
  const n = docNumber(number)
  if (!n) throw new Error('Número inválido.')
  return type === 'ORCAMENTO' ? { cmd: `/orcamentos/${n}`, query_params: { incluir_servicos: 'false', incluir_servicos_terceiros: 'false' } } : { cmd: `/pre-notas/${n}`, query_params: {} }
}

export function clientQuery(id: number): ActionDef {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Cliente inválido.')
  return { cmd: `/clientes/${id}`, query_params: {} }
}

/**
 * Rotas que o CRM pode pedir à Tcar: só GET, caminho exato e só os parâmetros conhecidos (valores simples). Nada que
 * grave na Tcar sai do CRM.
 */
const ROUTES: { re: RegExp; params: string[] }[] = [
  { re: /^\/produtos$/, params: ['limit', 'offset', 'incluir_referencias', 'alterado_desde', 'include', 'branch_ids'] },
  { re: /^\/produtos\/(?!\.\.?$)[^/?#\\]+$/, params: ['include', 'branch_ids'] },
  { re: /^\/produtos\/(?!\.\.?\/)[^/?#\\]+\/fotos$/, params: ['max_fotos'] },
  { re: /^\/orcamentos\/\d{1,12}$/, params: ['incluir_servicos', 'incluir_servicos_terceiros'] },
  { re: /^\/pre-notas\/\d{1,12}$/, params: [] },
  { re: /^\/clientes\/\d{1,12}$/, params: [] },
]

export function allowedRoute(cmd: string, verb: string, query: unknown = {}) {
  if (verb !== 'GET' || typeof cmd !== 'string' || cmd.length > 200) return false
  const route = ROUTES.find((r) => r.re.test(cmd))
  if (!route) return false
  const q = obj(query)
  return Object.entries(q).every(([k, v]) => route.params.includes(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 60 && !/[\u0000-\u001f]/.test(v))))
}

// ---------- Fotos ----------

export type Photo = { kind: 'blob'; buffer: Buffer; mime: string; ext: string } | { kind: 'url'; url: string }

/** Fotos da resposta (capa primeiro): imagens conferidas pelos bytes (PNG, JPEG, WebP, GIF) e endereços https. */
export function photosFrom(body: unknown, max = MAX_PHOTOS): { photos: Photo[]; skipped: number } {
  const b = obj(body)
  const list = Array.isArray(b.data) ? b.data : Array.isArray(body) ? (body as unknown[]) : []
  const photos: Photo[] = []
  let skipped = 0
  for (const raw of list) {
    if (photos.length >= max) break
    const f = obj(raw)
    if (f.tipo === 'url') {
      const url = str(f.url, 500)
      let ok = false
      try {
        ok = !!url && new URL(url).protocol === 'https:'
      } catch {
        ok = false
      }
      if (ok) photos.push({ kind: 'url', url: url! })
      else skipped++
      continue
    }
    const b64 = typeof f.base64 === 'string' ? f.base64.replace(/^data:[^,]*,/, '').replace(/\s/g, '') : ''
    // Base64 com 3 MB de imagem tem ~4 MB de texto: acima disso nem decodifica.
    if (!b64 || b64.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) {
      skipped++
      continue
    }
    const buffer = Buffer.from(b64, 'base64')
    const type = detectImage(buffer)
    if (!type || !['png', 'jpg', 'webp', 'gif'].includes(type.ext) || buffer.length > MAX_PHOTO_BYTES) {
      skipped++
      continue
    }
    photos.push({ kind: 'blob', buffer, mime: type.mime, ext: type.ext })
  }
  return { photos, skipped }
}

// ---------- Orçamento, pré-nota e cliente ----------

export interface ErpItem {
  code: string
  description: string | null
  quantity: number
  unitPrice: number | null
  total: number | null
}
export interface ErpDoc {
  type: ErpDocType
  number: string
  branchId: number | null
  /** N, A, C (orçamento) ou N, A, C, P (pré-nota). */
  status: string | null
  statusLabel: string | null
  issuedAt: string | null
  /** Valor das peças (o que vai na nota) e o total do documento. */
  productsTotal: number | null
  total: number | null
  freight: number | null
  customerCode: number | null
  customerName: string | null
  /** Só CNPJ (empresa). CPF não é guardado: pessoa física fica só como "PF". */
  customerCnpj: string | null
  personType: 'PF' | 'PJ' | null
  items: ErpItem[]
}

const BUDGET_STATUS: Record<string, string> = { N: 'Aberto', A: 'Transferido (gerou OS)', C: 'Cancelado' }
const PRE_NOTE_STATUS: Record<string, string> = { N: 'Pendente', A: 'Atualizada', C: 'Cancelada', P: 'Pré-venda' }

function docOf(raw: unknown): { cnpj: string | null; personType: 'PF' | 'PJ' | null } {
  const d = digits(raw)
  if (d.length === 14) return { cnpj: d, personType: 'PJ' }
  if (d.length === 11) return { cnpj: null, personType: 'PF' }
  return { cnpj: null, personType: null }
}

/** Orçamento (GET /orcamentos/:numero): cabeçalho, cliente e peças. */
export function budgetFrom(body: unknown): ErpDoc | null {
  const d = dataOf(body)
  const number = str(d.atorc_numero, 20)
  if (!number) return null
  const items: ErpItem[] = (Array.isArray(d.itens) ? d.itens : [])
    .slice(0, 300)
    .map((r) => obj(r))
    .map((r) => ({ code: str(r.atoit_codigo, 60) ?? '', description: str(r.atoit_descricao, 200), quantity: num(r.atoit_qtdade) ?? 0, unitPrice: num(r.atoit_vlr_unitario), total: num(r.atoit_vlr_total) }))
    .filter((i) => i.code && i.quantity > 0)
  const status = str(d.atorc_situacao, 2)
  const doc = docOf(d.cliente_cnpj)
  const partsTotal = num(d.atorc_totalpeca)
  const itemsTotal = items.reduce((s, i) => s + (i.total ?? 0), 0)
  return {
    type: 'ORCAMENTO',
    number,
    branchId: num(d.fll_codigo),
    status,
    statusLabel: status ? (BUDGET_STATUS[status] ?? status) : null,
    issuedAt: str(d.atorc_dtaemi, 30),
    productsTotal: partsTotal ?? (items.length ? round(itemsTotal, 2) : null),
    total: num(d.atorc_totalgeral),
    freight: null,
    customerCode: num(d.cln_codigo_cliente),
    customerName: str(d.cliente_nome, 160) ?? str(d.cliente_fantasia, 160),
    customerCnpj: doc.cnpj,
    personType: doc.personType,
    items,
  }
}

/**
 * Pré-nota (GET /pre-notas/:id). Na Tcar desta empresa a pré-nota é sempre venda: o bloco "fornecedor" da API é o
 * cliente.
 */
export function preNoteFrom(body: unknown): ErpDoc | null {
  const d = dataOf(body)
  const head = obj(d.cabecalho)
  const number = str(head.numero, 20) ?? str(obj(d.chave).id, 20)
  if (!number) return null
  const party = obj(d.fornecedor)
  const totals = obj(d.totais)
  const items: ErpItem[] = (Array.isArray(d.itens) ? d.itens : [])
    .slice(0, 300)
    .map((r) => obj(r))
    .map((r) => ({ code: str(r.produto_codigo, 60) ?? '', description: str(r.descricao, 200), quantity: num(r.quantidade) ?? 0, unitPrice: num(r.valor_unitario), total: num(r.valor_liquido) ?? num(r.valor_total) }))
    .filter((i) => i.code && i.quantity > 0)
  const status = str(head.situacao, 2)
  const doc = docOf(party.cnpj_cpf)
  return {
    type: 'PRE_NOTA',
    number,
    branchId: num(obj(d.filial).codigo) ?? num(obj(d.chave).filial),
    status,
    statusLabel: status ? (PRE_NOTE_STATUS[status] ?? status) : null,
    issuedAt: str(head.data_emissao, 30),
    productsTotal: num(totals.valor_produtos),
    total: num(totals.valor_total),
    freight: num(totals.valor_frete),
    customerCode: num(party.codigo),
    customerName: str(party.nome, 160) ?? str(party.fantasia, 160),
    customerCnpj: doc.cnpj,
    personType: doc.personType,
    items,
  }
}

export interface ClientAddress {
  zip: string | null
  city: string | null
  uf: string | null
  ibge: string | null
}

/** Só o necessário para o frete (CEP, cidade, UF): nada de telefone, e-mail, CPF ou dados de LGPD do cliente. */
export function clientAddressFrom(body: unknown): ClientAddress {
  const d = dataOf(body)
  const zip = digits(d.cep_cep)
  const uf = str(d.uf_estado, 2)?.toUpperCase() ?? null
  const ibge = digits(d.cdd_codigo)
  return { zip: zip.length === 8 ? zip : null, city: str(d.cidade_nome, 120), uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : null, ibge: ibge.length === 7 ? ibge : null }
}

/** Peso bruto da carga: quantidade × peso bruto de cada peça cadastrada na Tcar; lista as peças sem peso. */
export function weightOf(items: { code: string; quantity: number }[], weights: Map<string, number | null>) {
  let total = 0
  const missing: string[] = []
  for (const i of items) {
    const w = weights.get(i.code)
    if (w === null || w === undefined || !(w > 0)) missing.push(i.code)
    else total += w * i.quantity
  }
  return { total: round(total, 3), missing: [...new Set(missing)] }
}

// ---------- Fila do PingAlive ----------

/**
 * Faixas da fila: o que a tela espera (consulta de uma peça, orçamento/pré-nota e o cliente dele) vai na frente; a cópia
 * de produtos e as fotos têm cada uma a sua cota por contato, para uma não travar a outra.
 */
export const LANES = {
  tela: { kinds: ['live', 'doc', 'client'], max: 20 },
  produtos: { kinds: ['full', 'incremental'], max: 4 },
  fotos: { kinds: ['photos'], max: 2 },
} as const
export type Lane = keyof typeof LANES
export function laneOf(kind: string): Lane | null {
  for (const [lane, def] of Object.entries(LANES) as [Lane, (typeof LANES)[Lane]][]) if ((def.kinds as readonly string[]).includes(kind)) return lane
  return null
}
