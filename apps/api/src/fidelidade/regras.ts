// Fidelidade: regras sem banco (test/fidelidade.spec.ts). Pontos, níveis, validade, estorno, códigos de resgate,
// avaliações (NPS), links assinados e convites.
import { createHmac, randomBytes } from 'node:crypto'

const DAY_MS = 86_400_000

// ---------- Configuração ----------

export interface Level {
  /** Chave fixa (guardada no cliente): muda o nome sem perder quem já está no nível. */
  key: string
  name: string
  /** A partir de quantos pontos (ou R$, conforme a base) nos últimos 12 meses. */
  min: number
  /** Benefícios do nível (texto informativo para o cliente e a equipe). */
  benefits: string
  color: string
}

export interface ReviewConfig {
  enabled: boolean
  /** Convite: depois da entrega (status da loja) ou, sem entrega na loja, X dias depois do pagamento. */
  daysAfterDelivery: number
  daysAfterPayment: number
  /** Pedidos mais velhos que isso (dias) não recebem convite (não incomoda a base antiga). */
  maxAgeDays: number
  email: boolean
  whatsapp: boolean
  numberId: string | null
  /** Intervalo sorteado entre mensagens do WhatsApp (minutos). */
  gapMin: number
  gapMax: number
  aspects: boolean
  /** Detrator: NPS até este valor ou estrelas até este valor. */
  detractorNps: number
  detractorStars: number
  googleReviewUrl: string
  alertUserIds: string[]
  alertEmails: string[]
}

export interface Messages {
  inviteSubject: string
  inviteEmail: string
  inviteWhatsapp: string
  linkSubject: string
  linkEmail: string
  linkWhatsapp: string
  codeText: string
  thanks: string
  googleText: string
}

export interface PageTexts {
  title: string
  intro: string
  consent: string
  rules: string
  color: string
}

export interface FidelidadeConfig {
  enabled: boolean
  /** Só pedidos pagos a partir desta data (AAAA-MM-DD) dão pontos: ligar não distribui pontos da base antiga. */
  since: string | null
  pointsPerReal: number
  rounding: 'baixo' | 'proximo' | 'cima'
  minOrderValue: number
  /** Pontos vencem depois de N meses (0 = não vencem). */
  expireMonths: number
  /** Só pedidos do site (fora os de marketplace que passam pela Magazord). */
  onlySite: boolean
  reverseOnCancel: boolean
  bonusReview: number
  bonusFirstPurchase: number
  bonusBirthday: number
  /** Campo personalizado (tipo data) com o aniversário do cliente. */
  birthdayField: string | null
  levelBasis: 'pontos' | 'gasto'
  levels: Level[]
  /** Validade padrão dos códigos de resgate (dias). */
  codeValidityDays: number
  /** Quem entrega o brinde resgatado: "vendedor" (do cliente) ou "s:<vendedor>" / "u:<filial>". */
  giftHolder: string
  /** Validade do link de acesso enviado ao cliente (dias). */
  linkValidityDays: number
  /** Canais para o cliente entrar com código: e-mail e/ou WhatsApp (número de envio). */
  loginEmail: boolean
  loginWhatsapp: boolean
  loginNumberId: string | null
  review: ReviewConfig
  messages: Messages
  page: PageTexts
}

export const DEFAULT_LEVELS: Level[] = [
  { key: 'bronze', name: 'Bronze', min: 0, benefits: 'Acúmulo de pontos em todas as compras da loja virtual.', color: '#b45309' },
  { key: 'prata', name: 'Prata', min: 1000, benefits: 'Atendimento prioritário no WhatsApp.', color: '#64748b' },
  { key: 'ouro', name: 'Ouro', min: 5000, benefits: 'Atendimento prioritário e condições especiais combinadas com o vendedor.', color: '#ca8a04' },
  { key: 'diamante', name: 'Diamante', min: 15000, benefits: 'Atendimento prioritário, condições especiais e prêmios exclusivos.', color: '#0891b2' },
]

