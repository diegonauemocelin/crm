/**
 * E-mail do relatório do Marketing Inteligente: HTML com tabelas e estilos inline (compatível com Gmail e Outlook)
 * e a versão em texto. Só entra o que foi escolhido no agendamento. Funções puras (testadas em test/marketing.spec.ts).
 */
import type { BrandingSettings } from '../settings/settings.service'
import type { ReportSchedule } from './config'
import type { MlAds } from './arquivos'
import type { MarketingService } from './marketing.service'

type Analysis = Awaited<ReturnType<MarketingService['analyze']>>
type Email = Awaited<ReturnType<MarketingService['email']>>
type Health = Awaited<ReturnType<MarketingService['health']>>
type Store = Awaited<ReturnType<MarketingService['store']>>

export interface ReportInput {
  schedule: Pick<ReportSchedule, 'name' | 'sections'>
  periodLabel: string
  data: Analysis
  email: Email | null
  health: Health | null
  branding: Pick<BrandingSettings, 'appName' | 'primaryColor'> & Partial<Pick<BrandingSettings, 'shortName' | 'companyInfo'>> & { logoUrl?: string | null }
  link: string
  /** Loja virtual (Magazord), com a parte "loja" marcada. */
  store?: Store | null
  /** Mercado Livre Ads (Marketplaces), com a parte "mercado_livre" marcada. */
  ml?: MlAds | null
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

// Cor da marca da tela atual (cabeçalho das tabelas); trocada no início de cada relatório.
let BRAND = '#1d4ed8'
const th = (s: string, right = false) => `<th style="text-align:${right ? 'right' : 'left'};padding:7px 8px;background:${BRAND};font-size:12px;color:#ffffff;font-weight:600">${esc(s)}</th>`
const td = (s: string, right = false) => `<td style="text-align:${right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #eef0f3;font-size:13px">${s}</td>`
const h2 = (s: string, color: string) => `<tr><td style="padding:26px 0 10px"><div style="border-left:4px solid ${color};padding-left:10px;font-size:16px;font-weight:700;color:#111827">${esc(s)}</div></td></tr>`
/** Cor da marca clareada (fundo dos cartões e do resumo). */
const lighten = (hex: string, w: number) =>
  `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * w).toString(16).padStart(2, '0')).join('')}`
const CARDS: { key: K; label: string; fmt: (n: number | null) => string; goodUp: boolean }[] = [
  { key: 'mediaCost', label: 'Investimento em mídia', fmt: brl, goodUp: false },
  { key: 'leads', label: 'Leads gerados', fmt: int, goodUp: true },
  { key: 'sales', label: 'Vendas', fmt: int, goodUp: true },
  { key: 'revenue', label: 'Faturamento', fmt: brl, goodUp: true },
  { key: 'cpl', label: 'Custo por lead', fmt: brl, goodUp: false },
  { key: 'roas', label: 'ROAS de mídia', fmt: x2, goodUp: true },
]
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
  BRAND = color
  const soft = lighten(color, 0.92)
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
        ? `<tr><td style="font-size:13px;line-height:20px;background:${soft};border-left:4px solid ${color};padding:12px 16px;border-radius:4px">${x.ai
            .split('\n')
            .filter(Boolean)
            .map((l) => (/^(próximos passos|pontos de atenção|destaques)\b/i.test(l.replace(/^[-•*]\s*/, '')) ? `<b>${esc(l)}</b>` : esc(l.replace(/^[-•*]\s*/, '• '))))
            .join('<br>')}<br><span style="font-size:11px;color:#6b7280">Texto da IA (Gemini) a partir dos números agregados do período. Confira os números abaixo.</span></td></tr>`
        : '<tr><td style="font-size:13px;color:#6b7280">Resumo pela IA indisponível (cadastre a chave do Gemini em Configurações › E-mail marketing).</td></tr>',
    )
  }
  if (has('kpis')) {
    parts.push(h2('Indicadores principais', color))
    // Cartões com os seis números principais (3 por linha) antes da tabela completa.
    const card = (k: (typeof CARDS)[number]) =>
      `<td width="33%" valign="top" style="padding:4px"><div style="background:${soft};border-left:4px solid ${color};border-radius:4px;padding:10px 12px"><div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${esc(k.label)}</div><div style="font-size:19px;font-weight:700;color:#111827;padding:2px 0">${k.fmt(d.now[k.key] as number | null)}</div><div style="font-size:11px">${arrow(d.deltas[k.key] ?? null, k.goodUp)} <span style="color:#9ca3af">vs. anterior</span></div></div></td>`
    parts.push(`<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${CARDS.slice(0, 3).map(card).join('')}</tr><tr>${CARDS.slice(3).map(card).join('')}</tr></table></td></tr>`)
    parts.push('<tr><td style="height:10px"></td></tr>')
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
  if (has('loja') && x.store) {
    const st = x.store
    parts.push(h2('Loja virtual (Magazord)', color))
    parts.push(
      table(
        `<tr>${th('Indicador')}${th('Período', true)}${th('Anterior', true)}${th('Variação', true)}</tr>`,
        [
          ['Vendas (pedidos pagos)', int(st.now.orders), int(st.before.orders), arrow(st.deltas.orders)],
          ['Faturamento', `<b>${brl(st.now.revenue)}</b>`, brl(st.before.revenue), arrow(st.deltas.revenue)],
          ['Ticket médio', brl(st.now.ticket), brl(st.before.ticket), arrow(st.deltas.ticket)],
          ['Pedidos pendentes', int(st.now.pending), int(st.before.pending), ''],
          ['Pedidos cancelados', int(st.now.canceled), int(st.before.canceled), ''],
        ]
          .map((r) => `<tr>${td(esc(r[0]))}${td(r[1]!, true)}${td(r[2]!, true)}${td(r[3]!, true)}</tr>`)
          .join(''),
      ),
    )
    parts.push(h2('Valor por canal de venda', color))
    parts.push(
      st.channels.length
        ? table(`<tr>${th('Canal')}${th('Vendas', true)}${th('Faturamento', true)}${th('Participação', true)}</tr>`, st.channels.map((c) => `<tr>${td(esc(c.name))}${td(int(c.orders), true)}${td(brl(c.revenue), true)}${td(pc(c.share), true)}</tr>`).join(''))
        : '<tr><td style="font-size:13px;color:#6b7280">Sem vendas pagas no período.</td></tr>',
    )
    parts.push(h2('Produtos mais vendidos', color))
    parts.push(
      st.products.length
        ? table(`<tr>${th('Produto')}${th('Qtd.', true)}${th('Pedidos', true)}${th('Faturamento', true)}</tr>`, st.products.map((p) => `<tr>${td(`${esc(p.name)}${p.sku ? `<br><span style="font-size:11px;color:#9ca3af">${esc(p.sku)}</span>` : ''}`)}${td(int(p.quantity), true)}${td(int(p.orders), true)}${td(brl(p.revenue), true)}</tr>`).join(''))
        : '<tr><td style="font-size:13px;color:#6b7280">Sem itens de pedidos pagos no período.</td></tr>',
    )
    if (st.pendingItems) parts.push(`<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">${int(st.pendingItems)} pedido(s) do período ainda sem os itens lidos da Magazord: os mais vendidos ficam completos quando a leitura terminar.</td></tr>`)
  }
  if (has('mercado_livre') && x.ml) {
    const a = x.ml.totals.all
    parts.push(h2('Mercado Livre Ads', color))
    if (!a.cost && !a.revenue && !a.clicks) {
      parts.push(`<tr><td style="font-size:13px;color:#6b7280">${x.ml.config.connected ? 'Sem investimento no Mercado Livre Ads no período.' : 'Mercado Livre não conectado (Configurações › Marketplaces).'}</td></tr>`)
    } else {
      const roas = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`)
      parts.push(
        table(
          `<tr>${th('Indicador')}${th('Período', true)}${th('Anterior', true)}${th('Variação', true)}</tr>`,
          [
            ['Investimento', `<b>${brl(a.cost)}</b>`, brl(a.before.cost), arrow(a.delta.cost)],
            ['Receita atribuída', `<b>${brl(a.revenue)}</b>`, brl(a.before.revenue), arrow(a.delta.revenue)],
            ['ROAS', roas(a.roas), roas(a.before.roas), arrow(a.delta.roas)],
            ['ACOS', pc(a.acos), pc(a.before.acos), ''],
            ['Cliques', int(a.clicks), int(a.before.clicks), arrow(a.delta.clicks)],
            ['Vendas pelos anúncios', int(a.units), int(a.before.units), ''],
          ]
            .map((r) => `<tr>${td(esc(r[0]))}${td(r[1]!, true)}${td(r[2]!, true)}${td(r[3]!, true)}</tr>`)
            .join(''),
        ),
      )
      const top = x.ml.campaigns.filter((c) => c.cost || c.revenue).slice(0, 8)
      if (top.length)
        parts.push(
          h2('Campanhas do Mercado Livre Ads', color),
          table(`<tr>${th('Campanha')}${th('Investimento', true)}${th('Receita', true)}${th('ROAS', true)}${th('ACOS', true)}</tr>`, top.map((c) => `<tr>${td(esc(c.name))}${td(brl(c.cost), true)}${td(brl(c.revenue), true)}${td(roas(c.roas), true)}${td(pc(c.acos), true)}</tr>`).join('')),
        )
      parts.push('<tr><td style="font-size:12px;color:#6b7280;padding-top:6px">Receita que o Mercado Livre atribui aos anúncios (até 14 dias depois do clique): os últimos dias ainda podem subir. ACOS = investimento ÷ receita (quanto menor, melhor).</td></tr>')
    }
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
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${color};padding:22px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" style="width:170px">${x.branding.logoUrl ? `<div style="background:#ffffff;border-radius:6px;padding:8px 12px;display:inline-block"><img src="${esc(x.branding.logoUrl)}" alt="${esc(x.branding.shortName || x.branding.appName)}" height="40" style="display:block;max-width:150px;height:40px;border:0"></div>` : `<span style="font-size:18px;font-weight:700;color:#ffffff">${esc(x.branding.shortName || x.branding.appName)}</span>`}</td>
<td valign="middle" style="padding-left:18px"><div style="font-size:11px;color:${lighten(color, 0.7)};font-weight:700;letter-spacing:.08em;text-transform:uppercase">Marketing Inteligente</div><div style="font-size:21px;font-weight:700;color:#ffffff;padding-top:2px">${esc(x.schedule.name)}</div></td>
</tr></table></td></tr>
<tr><td style="padding:16px 28px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;color:#6b7280">${esc(x.periodLabel)}: ${period} · comparado com ${day(d.period.prevFrom)} a ${day(d.period.prevTo)} · atribuição: ${d.rules.attribution.model === 'primeiro' ? 'primeiro toque' : 'último toque'}, janela de ${d.rules.attribution.windowDays} dias</td></tr>
${notes.map((n) => `<tr><td style="font-size:12px;color:#92400e;background:#fffbeb;padding:8px;margin-top:8px">${esc(n)}</td></tr>`).join('')}
${parts.join('\n')}
<tr><td style="padding:24px 0 8px"><a href="${esc(x.link)}" style="background:${color};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block;font-weight:600">Abrir no sistema</a></td></tr>
<tr><td style="font-size:11px;color:#9ca3af;line-height:16px">Fontes: Pré-Vendas do CRM (leads, atendimento e valor da venda) e investimento das plataformas conectadas. Investimento do Google Ads atualizado em ${d.updatedAt.googleAdsCost ? new Date(d.updatedAt.googleAdsCost).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}. Conversões das plataformas não são somadas às vendas do CRM. Relatório gerado em ${new Date(d.updatedAt.crm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</td></tr>
</table></td></tr>
<tr><td style="border-top:3px solid ${color};padding:14px 28px;font-size:12px;color:#4b5563"><b>${esc(x.branding.shortName || x.branding.appName)}</b>${x.branding.companyInfo ? ` · ${esc(x.branding.companyInfo)}` : ''}</td></tr>
</table>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">${esc(x.branding.appName)}</p>
</td></tr></table></body></html>`
}

export function reportText(x: ReportInput) {
  const d = x.data
  const lines = [`${x.schedule.name}`, `${x.periodLabel}: ${day(d.period.from)} a ${day(d.period.to)}`, '']
  if (x.ml && (x.schedule.sections as string[]).includes('mercado_livre')) {
    const a = x.ml.totals.all
    if (a.cost || a.revenue) lines.push(`Mercado Livre Ads: ${brl(a.cost)} investidos · ${brl(a.revenue)} de receita${a.roas !== null ? ` (ROAS ${a.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x)` : ''}`, '')
  }
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
  if (x.store && (x.schedule.sections as string[]).includes('loja')) {
    const top = x.store.channels.slice(0, 3).map((c) => `${c.name} ${brl(c.revenue)}`).join(' · ')
    lines.push('', `Loja virtual: *${int(x.store.now.orders)} vendas · ${brl(x.store.now.revenue)}*${top ? ` (${top})` : ''}`)
  }
  if (x.ml && (x.schedule.sections as string[]).includes('mercado_livre')) {
    const a = x.ml.totals.all
    if (a.cost || a.revenue) lines.push('', `Mercado Livre Ads: *${brl(a.cost)} investidos · ${brl(a.revenue)} de receita*${a.roas !== null ? ` (ROAS ${a.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x)` : ''}`)
  }
  if (x.ai && (x.schedule.sections as string[]).includes('resumo_ia')) lines.push('', x.ai.length > 600 ? `${x.ai.slice(0, 597).trimEnd()}...` : x.ai)
  lines.push('', `Ver tudo no sistema: ${x.link}`)
  // A legenda de documento no WhatsApp aceita até 1.024 caracteres.
  return lines.join('\n').slice(0, 1024)
}
