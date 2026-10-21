/**
 * Planejamento (orçamento e metas) e alertas do Marketing Inteligente. Funções puras, testadas em test/marketing.spec.ts.
 * Projeções são estimativas com a premissa escrita; nada aqui supõe que mais investimento traz vendas na mesma proporção.
 */
import { delta, type Indicators } from './metricas'

export const PLAN_KEY = 'mkt_planejamento'
export const ALERTS_KEY = 'mkt_alertas'
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export interface MonthPlan {
  budget: { total: number | null; google: number | null; meta: number | null; tiktok: number | null; campaigns: Record<string, number> }
  goals: { leads: number | null; cpl: number | null; sales: number | null; revenue: number | null }
  updatedAt: string | null
  updatedBy: string | null
}
export interface Plans {
  months: Record<string, MonthPlan>
}
export const emptyPlan = (): MonthPlan => ({ budget: { total: null, google: null, meta: null, tiktok: null, campaigns: {} }, goals: { leads: null, cpl: null, sales: null, revenue: null }, updatedAt: null, updatedBy: null })

const money = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1e10 ? Math.round(n * 100) / 100 : undefined
}

export function cleanPlan(month: string, input: Partial<MonthPlan>, by: string): MonthPlan | { error: string } {
  if (!MONTH.test(month)) return { error: 'Mês inválido (use aaaa-mm).' }
  const b = (input.budget ?? {}) as Partial<MonthPlan['budget']>
  const g = (input.goals ?? {}) as Partial<MonthPlan['goals']>
  const fields = { total: money(b.total), google: money(b.google), meta: money(b.meta), tiktok: money(b.tiktok), leads: money(g.leads), cpl: money(g.cpl), sales: money(g.sales), revenue: money(g.revenue) }
  if (Object.values(fields).some((v) => v === undefined)) return { error: 'Valores do orçamento e das metas: números positivos.' }
  const campaigns: Record<string, number> = {}
  for (const [id, v] of Object.entries(b.campaigns ?? {})) {
    const n = money(v)
    if (!/^\d{1,30}$/.test(id) || n === undefined) return { error: 'Orçamento por campanha inválido.' }
    if (n) campaigns[id] = n
  }
  if (Object.keys(campaigns).length > 300) return { error: 'No máximo 300 campanhas com orçamento.' }
  return {
    budget: { total: fields.total!, google: fields.google!, meta: fields.meta!, tiktok: fields.tiktok!, campaigns },
    goals: { leads: fields.leads === null ? null : Math.round(fields.leads!), cpl: fields.cpl!, sales: fields.sales === null ? null : Math.round(fields.sales!), revenue: fields.revenue! },
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  }
}

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

/**
 * Projeção do gasto até o fim do mês: média diária do realizado × dias do mês (premissa: o ritmo continua igual).
 * Faixa de incerteza (≈80%) pela variação do gasto diário, quando há 7 dias ou mais.
 */
export function projection(dailySpent: number[], totalDays: number) {
  const elapsed = dailySpent.length
  const spent = dailySpent.reduce((s, x) => s + x, 0)
  if (!elapsed) return { spent: 0, projected: null, low: null, high: null, elapsed, premise: 'Sem gasto no mês ainda.' }
  const mean = spent / elapsed
  const remaining = Math.max(0, totalDays - elapsed)
  const projected = Math.round((spent + mean * remaining) * 100) / 100
  if (elapsed < 7 || !remaining) return { spent: round(spent), projected, low: null, high: null, elapsed, premise: `Ritmo médio de ${brl(mean)} por dia mantido até o fim do mês.` }
  const sd = Math.sqrt(dailySpent.reduce((s, x) => s + (x - mean) ** 2, 0) / (elapsed - 1))
  const margin = 1.28 * sd * Math.sqrt(remaining)
  return { spent: round(spent), projected, low: round(Math.max(spent, projected - margin)), high: round(projected + margin), elapsed, premise: `Ritmo médio de ${brl(mean)} por dia mantido; faixa pela variação diária dos últimos ${elapsed} dias (≈80% de chance).` }
}
const round = (n: number) => Math.round(n * 100) / 100
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Meta x realizado, com o esperado até hoje (ritmo linear) para saber se está no caminho. */
export function goalStatus(goal: number | null, done: number | null, elapsed: number, totalDays: number, lowerIsBetter = false) {
  if (goal === null || done === null) return null
  const pctDone = goal > 0 ? Math.round((done / goal) * 1000) / 10 : null
  if (lowerIsBetter) return { goal, done, pct: pctDone, expected: goal, onTrack: done <= goal }
  const expected = Math.round((goal * elapsed) / totalDays * 100) / 100
  return { goal, done, pct: pctDone, expected, onTrack: done >= expected * 0.9 }
}