export const DEFAULT_MESSAGES: Messages = {
  inviteSubject: 'Como foi a sua compra? Conte para nós e ganhe {bonus} pontos',
  inviteEmail: 'Olá, {nome}!\n\nSeu pedido {pedido} já deve ter chegado. Leva menos de um minuto para avaliar, e você ganha {bonus} pontos no programa de fidelidade.',
  inviteWhatsapp: 'Olá, {nome}! Seu pedido {pedido} já deve ter chegado. Pode nos contar como foi? Leva menos de um minuto e você ganha {bonus} pontos: {link}',
  linkSubject: 'Seus pontos no programa de fidelidade',
  linkEmail: 'Olá, {nome}!\n\nVocê tem {pontos} pontos (nível {nivel}). Use o botão abaixo para ver o extrato, os prêmios e pedir um resgate. O link vale por {dias} dias.',
  linkWhatsapp: 'Olá, {nome}! Você tem {pontos} pontos (nível {nivel}). Veja o extrato e os prêmios aqui: {link}',
  codeText: 'Seu código de acesso aos pontos é {codigo}. Ele vale por 10 minutos. Se não foi você que pediu, ignore esta mensagem.',
  thanks: 'Obrigado pela avaliação! Ela nos ajuda a atender cada vez melhor.',
  googleText: 'Que bom que você gostou! Se puder, deixe também a sua avaliação no Google: ajuda outros clientes a nos conhecer.',
}

export const DEFAULT_PAGE: PageTexts = {
  title: 'Programa de fidelidade',
  intro: 'Cada compra na loja virtual vale pontos. Troque por brindes, descontos e cashback.',
  consent: 'Ao entrar, você concorda que usemos seu nome, e-mail, telefone e pedidos da loja virtual para calcular seus pontos e falar com você sobre o programa. Você pode sair quando quiser.',
  rules: '',
  color: '',
}

export const DEFAULT_CONFIG: FidelidadeConfig = {
  enabled: false,
  since: null,
  pointsPerReal: 1,
  rounding: 'baixo',
  minOrderValue: 0,
  expireMonths: 12,
  onlySite: true,
  reverseOnCancel: true,
  bonusReview: 50,
  bonusFirstPurchase: 0,
  bonusBirthday: 0,
  birthdayField: null,
  levelBasis: 'pontos',
  levels: DEFAULT_LEVELS,
  codeValidityDays: 30,
  giftHolder: 'vendedor',
  linkValidityDays: 7,
  loginEmail: true,
  loginWhatsapp: false,
  loginNumberId: null,
  review: {
    enabled: false,
    daysAfterDelivery: 1,
    daysAfterPayment: 10,
    maxAgeDays: 60,
    email: true,
    whatsapp: false,
    numberId: null,
    gapMin: 2,
    gapMax: 10,
    aspects: true,
    detractorNps: 6,
    detractorStars: 2,
    googleReviewUrl: '',
    alertUserIds: [],
    alertEmails: [],
  },
  messages: DEFAULT_MESSAGES,
  page: DEFAULT_PAGE,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOLDER = /^(vendedor|(s|u):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function num(v: unknown, d: number, min: number, max: number, int = true) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d
  const x = Math.min(max, Math.max(min, v))
  return int ? Math.round(x) : Math.round(x * 10_000) / 10_000
}
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
function text(v: unknown, d: string, max: number) {
  if (typeof v !== 'string') return d
  return v.replace(/\r\n/g, '\n').slice(0, max)
}
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
const HEX = /^#[0-9a-f]{6}$/i

/** Endereço público https (link do Google para avaliar). */
export function cleanUrl(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return ''
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 500) : ''
  } catch {
    return ''
  }
}

