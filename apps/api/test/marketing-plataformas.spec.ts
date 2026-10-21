import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { cleanDetail, cleanTerms, DEFAULT_ALERT_WORDS, negativeSuggestions } from '../src/googleads/detalhes'
import { adsScript } from '../src/googleads/painel'
import { reportSheets, toPdf, toXlsx } from '../src/marketing/arquivos'
import { aiPayload, cleanAiText } from '../src/marketing/ia'
import { indicators, periods, type RecordRow } from '../src/marketing/metricas'
import { cleanPlan, cleanRule, evaluate, goalStatus, projection, scenarios, type AlertContext } from '../src/marketing/planejamento'
import { aggregateMedia, aggregateSeo, fatigue, groupByNames, type MediaDay, pagePath, rankPosts, resultOf, seoOpportunities, themesOf } from '../src/marketing/plataformas'
import { daysToSync, metaError, parseDailyInsights, parseFbPost, parseIgMedia, parseMetaBreakdown, parseMetaInsights, parseSearchAnalytics, parseTikTokReport } from '../src/marketing/sync'

describe('Google Ads detalhado (script ampliado)', () => {
  it('o script pede termos de pesquisa, recortes e páginas de destino, cada um protegido', () => {
    const s = adsScript('https://crm/x')
    for (const t of ['search_term_view', 'segments.device', 'segments.ad_network_type', 'landing_page_view', 'ad_group_ad', 'geographic_view', 'advertising_channel_type', 'search_impression_share']) expect(s).toContain(t)
    expect(s).toContain("{ detail: { from: de, to: ate, rows: p } }")
    expect(s).toContain("{ terms: { from: de, to: ate, rows: p } }")
  })

  it('limpa detalhes e termos, sem linha repetida', () => {
    const d = cleanDetail({ detail: { rows: [
      { d: '2026-10-01', c: '123', dim: 'device', k: 'MOBILE', l: 'MOBILE', cost: 10.456, cl: 3, im: 100, cv: 1, val: 50 },
      { d: '2026-10-01', c: '123', dim: 'device', k: 'MOBILE', l: 'MOBILE', cost: 11, cl: 3, im: 100, cv: 1, val: 50 },
      { d: '2026-10-01', c: '123', dim: 'type', k: 'SEARCH', cost: 5, cl: 1, im: 10, cv: 0, is: 0.4567 },
      { d: 'x', c: '123', dim: 'device', k: 'A', cost: 1, cl: 1, im: 1, cv: 0 },
      { d: '2026-10-01', c: '123', dim: 'inventado', k: 'A', cost: 1, cl: 1, im: 1, cv: 0 },
    ] } })
    expect(Array.isArray(d) && d.map((x) => [x.dimension, x.cost, x.impressionShare])).toEqual([['device', 11, null], ['type', 5, 0.4567]])
    const t = cleanTerms({ terms: { rows: [{ d: '2026-10-01', c: '1', g: '2', t: 'Filtro JCB 3CX ', cost: 4, cl: 2, im: 9, cv: 0 }, { d: '2026-10-01', c: '1', g: 'x', t: 'a', cost: 1, cl: 1, im: 1, cv: 0 }] } })
    expect(t).toEqual([{ date: '2026-10-01', campaignId: '1', adGroupId: '2', term: 'filtro jcb 3cx', cost: 4, clicks: 2, impressions: 9, conversions: 0 }])
    expect(cleanDetail({ detail: { rows: Array(5001).fill({}) } })).toEqual({ error: 'Linhas demais em um envio (máximo 5.000).' })
  })

  it('sugere negativas por palavra de alerta e por gasto sem conversão, nunca termo que converteu', () => {
    const terms = [
      { term: 'vaga de emprego operador escavadeira', campaignIds: ['1'], cost: 12, clicks: 3, impressions: 40, conversions: 0 },
      { term: 'manual pdf retroescavadeira 3cx', campaignIds: ['1'], cost: 8, clicks: 2, impressions: 30, conversions: 0 },
      { term: 'filtro hidraulico jcb', campaignIds: ['1'], cost: 90, clicks: 20, impressions: 300, conversions: 2 },
      { term: 'peças caterpillar 320', campaignIds: ['1'], cost: 60, clicks: 12, impressions: 200, conversions: 0 },
      { term: 'peças komatsu', campaignIds: ['1'], cost: 5, clicks: 1, impressions: 20, conversions: 0 },
    ]
    const s = negativeSuggestions(terms, DEFAULT_ALERT_WORDS, { minCost: 20, minClicks: 5 })
    expect(s.map((x) => [x.term, x.reason, x.word ?? null])).toEqual([
      ['peças caterpillar 320', 'sem_conversao', null],
      ['vaga de emprego operador escavadeira', 'palavra', 'emprego'],
      ['manual pdf retroescavadeira 3cx', 'palavra', 'pdf'],
    ])
  })
})