/**
 * Cenários de investimento (−30% a +30%) com faixa: o lado otimista mantém o CPL atual; o conservador supõe
 * retorno decrescente (cada real a mais rende menos: leads ∝ investimento^0,6). Para reduções, o inverso.
 * Conversão em venda e ticket médio ficam como os do período (premissas escritas na tela).
 */
export function scenarios(base: Pick<Indicators, 'mediaCost' | 'leads' | 'sales' | 'revenue' | 'conversionRate' | 'ticket'>, changes = [-30, -15, 15, 30]) {
  if (base.mediaCost <= 0 || base.leads <= 0) return []
  const conv = (base.conversionRate ?? 0) / 100
  const ticket = base.ticket ?? 0
  return changes.map((pctChange) => {
    const f = 1 + pctChange / 100
    const prop = base.leads * f
    const dim = base.leads * f ** 0.6
    const [low, high] = pctChange > 0 ? [dim, prop] : [prop, dim]
    const r = (n: number) => Math.round(n)
    return {
      change: pctChange,
      investment: round(base.mediaCost * f),
      leads: { low: r(low), high: r(high) },
      sales: { low: r(low * conv), high: r(high * conv) },
      revenue: { low: round(low * conv * ticket), high: round(high * conv * ticket) },
    }
  })
}

// ---------- Alertas ----------

export const ALERT_TYPES = [
  { key: 'gasto_limite', label: 'Gasto perto do limite do orçamento do mês', unit: '% do orçamento', default: 90 },
  { key: 'campanha_sem_conversao', label: 'Campanha com investimento e sem leads', unit: 'R$ investidos no período', default: 200 },
  { key: 'cpl_aumento', label: 'Aumento do custo por lead', unit: '% de alta contra o período anterior', default: 30 },
  { key: 'queda_leads', label: 'Queda de leads', unit: '% de queda contra o período anterior', default: 30 },
  { key: 'queda_faturamento', label: 'Queda do faturamento atribuído', unit: '% de queda contra o período anterior', default: 30 },
  { key: 'leads_sem_atendimento', label: 'Leads sem atendimento', unit: 'leads', default: 5 },
  { key: 'meta_atrasada', label: 'Meta de leads ou vendas abaixo do ritmo', unit: '% abaixo do esperado até hoje', default: 20 },
  { key: 'perda_utm', label: 'Leads de anúncio sem campanha identificada (UTM)', unit: '% dos leads de anúncio', default: 30 },
  { key: 'dados_desatualizados', label: 'Dados desatualizados ou falha de integração', unit: 'horas sem atualizar', default: 36 },
] as const
export type AlertType = (typeof ALERT_TYPES)[number]['key']

export interface AlertRule {
  id: string
  type: AlertType
  threshold: number
  /** Período avaliado (dias), comparado com o anterior do mesmo tamanho. */
  windowDays: number
  emails: string[]
  active: boolean
  lastFiredAt: string | null
}
export interface AlertEvent {
  at: string
  ruleId: string
  type: AlertType
  message: string
  limitation: string | null
}
export interface AlertsState {
  rules: AlertRule[]
  events: AlertEvent[]
}
export const DEFAULT_ALERTS: AlertsState = { rules: [], events: [] }
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i

