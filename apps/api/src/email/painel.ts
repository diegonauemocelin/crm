/**
 * Dashboard do e-mail marketing: contas puras (taxas, atribuição de vendas ao clique e o que chama atenção).
 * Abertura é aproximada: alguns programas (Apple Mail, alguns antivírus) abrem as imagens sozinhos.
 */

const DAY = 86_400_000

/** Recusa definitiva do servidor do destinatário (e-mail inexistente): o mesmo critério que marca o lead como devolvido. */
export const BOUNCE_SQL = '(^|[^0-9])(550|551|553|554)([^0-9]|$)|user unknown|unknown user|no such user|mailbox (unavailable|not found)|does not exist|inexistente'

export const ATTRIBUTION_WINDOWS = [1, 3, 7, 14, 30] as const
export type AttributionWindow = (typeof ATTRIBUTION_WINDOWS)[number]

export interface Funnel {
  sent: number
  failed: number
  bounced: number
  opened: number
  clicked: number
  unsubscribed: number
}

export const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

/** Taxas sobre os entregues (enviados aceitos pelo servidor). Cliques por abertura = interesse de quem abriu. */
export function rates(f: Funnel) {
  const attempted = f.sent + f.failed
  return {
    delivery: ratio(f.sent, attempted),
    bounce: ratio(f.bounced, attempted),
    open: ratio(f.opened, f.sent),
    click: ratio(f.clicked, f.sent),
    clickToOpen: ratio(f.clicked, f.opened),
    unsubscribe: ratio(f.unsubscribed, f.sent),
  }
}

export interface Click {
  leadId: string
  campaignId: string
  automationId: string | null
  at: Date
}
export interface Sale {
  id: string
  leadId: string
  at: Date
  value: number
  /** loja (pedido pago no site) ou atendimento (venda registrada na pré-venda). */
  source: 'loja' | 'atendimento'
}
export interface Attributed extends Sale {
  campaignId: string
  automationId: string | null
}

/**
 * Venda atribuída ao último clique em e-mail do mesmo lead nos N dias antes da compra.
 * Uma venda conta uma vez só (para o e-mail clicado por último), mesmo que o lead tenha clicado em vários.
 */
export function attributeSales(clicks: Click[], sales: Sale[], windowDays: number): Attributed[] {
  const byLead = new Map<string, Click[]>()
  for (const c of clicks) {
    const list = byLead.get(c.leadId)
    if (list) list.push(c)
    else byLead.set(c.leadId, [c])
  }
  for (const list of byLead.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime())
  const out: Attributed[] = []
  for (const s of sales) {
    const list = byLead.get(s.leadId)
    if (!list) continue
    let last: Click | null = null
    for (const c of list) {
      if (c.at.getTime() > s.at.getTime()) break
      last = c
    }
    if (last && s.at.getTime() - last.at.getTime() <= windowDays * DAY) out.push({ ...s, campaignId: last.campaignId, automationId: last.automationId })
  }
  return out
}

export function sumSales(list: { value: number }[]) {
  return { count: list.length, revenue: Math.round(list.reduce((n, s) => n + s.value, 0) * 100) / 100 }
}

const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Dia e hora com mais aberturas (só com volume suficiente para não enganar). */
export function bestSlot(heat: number[][]) {
  let best: { w: number; h: number; n: number } | null = null
  let total = 0
  heat.forEach((row, w) =>
    row.forEach((n, h) => {
      total += n
      if (!best || n > best.n) best = { w, h, n }
    }),
  )
  const b = best as { w: number; h: number; n: number } | null
  if (!b || total < 50 || b.n < 5) return null
  return { weekday: WEEK[b.w] ?? '', hour: b.h }
}

export function insights(i: {
  funnel: Funnel
  previousOpen: number | null
  campaigns: { name: string; sent: number; click: number | null }[]
  slot: { weekday: string; hour: number } | null
  revenue: number
  sales: number
  windowDays: number
}) {
  const out: { tone: 'bom' | 'atencao' | 'neutro'; text: string }[] = []
  const r = rates(i.funnel)
  if (i.funnel.sent === 0) return [{ tone: 'neutro' as const, text: 'Nenhum e-mail enviado no período.' }]
  if (r.bounce !== null && r.bounce > 0.02) out.push({ tone: 'atencao', text: `${pct(r.bounce)} dos envios voltaram com e-mail inexistente. Acima de 2% os provedores começam a desconfiar do domínio: limpe a base ou confirme os e-mails antes de enviar.` })
  if (r.unsubscribe !== null && r.unsubscribe > 0.005) out.push({ tone: 'atencao', text: `Descadastros em ${pct(r.unsubscribe)} dos entregues (o saudável é abaixo de 0,5%). Revise a frequência e se o público do segmento combina com o assunto.` })
  if (r.open !== null && i.funnel.sent >= 100) {
    if (r.open < 0.15) out.push({ tone: 'atencao', text: `Abertura de ${pct(r.open)}, baixa. Teste assuntos mais diretos (com o nome da peça ou da marca) e confira se os e-mails não estão caindo no spam.` })
    else if (r.open >= 0.3) out.push({ tone: 'bom', text: `Abertura de ${pct(r.open)}: acima da média do setor (20 a 25%).` })
  }
  if (i.previousOpen !== null && r.open !== null && i.funnel.sent >= 100) {
    const d = r.open - i.previousOpen
    if (Math.abs(d) >= 0.05) out.push({ tone: d > 0 ? 'bom' : 'atencao', text: `A abertura ${d > 0 ? 'subiu' : 'caiu'} ${(Math.abs(d) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos em relação ao período anterior.` })
  }
  const ranked = i.campaigns.filter((c) => c.sent >= 50 && c.click !== null).sort((a, b) => (b.click ?? 0) - (a.click ?? 0))
  const top = ranked[0]
  if (ranked.length >= 2 && top) out.push({ tone: 'neutro', text: `Mais cliques: “${top.name}” (${pct(top.click ?? 0)} dos entregues). Vale repetir o formato.` })
  if (i.slot) out.push({ tone: 'neutro', text: `Os e-mails são mais abertos na ${i.slot.weekday}, por volta das ${i.slot.hour}h. Bom horário para agendar os próximos envios.` })
  if (i.sales > 0) out.push({ tone: 'bom', text: `${i.sales} venda(s) de quem clicou em um e-mail nos ${i.windowDays} dias anteriores à compra, somando ${i.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` })
  return out
}
