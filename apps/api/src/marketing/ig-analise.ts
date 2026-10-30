/**
 * Análise dos posts do Instagram (ideia do /ig-audit do instagram-agent-skill, MIT): cada post é medido contra o normal
 * do próprio perfil (quantas vezes o alcance passou da mediana dos últimos 90 dias), e não pelas visualizações soltas.
 * Envios e salvamentos contam por mil pessoas alcançadas. Funções puras, testadas.
 */

export interface AuditPost {
  postId: string
  profileId: string | null
  publishedAt: Date
  format: string
  caption: string
  permalink: string | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
}

export const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
/** Acima disso o post "estourou" para o perfil; abaixo do outro limite, ficou fraco. */
export const OUTLIER = 1.5
export const WEAK = 0.67

const r2 = (n: number) => Math.round(n * 100) / 100

export interface AuditRow {
  postId: string
  publishedAt: Date
  format: string
  caption: string
  permalink: string | null
  reach: number | null
  /** Alcance normal do perfil (mediana). */
  baseline: number | null
  /** Quantas vezes o alcance passou do normal. */
  multiple: number | null
  verdict: 'acima' | 'normal' | 'abaixo' | null
  sharesPer1k: number | null
  savesPer1k: number | null
  commentsPer1k: number | null
}

export interface AuditGroup {
  label: string
  posts: number
  medianMultiple: number
  above: number
  below: number
  sharesPer1k: number | null
  savesPer1k: number | null
}

export interface Audit {
  posts: AuditRow[]
  byFormat: AuditGroup[]
  byWeekday: AuditGroup[]
  measured: number
  findings: string[]
}

export function median(list: number[]) {
  const s = list.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Dia da semana em São Paulo. */
const weekdayOf = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).getUTCDay()

/**
 * Ranqueia os posts do período (sem stories) pelo múltiplo sobre o alcance mediano do próprio perfil.
 * history: posts dos últimos 90 dias (de todos os perfis analisados), para o "normal" de cada perfil; sem histórico
 * suficiente (menos de 3 posts com alcance), usa o próprio período.
 */
export function auditPosts(period: AuditPost[], history: Pick<AuditPost, 'profileId' | 'reach' | 'format'>[], official = ''): Audit {
  const key = (p: { profileId: string | null }) => p.profileId ?? official
  const feed = period.filter((p) => p.format !== 'Story')
  const reachesBy = (list: Pick<AuditPost, 'profileId' | 'reach' | 'format'>[]) => {
    const map = new Map<string, number[]>()
    for (const p of list) if (p.format !== 'Story' && p.reach) map.set(key(p), [...(map.get(key(p)) ?? []), p.reach])
    return map
  }
  const hist = reachesBy(history)
  const own = reachesBy(feed)
  const baseline = new Map<string, number>()
  for (const k of new Set([...hist.keys(), ...own.keys()])) {
    const list = (hist.get(k)?.length ?? 0) >= 3 ? hist.get(k)! : (own.get(k) ?? [])
    const m = median(list)
    if (m) baseline.set(k, m)
  }
  const per1k = (v: number | null, reach: number | null) => (reach ? r2(((v ?? 0) / reach) * 1000) : null)
  const posts: AuditRow[] = feed
    .map((p): AuditRow => {
      const base = baseline.get(key(p)) ?? null
      const multiple = p.reach && base ? r2(p.reach / base) : null
      return {
        postId: p.postId,
        publishedAt: p.publishedAt,
        format: p.format,
        caption: p.caption.slice(0, 160),
        permalink: p.permalink,
        reach: p.reach,
        baseline: base === null ? null : Math.round(base),
        multiple,
        verdict: multiple === null ? null : multiple >= OUTLIER ? 'acima' : multiple <= WEAK ? 'abaixo' : 'normal',
        sharesPer1k: per1k(p.shares, p.reach),
        savesPer1k: per1k(p.saves, p.reach),
        commentsPer1k: per1k(p.comments, p.reach),
      }
    })
    .sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1) || (b.reach ?? 0) - (a.reach ?? 0))

  const group = (by: (p: AuditRow) => string): AuditGroup[] => {
    const map = new Map<string, AuditRow[]>()
    for (const p of posts) if (p.multiple !== null) map.set(by(p), [...(map.get(by(p)) ?? []), p])
    return [...map.entries()]
      .map(([label, list]) => ({
        label,
        posts: list.length,
        medianMultiple: r2(median(list.map((p) => p.multiple!))!),
        above: list.filter((p) => p.verdict === 'acima').length,
        below: list.filter((p) => p.verdict === 'abaixo').length,
        sharesPer1k: median(list.map((p) => p.sharesPer1k ?? 0)),
        savesPer1k: median(list.map((p) => p.savesPer1k ?? 0)),
      }))
      .sort((a, b) => b.medianMultiple - a.medianMultiple || b.posts - a.posts)
  }
  const byFormat = group((p) => p.format)
  const byWeekday = group((p) => WEEKDAY_NAMES[weekdayOf(p.publishedAt)]!)
  const measured = posts.filter((p) => p.multiple !== null)
  return { posts, byFormat, byWeekday, measured: measured.length, findings: findings(measured, byFormat, byWeekday) }
}