export function cleanRule(input: Partial<AlertRule>, prev: AlertRule | null, id: string): AlertRule | { error: string } {
  const type = ALERT_TYPES.find((t) => t.key === (input.type ?? prev?.type))
  if (!type) return { error: 'Tipo de alerta inválido.' }
  const threshold = Number(input.threshold ?? prev?.threshold ?? type.default)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1e9) return { error: 'Limite do alerta inválido.' }
  const windowDays = Number(input.windowDays ?? prev?.windowDays ?? 7)
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) return { error: 'Período avaliado: de 1 a 90 dias.' }
  const emails = [...new Set((input.emails ?? prev?.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
  if (emails.length > 20) return { error: 'No máximo 20 e-mails por alerta.' }
  const bad = emails.find((e) => !EMAIL.test(e))
  if (bad) return { error: `E-mail inválido: ${bad}` }
  return { id, type: type.key, threshold, windowDays, emails, active: input.active ?? prev?.active ?? true, lastFiredAt: prev?.lastFiredAt ?? null }
}

export interface AlertContext {
  now: Indicators
  before: Indicators
  campaigns: { key: string; name: string; mediaCost: number; leads: number }[]
  googleWithoutCampaign: { without: number; total: number }
  /** Orçamento do mês e gasto até agora (null = sem orçamento cadastrado). */
  budget: { amount: number; spent: number } | null
  goals: { label: string; status: ReturnType<typeof goalStatus> }[]
  /** Horas desde a última atualização de cada fonte ligada, e erros de sincronização. */
  staleness: { name: string; hours: number | null; error: string | null }[]
}

const MIN = 10
const pc = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Avalia um alerta. Amostra pequena não dispara (ou dispara com a limitação escrita, quando a regra é de contagem). */
export function evaluate(rule: AlertRule, c: AlertContext): { fired: boolean; message: string; limitation: string | null } {
  const no = { fired: false, message: '', limitation: null }
  const t = rule.threshold
  switch (rule.type) {
    case 'gasto_limite': {
      if (!c.budget || c.budget.amount <= 0) return no
      const used = (c.budget.spent / c.budget.amount) * 100
      return used >= t ? { fired: true, message: `O gasto do mês chegou a ${pc(used)} do orçamento (${brl(c.budget.spent)} de ${brl(c.budget.amount)}).`, limitation: null } : no
    }
    case 'campanha_sem_conversao': {
      const list = c.campaigns.filter((x) => x.key !== '-' && x.mediaCost >= t && x.leads === 0)
      return list.length ? { fired: true, message: `${list.length} campanha(s) investiram ${brl(t)} ou mais sem gerar lead: ${list.slice(0, 5).map((x) => `${x.name} (${brl(x.mediaCost)})`).join(', ')}.`, limitation: null } : no
    }
    case 'cpl_aumento': {
      const d = delta(c.now.cpl, c.before.cpl)
      if (d === null || d < t) return no
      if (c.now.leads < MIN || c.before.leads < MIN) return no
      return { fired: true, message: `O custo por lead subiu ${pc(d)}: ${brl(c.before.cpl!)} → ${brl(c.now.cpl!)}.`, limitation: null }
    }
    case 'queda_leads': {
      const d = delta(c.now.leads, c.before.leads)
      if (d === null || -d < t || c.before.leads < MIN) return no
      return { fired: true, message: `Os leads caíram ${pc(-d)}: ${c.before.leads} → ${c.now.leads}.`, limitation: null }
    }
    case 'queda_faturamento': {
      const d = delta(c.now.mktRevenue, c.before.mktRevenue)
      if (d === null || -d < t || c.before.mktSales < 5) return no
      return { fired: true, message: `O faturamento atribuído ao marketing caiu ${pc(-d)}: ${brl(c.before.mktRevenue)} → ${brl(c.now.mktRevenue)}.`, limitation: c.before.mktSales < 15 ? 'Poucas vendas no período anterior: confira antes de concluir.' : null }
    }
    case 'leads_sem_atendimento': {
      const n = c.now.leads - c.now.attended
      return n >= t ? { fired: true, message: `${n} lead(s) do período estão sem atendimento.`, limitation: null } : no
    }
    case 'meta_atrasada': {
      const late = c.goals.filter((g) => g.status && g.status.expected > 0 && !(g.label === 'CPL') && g.status.done < g.status.expected * (1 - t / 100))
      return late.length ? { fired: true, message: `Meta abaixo do ritmo: ${late.map((g) => `${g.label} ${g.status!.done.toLocaleString('pt-BR')} de ${g.status!.expected.toLocaleString('pt-BR')} esperados até hoje`).join('; ')}.`, limitation: 'Ritmo esperado linear ao longo do mês.' } : no
    }
    case 'perda_utm': {
      const g = c.googleWithoutCampaign
      if (g.total < MIN) return no
      const share = (g.without / g.total) * 100
      return share >= t ? { fired: true, message: `${pc(share)} dos leads de anúncio do Google estão sem campanha identificada (${g.without} de ${g.total}).`, limitation: null } : no
    }
    case 'dados_desatualizados': {
      const bad = c.staleness.filter((s) => s.error || (s.hours !== null && s.hours >= t))
      return bad.length ? { fired: true, message: bad.map((s) => (s.error ? `${s.name}: ${s.error}` : `${s.name} sem atualizar há ${Math.round(s.hours!)} h`)).join('; '), limitation: null } : no
    }
  }
}