/** Níveis em ordem crescente, com chaves únicas e o primeiro sempre a partir de 0. */
export function cleanLevels(v: unknown): Level[] {
  if (!Array.isArray(v) || !v.length) return DEFAULT_LEVELS.map((l) => ({ ...l }))
  const out: Level[] = []
  const keys = new Set<string>()
  for (const raw of v.slice(0, 10)) {
    const r = (raw ?? {}) as Partial<Level>
    const name = text(r.name, '', 40).trim()
    if (!name) continue
    let key = (typeof r.key === 'string' ? r.key : name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
    if (!key) key = `nivel-${out.length + 1}`
    while (keys.has(key)) key = `${key}-${out.length + 1}`
    keys.add(key)
    out.push({ key, name, min: num(r.min, 0, 0, 100_000_000), benefits: text(r.benefits, '', 500), color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : '#64748b' })
  }
  if (!out.length) return DEFAULT_LEVELS.map((l) => ({ ...l }))
  out.sort((a, b) => a.min - b.min)
  out[0]!.min = 0
  return out
}

export function cleanConfig(raw: unknown): FidelidadeConfig {
  const r = (raw ?? {}) as Partial<Record<keyof FidelidadeConfig, unknown>>
  const rv = (r.review ?? {}) as Partial<Record<keyof ReviewConfig, unknown>>
  const m = (r.messages ?? {}) as Partial<Record<keyof Messages, unknown>>
  const p = (r.page ?? {}) as Partial<Record<keyof PageTexts, unknown>>
  const d = DEFAULT_CONFIG
  const gapA = num(rv.gapMin, d.review.gapMin, 1, 120)
  const gapB = num(rv.gapMax, d.review.gapMax, 1, 120)
  const since = typeof r.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.since) && !Number.isNaN(Date.parse(`${r.since}T00:00:00Z`)) ? r.since : null
  const msg = (k: keyof Messages, max = 2000) => text(m[k], d.messages[k], max).trim() || d.messages[k]
  return {
    enabled: bool(r.enabled, d.enabled),
    since,
    pointsPerReal: num(r.pointsPerReal, d.pointsPerReal, 0, 1000, false),
    rounding: r.rounding === 'proximo' || r.rounding === 'cima' ? r.rounding : 'baixo',
    minOrderValue: num(r.minOrderValue, d.minOrderValue, 0, 10_000_000, false),
    expireMonths: num(r.expireMonths, d.expireMonths, 0, 120),
    onlySite: bool(r.onlySite, d.onlySite),
    reverseOnCancel: bool(r.reverseOnCancel, d.reverseOnCancel),
    bonusReview: num(r.bonusReview, d.bonusReview, 0, 1_000_000),
    bonusFirstPurchase: num(r.bonusFirstPurchase, d.bonusFirstPurchase, 0, 1_000_000),
    bonusBirthday: num(r.bonusBirthday, d.bonusBirthday, 0, 1_000_000),
    birthdayField: typeof r.birthdayField === 'string' && /^[a-z0-9_]{1,60}$/i.test(r.birthdayField) ? r.birthdayField : null,
    levelBasis: r.levelBasis === 'gasto' ? 'gasto' : 'pontos',
    levels: cleanLevels(r.levels),
    codeValidityDays: num(r.codeValidityDays, d.codeValidityDays, 1, 3650),
    giftHolder: typeof r.giftHolder === 'string' && HOLDER.test(r.giftHolder) ? r.giftHolder.toLowerCase() : 'vendedor',
    linkValidityDays: num(r.linkValidityDays, d.linkValidityDays, 1, 30),
    loginEmail: bool(r.loginEmail, d.loginEmail),
    loginWhatsapp: bool(r.loginWhatsapp, d.loginWhatsapp),
    loginNumberId: uuidOrNull(r.loginNumberId),
    review: {
      enabled: bool(rv.enabled, d.review.enabled),
      daysAfterDelivery: num(rv.daysAfterDelivery, d.review.daysAfterDelivery, 0, 60),
      daysAfterPayment: num(rv.daysAfterPayment, d.review.daysAfterPayment, 1, 120),
      maxAgeDays: num(rv.maxAgeDays, d.review.maxAgeDays, 7, 365),
      email: bool(rv.email, d.review.email),
      whatsapp: bool(rv.whatsapp, d.review.whatsapp),
      numberId: uuidOrNull(rv.numberId),
      gapMin: Math.min(gapA, gapB),
      gapMax: Math.max(gapA, gapB),
      aspects: bool(rv.aspects, d.review.aspects),
      detractorNps: num(rv.detractorNps, d.review.detractorNps, 0, 10),
      detractorStars: num(rv.detractorStars, d.review.detractorStars, 1, 5),
      googleReviewUrl: cleanUrl(rv.googleReviewUrl),
      alertUserIds: Array.isArray(rv.alertUserIds) ? [...new Set(rv.alertUserIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 50) : [],
      alertEmails: Array.isArray(rv.alertEmails) ? [...new Set(rv.alertEmails.filter((x): x is string => typeof x === 'string' && EMAIL.test(x.trim())).map((x) => x.trim().toLowerCase()))].slice(0, 20) : [],
    },
    messages: {
      inviteSubject: msg('inviteSubject', 150),
      inviteEmail: msg('inviteEmail'),
      inviteWhatsapp: msg('inviteWhatsapp', 1000),
      linkSubject: msg('linkSubject', 150),
      linkEmail: msg('linkEmail'),
      linkWhatsapp: msg('linkWhatsapp', 1000),
      codeText: msg('codeText', 500),
      thanks: msg('thanks', 500),
      googleText: msg('googleText', 500),
    },
    page: {
      title: text(p.title, d.page.title, 80).trim() || d.page.title,
      intro: text(p.intro, d.page.intro, 500),
      consent: text(p.consent, d.page.consent, 1500).trim() || d.page.consent,
      rules: text(p.rules, d.page.rules, 3000),
      color: typeof p.color === 'string' && HEX.test(p.color) ? p.color : '',
    },
  }
}

// ---------- Pontos ----------

/** Pedido conta para o programa: pago, depois do início, valor mínimo e (se escolhido) só do site. */
export function orderQualifies(o: { statusGroup: string; total: number; orderedAt: Date; channel: string | null }, cfg: Pick<FidelidadeConfig, 'since' | 'minOrderValue' | 'onlySite'>) {
  if (o.statusGroup !== 'pago' || !cfg.since) return false
  if (o.orderedAt.getTime() < Date.parse(`${cfg.since}T03:00:00Z`)) return false
  if (o.total < cfg.minOrderValue || o.total <= 0) return false
  if (cfg.onlySite && o.channel && !/^site$/i.test(o.channel.trim())) return false
  return true
}

/** Pontos do pedido: valor × pontos por R$, arredondado como configurado. */
export function pointsFor(total: number, cfg: Pick<FidelidadeConfig, 'pointsPerReal' | 'rounding' | 'minOrderValue'>) {
  if (!(total > 0) || total < cfg.minOrderValue) return 0
  // Centavos inteiros primeiro: 0,1 + 0,2 não vira 0,30000000000000004 e perde um ponto.
  const raw = Math.round(total * 100 * cfg.pointsPerReal) / 100
  const eps = 1e-9
  const v = cfg.rounding === 'cima' ? Math.ceil(raw - eps) : cfg.rounding === 'proximo' ? Math.round(raw) : Math.floor(raw + eps)
  return Math.max(0, v)
}

/** Validade de um lote de pontos (null = não vence). */
export function expiresAtFor(from: Date, months: number): Date | null {
  if (!months) return null
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

export interface Lot {
  id: string
  remaining: number
  expiresAt: Date | null
}

/**
 * Consome pontos dos lotes: primeiro os que vencem antes (os sem validade por último); `prefer` é consumido antes
 * de todos (estorno: tira primeiro do lote do próprio pedido). O que faltar volta em `shortfall`.
 */
export function consumeLots(lots: Lot[], amount: number, prefer?: string) {
  const order = lots
    .filter((l) => l.remaining > 0)
    .sort((a, b) => {
      if (prefer && (a.id === prefer) !== (b.id === prefer)) return a.id === prefer ? -1 : 1
      const ta = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY
      const tb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY
      return ta - tb || a.id.localeCompare(b.id)
    })
  let left = Math.max(0, Math.round(amount))
  const takes: { id: string; take: number }[] = []
  for (const l of order) {
    if (!left) break
    const take = Math.min(l.remaining, left)
    takes.push({ id: l.id, take })
    left -= take
  }
  return { takes, shortfall: left }
}

/**
 * Lote novo quando o saldo está negativo (estorno de pedido cujos pontos já tinham sido usados): o ganho paga
 * primeiro a dívida e só o resto fica disponível.
 */
export function lotAfterDebt(points: number, balanceBefore: number) {
  if (points <= 0) return 0
  return balanceBefore < 0 ? Math.max(0, points + balanceBefore) : points
}

/** Pedido cancelado ou devolvido na loja (os pontos dele são estornados). */
export function isReversal(o: { statusGroup: string; statusName: string }) {
  return o.statusGroup === 'cancelado' || /devolv|devoluç|estorn|cancelad|chargeback|reembols/i.test(o.statusName)
}

/** Pedido entregue segundo a situação da loja. */
export function isDelivered(statusName: string) {
  return /entregue|entrega realizada|recebido pelo cliente/i.test(statusName) && !/não entregue|nao entregue|devolv|transportadora|correios/i.test(statusName)
}

// ---------- Níveis ----------

export function levelFor(value: number, levels: Level[]) {
  const sorted = [...levels].sort((a, b) => a.min - b.min)
  let i = 0
  for (let k = 0; k < sorted.length; k++) if (value >= sorted[k]!.min) i = k
  const current = sorted[i] ?? null
  const next = sorted[i + 1] ?? null
  return { current, next, missing: next ? Math.max(0, Math.ceil(next.min - value)) : 0, rank: i }
}

export function levelRank(key: string | null | undefined, levels: Level[]) {
  if (!key) return -1
  return [...levels].sort((a, b) => a.min - b.min).findIndex((l) => l.key === key)
}

// ---------- Resgates ----------

export type RewardKind = 'BRINDE' | 'DESCONTO' | 'CASHBACK' | 'BENEFICIO'
export const REWARD_KINDS: RewardKind[] = ['BRINDE', 'DESCONTO', 'CASHBACK', 'BENEFICIO']

/** Por que o cliente não pode resgatar (null = pode). */
export function redemptionProblem(d: {
  active: boolean
  kind: string
  pointsCost: number
  balance: number
  stock: number | null
  perCustomer: number | null
  usedByCustomer: number
  minRank: number
  customerRank: number
  optedOut?: boolean
}): string | null {
  if (d.optedOut) return 'Você saiu do programa de fidelidade.'
  if (!d.active) return 'Este prêmio não está disponível.'
  if (d.kind === 'BENEFICIO') return 'Este benefício vem com o nível: não precisa resgatar.'
  if (d.minRank > d.customerRank) return 'Este prêmio é de um nível acima do seu.'
  if (d.stock !== null && d.stock <= 0) return 'Este prêmio esgotou.'
  if (d.perCustomer !== null && d.usedByCustomer >= d.perCustomer) return `Limite de ${d.perCustomer} resgate(s) deste prêmio por cliente.`
  if (d.balance < d.pointsCost) return `Saldo insuficiente: faltam ${d.pointsCost - d.balance} pontos.`
  return null
}

// Sem letras e números que se confundem (0/O, 1/I/L, 5/S, 2/Z): o código é lido em voz alta ou digitado.
const CODE_ALPHABET = '346789ABCDEFGHJKMNPQRTUVWXY'

/** Código de resgate FID-XXXXX-XXXXX (10 caracteres sorteados: cerca de 47 bits). */
export function generateCode(random: (n: number) => Buffer = randomBytes) {
  const out: string[] = []
  // Rejeição: só bytes abaixo do maior múltiplo do alfabeto, para não favorecer letras.
  const limit = 256 - (256 % CODE_ALPHABET.length)
  while (out.length < 10) {
    for (const b of random(16)) {
      if (b >= limit) continue
      out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]!)
      if (out.length === 10) break
    }
  }
  return `FID-${out.slice(0, 5).join('')}-${out.slice(5).join('')}`
}

