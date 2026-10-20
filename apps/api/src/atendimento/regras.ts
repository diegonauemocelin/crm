/** Regras dos atendimentos de Pré/Pós-Vendas. Funções puras (testadas em test/atendimento.spec.ts). */

export type SaleStatus = 'SIM' | 'NAO' | 'NEGOCIACAO'
export type ReturnStatus = 'SIM' | 'NAO' | 'PENDENTE'

export interface RecordState {
  forwarded: boolean
  returnStatus: ReturnStatus | null
  saleStatus: SaleStatus
  lostReasonId: string | null
  invoiceNumber: string | null
  saleValue: number | null
}

/** Regras da especificação: motivo obrigatório na venda perdida; NF e valor obrigatórios na venda realizada. */
export function validateRecord(r: RecordState): string | null {
  if (r.saleStatus === 'NAO' && !r.lostReasonId) return 'Informe o motivo da venda perdida.'
  if (r.saleStatus === 'SIM') {
    if (!r.invoiceNumber?.trim()) return 'Informe o número da nota fiscal da venda.'
    if (r.saleValue === null || r.saleValue === undefined || !(r.saleValue > 0)) return 'Informe o valor da venda.'
  }
  if (r.returnStatus && !r.forwarded) return 'Só é possível informar o retorno do vendedor se o lead foi repassado.'
  return null
}

/**
 * Ajustes automáticos coerentes com a situação:
 * - ao repassar, o retorno fica "Pendente" e a data do repasse é registrada (base do alerta);
 * - ao marcar retorno "Sim", registra quando o vendedor retornou (tempo médio de retorno);
 * - fora da venda perdida não há motivo; fora da venda realizada não há NF/valor.
 */
export function applyAutomaticFields<T extends RecordState & { forwardedAt?: Date | null; returnedAt?: Date | null }>(
  next: T,
  prev: (RecordState & { forwardedAt?: Date | null; returnedAt?: Date | null }) | null,
  now = new Date(),
): T {
  const out = { ...next }
  if (out.forwarded && !prev?.forwarded) {
    out.forwardedAt ??= now
    out.returnStatus ??= 'PENDENTE'
  }
  if (!out.forwarded) {
    out.forwardedAt = null
    out.returnStatus = null
    out.returnedAt = null
  }
  if (out.returnStatus === 'SIM' && prev?.returnStatus !== 'SIM') out.returnedAt ??= now
  if (out.returnStatus !== 'SIM') out.returnedAt = null
  if (out.saleStatus !== 'NAO') out.lostReasonId = null
  if (out.saleStatus !== 'SIM') {
    out.invoiceNumber = null
    out.saleValue = null
  }
  return out
}

/** Atendimento repassado, ainda sem retorno do vendedor, há mais tempo que o limite configurado. */
export function isOverdue(r: { forwarded: boolean; returnStatus: ReturnStatus | null; forwardedAt: Date | null }, alertHours: number, now = new Date()) {
  return r.forwarded && r.returnStatus === 'PENDENTE' && !!r.forwardedAt && now.getTime() - r.forwardedAt.getTime() > alertHours * 3_600_000
}

// ---------- Em negociação: prazo para chamar o cliente ----------

/** Pré-venda repassada ao vendedor e ainda sem resultado: o cliente precisa ser chamado dentro do prazo. */
export function inNegotiation(r: { kind?: 'PRE_VENDAS' | 'POS_VENDAS'; forwarded: boolean; saleStatus: SaleStatus }) {
  return (r.kind ?? 'PRE_VENDAS') === 'PRE_VENDAS' && r.forwarded && r.saleStatus === 'NEGOCIACAO'
}

/**
 * Prazo para chamar o cliente depois de uma alteração:
 * - fora da negociação (vendeu, perdeu ou não está repassada): sem prazo;
 * - data escolhida na ficha: vale ela;
 * - acabou de entrar em negociação: agora + prazo configurado;
 * - continua em negociação: mantém o prazo que já tinha.
 */
export function nextCallDue(
  next: { kind?: 'PRE_VENDAS' | 'POS_VENDAS'; forwarded: boolean; saleStatus: SaleStatus },
  prev: { kind?: 'PRE_VENDAS' | 'POS_VENDAS'; forwarded: boolean; saleStatus: SaleStatus; callDueAt: Date | null } | null,
  callHours: number,
  chosen?: Date | null,
  now = new Date(),
): Date | null {
  if (!inNegotiation(next)) return null
  if (chosen) return chosen
  const fresh = new Date(now.getTime() + callHours * 3_600_000)
  if (!prev || !inNegotiation(prev)) return fresh
  return prev.callDueAt ?? fresh
}

