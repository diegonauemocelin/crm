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

export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo de atendimento',
  leadAt: 'Data do lead',
  name: 'Nome',
  customerCode: 'Código do cliente',
  phone: 'Telefone',
  email: 'E-mail',
  sellerId: 'Vendedor',
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
