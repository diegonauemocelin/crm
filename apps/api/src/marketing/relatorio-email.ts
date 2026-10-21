/**
 * E-mail do relatório do Marketing Inteligente: HTML com tabelas e estilos inline (compatível com Gmail e Outlook)
 * e a versão em texto. Só entra o que foi escolhido no agendamento. Funções puras (testadas em test/marketing.spec.ts).
 */
import type { BrandingSettings } from '../settings/settings.service'
import type { ReportSchedule } from './config'
import type { MarketingService } from './marketing.service'

type Analysis = Awaited<ReturnType<MarketingService['analyze']>>
type Email = Awaited<ReturnType<MarketingService['email']>>
type Health = Awaited<ReturnType<MarketingService['health']>>

export interface ReportInput {
  schedule: Pick<ReportSchedule, 'name' | 'sections'>
  periodLabel: string
  data: Analysis
  email: Email | null
  health: Health | null
  branding: Pick<BrandingSettings, 'appName' | 'primaryColor'>
  link: string
  /** Resumo escrito pela IA (só com a parte "resumo_ia" marcada e a chave do Gemini cadastrada). */
  ai?: string | null
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const brl = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const int = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }))
const pc = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const x2 = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`)
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const arrow = (d: number | null, goodUp = true) => {
  if (d === null) return '<span style="color:#9ca3af">—</span>'
  const good = d === 0 ? null : (d > 0) === goodUp
  const color = good === null ? '#6b7280' : good ? '#15803d' : '#b91c1c'
  return `<span style="color:${color}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`
}

type K = keyof Analysis['now']
const KPIS: { key: K; label: string; fmt: (n: number | null) => string; goodUp?: boolean }[] = [
  { key: 'mediaCost', label: 'Investimento em mídia', fmt: brl, goodUp: false },
  { key: 'totalCost', label: 'Custo total de marketing', fmt: brl, goodUp: false },
  { key: 'leads', label: 'Leads gerados', fmt: int },
  { key: 'qualified', label: 'Leads qualificados', fmt: int },
  { key: 'opportunities', label: 'Oportunidades', fmt: int },
  { key: 'sales', label: 'Vendas', fmt: int },
  { key: 'revenue', label: 'Faturamento (Pré-Vendas)', fmt: brl },
  { key: 'mktRevenue', label: 'Faturamento atribuído ao marketing', fmt: brl },
  { key: 'cpl', label: 'Custo por lead', fmt: brl, goodUp: false },
  { key: 'cpql', label: 'Custo por lead qualificado', fmt: brl, goodUp: false },
  { key: 'cac', label: 'CAC', fmt: brl, goodUp: false },
  { key: 'conversionRate', label: 'Conversão lead → venda', fmt: pc },
  { key: 'roas', label: 'ROAS de mídia', fmt: x2 },
  { key: 'roi', label: 'ROI estimado', fmt: pc },
  { key: 'ticket', label: 'Ticket médio', fmt: brl },
  { key: 'attendedRate', label: 'Leads atendidos', fmt: pc },
  { key: 'notAttendedRate', label: 'Leads sem atendimento', fmt: pc, goodUp: false },
  { key: 'lostRate', label: 'Oportunidades perdidas', fmt: pc, goodUp: false },
]

const th = (s: string, right = false) => `<th style="text-align:${right ? 'right' : 'left'};padding:6px 8px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;font-weight:600">${esc(s)}</th>`
const td = (s: string, right = false) => `<td style="text-align:${right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px">${s}</td>`
const h2 = (s: string, color: string) => `<tr><td style="padding:24px 0 8px;font-size:16px;font-weight:700;color:${color}">${esc(s)}</td></tr>`
const table = (head: string, body: string) => `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head}${body}</table></td></tr>`