/** Em negociação e o prazo para chamar o cliente já passou. */
export function isCallOverdue(r: { kind?: 'PRE_VENDAS' | 'POS_VENDAS'; forwarded: boolean; saleStatus: SaleStatus; callDueAt: Date | null }, now = new Date()) {
  return inNegotiation(r) && !!r.callDueAt && r.callDueAt.getTime() < now.getTime()
}

// ---------- Mensagem automática no dia seguinte ----------

export interface NextDayMessage {
  enabled: boolean
  /** Horário de São Paulo (HH:MM) a partir do qual a mensagem sai. */
  time: string
  text: string
  /** Número que envia para quem não chamou por WhatsApp (vazio: o primeiro dos escolhidos que estiver conectado). */
  numberId: string | null
  /** Números de WhatsApp cujos atendimentos recebem a mensagem (ex.: só o de Pré-vendas); sai pelo mesmo número. */
  numberIds: string[]
  /** Também para quem não chamou por WhatsApp (veio de formulário): sai pelo numberId. */
  withoutChat: boolean
  /** Só pré-venda marcada "Repassou ao vendedor"; o dia seguinte conta a partir do repasse. */
  onlyForwarded: boolean
  /** Situações da venda que recebem a mensagem. */
  saleStatuses: SaleStatusKey[]
  /** Espera entre um envio e o próximo pelo mesmo número, sorteada entre o mínimo e o máximo (minutos). */
  gapMin: number
  gapMax: number
}

export type SaleStatusKey = 'NEGOCIACAO' | 'SIM' | 'NAO'
export const SALE_STATUS_KEYS: SaleStatusKey[] = ['NEGOCIACAO', 'SIM', 'NAO']

export const DEFAULT_NEXT_DAY_TEXT =
  'Olá, {nome}! Tudo bem? Ontem você entrou em contato com a gente. Conseguimos te ajudar com o que precisava? Se ficou alguma dúvida, é só responder esta mensagem.'

export const DEFAULT_NEXT_DAY: NextDayMessage = { enabled: false, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT, numberId: null, numberIds: [], withoutChat: false, onlyForwarded: true, saleStatuses: SALE_STATUS_KEYS, gapMin: 3, gapMax: 20 }

/** Configuração salva (ou incompleta) com valores válidos. */
export function cleanNextDay(raw: Partial<NextDayMessage> | null | undefined): NextDayMessage {
  const r = raw ?? {}
  const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_NEXT_DAY.time
  const text = typeof r.text === 'string' && r.text.trim() ? r.text.trim().slice(0, 1000) : DEFAULT_NEXT_DAY_TEXT
  const statuses = Array.isArray(r.saleStatuses) ? SALE_STATUS_KEYS.filter((k) => r.saleStatuses!.includes(k)) : SALE_STATUS_KEYS
  const numberId = typeof r.numberId === 'string' ? r.numberId : null
  const ids = Array.isArray(r.numberIds) ? [...new Set(r.numberIds.filter((x): x is string => typeof x === 'string'))].slice(0, 50) : null
  return {
    enabled: r.enabled === true,
    time,
    text,
    numberId,
    // Salva antes desta escolha: só o número que estava selecionado (nunca todos os números conectados).
    numberIds: ids ?? (numberId ? [numberId] : []),
    withoutChat: r.withoutChat === true,
    // Configuração salva antes desta regra: só repassadas (é o que faz sentido para a mensagem de pós-venda).
    onlyForwarded: r.onlyForwarded !== false,
    saleStatuses: statuses.length ? statuses : SALE_STATUS_KEYS,
    ...cleanGap(r.gapMin, r.gapMax),
  }
}

/** Intervalo entre envios: de 1 a 120 minutos, mínimo nunca maior que o máximo (padrão 3 a 20). */
function cleanGap(min: unknown, max: unknown) {
  const int = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(120, Math.max(1, Math.round(v))) : d)
  const a = int(min, DEFAULT_NEXT_DAY.gapMin)
  const b = int(max, DEFAULT_NEXT_DAY.gapMax)
  return { gapMin: Math.min(a, b), gapMax: Math.max(a, b) }
}

/** Espera sorteada até o próximo envio (ms), para o WhatsApp não ver um padrão de robô e bloquear o número. */
export function nextGapMs(cfg: Pick<NextDayMessage, 'gapMin' | 'gapMax'>, random = Math.random) {
  return Math.round((cfg.gapMin + random() * (cfg.gapMax - cfg.gapMin)) * 60_000)
}

/**
 * Conversa finalizada ou arquivada não recebe a mensagem do dia seguinte: arquivada agora, ou finalizada depois que
 * o cliente chamou (atendimento encerrado).
 */
