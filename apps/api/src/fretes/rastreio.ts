/**
 * Rastreamento pela chave da NF-e no SSW (TW Transportes e as outras transportadoras que usam o sistema SSW): API
 * pública, sem senha. Funções puras, testadas em test/fretes-rastreio.spec.ts.
 */
export const SSW_TRACKING_URL = 'https://ssw.inf.br/api/trackingdanfe'

export interface TrackingEvent {
  at: string | null
  city: string | null
  unit: string | null
  occurrence: string
  description: string | null
  kind: string | null
  receiver: string | null
}

export interface TrackingResult {
  found: boolean
  message: string
  /** Domínio da transportadora no SSW (ex.: TWT). */
  carrier: string | null
  events: TrackingEvent[]
  /** Data da entrega, quando o rastreamento já mostra a mercadoria entregue. */
  deliveredAt: string | null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** "2020-07-20T10:36:12" (hora de Brasília) → ISO com o fuso. */
function spIso(v: unknown) {
  const s = str(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null
  const d = new Date(`${s.length === 16 ? `${s}:00` : s}-03:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Ocorrência de entrega feita (não conta pré-entrega). */
export function isDelivery(e: Pick<TrackingEvent, 'kind' | 'occurrence'>) {
  if (/pre-?entrega/i.test(e.kind ?? '') || /PRE-?ENTREGUE/i.test(e.occurrence)) return false
  return /^entrega$/i.test(e.kind ?? '') || /^MERCADORIA ENTREGUE\b/i.test(e.occurrence)
}

export function parseSswTracking(body: unknown): TrackingResult {
  const b = (body ?? {}) as Record<string, unknown>
  const message = str(b.message) ?? (b.success ? '' : 'Sem resposta do rastreamento.')
  if (b.success !== true) return { found: false, message, carrier: null, events: [], deliveredAt: null }
  const doc = (b.documento ?? {}) as Record<string, unknown>
  const list = Array.isArray(doc.tracking) ? (doc.tracking as Record<string, unknown>[]) : []
  const events: TrackingEvent[] = list
    .map((t) => ({
      at: spIso(t.data_hora) ?? spIso(t.data_hora_efetiva),
      city: str(t.cidade),
      unit: str(t.filial),
      occurrence: str(t.ocorrencia) ?? 'Ocorrência',
      description: str(t.descricao),
      kind: str(t.tipo),
      receiver: str(t.nome_recebedor),
    }))
    .sort((a, c) => (c.at ?? '').localeCompare(a.at ?? ''))
  const delivered = events.find(isDelivery)
  const firstWithCarrier = list.find((t) => str(t.dominio))
  return { found: true, message, carrier: firstWithCarrier ? str(firstWithCarrier.dominio) : null, events, deliveredAt: delivered ? (spIso(list.find((t) => str(t.ocorrencia) === delivered.occurrence)?.data_hora_efetiva) ?? delivered.at) : null }
}

/** Resumo de uma linha para a lista de pedidos: a ocorrência mais recente. */
export function trackingLine(r: TrackingResult) {
  const e = r.events[0]
  if (!r.found || !e) return null
  return `${e.occurrence.replace(/\s*\(\d+\)$/, '')}${e.city ? ` · ${e.city}` : ''}`.slice(0, 200)
}