/** Código digitado pela equipe: maiúsculas, sem espaços, com os traços no lugar. */
export function normalizeCode(v: string) {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^FID/, '')
  if (s.length !== 10) return null
  return `FID-${s.slice(0, 5)}-${s.slice(5)}`
}

export function isCode(v: string) {
  return new RegExp(`^FID-[${CODE_ALPHABET}]{5}-[${CODE_ALPHABET}]{5}$`).test(v)
}

// ---------- Avaliações ----------

export function npsClass(score: number): 'promotor' | 'neutro' | 'detrator' {
  return score >= 9 ? 'promotor' : score >= 7 ? 'neutro' : 'detrator'
}

/** NPS = % promotores − % detratores (de −100 a 100), com as contagens. */
export function npsOf(scores: number[]) {
  const total = scores.length
  const promoters = scores.filter((s) => s >= 9).length
  const detractors = scores.filter((s) => s <= 6).length
  const passives = total - promoters - detractors
  return { total, promoters, passives, detractors, nps: total ? Math.round(((promoters - detractors) / total) * 100) : null }
}

export function isDetractor(r: { stars: number; nps: number }, cfg: Pick<ReviewConfig, 'detractorNps' | 'detractorStars'>) {
  return r.nps <= cfg.detractorNps || r.stars <= cfg.detractorStars
}

