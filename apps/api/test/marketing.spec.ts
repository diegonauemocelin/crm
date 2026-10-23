import { describe, expect, it } from 'vitest'
import { cleanConfig, cleanFilters, cleanMetaAccount, cleanSchedule, cleanSiteUrl, DEFAULT_CONFIG, describeFrequency, isDue, nextRun, reportPeriod, type ReportSchedule, whatsappGap } from '../src/marketing/config'
import {
  applyFilters,
  attributedCampaign,
  breakdown,
  bucketOf,
  buckets,
  type CostRow,
  delta,
  formulas,
  funnel,
  indicators,
  periods,
  platformOf,
  type RecordRow,
  regionOf,
  type Rules,
  series,
  sumRecords,
} from '../src/marketing/metricas'
import { recommendations } from '../src/marketing/recomendacoes'
import { mlSheets } from '../src/marketing/arquivos'
import { reportHtml, reportWhatsapp } from '../src/marketing/relatorio-email'

const rules: Rules = { qualified: 'repassado_retorno', marginPct: 30, fixedMonthly: 0, marketingOriginIds: [] }
let n = 0
const rec = (p: Partial<RecordRow> = {}): RecordRow => {
  n++
  return {
    id: `r${n}`, leadId: `l${n}`, dedupeKey: p.leadId ?? `l${n}`, leadAt: new Date('2026-10-10T15:00:00Z'), forwarded: false, forwardedAt: null, returnStatus: null, returnedAt: null,
    saleStatus: 'NEGOCIACAO', saleValue: 0, firstActionAt: null, state: 'SC', country: null, unitId: 'u1', sellerId: 's1', originId: 'o1', customerTypeId: null,
    brandIds: [], partTypeIds: [], platform: 'google', campaignId: 'c1', campaignName: 'Pesquisa JCB', recurring: false, ...p,
  }
}
const cost = (p: Partial<CostRow> = {}): CostRow => ({ date: '2026-10-10', platform: 'google', campaignId: 'c1', campaignName: 'Pesquisa JCB', cost: 100, clicks: 50, impressions: 1000, conversions: 2, ...p })

describe('Marketing Inteligente: fórmulas', () => {
  it('segue as fórmulas do projeto e não quebra com zero', () => {
    const f = formulas({ mediaCost: 1000, totalCost: 1500, clicks: 400, impressions: 20000, leads: 50, qualified: 20, attended: 45, sales: 5, revenue: 10000, mktRevenue: 8000, newCustomers: 4, marginPct: 30 })
    expect(f.ctr).toBe(2)
    expect(f.cpc).toBe(2.5)
    expect(f.cpm).toBe(50)
    expect(f.cpl).toBe(20)
    expect(f.cpql).toBe(50)
    expect(f.cac).toBe(375)
    expect(f.conversionRate).toBe(10)
    expect(f.roas).toBe(8)
    // ROI ≠ ROAS: (8000 × 30% − 1500) ÷ 1500 = 60%.
    expect(f.roi).toBe(60)
    expect(f.ticket).toBe(2000)
    expect(f.attendedRate).toBe(90)
    const z = formulas({ mediaCost: 0, totalCost: 0, clicks: 0, impressions: 0, leads: 0, qualified: 0, attended: 0, sales: 0, revenue: 0, mktRevenue: 0, newCustomers: 0, marginPct: 30 })
    expect(Object.values(z).every((v) => v === null)).toBe(true)
    expect(delta(120, 100)).toBe(20)
    expect(delta(5, 0)).toBeNull()
  })

  it('conta o lead uma vez (vale a etapa mais avançada) e soma cada venda', () => {
    const rows = [
      rec({ leadId: 'A', dedupeKey: 'A', forwarded: true, returnStatus: 'PENDENTE' }),
      rec({ leadId: 'A', dedupeKey: 'A', forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 1500 }),
      rec({ leadId: 'B', dedupeKey: 'B', forwarded: true, saleStatus: 'SIM', saleValue: 500, recurring: true }),
      rec({ leadId: 'C', dedupeKey: 'C', platform: 'outros', saleStatus: 'NAO', firstActionAt: new Date() }),
    ]
    const t = sumRecords(rows, rules)
    expect(t).toMatchObject({ leads: 3, attended: 3, opportunities: 2, qualified: 1, sales: 2, revenue: 2000, lost: 1, mktLeads: 2, mktSales: 2, mktRevenue: 2000, newCustomers: 1 })
    // Regra "só repassado": B também é qualificado.
    expect(sumRecords(rows, { ...rules, qualified: 'repassado' }).qualified).toBe(2)
    // Origem marcada como marketing entra no faturamento atribuído.
    expect(sumRecords(rows, { ...rules, marketingOriginIds: ['o1'] }).mktLeads).toBe(3)
  })

  it('indicadores com custos fixos rateados e ROI estimado pela margem', () => {
    const i = indicators([rec({ forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 3000 })], [cost({ cost: 300 })], { ...rules, fixedMonthly: 3000 }, 10)
    expect(i.fixedCost).toBe(1000)
    expect(i.totalCost).toBe(1300)
    expect(i.roas).toBe(10)
    expect(i.roi).toBeCloseTo(-30.77, 1)
    expect(i.cpl).toBe(300)
  })
})

