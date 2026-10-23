/**
 * Resumo do vendedor (semanal, WhatsApp): ciclo de sexta a quinta, enviado na sexta seguinte para cada vendedor que
 * recebeu clientes da pré-venda repassados no ciclo, com as informações escolhidas em Marketing › Relatórios e alertas.
 * Funções puras (testadas em test/relatorio-semanal.spec.ts) e a leitura do banco (loadWeekly).
 */
import type { PrismaService } from '../prisma/prisma.service'
import { normalizePhone } from './br'

/** Informações que podem ir no resumo (a ordem é a da mensagem). */
export const WEEKLY_SECTIONS = [
  { key: 'repassados', label: 'Leads repassados' },
  { key: 'vendas', label: 'Vendas realizadas' },
  { key: 'conversao', label: 'Conversão (vendas ÷ leads)' },
  { key: 'valor', label: 'Valor vendido e ticket médio' },
  { key: 'negociacao', label: 'Em negociação e perdidas' },
  { key: 'motivos', label: 'Motivos de perda mais comuns' },
  { key: 'retorno', label: 'Retorno ao cliente (taxa e tempo médio)' },
  { key: 'sem_contato', label: 'Clientes ainda sem contato registrado (nomes)' },
  { key: 'anterior', label: 'Comparação com o ciclo anterior' },
  { key: 'equipe', label: 'Média da equipe (conversão)' },
  { key: 'fechadas', label: 'Vendas fechadas na semana de repasses anteriores' },
  { key: 'marcas', label: 'Marcas de máquina mais pedidas' },
  { key: 'pecas', label: 'Tipos de peça mais pedidos' },
  { key: 'origens', label: 'De onde vieram os leads (origem)' },
  { key: 'sugestoes', label: 'Sugestões de melhoria' },
] as const
export type WeeklySection = (typeof WEEKLY_SECTIONS)[number]['key']
const SECTION_KEYS = new Set<string>(WEEKLY_SECTIONS.map((s) => s.key))
export const DEFAULT_SECTIONS: WeeklySection[] = ['repassados', 'vendas', 'conversao', 'valor', 'negociacao', 'anterior', 'equipe', 'fechadas', 'sugestoes']

export interface SellerWeekly {
  enabled: boolean
  /** Horário de São Paulo (HH:MM) a partir do qual o resumo sai, na sexta-feira. */
  time: string
  /** Número da empresa que envia (vazio: o primeiro conectado). */
  numberId: string | null
  /** Todos os vendedores com repasse no ciclo ou só os escolhidos em sellerIds. */
  allSellers: boolean
  sellerIds: string[]
  sections: WeeklySection[]
  /** Gestores (WhatsApp, informados à mão): recebem o resumo da equipe com uma linha por vendedor. Vazio: só os vendedores. */
  managerPhones: string[]
  /** Intervalo sorteado entre uma mensagem e outra (minutos), para o WhatsApp não ver o envio como spam. */
  gapMin: number
  gapMax: number
}

export const DEFAULT_WEEKLY: SellerWeekly = { enabled: false, time: '08:00', numberId: null, allSellers: true, sellerIds: [], sections: DEFAULT_SECTIONS, managerPhones: [], gapMin: 2, gapMax: 10 }

export function cleanWeekly(raw: Partial<SellerWeekly> | null | undefined): SellerWeekly {
  const r = raw ?? {}
  const sections = Array.isArray(r.sections) ? WEEKLY_SECTIONS.map((s) => s.key).filter((k) => (r.sections as string[]).includes(k)) : DEFAULT_SECTIONS
  return {
    enabled: r.enabled === true,
    time: typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_WEEKLY.time,
    numberId: typeof r.numberId === 'string' ? r.numberId : null,
    allSellers: r.allSellers !== false,
    sellerIds: Array.isArray(r.sellerIds) ? [...new Set(r.sellerIds.filter((x): x is string => typeof x === 'string'))].slice(0, 500) : [],
    sections: sections.length ? sections : DEFAULT_SECTIONS,
    ...weeklyGap(r.gapMin, r.gapMax),
    managerPhones: Array.isArray(r.managerPhones) ? [...new Set(r.managerPhones.map((x) => normalizePhone(String(x))).filter((x): x is string => !!x))].slice(0, 10) : [],
  }
}
/** Intervalo entre os envios: de 1 a 60 minutos (padrão 2 a 10), o menor sempre primeiro. */
export function weeklyGap(min: unknown, max: unknown) {
  const n = (v: unknown, d: number) => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) && x >= 1 && x <= 60 ? x : d
  }
  const a = n(min, DEFAULT_WEEKLY.gapMin)
  const b = n(max, DEFAULT_WEEKLY.gapMax)
  return { gapMin: Math.min(a, b), gapMax: Math.max(a, b) }
}