type Row = Analysis['byCampaign'][number]
function breakdownTable(rows: Row[], label: string, withCost: boolean, limit = 15) {
  const top = rows.slice(0, limit)
  if (!top.length) return '<tr><td style="font-size:13px;color:#6b7280">Sem dados no período.</td></tr>'
  const head = `<tr>${th(label)}${withCost ? th('Investido', true) : ''}${th('Leads', true)}${th('Qualif.', true)}${th('Vendas', true)}${th('Faturamento', true)}${th('Conv.', true)}${withCost ? th('CPL', true) + th('ROAS', true) : ''}</tr>`
  const body = top
    .map((r) => `<tr>${td(esc(r.name))}${withCost ? td(brl(r.mediaCost), true) : ''}${td(int(r.leads), true)}${td(int(r.qualified), true)}${td(int(r.sales), true)}${td(brl(r.revenue), true)}${td(pc(r.conversionRate), true)}${withCost ? td(brl(r.cpl), true) + td(x2(r.roas), true) : ''}</tr>`)
    .join('')
  return table(head, body) + (rows.length > limit ? `<tr><td style="font-size:12px;color:#6b7280;padding-top:4px">E mais ${rows.length - limit} linha(s) no sistema.</td></tr>` : '')
}

export function reportHtml(x: ReportInput) {
  const color = /^#[0-9a-f]{6}$/i.test(x.branding.primaryColor) ? x.branding.primaryColor : '#1d4ed8'
  const d = x.data
  const has = (k: string) => (x.schedule.sections as string[]).includes(k)
  const parts: string[] = []
  const notes: string[] = []
  if (d.crmOnlyFilters.length) notes.push('Com filtro de marca, estado, vendedor ou outro dado só do CRM, o investimento não tem esse recorte e as contas de custo ficam de fora.')
  if (!d.updatedAt.googleAdsCost) notes.push('Investimento do Google Ads ainda não recebido.')

  if (has('resumo_ia')) {
    parts.push(h2('Resumo do período', color))
    parts.push(
      x.ai
        ? `<tr><td style="font-size:13px;line-height:20px">${x.ai.split('\n').filter(Boolean).map((l) => esc(l)).join('<br>')}<br><span style="font-size:11px;color:#6b7280">Texto da IA (Gemini) a partir dos números agregados do período. Confira os números abaixo.</span></td></tr>`
        : '<tr><td style="font-size:13px;color:#6b7280">Resumo pela IA indisponível (cadastre a chave do Gemini em Configurações › E-mail marketing).</td></tr>',
    )
  }
  if (has('kpis')) {
    parts.push(h2('Indicadores principais', color))
    const rows = KPIS.map((k) => `<tr>${td(esc(k.label))}${td(`<b>${k.fmt(d.now[k.key] as number | null)}</b>`, true)}${td(k.fmt(d.before[k.key] as number | null), true)}${td(arrow(d.deltas[k.key] ?? null, k.goodUp ?? true), true)}</tr>`).join('')
    parts.push(table(`<tr>${th('Indicador')}${th('Período', true)}${th('Anterior', true)}${th('Variação', true)}</tr>`, rows))
    parts.push(`<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">ROI estimado com margem de ${pc(d.rules.marginPct)}${d.rules.fixedMonthly ? ` e custos fixos de ${brl(d.rules.fixedMonthly)}/mês` : ''}. ROAS = faturamento atribuído ÷ investimento em mídia.</td></tr>`)
  }
  if (has('plataformas')) parts.push(h2('Por plataforma', color), breakdownTable(d.byPlatform, 'Plataforma', true))
  if (has('campanhas')) parts.push(h2('Campanhas', color), breakdownTable(d.byCampaign, 'Campanha', true))
  if (has('funil')) {
    parts.push(h2('Funil de marketing e vendas', color))
    const rows = d.funnel.steps.map((s) => `<tr>${td(esc(s.label))}${td(int(s.value), true)}${td(s.rate === null ? '—' : pc(s.rate), true)}</tr>`).join('')
    parts.push(table(`<tr>${th('Etapa')}${th('Volume', true)}${th('Passagem', true)}</tr>`, rows + `<tr>${td('<b>Faturamento</b>')}${td(`<b>${brl(d.funnel.revenue)}</b>`, true)}${td('')}</tr>`))
    const t = d.funnel.times
    parts.push(`<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">Tempo até repassar ao vendedor: mediana ${t.toForwardMedianHours === null ? '—' : `${int(t.toForwardMedianHours)} h`}. Até o retorno do vendedor: mediana ${t.toReturnMedianHours === null ? '—' : `${int(t.toReturnMedianHours)} h`}.</td></tr>`)
  }
  if (has('vendedores')) parts.push(h2('Por vendedor', color), breakdownTable(d.bySeller, 'Vendedor', false))
  if (has('regioes')) parts.push(h2('Por região', color), breakdownTable(d.byRegion, 'Região', false), h2('Por estado', color), breakdownTable(d.byState, 'Estado', false, 10))
  if (has('marcas')) parts.push(h2('Por marca da máquina', color), breakdownTable(d.byBrand, 'Marca', false))
  if (has('categorias')) parts.push(h2('Por tipo de peça', color), breakdownTable(d.byPartType, 'Tipo de peça', false))
  if (has('origens')) parts.push(h2('Por origem do lead', color), breakdownTable(d.byOrigin, 'Origem', false))
  if (has('email') && x.email) {
    const e = x.email.totals
    parts.push(h2('E-mail marketing', color))
    parts.push(table(`<tr>${th('Enviados', true)}${th('Abertura registrada', true)}${th('Cliques', true)}${th('Descadastros', true)}${th('Vendas de quem clicou', true)}</tr>`, `<tr>${td(int(e.sent), true)}${td(pc(e.openRate), true)}${td(pc(e.clickRate), true)}${td(pc(e.unsubRate), true)}${td(`${int(e.orders)} · ${brl(e.revenue)}`, true)}</tr>`))
    parts.push('<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">A abertura registrada pode ser maior que a real (proteção de privacidade do Apple Mail e outros abre as imagens sozinhos). Cliques são mais confiáveis.</td></tr>')
  }
  if (has('recomendacoes')) {
    parts.push(h2('Recomendações', color))
    if (!d.recommendations.length) parts.push('<tr><td style="font-size:13px;color:#6b7280">Nenhum ponto de atenção com amostra suficiente no período.</td></tr>')
    for (const r of d.recommendations.slice(0, 8)) {
      parts.push(`<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;line-height:19px"><b>${esc(r.problem)}</b> <span style="color:#6b7280">(prioridade ${r.priority}, confiança ${r.confidence})</span><br>${r.evidence.map(esc).join(' · ')}<br><b>Ação sugerida:</b> ${esc(r.action)}<br><span style="color:#6b7280">Fonte: ${esc(r.source)}. Como medir: ${esc(r.validate)}</span></td></tr>`)
    }
  }
  if (has('saude') && x.health) {
    parts.push(h2('Saúde dos dados', color))
    const label = { ok: '✅ ok', atencao: '⚠️ atenção', erro: '❌ erro', desligado: '⏸ desligado' } as const
    const rows = x.health.sources.map((s) => `<tr>${td(esc(s.name))}${td(label[s.status])}${td(s.lastAt ? new Date(s.lastAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')}</tr>`).join('')
    parts.push(table(`<tr>${th('Fonte')}${th('Situação')}${th('Última atualização')}</tr>`, rows))
    const q = d.quality
    parts.push(`<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">Leads do Google Ads com campanha identificada: ${q.googleLeads ? pc((q.googleWithCampaign / q.googleLeads) * 100) : '—'}. Com origem: ${q.records ? pc((q.withOrigin / q.records) * 100) : '—'}.</td></tr>`)
  }

  const period = d.period.from === d.period.to ? day(d.period.from) : `${day(d.period.from)} a ${day(d.period.to)}`
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:8px;padding:28px">
<tr><td style="font-size:12px;color:${color};font-weight:700;letter-spacing:.08em;text-transform:uppercase">Marketing Inteligente</td></tr>
<tr><td style="font-size:21px;font-weight:700;padding:4px 0">${esc(x.schedule.name)}</td></tr>
<tr><td style="font-size:13px;color:#6b7280">${esc(x.periodLabel)}: ${period} · comparado com ${day(d.period.prevFrom)} a ${day(d.period.prevTo)} · atribuição: ${d.rules.attribution.model === 'primeiro' ? 'primeiro toque' : 'último toque'}, janela de ${d.rules.attribution.windowDays} dias</td></tr>
${notes.map((n) => `<tr><td style="font-size:12px;color:#92400e;background:#fffbeb;padding:8px;margin-top:8px">${esc(n)}</td></tr>`).join('')}
${parts.join('\n')}
<tr><td style="padding:24px 0 8px"><a href="${esc(x.link)}" style="background:${color};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block;font-weight:600">Abrir no sistema</a></td></tr>
<tr><td style="font-size:11px;color:#9ca3af;line-height:16px">Fontes: Pré-Vendas do CRM (leads, atendimento e valor da venda) e investimento das plataformas conectadas. Investimento do Google Ads atualizado em ${d.updatedAt.googleAdsCost ? new Date(d.updatedAt.googleAdsCost).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}. Conversões das plataformas não são somadas às vendas do CRM. Relatório gerado em ${new Date(d.updatedAt.crm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</td></tr>
</table>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">${esc(x.branding.appName)}</p>
</td></tr></table></body></html>`
}

export function reportText(x: ReportInput) {
  const d = x.data
  const lines = [`${x.schedule.name}`, `${x.periodLabel}: ${day(d.period.from)} a ${day(d.period.to)}`, '']
  if (x.ai && (x.schedule.sections as string[]).includes('resumo_ia')) lines.push(x.ai, '')
  if ((x.schedule.sections as string[]).includes('kpis')) for (const k of KPIS) lines.push(`${k.label}: ${k.fmt(d.now[k.key] as number | null)} (anterior: ${k.fmt(d.before[k.key] as number | null)})`)
  if ((x.schedule.sections as string[]).includes('recomendacoes')) for (const r of d.recommendations.slice(0, 8)) lines.push('', `• ${r.problem}`, `  ${r.evidence.join(' · ')}`, `  Ação: ${r.action}`)
  lines.push('', `Ver tudo no sistema: ${x.link}`)
  return lines.join('\n')
}

const WA_KPIS: K[] = ['mediaCost', 'leads', 'sales', 'revenue', 'cpl', 'roas']

/** Mensagem do WhatsApp: curta (vai como legenda do PDF), com os principais números e o resumo da IA. */
export function reportWhatsapp(x: ReportInput) {
  const d = x.data
  const lines = [`*${x.schedule.name}*`, `${x.periodLabel}: ${day(d.period.from)}${d.period.from === d.period.to ? '' : ` a ${day(d.period.to)}`}`, '']
  for (const key of WA_KPIS) {
    const k = KPIS.find((y) => y.key === key)!
    lines.push(`${k.label}: *${k.fmt(d.now[k.key] as number | null)}* (antes: ${k.fmt(d.before[k.key] as number | null)})`)
  }
  if (x.ai && (x.schedule.sections as string[]).includes('resumo_ia')) lines.push('', x.ai.length > 600 ? `${x.ai.slice(0, 597).trimEnd()}...` : x.ai)
  lines.push('', `Ver tudo no sistema: ${x.link}`)
  // A legenda de documento no WhatsApp aceita até 1.024 caracteres.
  return lines.join('\n').slice(0, 1024)
}