describe('Marketing Inteligente: período, plataforma e atribuição', () => {
  it('período anterior do mesmo tamanho e baldes da visão', () => {
    const p = periods('2026-10-01', '2026-10-10')
    expect(p).toMatchObject({ days: 10, prevFrom: '2026-09-21', prevTo: '2026-09-30' })
    expect(p.start.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(bucketOf('2026-10-22', 'semana')).toBe('2026-10-19')
    expect(bucketOf('2026-11-05', 'trimestre')).toBe('2026-T4')
    expect(buckets('2026-09-28', '2026-10-05', 'mes')).toEqual(['2026-09', '2026-10'])
    expect(periods('2026-10-10', '2026-10-01').from).toBe('2026-10-01')
  })

  it('plataforma do atendimento e região do estado', () => {
    expect(platformOf({ adsVia: 'ANUNCIO', originName: 'Site' })).toBe('google')
    expect(platformOf({ adsVia: null, originName: 'Instagram' })).toBe('meta')
    expect(platformOf({ adsVia: null, originName: 'Site', source: 'facebook' })).toBe('meta')
    expect(platformOf({ adsVia: null, originName: 'TikTok' })).toBe('tiktok')
    expect(platformOf({ adsVia: null, originName: 'Indicação' })).toBe('outros')
    expect(regionOf('rs')).toBe('Sul')
    expect(regionOf(null)).toBe('Sem estado')
    expect(regionOf('SP', 'Paraguai')).toBe('Exterior')
  })

  it('campanha pelo modelo de atribuição e pela janela', () => {
    const base = { leadAt: new Date('2026-10-10T12:00:00Z'), recordCampaignId: 'ultima', recordCampaign: 'Última', recordTouchAt: new Date('2026-10-09T12:00:00Z'), firstCampaignId: 'primeira', firstCampaign: 'Primeira', firstTouchAt: new Date('2026-08-01T12:00:00Z') }
    expect(attributedCampaign(base, 'ultimo', 90)).toEqual({ id: 'ultima', name: 'Última' })
    expect(attributedCampaign(base, 'primeiro', 90)).toEqual({ id: 'primeira', name: 'Primeira' })
    expect(attributedCampaign(base, 'primeiro', 30)).toMatchObject({ id: null, outOfWindow: true })
    expect(attributedCampaign({ ...base, recordCampaignId: null }, 'ultimo', 90).id).toBeNull()
  })

  it('filtros, recortes, série e funil', () => {
    const rows = [
      rec({ state: 'SC', brandIds: ['jcb', 'cat'], forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 1000, forwardedAt: new Date('2026-10-10T17:00:00Z') }),
      rec({ state: 'PR', brandIds: ['jcb'], campaignId: null, firstActionAt: new Date() }),
      rec({ state: 'SP', platform: 'outros', campaignId: null, leadAt: new Date('2026-10-12T15:00:00Z') }),
    ]
    expect(applyFilters(rows, { brandId: 'cat' })).toHaveLength(1)
    expect(applyFilters(rows, { region: 'Sul' })).toHaveLength(2)
    expect(applyFilters(rows, { campaignId: '-' })).toHaveLength(2)
    const byBrand = breakdown(rows, [], 'brand', rules, 30, (k) => k.toUpperCase())
    expect(byBrand.find((b) => b.key === 'jcb')).toMatchObject({ name: 'JCB', leads: 2, sales: 1 })
    const byCamp = breakdown(rows, [cost(), cost({ campaignId: 'c9', campaignName: 'Sem lead' })], 'campaign', rules, 30, String)
    expect(byCamp.map((c) => c.name)).toEqual(['Pesquisa JCB', 'Sem lead', 'Campanha não identificada'])
    expect(byCamp[0]).toMatchObject({ mediaCost: 100, leads: 1, cpl: 100, platform: 'google' })
    const s = series(rows, [cost()], '2026-10-10', '2026-10-12', 'dia', rules)
    expect(s.map((x) => [x.bucket, x.leads, x.mediaCost])).toEqual([['2026-10-10', 2, 100], ['2026-10-11', 0, 0], ['2026-10-12', 1, 0]])
    const f = funnel(indicators(rows, [cost()], rules, 3), rows)
    expect(f.steps.map((x) => x.value)).toEqual([1000, 50, 3, 2, 1, 1, 1])
    expect(f.steps[3]!.rate).toBeCloseTo(66.7, 1)
    expect(f.times.toForwardHours).toBe(2)
  })
})

describe('Marketing Inteligente: configurações e relatórios agendados', () => {
  it('limpa as configurações e os filtros', () => {
    const c = cleanConfig({ marginPct: 35.5, qualified: 'repassado', marketingOriginIds: ['ok', 'inventada'], attribution: { model: 'primeiro', windowDays: 30 } }, DEFAULT_CONFIG, new Set(['ok']))
    expect(c).toMatchObject({ marginPct: 35.5, qualified: 'repassado', marketingOriginIds: ['ok'], attribution: { model: 'primeiro', windowDays: 30 } })
    expect(cleanConfig({ marginPct: 120 }, DEFAULT_CONFIG, new Set())).toEqual({ error: 'Margem de contribuição: de 0 a 100%.' })
    expect(DEFAULT_CONFIG.marginPct).toBe(30)
    expect(DEFAULT_CONFIG.qualified).toBe('repassado_retorno')
    expect(cleanFilters({ platform: 'meta', state: 'SC', campaignId: "1; drop", region: 'Sul', cliente: 'x' })).toEqual({ platform: 'meta', state: 'SC', region: 'Sul' })
    expect(cleanMetaAccount('123456789')).toBe('act_123456789')
    expect(cleanMetaAccount('act_x')).toBeNull()
    expect(cleanSiteUrl('https://www.usaparts.com.br')).toBe('https://www.usaparts.com.br/')
    expect(cleanSiteUrl('sc-domain:usaparts.com.br')).toBe('sc-domain:usaparts.com.br')
    expect(cleanSiteUrl('javascript:alert(1)')).toBeNull()
  })

  it('valida o agendamento: e-mails, conteúdo e horário', () => {
    expect(cleanSchedule({ name: 'Diretoria', emails: [], sections: ['kpis'] }, null, 'x', null)).toEqual({ error: 'Cadastre ao menos um e-mail ou um celular de WhatsApp para receber o relatório.' })
    expect(cleanSchedule({ name: 'Diretoria', emails: ['a@b'], sections: ['kpis'] }, null, 'x', null)).toEqual({ error: 'E-mail inválido: a@b' })
    expect(cleanSchedule({ name: 'Diretoria', emails: ['dir@usaparts.com.br'], sections: [] }, null, 'x', null)).toEqual({ error: 'Escolha ao menos uma informação para ir no relatório.' })
    const s = cleanSchedule({ name: 'Diretoria', emails: ['DIR@usaparts.com.br', 'dir@usaparts.com.br'], frequency: 'semanal', weekday: 1, hour: 7, sections: ['kpis', 'inventada' as never] }, null, 'x', 'u') as ReportSchedule
    expect(s).toMatchObject({ emails: ['dir@usaparts.com.br'], sections: ['kpis'], period: 'semana_anterior', hour: 7, active: true })
    expect(describeFrequency(s)).toBe('Toda segunda às 07h')
    expect(describeFrequency({ ...s, weekday: 6 })).toBe('Todo sábado às 07h')
  })

  it('agendamento pelo WhatsApp: celulares com DDD, sem e-mail obrigatório, pausa sorteada', () => {
    const s = cleanSchedule({ name: 'Diretoria', emails: [], whatsapp: ['(49) 98863-2548', '49988632548', '+55 49 99999-0000'], sections: ['kpis'] }, null, 'x', 'u') as ReportSchedule
    expect(s).toMatchObject({ emails: [], whatsapp: ['+5549988632548', '+5549999990000'], whatsappNumberId: null })
    expect(cleanSchedule({ name: 'D', whatsapp: ['1234'], sections: ['kpis'] }, null, 'x', null)).toEqual({ error: 'Celular inválido para WhatsApp: 1234 (use DDD + número, ex.: (49) 98863-2548).' })
    expect(cleanSchedule({ name: 'D', whatsapp: Array.from({ length: 21 }, (_, i) => `4999999${String(i).padStart(4, '0')}`), sections: ['kpis'] }, null, 'x', null)).toEqual({ error: 'No máximo 20 celulares por relatório.' })
    // Edição sem mandar os celulares mantém os de antes.
    expect((cleanSchedule({ name: 'Outro nome' }, s, 'x', 'u') as ReportSchedule).whatsapp).toEqual(s.whatsapp)
    expect(whatsappGap(() => 0)).toBe(40_000)
    expect(whatsappGap(() => 0.999)).toBeLessThan(120_000)
  })

  it('calcula o próximo envio e quando está na hora (horário de Brasília)', () => {
    const at = (iso: string) => Date.parse(iso)
    const daily = { frequency: 'diario' as const, weekday: 1, monthDay: 1, hour: 8 }
    // 20/10/2026 07:00 em Brasília = 10:00 UTC.
    expect(new Date(nextRun(daily, at('2026-10-20T10:00:00Z'))!).toISOString()).toBe('2026-10-20T11:00:00.000Z')
    expect(new Date(nextRun(daily, at('2026-10-20T11:30:00Z'))!).toISOString()).toBe('2026-10-21T11:00:00.000Z')
    expect(new Date(nextRun({ ...daily, frequency: 'mensal', monthDay: 5 }, at('2026-10-20T11:30:00Z'))!).toISOString()).toBe('2026-11-05T11:00:00.000Z')
    const sch = { ...(cleanSchedule({ name: 'X', emails: ['a@b.com'], sections: ['kpis'], hour: 8 }, null, 'x', null) as ReportSchedule), createdAt: '2026-10-19T00:00:00Z' }
    expect(isDue(sch, at('2026-10-20T11:05:00Z'))).toBe(true)
    expect(isDue({ ...sch, lastSentAt: '2026-10-20T11:05:00Z' }, at('2026-10-20T11:10:00Z'))).toBe(false)
    expect(isDue({ ...sch, active: false }, at('2026-10-20T11:05:00Z'))).toBe(false)
    // Criado depois do horário de hoje: só manda amanhã.
    expect(isDue({ ...sch, createdAt: '2026-10-20T11:02:00Z' }, at('2026-10-20T11:05:00Z'))).toBe(false)
    expect(reportPeriod('ontem', at('2026-10-20T11:00:00Z'))).toEqual({ from: '2026-10-19', to: '2026-10-19' })
    expect(reportPeriod('semana_anterior', at('2026-10-20T11:00:00Z'))).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(reportPeriod('mes_anterior', at('2026-10-20T11:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(reportPeriod('mes_atual', at('2026-11-01T11:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
})

describe('Marketing Inteligente: recomendações e e-mail do relatório', () => {
  const p = periods('2026-10-01', '2026-10-30')
  const mk = (leads: number, cost: number, sales: number) =>
    indicators(Array.from({ length: leads }, (_, i) => rec({ saleStatus: i < sales ? 'SIM' : 'NEGOCIACAO', saleValue: i < sales ? 1000 : 0, forwarded: i < leads / 2 })), [cost > 0 ? { date: '2026-10-01', platform: 'google', campaignId: 'c1', campaignName: 'X', cost, clicks: 10, impressions: 100, conversions: 0 } : null].filter((x): x is CostRow => !!x), rules, 30)

  it('só recomenda com amostra suficiente e mostra os números', () => {
    const base = { period: p, campaigns: [], states: [], sellers: [], googleWithoutCampaign: { without: 0, total: 0 }, forwardMedianHours: null, forwardSample: 0, costStaleHours: 2 }
    const recs = recommendations({ ...base, now: mk(20, 2000, 2), before: mk(20, 1000, 2) })
    const cpl = recs.find((r) => r.id === 'cpl-subiu')!
    expect(cpl.problem).toBe('O custo por lead subiu 100%.')
    expect(cpl.evidence[0]).toMatch(/R\$\s50,00 → R\$\s100,00/)
    expect(cpl.source).toContain('Google Ads')
    // Amostra pequena: nada.
    expect(recommendations({ ...base, now: mk(5, 2000, 0), before: mk(5, 1000, 0) }).find((r) => r.id === 'cpl-subiu')).toBeUndefined()
    // Leads sem campanha e investimento parado.
    const dados = recommendations({ ...base, now: mk(20, 1000, 2), before: mk(20, 1000, 2), googleWithoutCampaign: { without: 9, total: 20 }, costStaleHours: 80 })
    expect(dados.map((r) => r.id)).toEqual(expect.arrayContaining(['leads-sem-campanha', 'investimento-desatualizado']))
    expect(dados.every((r) => r.action && r.metric && r.validate)).toBe(true)
  })

  it('o e-mail leva só o que foi escolhido e escapa os nomes', () => {
    const now = mk(10, 500, 1)
    const data = {
      period: { from: '2026-10-19', to: '2026-10-19', days: 1, prevFrom: '2026-10-18', prevTo: '2026-10-18' },
      crmOnlyFilters: [],
      rules: { ...rules, attribution: { model: 'ultimo', windowDays: 90 } },
      updatedAt: { crm: '2026-10-20T11:00:00Z', googleAdsCost: '2026-10-20T10:00:00Z', googleAdsScript: null, googleAdsCampaigns: null },
      now,
      before: now,
      deltas: { leads: 0 },
      byCampaign: [{ key: 'c1', name: '<script>x</script>', platform: 'google', ...now }],
      byPlatform: [],
      funnel: funnel(now, []),
      recommendations: [],
      quality: { records: 10, withOrigin: 10, googleLeads: 10, googleWithCampaign: 8 },
    } as never
    const html = reportHtml({ schedule: { name: 'Diário', sections: ['kpis', 'campanhas'] }, periodLabel: 'Ontem', data, email: null, health: null, branding: { appName: 'CRM Usaparts', primaryColor: '#5747cb' }, link: 'https://crm/x' })
    expect(html).toContain('Indicadores principais')
    expect(html).toContain('Campanhas')
    expect(html).not.toContain('Funil de marketing')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('ROI estimado com margem de 30%')
    const wa = reportWhatsapp({ schedule: { name: 'Diário', sections: ['kpis', 'resumo_ia'] }, periodLabel: 'Ontem', data, email: null, health: null, branding: { appName: 'CRM Usaparts', primaryColor: '#5747cb' }, link: 'https://crm/x', ai: 'x'.repeat(900) })
    expect(wa).toContain('*Diário*')
    expect(wa).toContain('Leads gerados')
    expect(wa).toContain('Ver tudo no sistema: https://crm/x')
    expect(wa.length).toBeLessThanOrEqual(1024)

    // Mercado Livre Ads: tabela no e-mail, linha no WhatsApp e planilhas do PDF/Excel
    const k = (cost: number, revenue: number) => ({ impressions: 10000, clicks: 400, cost, revenue, directRevenue: revenue, indirectRevenue: 0, units: 12, items: 12, ctr: 4, cpc: cost / 400, cpm: 1, roas: revenue / cost, acos: (cost * 100) / revenue, cvr: 3 })
    const ml = {
      config: { connected: true },
      totals: { all: { ...k(1000, 8000), before: k(800, 5000), delta: { cost: 25, revenue: 60, clicks: 0, impressions: 0, roas: 28, acos: -22, items: 0, cpc: 25 } } },
      campaigns: [{ name: 'Filtros JCB', status: 'active', ...k(600, 5000) }, { name: 'Parada', status: 'paused', ...k(0, 0), cost: 0, revenue: 0 }],
      display: [],
    } as never
    const mlHtml = reportHtml({ schedule: { name: 'Diário', sections: ['mercado_livre'] }, periodLabel: 'Ontem', data, email: null, health: null, branding: { appName: 'CRM Usaparts', primaryColor: '#5747cb' }, link: 'https://crm/x', ml })
    expect(mlHtml).toContain('Mercado Livre Ads')
    expect(mlHtml).toContain('Filtros JCB')
    expect(mlHtml).not.toContain('Parada')
    expect(mlHtml).toContain('8x')
    const mlWa = reportWhatsapp({ schedule: { name: 'Diário', sections: ['mercado_livre'] }, periodLabel: 'Ontem', data, email: null, health: null, branding: { appName: 'CRM Usaparts', primaryColor: '#5747cb' }, link: 'https://crm/x', ml })
    expect(mlWa).toContain('Mercado Livre Ads: *')
    expect(mlWa).toContain('de receita* (ROAS 8x)')
    const sheets = mlSheets(ml)
    expect(sheets.map((x) => x.name)).toEqual(['Mercado Livre Ads', 'ML Ads: campanhas'])
    expect(sheets[1]!.rows).toHaveLength(1)
  })
})