describe('Leitura das APIs das plataformas', () => {
  it('Meta: insights por dia, ações (lead, conversa, compra) e recortes', () => {
    const rows = parseMetaInsights([
      { date_start: '2026-10-01', campaign_id: '111', campaign_name: 'Leads JCB', adset_id: '222', ad_id: '333', ad_name: 'Vídeo 1', objective: 'OUTCOME_LEADS', spend: '50.5', impressions: '1000', reach: '800', clicks: '40', inline_link_clicks: '25', actions: [{ action_type: 'lead', value: '4' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }, { action_type: 'purchase', value: '1' }, { action_type: 'omni_purchase', value: '1' }, { action_type: 'video_view', value: '300' }] },
      { date_start: 'ontem', campaign_id: '111', ad_id: '333' },
    ], 'ad')
    expect(rows).toEqual([{ platform: 'meta', level: 'ad', entityId: '333', name: 'Vídeo 1', campaignId: '111', campaignName: 'Leads JCB', parentId: '222', objective: 'OUTCOME_LEADS', date: '2026-10-01', spend: 50.5, impressions: 1000, reach: 800, clicks: 25, leads: 4, conversations: 2, conversions: 1, videoViews: 300 }])
    expect(parseMetaBreakdown([{ date_start: '2026-10-01', campaign_id: '111', publisher_platform: 'instagram', platform_position: 'reels', spend: '10', impressions: '100', clicks: '3' }], 'placement', ['publisher_platform', 'platform_position'])[0]).toMatchObject({ key: 'instagram · reels', spend: 10 })
    expect(metaError(400, { error: { code: 190, message: 'expired' } })).toContain('vencido')
    expect(metaError(400, { error: { code: 17 } })).toContain('Limite de chamadas')
  })

  it('Instagram, Facebook e insights diários', () => {
    const ig = parseIgMedia({ id: '17890', timestamp: '2026-10-10T12:00:00+0000', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'Peças JCB', permalink: 'https://www.instagram.com/reel/x', like_count: 30, comments_count: 4 }, { reach: 1000, saved: 5, shares: 2, views: 3000 })
    expect(ig).toMatchObject({ network: 'instagram', format: 'Reels', likes: 30, saves: 5, reach: 1000, videoViews: 3000 })
    const fb = parseFbPost({ id: '123_456', created_time: '2026-10-11T10:00:00+0000', message: 'Promoção', status_type: 'added_photos', reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 1 } }, shares: { count: 3 } })
    expect(fb).toMatchObject({ format: 'Imagem', likes: 12, comments: 1, shares: 3 })
    const daily = parseDailyInsights([{ name: 'reach', values: [{ value: 120, end_time: '2026-10-11T07:00:00+0000' }, { value: 90, end_time: '2026-10-12T07:00:00+0000' }] }])
    expect([...daily.entries()]).toEqual([['2026-10-11', { reach: 120 }], ['2026-10-12', { reach: 90 }]])
  })

  it('TikTok e Search Console', () => {
    const t = parseTikTokReport({ list: [{ dimensions: { campaign_id: '9001', stat_time_day: '2026-10-01 00:00:00' }, metrics: { campaign_name: 'Vídeos', spend: '30.00', impressions: '5000', reach: '4000', clicks: '60', conversion: '3', video_play_actions: '2500', objective_type: 'VIDEO_VIEWS' } }] }, 'campaign')
    expect(t[0]).toMatchObject({ platform: 'tiktok', entityId: '9001', date: '2026-10-01', spend: 30, conversions: 3, videoViews: 2500, leads: 0 })
    expect(parseSearchAnalytics({ rows: [{ keys: ['peças jcb'], clicks: 10, impressions: 200, position: 6.234 }] }, '2026-10-01', 'query')).toEqual([{ date: '2026-10-01', kind: 'query', key: 'peças jcb', clicks: 10, impressions: 200, position: 6.23 }])
    expect(parseSearchAnalytics({ rows: [{ clicks: 50, impressions: 900, position: 9 }] }, '2026-10-01', 'total')[0]).toMatchObject({ key: 'total', clicks: 50 })
    const plan = daysToSync('2026-10-21', null, 90, 4, 15)
    expect(plan.days.slice(0, 4)).toEqual(['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17'])
    expect(plan.days).toHaveLength(19)
    expect(plan.done).toBe(false)
    const last = daysToSync('2026-10-21', '2026-07-25', 90, 4, 15)
    expect(last.done).toBe(true)
  })
})

