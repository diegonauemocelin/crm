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
  /** Número que envia quando o cliente não chamou por WhatsApp (vazio: o primeiro conectado). */
  numberId: string | null
}

export const DEFAULT_NEXT_DAY_TEXT =
  'Olá, {nome}! Tudo bem? Ontem você entrou em contato com a gente. Conseguimos te ajudar com o que precisava? Se ficou alguma dúvida, é só responder esta mensagem.'

export const DEFAULT_NEXT_DAY: NextDayMessage = { enabled: false, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT, numberId: null }

/** Configuração salva (ou incompleta) com valores válidos. */
export function cleanNextDay(raw: Partial<NextDayMessage> | null | undefined): NextDayMessage {
  const r = raw ?? {}
  const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_NEXT_DAY.time
  const text = typeof r.text === 'string' && r.text.trim() ? r.text.trim().slice(0, 1000) : DEFAULT_NEXT_DAY_TEXT
  return { enabled: r.enabled === true, time, text, numberId: typeof r.numberId === 'string' ? r.numberId : null }
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