export function conversationClosed(conv: { status: string; closedAt: Date | null } | null, leadAt: Date) {
  if (!conv) return false
  return conv.status === 'ARQUIVADA' || (!!conv.closedAt && conv.closedAt >= leadAt)
}

/**
 * Janela da mensagem do dia seguinte, no horário de São Paulo (UTC-3): a partir do horário configurado de hoje,
 * vale para quem abriu pré-venda ontem. Antes do horário, nada sai (null).
 */
export function nextDayWindow(time: string, now = new Date()): { from: Date; to: Date; day: string } | null {
  const local = new Date(now.getTime() - 3 * 3_600_000).toISOString()
  if (local.slice(11, 16) < time) return null
  const today = local.slice(0, 10)
  const to = new Date(`${today}T00:00:00-03:00`)
  const from = new Date(to.getTime() - 86_400_000)
  return { from, to, day: new Date(from.getTime() - 3 * 3_600_000).toISOString().slice(0, 10) }
}

// ---------- Resumo do dia para cada vendedor ----------

export interface SellerDigest {
  enabled: boolean
  /** Horário de São Paulo (HH:MM) a partir do qual o resumo do dia sai. */
  time: string
  /** Abertura da mensagem; a lista de clientes vem logo abaixo. */
  text: string
  /** Número da empresa que envia (vazio: o primeiro conectado). */
  numberId: string | null
  /** Um cliente por mensagem (como se faz copiando e colando, cada telefone fica clicável) ou tudo numa lista só. */
  split: boolean
  /** Todos os vendedores (com telefone) ou só os escolhidos em sellerIds. */
  allSellers: boolean
  sellerIds: string[]
}

export const DEFAULT_DIGEST_TEXT = 'Olá, {vendedor}! Resumo de hoje ({data}): {quantidade} cliente(s) da pré-venda repassado(s) para você. Não deixe de chamar todos:'

export const DEFAULT_DIGEST: SellerDigest = { enabled: false, time: '18:00', text: DEFAULT_DIGEST_TEXT, numberId: null, split: true, allSellers: true, sellerIds: [] }

export function cleanDigest(raw: Partial<SellerDigest> | null | undefined): SellerDigest {
  const r = raw ?? {}
  const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_DIGEST.time
  const text = typeof r.text === 'string' && r.text.trim() ? r.text.trim().slice(0, 1000) : DEFAULT_DIGEST_TEXT
  return { enabled: r.enabled === true, time, text, numberId: typeof r.numberId === 'string' ? r.numberId : null,
    split: r.split !== false,
    allSellers: r.allSellers !== false,
    sellerIds: Array.isArray(r.sellerIds) ? [...new Set(r.sellerIds.filter((x): x is string => typeof x === 'string'))].slice(0, 500) : [],
  }
}

/** O vendedor recebe o resumo? Ligado, e todos ou entre os escolhidos. */
export function digestFor(c: SellerDigest, sellerId: string) {
  return c.enabled && (c.allSellers || c.sellerIds.includes(sellerId))
}

/** Dia de hoje em São Paulo (início e fim) e se já passou do horário do envio. */
export function todayWindow(time: string, now = new Date()) {
  const local = new Date(now.getTime() - 3 * 3_600_000).toISOString()
  const day = local.slice(0, 10)
  const from = new Date(`${day}T00:00:00-03:00`)
  return { day, from, to: new Date(from.getTime() + 86_400_000), due: local.slice(11, 16) >= time }
}

/** Telefone para ler: +5549999991111 -> (49) 99999-1111; fora do Brasil fica como está. */
export function readablePhone(phone: string | null) {
  if (!phone) return 'sem telefone'
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone)
  return br ? `(${br[1]}) ${br[2]}-${br[3]}` : phone
}

/**
 * Mensagens do resumo: a abertura (com {vendedor}, {data} e {quantidade}) e os clientes, telefone primeiro (no
 * WhatsApp do vendedor o telefone fica clicável para "Conversar"). Separado: uma mensagem por cliente; senão, uma lista.
 */
export function digestMessages(intro: string, seller: string, day: string, items: { name: string; phone: string | null }[], split: boolean) {
  const [y, m, d] = day.split('-')
  const head = intro
    .replace(/\{vendedor\}/gi, seller.trim().split(/\s+/)[0] ?? '')
    .replace(/\{data\}/gi, `${d}/${m}/${y}`)
    .replace(/\{quantidade\}/gi, String(items.length))
  const lines = items.map((r) => `${readablePhone(r.phone)}\n${r.name}`)
  return split ? [head, ...lines] : [[head, '', ...items.map((r, i) => `${i + 1}. ${readablePhone(r.phone)} — ${r.name}`)].join('\n')]
}