const x = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`
const short = (c: string) => {
  const line = c.split('\n').find((l) => l.trim())?.trim() ?? ''
  return line.length > 70 ? `${line.slice(0, 67)}...` : line || '(sem legenda)'
}

/** O que a análise mostra, em frases curtas (para a tela e para o plano da semana da IA). */
function findings(measured: AuditRow[], byFormat: AuditGroup[], byWeekday: AuditGroup[]) {
  const out: string[] = []
  if (measured.length < 3) return ['Poucos posts com alcance no período para comparar. Amplie o período (ex.: últimos 90 dias).']
  const above = measured.filter((p) => p.verdict === 'acima')
  out.push(`${above.length} de ${measured.length} posts passaram de ${x(OUTLIER)} o alcance normal do perfil; ${measured.filter((p) => p.verdict === 'abaixo').length} ficaram abaixo de ${x(WEAK)}.`)
  const formats = byFormat.filter((f) => f.posts >= 2)
  if (formats.length >= 2) {
    const best = formats[0]!
    const worst = formats.at(-1)!
    out.push(`Melhor formato: ${best.label} (mediana de ${x(best.medianMultiple)} o normal, ${best.posts} posts). O mais fraco: ${worst.label} (${x(worst.medianMultiple)}, ${worst.posts} posts).`)
  }
  const days = byWeekday.filter((d) => d.posts >= 2)
  if (days.length >= 2) out.push(`Dia que mais rendeu: ${days[0]!.label} (${x(days[0]!.medianMultiple)}). O que menos rendeu: ${days.at(-1)!.label} (${x(days.at(-1)!.medianMultiple)}).`)
  const top = measured[0]!
  out.push(`Melhor post: ${top.format}, ${x(top.multiple!)} o normal: "${short(top.caption)}".`)
  const shared = [...measured].filter((p) => (p.sharesPer1k ?? 0) > 0).sort((a, b) => (b.sharesPer1k ?? 0) - (a.sharesPer1k ?? 0))[0]
  if (shared && shared.postId !== top.postId) out.push(`Mais enviado para outras pessoas: ${shared.format}, ${shared.sharesPer1k!.toLocaleString('pt-BR')} envios por mil alcançados: "${short(shared.caption)}".`)
  const saved = [...measured].filter((p) => (p.savesPer1k ?? 0) > 0).sort((a, b) => (b.savesPer1k ?? 0) - (a.savesPer1k ?? 0))[0]
  if (saved && saved.postId !== top.postId && saved.postId !== shared?.postId) out.push(`Mais salvo: ${saved.format}, ${saved.savesPer1k!.toLocaleString('pt-BR')} salvamentos por mil alcançados: "${short(saved.caption)}".`)
  return out
}

/** Resumo do que deu resultado para o plano da semana da IA (só números e trechos de legenda, sem pessoas). */
export function planInsights(a: Audit, bestTimes: string[]) {
  if (a.measured < 3) return ''
  const top = a.posts.filter((p) => p.verdict === 'acima').slice(0, 5)
  return [
    ...a.findings,
    bestTimes.length ? `Horários com mais alcance: ${bestTimes.join('; ')}.` : '',
    top.length ? `Posts que mais passaram do normal (repita o assunto ou o jeito, sem copiar o texto):\n${top.map((p) => `- ${p.format}, ${x(p.multiple!)}: ${short(p.caption)}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