export const ASPECTS = ['produto', 'entrega', 'atendimento'] as const

/** Confere a avaliação enviada pelo cliente; devolve o motivo do erro ou os dados limpos. */
export function cleanReview(raw: { stars?: unknown; nps?: unknown; comment?: unknown; aspects?: unknown }) {
  const stars = Number(raw.stars)
  const nps = Number(raw.nps)
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: 'Escolha de 1 a 5 estrelas.' as const }
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) return { error: 'Escolha uma nota de 0 a 10.' as const }
  const aspects: Record<string, number> = {}
  const a = (raw.aspects ?? {}) as Record<string, unknown>
  for (const k of ASPECTS) {
    const v = Number(a[k])
    if (Number.isInteger(v) && v >= 1 && v <= 5) aspects[k] = v
  }
  const comment = typeof raw.comment === 'string' ? raw.comment.replace(/\s+$/g, '').slice(0, 2000).trim() : ''
  return { stars, nps, comment: comment || null, aspects: Object.keys(aspects).length ? aspects : null }
}

// ---------- Convites ----------

/** Quando o convite para avaliar sai: dias depois da entrega ou, sem entrega registrada, depois do pagamento. */
export function inviteDueAt(o: { orderedAt: Date; deliveredAt: Date | null }, cfg: Pick<ReviewConfig, 'daysAfterDelivery' | 'daysAfterPayment'>) {
  return o.deliveredAt ? new Date(o.deliveredAt.getTime() + cfg.daysAfterDelivery * DAY_MS) : new Date(o.orderedAt.getTime() + cfg.daysAfterPayment * DAY_MS)
}