export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo de atendimento',
  leadAt: 'Data do lead',
  name: 'Nome',
  customerCode: 'Código do cliente',
  phone: 'Telefone',
  email: 'E-mail',
  sellerId: 'Vendedor',
  unitId: 'Unidade',
  originId: 'Origem',
  customerTypeId: 'Tipo de cliente',
  country: 'País',
  state: 'Estado',
  city: 'Cidade',
  brandIds: 'Marca da máquina',
  partTypeIds: 'Tipo de peça',
  forwarded: 'Repassou ao vendedor',
  returnStatus: 'Vendedor retornou',
  saleStatus: 'Venda realizada',
  lostReasonId: 'Motivo da perda',
  invoiceNumber: 'Nota fiscal',
  saleValue: 'Valor da venda',
  notes: 'Observações',
  callDueAt: 'Chamar o cliente até',
  followStatus: 'Situação do pós-venda',
  followNote: 'Observação do pós-venda',
}

// ---------- Pós-venda automático ----------

export type FollowStatus = 'PENDENTE' | 'CONTATADO' | 'ANALISANDO' | 'RESOLVIDO' | 'VOLTOU_AO_VENDEDOR'

export const FOLLOW_LABEL: Record<FollowStatus, string> = {
  PENDENTE: 'Aguardando contato',
  CONTATADO: 'Cliente contatado',
  ANALISANDO: 'Analisando',
  RESOLVIDO: 'Resolvido',
  VOLTOU_AO_VENDEDOR: 'Voltou ao vendedor',
}

/** A pré-venda gera o pós-venda quando passa a ter resultado (venda realizada ou não). Só uma vez. */
export function shouldCreatePostSale(kind: 'PRE_VENDAS' | 'POS_VENDAS', prevSale: SaleStatus | null, nextSale: SaleStatus) {
  const closed = (s: SaleStatus | null) => s === 'SIM' || s === 'NAO'
  return kind === 'PRE_VENDAS' && closed(nextSale) && !closed(prevSale)
}

/** Toda mudança de situação do pós-venda exige uma observação (o que foi feito ou combinado). */
export function validateFollow(prev: FollowStatus | null, next: FollowStatus | null, note: string | null | undefined): string | null {
  if (next === prev) return null
  if (next === 'PENDENTE' && prev) return 'O pós-venda não pode voltar para "Aguardando contato".'
  if (next && next !== 'PENDENTE' && !note?.trim()) return 'Escreva uma observação sobre o contato com o cliente.'
  return null
}

/** Pós-venda ainda sem nenhum contato registrado depois do prazo (padrão: 24 horas). */
export function isFollowOverdue(r: { followStatus: FollowStatus | null; dueAt: Date | null }, now = new Date()) {
  return r.followStatus === 'PENDENTE' && !!r.dueAt && r.dueAt.getTime() < now.getTime()
}

function comparable(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return [...v].sort().join(',')
  if (typeof v === 'object' && 'toString' in (v as object)) return String(v)
  return String(v)
}

/** Lista só os campos que mudaram, com valor anterior e novo (base do histórico de cada registro). */
export function diffRecord(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { de: unknown; para: unknown }> = {}
  for (const field of Object.keys(FIELD_LABELS)) {
    if (!(field in after)) continue
    if (comparable(before[field]) !== comparable(after[field])) changes[field] = { de: before[field] ?? null, para: after[field] ?? null }
  }
  return changes
}

export type NextDayRoute = { send: string } | { skip: string } | { wait: true }

/**
 * Por qual número sai a mensagem do dia seguinte: o atendimento tem de ser de um dos números escolhidos e sai por ele;
 * de outro número (ex.: e-commerce) não manda. Sem conversa (formulário), só se a opção estiver ligada.
 * Número escolhido desconectado: espera reconectar.
 */
export function nextDayRoute(conv: { numberId: string } | null, cfg: Pick<NextDayMessage, 'numberIds' | 'numberId' | 'withoutChat'>, connected: string[]): NextDayRoute {
  if (conv) {
    if (!cfg.numberIds.includes(conv.numberId)) return { skip: 'atendimento por um número de WhatsApp que não está nas regras' }
    return connected.includes(conv.numberId) ? { send: conv.numberId } : { wait: true }
  }
  if (!cfg.withoutChat) return { skip: 'cliente não chamou por WhatsApp' }
  const pick = cfg.numberId && connected.includes(cfg.numberId) ? cfg.numberId : cfg.numberIds.find((id) => connected.includes(id))
  return pick ? { send: pick } : { wait: true }
}