describe('Telas das plataformas', () => {
  const day = (date: string, p: Partial<MediaDay> = {}): MediaDay => ({ entityId: 'a1', name: 'Anúncio 1', campaignId: 'c1', campaignName: 'C', parentId: null, objective: 'OUTCOME_LEADS', date, spend: 10, impressions: 500, reach: 200, clicks: 10, leads: 1, conversations: 0, conversions: 0, videoViews: null, ...p })
  it('soma por anúncio, resultado pelo objetivo e frequência', () => {
    const a = aggregateMedia([day('2026-10-01'), day('2026-10-02', { spend: 20, leads: 3 })])[0]!
    expect(a).toMatchObject({ spend: 30, impressions: 1000, leads: 4, result: 'leads', results: 4, costPerResult: 7.5, ctr: 2, frequency: 2.5 })
    expect(resultOf('MESSAGES')).toBe('conversations')
    expect(resultOf('OUTCOME_SALES')).toBe('conversions')
    expect(resultOf('LINK_CLICKS')).toBe('clicks')
  })

  it('aponta cansaço do anúncio só com amostra', () => {
    const rows = [
      ...['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'].map((d) => day(d, { impressions: 300, clicks: 9, reach: 250 })),
      ...['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((d) => day(d, { impressions: 300, clicks: 4, reach: 60 })),
    ]
    const f = fatigue(rows, '2026-10-21')
    expect(f[0]!.reasons.join(' | ')).toMatch(/CTR caiu de 3% para 1,33%.*frequência de 5/)
    expect(fatigue(rows.map((r) => ({ ...r, impressions: 50 })), '2026-10-21')).toEqual([])
  })

  it('SEO: posição ponderada, oportunidades, marcas e caminho da página', () => {
    const agg = aggregateSeo([
      { key: 'peças jcb', clicks: 2, impressions: 400, position: 5 },
      { key: 'peças jcb', clicks: 1, impressions: 100, position: 10 },
      { key: 'filtro caterpillar', clicks: 30, impressions: 300, position: 2 },
    ])
    expect(agg.find((q) => q.key === 'peças jcb')).toMatchObject({ clicks: 3, impressions: 500, position: 6, ctr: 0.6 })
    expect(seoOpportunities(agg).map((q) => q.key)).toEqual(['peças jcb'])
    expect(groupByNames(agg, ['JCB', 'Caterpillar', 'Volvo']).map((g) => g.name)).toEqual(['Caterpillar', 'JCB'])
    expect(groupByNames([{ key: 'https://www.usaparts.com.br/pecas-new-holland/x', clicks: 1, impressions: 2, position: 3, ctr: 50 }], ['New Holland'])).toHaveLength(1)
    expect(pagePath('https://www.usaparts.com.br/Pecas-JCB/?utm_source=x')).toBe('/pecas-jcb')
  })

  it('redes: ranking por engajamento e temas pelo texto', () => {
    const base = { network: 'instagram', permalink: null, impressions: null, videoViews: null, shares: 0, saves: 0, format: 'Imagem', publishedAt: new Date() }
    const r = rankPosts([
      { ...base, postId: '1', caption: 'Filtros para JCB', likes: 10, comments: 0, reach: 1000 },
      { ...base, postId: '2', caption: 'Material rodante Komatsu', likes: 50, comments: 10, reach: 1000 },
    ])
    expect(r.map((p) => [p.postId, p.engagementRate])).toEqual([['2', 6], ['1', 1]])
    expect(themesOf('Material rodante para Komatsu PC200', ['Komatsu', 'Material rodante', 'JCB'])).toEqual(['Komatsu', 'Material rodante'])
  })
})

describe('Planejamento, cenários e alertas', () => {
  it('limpa o plano do mês', () => {
    expect(cleanPlan('2026-13', {}, 'x')).toEqual({ error: 'Mês inválido (use aaaa-mm).' })
    const p = cleanPlan('2026-10', { budget: { total: 10000, google: 7000, meta: 3000, tiktok: null, campaigns: { '123': 2000 } }, goals: { leads: 300.4, cpl: 30, sales: 40, revenue: 200000 } }, 'Diego')
    expect(p).toMatchObject({ budget: { total: 10000, campaigns: { '123': 2000 } }, goals: { leads: 300 }, updatedBy: 'Diego' })
    expect(cleanPlan('2026-10', { budget: { total: -1 } as never }, 'x')).toMatchObject({ error: expect.any(String) })
  })

  it('projeção com a premissa e faixa, metas e cenários sem proporção garantida', () => {
    const p = projection([100, 120, 80, 100, 110, 90, 100], 31)
    expect(p).toMatchObject({ spent: 700, projected: 3100, elapsed: 7 })
    expect(p.low! < 3100 && p.high! > 3100).toBe(true)
    expect(projection([50], 30)).toMatchObject({ projected: 1500, low: null })
    expect(goalStatus(300, 100, 10, 30)).toMatchObject({ expected: 100, onTrack: true })
    expect(goalStatus(300, 50, 15, 30)).toMatchObject({ onTrack: false })
    const sc = scenarios({ mediaCost: 1000, leads: 100, sales: 10, revenue: 50000, conversionRate: 10, ticket: 5000 })
    const up = sc.find((x) => x.change === 30)!
    expect(up.leads.high).toBe(130)
    expect(up.leads.low).toBeLessThan(130)
    expect(up.investment).toBe(1300)
  })

  it('alertas: dispara com amostra e não repete regra inválida', () => {
    const n = 0
    const mk = (leads: number, cost: number, sales = 0) =>
      indicators(Array.from({ length: leads }, (_, i): RecordRow => ({ id: `r${n}${i}`, leadId: `l${i}`, dedupeKey: `l${i}`, leadAt: new Date(), forwarded: false, forwardedAt: null, returnStatus: null, returnedAt: null, saleStatus: i < sales ? 'SIM' : 'NEGOCIACAO', saleValue: i < sales ? 1000 : 0, firstActionAt: null, state: 'SC', country: null, unitId: null, sellerId: null, originId: null, customerTypeId: null, brandIds: [], partTypeIds: [], platform: 'google', campaignId: 'c', campaignName: 'C', recurring: false })), cost ? [{ date: '2026-10-01', platform: 'google', campaignId: 'c', campaignName: 'C', cost, clicks: 1, impressions: 1, conversions: 0 }] : [], { qualified: 'repassado_retorno', marginPct: 30, fixedMonthly: 0, marketingOriginIds: [] }, 7)
    const ctx = (over: Partial<AlertContext>): AlertContext => ({ now: mk(20, 2000), before: mk(20, 1000), campaigns: [], googleWithoutCampaign: { without: 0, total: 0 }, budget: null, goals: [], staleness: [], ...over })
    const rule = (type: string, threshold: number) => cleanRule({ type: type as never, threshold, emails: ['a@b.com'] }, null, 'id') as never
    expect(evaluate(rule('cpl_aumento', 30), ctx({})).fired).toBe(true)
    expect(evaluate(rule('cpl_aumento', 30), ctx({ now: mk(5, 2000), before: mk(5, 1000) })).fired).toBe(false)
    expect(evaluate(rule('gasto_limite', 90), ctx({ budget: { amount: 1000, spent: 950 } })).message).toContain('95%')
    expect(evaluate(rule('leads_sem_atendimento', 5), ctx({})).message).toContain('20 lead(s)')
    expect(evaluate(rule('dados_desatualizados', 36), ctx({ staleness: [{ name: 'Meta Ads', hours: 50, error: null }] })).message).toContain('Meta Ads sem atualizar há 50 h')
    expect(cleanRule({ type: 'x' as never }, null, 'id')).toEqual({ error: 'Tipo de alerta inválido.' })
    expect(cleanRule({ type: 'queda_leads', emails: ['nao-e-email'] }, null, 'id')).toEqual({ error: 'E-mail inválido: nao-e-email' })
  })
})

describe('Arquivos (Excel e PDF) e IA', () => {
  const rows: RecordRow[] = [{ id: 'r1', leadId: 'l1', dedupeKey: 'l1', leadAt: new Date('2026-10-10T12:00:00Z'), forwarded: true, forwardedAt: null, returnStatus: 'SIM', returnedAt: null, saleStatus: 'SIM', saleValue: 5000, firstActionAt: null, state: 'SC', country: null, unitId: null, sellerId: 's1', originId: null, customerTypeId: null, brandIds: [], partTypeIds: [], platform: 'google', campaignId: 'c1', campaignName: 'Peças JCB — Pesquisa', recurring: false }]
  const now = indicators(rows, [{ date: '2026-10-10', platform: 'google', campaignId: 'c1', campaignName: 'Peças JCB — Pesquisa', cost: 500, clicks: 100, impressions: 2000, conversions: 1 }], { qualified: 'repassado_retorno', marginPct: 30, fixedMonthly: 0, marketingOriginIds: [] }, 30)
  const p = periods('2026-10-01', '2026-10-30')
  const data = {
    period: { from: p.from, to: p.to, days: 30, prevFrom: p.prevFrom, prevTo: p.prevTo },
    rules: { qualified: 'repassado_retorno', marginPct: 30, fixedMonthly: 0, marketingOriginIds: [], attribution: { model: 'ultimo', windowDays: 90 } },
    now,
    before: now,
    deltas: { leads: 0 },
    byPlatform: [{ key: 'google', name: 'Google Ads', platform: null, ...now }],
    byCampaign: [{ key: 'c1', name: 'Peças JCB — Pesquisa (ação)', platform: 'google', ...now }],
    bySeller: [{ key: 's1', name: 'Vendedor Exemplo', platform: null, ...now }],
    byRegion: [], byState: [], byBrand: [], byPartType: [], byOrigin: [],
    funnel: { steps: [{ key: 'leads', label: 'Leads gerados', value: 1, rate: null }], revenue: 5000, times: {} },
    recommendations: [{ id: 'x', area: 'Dados', priority: 'alta', confidence: 'media', problem: 'Algo → aconteceu', evidence: ['a'], impact: 'i', action: 'faça', metric: 'm', validate: 'v', source: 's' }],
    quality: { googleLeads: 1, googleWithCampaign: 1 },
  } as never

  it('Excel com uma aba por parte e números como números', () => {
    const sheets = reportSheets(data, ['kpis', 'campanhas', 'funil', 'recomendacoes'], null, null, null)
    expect(sheets.map((s) => s.name)).toEqual(['Indicadores', 'Campanhas', 'Funil', 'Recomendações'])
    const files = unzipSync(toXlsx(sheets, 'Relatório'))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet4.xml']))
    const s2 = strFromU8(files['xl/worksheets/sheet2.xml']!)
    expect(s2).toContain('Peças JCB — Pesquisa (ação)')
    expect(s2).toContain('<v>500</v>')
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="Recomendações"')
  })

  it('PDF válido, com acentos e quebra de página', () => {
    const sheets = reportSheets(data, ['kpis', 'campanhas'], null, null, null)
    const many = [...sheets, { name: 'Longa', header: ['Item', 'Valor'], rows: Array.from({ length: 150 }, (_, i) => [`Linha ${i} — ação`, i]) }]
    const pdf = Buffer.from(toPdf({ title: 'Relatório de marketing', subtitle: 'Período: 01/10 a 30/10', sheets: many, footer: 'CRM' }))
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('%%EOF')
    expect(text).toContain('Pe\xe7as JCB \x97 Pesquisa')
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBeGreaterThan(1)
    // Tabela de xref aponta para os objetos certos.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
  })

  it('IA recebe só agregados (sem vendedores, clientes ou contatos)', () => {
    const payload = JSON.stringify(aiPayload(data))
    expect(payload).toContain('Peças JCB')
    expect(payload).not.toContain('Vendedor Exemplo')
    expect(cleanAiText('**Resumo**\n\n\n* ponto 1\n# Título')).toBe('Resumo\n\n- ponto 1\nTítulo')
  })
})