/** O convite deste pedido pode sair agora? (null = sim; senão o motivo para pular ou "esperar"). */
export function inviteBlock(
  o: { orderedAt: Date; deliveredAt: Date | null; reversedAt: Date | null; reviewed: boolean; optedOut: boolean; hasEmail: boolean; hasPhone: boolean },
  cfg: ReviewConfig,
  now: Date,
): null | 'esperar' | string {
  if (o.reviewed) return 'já avaliado'
  if (o.reversedAt) return 'pedido cancelado'
  if (o.optedOut) return 'cliente saiu do programa'
  if (now.getTime() - o.orderedAt.getTime() > cfg.maxAgeDays * DAY_MS) return 'pedido antigo'
  if (inviteDueAt(o, cfg).getTime() > now.getTime()) return 'esperar'
  if (!(cfg.email && o.hasEmail) && !(cfg.whatsapp && o.hasPhone)) return 'sem e-mail ou telefone para o canal escolhido'
  return null
}

/** Troca {variavel} pelo valor (variável desconhecida fica como está). */
export function fill(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{([a-z_]+)\}/gi, (all, k: string) => {
    const v = vars[k.toLowerCase()]
    return v === undefined || v === null ? all : String(v)
  })
}

export const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || 'cliente'

// ---------- Aniversário ----------