/** Espera até a próxima mensagem (ms), sorteada no intervalo. */
export const weeklyGapMs = (c: Pick<SellerWeekly, 'gapMin' | 'gapMax'>, random = Math.random) => Math.round((c.gapMin + random() * (c.gapMax - c.gapMin)) * 60_000)

export const isWeeklySection = (k: string): k is WeeklySection => SECTION_KEYS.has(k)

export const weeklyFor = (c: SellerWeekly, sellerId: string) => c.enabled && (c.allSellers || c.sellerIds.includes(sellerId))

const DAY = 86_400_000
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/**
 * Ciclo de sexta a quinta (horário de São Paulo). Na sexta, a partir do horário, o resumo do ciclo que terminou na
 * quinta (ontem) está pronto para sair. Fora da sexta, devolve o último ciclo completo (para a prévia), sem "due".
 */
export function weeklyCycle(time: string, now = new Date()) {
  const local = new Date(now.getTime() - 3 * 3_600_000)
  const today = local.toISOString().slice(0, 10)
  const weekday = local.getUTCDay() // 0 domingo ... 5 sexta
  // Última sexta-feira até hoje (hoje, se for sexta): é o dia do envio; o ciclo é a semana anterior a ele.
  const sendDay = new Date(Date.parse(`${today}T00:00:00Z`) - ((weekday - 5 + 7) % 7) * DAY).toISOString().slice(0, 10)
  const to = new Date(`${sendDay}T00:00:00-03:00`)
  const from = new Date(to.getTime() - 7 * DAY)
  const fromDay = new Date(Date.parse(`${sendDay}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10)
  const toDay = new Date(Date.parse(`${sendDay}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
  return {
    /** Identifica o ciclo (a sexta do envio): o envio sai uma vez por ciclo. */
    key: sendDay,
    from,
    to,
    prevFrom: new Date(from.getTime() - 7 * DAY),
    label: `${ddmm(fromDay)} a ${ddmm(toDay)}`,
    due: weekday === 5 && today === sendDay && local.toISOString().slice(11, 16) >= time,
  }
}

export interface WeeklyRow {
  sellerId: string
  name: string
  saleStatus: 'SIM' | 'NAO' | 'NEGOCIACAO'
  saleValue: number | null
  returnStatus: 'SIM' | 'NAO' | 'PENDENTE' | null
  calledAt: Date | null
  lostReason: string | null
  forwardedAt?: Date | null
  returnedAt?: Date | null
  brands?: string[]
  partTypes?: string[]
  origin?: string | null
}

export interface WeeklyStats {
  forwarded: number
  sales: number
  /** Vendas ÷ repassados (%), ou null sem repasse. */
  conversion: number | null
  revenue: number
  ticket: number | null
  negotiating: number
  lost: number
  /** Em negociação e sem contato registrado no CRM ("Chamei o cliente" ou retorno). */
  noContact: string[]
  topLost: { reason: string; count: number } | null
  lostReasons: { name: string; count: number }[]
  /** Retornos ao cliente (Retorno do vendedor = Sim) ÷ repassados (%). */
  returnRate: number | null
  /** Horas, em média, do repasse até o retorno ao cliente. */
  returnHours: number | null
  brands: { name: string; count: number }[]
  partTypes: { name: string; count: number }[]
  origins: { name: string; count: number }[]
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
const top = (list: (string | null | undefined)[], n = 3) => {
  const m = new Map<string, number>()
  for (const x of list) if (x) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, n).map(([name, count]) => ({ name, count }))
}

export function weeklyStats(rows: WeeklyRow[]): WeeklyStats {
  const sold = rows.filter((r) => r.saleStatus === 'SIM')
  const revenue = Math.round(sold.reduce((s, r) => s + (r.saleValue ?? 0), 0) * 100) / 100
  const withValue = sold.filter((r) => r.saleValue)
  const lostReasons = top(rows.filter((r) => r.saleStatus === 'NAO').map((r) => r.lostReason))
  const returned = rows.filter((r) => r.returnStatus === 'SIM')
  const waits = returned.filter((r) => r.forwardedAt && r.returnedAt && r.returnedAt >= r.forwardedAt).map((r) => (r.returnedAt!.getTime() - r.forwardedAt!.getTime()) / 3_600_000)
  return {
    forwarded: rows.length,
    sales: sold.length,
    conversion: pct(sold.length, rows.length),
    revenue,
    ticket: withValue.length ? Math.round((withValue.reduce((s, r) => s + r.saleValue!, 0) / withValue.length) * 100) / 100 : null,
    negotiating: rows.filter((r) => r.saleStatus === 'NEGOCIACAO').length,
    lost: rows.filter((r) => r.saleStatus === 'NAO').length,
    noContact: rows.filter((r) => r.saleStatus === 'NEGOCIACAO' && !r.calledAt && r.returnStatus !== 'SIM').map((r) => r.name),
    topLost: lostReasons[0] ? { reason: lostReasons[0].name, count: lostReasons[0].count } : null,
    lostReasons,
    returnRate: pct(returned.length, rows.length),
    returnHours: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10 : null,
    brands: top(rows.flatMap((r) => r.brands ?? [])),
    partTypes: top(rows.flatMap((r) => r.partTypes ?? [])),
    origins: top(rows.map((r) => r.origin)),
  }
}

/** Sugestões de melhoria a partir dos números (no máximo 3, as mais úteis primeiro). */
export function weeklySuggestions(s: WeeklyStats, team: { conversion: number | null }, prev: WeeklyStats | null): string[] {
  const out: string[] = []
  if (s.noContact.length) {
    const names = s.noContact.slice(0, 5).join(', ')
    out.push(`${s.noContact.length} cliente(s) ainda sem contato registrado no CRM (${names}${s.noContact.length > 5 ? ' e outros' : ''}): chame hoje e marque "Chamei o cliente".`)
  }
  if (s.conversion !== null && team.conversion !== null && s.forwarded >= 3 && s.conversion + 5 < team.conversion) out.push(`Sua conversão (${fmtPct(s.conversion)}) ficou abaixo da média da equipe (${fmtPct(team.conversion)}). Retornar no mesmo dia do repasse e mandar o orçamento por escrito costuma aumentar o fechamento.`)
  if (s.returnHours !== null && s.returnHours > 24) out.push(`O retorno ao cliente levou em média ${fmtHours(s.returnHours)}. Quanto mais rápido o primeiro contato depois do repasse, maior a chance de venda.`)
  if (s.forwarded >= 3 && s.negotiating / s.forwarded >= 0.5) out.push(`${s.negotiating} de ${s.forwarded} ainda em negociação: faça o acompanhamento e atualize no CRM (vendeu ou perdeu, com o motivo).`)
  if (s.topLost && s.topLost.count >= 2) out.push(`Motivo de perda mais comum: ${s.topLost.reason} (${s.topLost.count}). Vale conversar com a gestão sobre como contornar.`)
  if (!out.length && s.conversion !== null && team.conversion !== null && s.forwarded >= 3 && s.conversion >= team.conversion + 5) out.push(`Parabéns: sua conversão (${fmtPct(s.conversion)}) ficou acima da média da equipe (${fmtPct(team.conversion)}). Continue retornando rápido.`)
  if (!out.length && prev && prev.conversion !== null && s.conversion !== null && s.conversion < prev.conversion - 10) out.push(`A conversão caiu em relação ao ciclo anterior (${fmtPct(prev.conversion)} → ${fmtPct(s.conversion)}). Revise os clientes em negociação.`)
  return out.slice(0, 3)
}

const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const fmtHours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h` : `${Math.round(h / 24)} dias`)
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const list = (l: { name: string; count: number }[]) => l.map((x) => `${x.name} (${x.count})`).join(', ')

/** Mensagem do WhatsApp (negrito com *texto*), só com as informações escolhidas. */
export function weeklyMessage(o: { seller: string; label: string; stats: WeeklyStats; prev: WeeklyStats | null; team: { conversion: number | null }; closedInWeek: number; suggestions: string[]; sections?: WeeklySection[] }) {
  const s = o.stats
  const has = (k: WeeklySection) => (o.sections ?? DEFAULT_SECTIONS).includes(k)
  const first = o.seller.trim().split(/\s+/)[0] ?? o.seller
  const vs = (before: number | null | undefined, kind: 'n' | '%' = 'n') => (!has('anterior') || before === null || before === undefined ? '' : ` (ciclo anterior: ${kind === '%' ? fmtPct(before) : before})`)
  const lines = [`*Resumo semanal: ${o.label}*`, `Olá, ${first}! Seu resultado com os clientes da pré-venda repassados para você:`, '']
  if (has('repassados')) lines.push(`📥 Leads repassados: *${s.forwarded}*${vs(o.prev?.forwarded)}`)
  if (has('vendas')) lines.push(`✅ Vendas realizadas: *${s.sales}*${vs(o.prev?.sales)}`)
  if (has('conversao')) lines.push(`📈 Conversão (vendas ÷ leads): *${fmtPct(s.conversion)}*${vs(o.prev?.conversion, '%')}`)
  if (has('valor') && s.revenue) lines.push(`💰 Valor vendido: ${brl(s.revenue)}${s.ticket ? ` · ticket médio ${brl(s.ticket)}` : ''}`)
  if (has('negociacao')) lines.push(`🤝 Em negociação: ${s.negotiating} · Perdidas: ${s.lost}`)
  if (has('motivos') && s.lostReasons.length) lines.push(`❌ Motivos de perda: ${list(s.lostReasons)}`)
  if (has('retorno')) lines.push(`📞 Retorno ao cliente: ${fmtPct(s.returnRate)}${s.returnHours !== null ? ` · em média ${fmtHours(s.returnHours)} depois do repasse` : ''}`)
  if (has('equipe') && o.team.conversion !== null) lines.push(`👥 Média da equipe: ${fmtPct(o.team.conversion)}`)
  if (has('fechadas') && o.closedInWeek > s.sales) lines.push(`🔁 Na semana você também fechou ${o.closedInWeek - s.sales} venda(s) de repasses anteriores.`)
  if (has('marcas') && s.brands.length) lines.push(`🚜 Marcas mais pedidas: ${list(s.brands)}`)
  if (has('pecas') && s.partTypes.length) lines.push(`🔧 Peças mais pedidas: ${list(s.partTypes)}`)
  if (has('origens') && s.origins.length) lines.push(`📣 Origem dos leads: ${list(s.origins)}`)
  if (has('sem_contato') && s.noContact.length) lines.push('', `*Ainda sem contato registrado (${s.noContact.length})*`, ...s.noContact.slice(0, 15).map((n) => `• ${n}`), ...(s.noContact.length > 15 ? [`• e mais ${s.noContact.length - 15}`] : []))
  if (has('sugestoes') && o.suggestions.length) lines.push('', '*Sugestões*', ...o.suggestions.map((x) => `• ${x}`))
  return lines.join('\n')
}

/** Linha de um vendedor no resumo do gestor. */
export interface ManagerLine {
  seller: string
  stats: WeeklyStats
}

/**
 * Resumo da equipe para o gestor: os totais do ciclo e uma linha por vendedor (leads, vendas, conversão e, se
 * escolhidos, valor vendido e quem ainda está sem contato), com os destaques da semana.
 */
export function managerMessage(label: string, lines: ManagerLine[], sections: WeeklySection[] = DEFAULT_SECTIONS) {
  const has = (k: WeeklySection) => sections.includes(k)
  const sum = (f: (s: WeeklyStats) => number) => lines.reduce((a, l) => a + f(l.stats), 0)
  const forwarded = sum((s) => s.forwarded)
  const sales = sum((s) => s.sales)
  const revenue = Math.round(sum((s) => s.revenue) * 100) / 100
  const noContact = sum((s) => s.noContact.length)
  const out = [`*Resumo semanal da equipe: ${label}*`, '', `📥 Leads repassados: *${forwarded}*`, `✅ Vendas realizadas: *${sales}*`, `📈 Conversão (vendas ÷ leads): *${fmtPct(pct(sales, forwarded))}*`]
  if (has('valor') && revenue) out.push(`💰 Valor vendido: ${brl(revenue)}`)
  if ((has('sem_contato') || has('sugestoes')) && noContact) out.push(`⚠️ Clientes ainda sem contato registrado: ${noContact}`)
  out.push('', '*Por vendedor*')
  for (const l of [...lines].sort((a, b) => b.stats.forwarded - a.stats.forwarded || a.seller.localeCompare(b.seller, 'pt-BR'))) {
    const s = l.stats
    const extra = [has('valor') && s.revenue ? brl(s.revenue) : null, (has('sem_contato') || has('sugestoes')) && s.noContact.length ? `${s.noContact.length} sem contato` : null].filter(Boolean)
    out.push(`• ${l.seller}: ${s.forwarded} lead(s) · ${s.sales} venda(s) · ${fmtPct(s.conversion)}${extra.length ? ` · ${extra.join(' · ')}` : ''}`)
  }
  const ranked = lines.filter((l) => l.stats.forwarded >= 3 && l.stats.conversion !== null).sort((a, b) => b.stats.conversion! - a.stats.conversion!)
  if (ranked.length >= 2) {
    out.push('', `🏆 Maior conversão: ${ranked[0]!.seller} (${fmtPct(ranked[0]!.stats.conversion)})`)
    const late = [...lines].sort((a, b) => b.stats.noContact.length - a.stats.noContact.length)[0]!
    if (late.stats.noContact.length >= 2) out.push(`📞 Mais clientes sem contato: ${late.seller} (${late.stats.noContact.length})`)
  }
  return out.join('\n')
}

/** Leitura do ciclo: repasses por vendedor (ciclo e anterior), média da equipe e vendas fechadas na semana. */
export async function loadWeekly(prisma: PrismaService, tenantId: string, cycle: ReturnType<typeof weeklyCycle>, sections: WeeklySection[] = DEFAULT_SECTIONS) {
  const select = { sellerId: true, name: true, saleStatus: true, saleValue: true, returnStatus: true, calledAt: true, forwardedAt: true, returnedAt: true, brandIds: true, partTypeIds: true, origin: { select: { name: true } }, lostReason: { select: { name: true } }, seller: { select: { id: true, name: true, phone: true, active: true } } } as const
  const base = { tenantId, kind: 'PRE_VENDAS' as const, deletedAt: null, forwarded: true, sellerId: { not: null } }
  const [now, before, closed] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { ...base, forwardedAt: { gte: cycle.from, lt: cycle.to } }, orderBy: { forwardedAt: 'asc' }, select }),
    prisma.serviceRecord.findMany({ where: { ...base, forwardedAt: { gte: cycle.prevFrom, lt: cycle.from } }, select }),
    prisma.$queryRaw<{ sellerId: string; n: number }[]>`
      SELECT r."sellerId", COUNT(DISTINCT r.id)::int AS n
        FROM service_record_history h JOIN service_records r ON r.id = h."recordId"
       WHERE r."tenantId" = ${tenantId}::uuid AND r.kind = 'PRE_VENDAS' AND r."deletedAt" IS NULL AND r."saleStatus" = 'SIM' AND r."sellerId" IS NOT NULL
         AND h."createdAt" >= ${cycle.from} AND h."createdAt" < ${cycle.to} AND h.changes -> 'saleStatus' ->> 'para' = 'SIM'
       GROUP BY r."sellerId"`.catch((): { sellerId: string; n: number }[] => []),
  ])
  // Nomes das marcas e tipos de peça (listas configuráveis) só quando essas partes vão na mensagem.
  const ids = sections.includes('marcas') || sections.includes('pecas') ? [...new Set(now.flatMap((r) => [...r.brandIds, ...r.partTypeIds]))] : []
  const names = new Map(ids.length ? (await prisma.lookupItem.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]) : [])
  const row = (r: (typeof now)[number]): WeeklyRow => ({
    sellerId: r.sellerId!,
    name: r.name,
    saleStatus: r.saleStatus,
    saleValue: r.saleValue === null ? null : Number(r.saleValue),
    returnStatus: r.returnStatus,
    calledAt: r.calledAt,
    lostReason: r.lostReason?.name ?? null,
    forwardedAt: r.forwardedAt,
    returnedAt: r.returnedAt,
    brands: r.brandIds.map((id) => names.get(id)).filter((x): x is string => !!x),
    partTypes: r.partTypeIds.map((id) => names.get(id)).filter((x): x is string => !!x),
    origin: r.origin?.name ?? null,
  })
  const group = (rows: typeof now) => {
    const m = new Map<string, WeeklyRow[]>()
    for (const r of rows) m.set(r.sellerId!, [...(m.get(r.sellerId!) ?? []), row(r)])
    return m
  }
  const nowBy = group(now)
  const prevBy = group(before)
  const team = weeklyStats(now.map(row))
  const closedBy = new Map(closed.map((c) => [c.sellerId, Number(c.n)]))
  const sellers = new Map(now.map((r) => [r.sellerId!, r.seller!]))
  return [...nowBy.entries()]
    .map(([sellerId, rows]) => {
      const stats = weeklyStats(rows)
      const prevRows = prevBy.get(sellerId)
      const prev = prevRows ? weeklyStats(prevRows) : null
      const seller = sellers.get(sellerId)!
      const suggestions = weeklySuggestions(stats, { conversion: team.conversion }, prev)
      return { seller, stats, prev, message: weeklyMessage({ seller: seller.name, label: cycle.label, stats, prev, team: { conversion: team.conversion }, closedInWeek: closedBy.get(sellerId) ?? 0, suggestions, sections }) }
    })
    .sort((a, b) => a.seller.name.localeCompare(b.seller.name, 'pt-BR'))
}