/** "AAAA-MM-DD" ou "DD/MM/AAAA" do campo personalizado: faz aniversário no dia (horário de São Paulo)? */
export function isBirthday(value: unknown, now: Date) {
  if (typeof value !== 'string') return false
  let md: string | null = null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (iso) md = `${iso[2]}-${iso[3]}`
  else if (br) md = `${br[2]}-${br[1]}`
  if (!md) return false
  const today = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(5, 10)
  // 29/02 comemora em 28/02 nos anos sem 29.
  if (md === '02-29') {
    const y = new Date(now.getTime() - 3 * 3_600_000).getUTCFullYear()
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    return today === (leap ? '02-29' : '02-28')
  }
  return today === md
}

// ---------- Links assinados (acesso sem senha) ----------

export interface AccessToken {
  /** Empresa, lead, versão do acesso (sobe quando o cliente sai), tipo e validade (epoch em segundos). */
  t: string
  l: string
  v: number
  /** "link" (enviado por e-mail/WhatsApp) ou "sessao" (depois de entrar). */
  k: 'link' | 'sessao'
  e: number
}

export function signToken(p: AccessToken, key: Buffer | string) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  const sig = createHmac('sha256', key).update(`fid1.${body}`).digest('base64url')
  return `${body}.${sig}`
}

/** Confere assinatura e validade (sem banco). A versão (v) é conferida depois, com o cliente. */
export function verifyToken(token: string, key: Buffer | string, now = new Date()): AccessToken | null {
  if (typeof token !== 'string' || token.length > 600) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const expected = createHmac('sha256', key).update(`fid1.${body}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingEqual(a, b)) return null
  let p: AccessToken
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessToken
  } catch {
    return null
  }
  if (!p || typeof p.t !== 'string' || typeof p.l !== 'string' || typeof p.e !== 'number' || typeof p.v !== 'number') return null
  if (!UUID_RE.test(p.t) || !UUID_RE.test(p.l) || (p.k !== 'link' && p.k !== 'sessao')) return null
  if (p.e * 1000 <= now.getTime()) return null
  return p
}

function timingEqual(a: Buffer, b: Buffer) {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Contato digitado na página: e-mail (minúsculo) ou telefone (só dígitos). */
export function parseContact(v: string): { email: string } | { phone: string } | null {
  const s = (v ?? '').trim().slice(0, 200)
  if (EMAIL.test(s)) return { email: s.toLowerCase() }
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 10 && digits.length <= 13) return { phone: digits }
  return null
}

/** Mostra parte do e-mail ou do telefone, para o cliente reconhecer sem expor o dado completo. */
export function maskEmail(e: string | null | undefined) {
  if (!e) return null
  return e.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2')
}
export function maskPhone(p: string | null | undefined) {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  return d.length >= 4 ? `(••) •••••-${d.slice(-4)}` : null
}

// ---------- Painel ----------

/** Últimos N meses "AAAA-MM" (horário de São Paulo), do mais antigo ao atual. */
export function lastMonths(n: number, now = new Date()) {
  const sp = new Date(now.getTime() - 3 * 3_600_000)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth() - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

/** Soma por mês dos movimentos do extrato: emitidos (ganho/bônus/ajuste+), resgatados, vencidos, estornados. */
export function monthlyFlow(rows: { month: string; kind: string; points: number }[], months: string[]) {
  const by = new Map(months.map((m) => [m, { month: m, emitidos: 0, resgatados: 0, expirados: 0, estornados: 0 }]))
  for (const r of rows) {
    const b = by.get(r.month)
    if (!b) continue
    if (r.kind === 'RESGATE') b.resgatados += -r.points
    else if (r.kind === 'EXPIRADO') b.expirados += -r.points
    else if (r.kind === 'ESTORNO') b.estornados += -r.points
    else if (r.points > 0) b.emitidos += r.points
    // Ajuste negativo: aparece no extrato do cliente, não entra nestas somas.
  }
  return [...by.values()]
}
