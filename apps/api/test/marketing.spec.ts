import { describe, expect, it } from 'vitest'
import { attribute, campaignKey, channelOfTouch, pickTouch } from '../src/marketing/canais'
import { cac, cpc, cpl, cpm, ctr, div, roas, roi, ticket, trend, variation } from '../src/marketing/formulas'
import { parseFilters } from '../src/marketing/marketing.service'
import {
  attentionPoints,
  biggestDrop,
  breakdown,
  buildKpis,
  type CostRow,
  costFollowsFilters,
  type Ctx,
  type Dataset,
  dedupeOrders,
  filterOrders,
  filterRows,
  funnel,
  kpiValues,
  type Row,
  stagesOf,
  type StoreOrder,
  summarizePeriod,
  timings,
} from '../src/marketing/motor'
import { bucketOfDay, bucketsOf, makePeriod, previousPeriod } from '../src/marketing/periodo'

const NO_ATTR = { channel: 'nao_identificado' as const, campaignId: null, campaign: null, ad: null, term: null, source: null, medium: null, how: 'nenhum' as const, touchAt: null }
const GOOGLE = (id: string) => ({ ...NO_ATTR, channel: 'google_ads' as const, campaignId: id, campaign: `Campanha ${id}`, how: 'clique_google' as const })
const at = (iso: string) => new Date(`${iso}T12:00:00-03:00`)

function row(over: Partial<Row> & { id: string }): Row {
  return {
    contactKey: over.id,
    leadId: null,
    leadAt: at('2026-10-05'),
    saleAt: null,
    saleAtEstimated: false,
    sellerId: null,
    unitId: null,
    originId: null,
    customerTypeId: null,
    state: 'SC',
    region: 'Sul',
    brandIds: [],
    partTypeIds: [],
    forwarded: false,
    returnStatus: null,
    returnedAt: null,
    saleStatus: 'NEGOCIACAO',
    saleValue: null,
    lostReasonId: null,
    firstContactAt: null,
    imported: false,
    leadStage: 'LEAD',
    recurring: false,
    attribution: NO_ATTR,
    ...over,
  }
}

const cost = (day: string, campaignId: string, value: number, clicks = 10, impressions = 100): CostRow => ({ day, channel: 'google_ads', campaignId, campaignName: `Campanha ${campaignId}`, cost: value, clicks, impressions, conversions: 1 })
const ctx: Ctx = { rule: 'estagio_ou_repasse', costChannels: new Set(['google_ads']) }
const OCT = makePeriod('2026-10-01', '2026-10-31')

describe('Marketing: fórmulas', () => {
  it('divisão por zero ou sem dado vira null, nunca zero nem erro', () => {
    expect(div(10, 0)).toBeNull()
    expect(div(null, 2)).toBeNull()
    expect(div(10, undefined)).toBeNull()
    expect(div(10, 4)).toBe(2.5)
    expect(ctr(5, 0)).toBeNull()
    expect(cpc(100, 0)).toBeNull()
  })

  it('CTR, CPC, CPM, CPL, CAC, ROAS e ticket', () => {
    expect(ctr(34, 1000)).toBeCloseTo(0.034)
    expect(cpc(100, 40)).toBe(2.5)
    expect(cpm(50, 10_000)).toBe(5)
    expect(cpl(1000, 20)).toBe(50)
    expect(cpl(0, 20)).toBeNull()
    expect(cac(1000, 4)).toBe(250)
    expect(roas(4000, 1000)).toBe(4)
    expect(ticket(3000, 4)).toBe(750)
  })

  it('ROI não é ROAS e só existe com contribuição e custos', () => {
    expect(roi(null, 1000)).toBeNull()
    expect(roi(1500, 0)).toBeNull()
    expect(roi(1500, 1000)).toBeCloseTo(0.5)
    expect(roas(4000, 1000)).not.toBe(roi(4000, 1000))
  })

  it('variação e tendência', () => {
    expect(variation(120, 100)).toBeCloseTo(0.2)
    expect(variation(5, 0)).toBeNull()
    expect(trend([10, 12, 15, 18])).toBe('alta')
    expect(trend([18, 15, 12, 10])).toBe('queda')
    expect(trend([10, 10, 10.1, 10])).toBe('estavel')
    expect(trend([1, 2])).toBeNull()
  })
})

describe('Marketing: períodos', () => {
  it('período anterior equivalente tem o mesmo número de dias, logo antes', () => {
    const p = makePeriod('2026-10-01', '2026-10-31')
    expect(p.days).toBe(31)
    expect(previousPeriod(p)).toMatchObject({ from: '2026-08-31', to: '2026-09-30', days: 31 })
  })

  it('datas trocadas são desviradas e o limite é de 2 anos', () => {
    expect(makePeriod('2026-10-31', '2026-10-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(makePeriod('2020-01-01', '2026-10-31').days).toBe(731)
  })

  it('agrupa por semana (segunda), mês, trimestre e ano', () => {
    expect(bucketOfDay('2026-10-22', 'semana')).toBe('2026-10-19')
    expect(bucketOfDay('2026-10-22', 'mes')).toBe('2026-10')
    expect(bucketOfDay('2026-11-22', 'trimestre')).toBe('2026-T4')
    expect(bucketOfDay('2026-11-22', 'ano')).toBe('2026')
    expect(bucketsOf(makePeriod('2026-09-15', '2026-10-15'), 'mes')).toEqual(['2026-09', '2026-10'])
  })
})

describe('Marketing: canais e atribuição', () => {
  it('classifica o canal pelo toque', () => {
    expect(channelOfTouch({ source: 'google', medium: 'cpc' })).toBe('google_ads')
    expect(channelOfTouch({ source: 'facebook', medium: 'cpc' })).toBe('meta_ads')
    expect(channelOfTouch({ source: 'instagram', medium: 'paid_social' })).toBe('meta_ads')
    expect(channelOfTouch({ source: 'tiktok', medium: 'cpc' })).toBe('tiktok_ads')
    expect(channelOfTouch({ source: 'newsletter', medium: 'email' })).toBe('email')
    expect(channelOfTouch({ source: 'google', medium: 'organico' })).toBe('busca_organica')
    expect(channelOfTouch({ source: 'instagram', medium: 'social' })).toBe('social_organico')
    expect(channelOfTouch({ source: 'direto', medium: 'direto' })).toBe('direto')
    expect(channelOfTouch({ source: 'x', medium: 'y', landing: 'https://usaparts.com.br/?gclid=abc' })).toBe('google_ads')
    expect(channelOfTouch(null)).toBe('nao_identificado')
  })

  it('pega o último (ou o primeiro) toque não direto dentro da janela', () => {
    const contact = at('2026-10-20')
    const touches = [
      { t: { source: 'google', medium: 'organico' }, at: at('2026-10-01') },
      { t: { source: 'facebook', medium: 'cpc', campaign: 'Peças JCB' }, at: at('2026-10-10') },
      { t: { source: 'direto', medium: 'direto' }, at: at('2026-10-19') },
      { t: { source: 'google', medium: 'cpc' }, at: at('2026-08-01') },
    ]
    expect(pickTouch(touches, contact, 'ultimo', 30)?.t.source).toBe('facebook')
    expect(pickTouch(touches, contact, 'primeiro', 30)?.t.medium).toBe('organico')
    // Fora da janela de 7 dias, sobra só o direto.
    expect(pickTouch(touches, contact, 'ultimo', 7)?.t.source).toBe('direto')
  })

  it('clique no anúncio do Google e origem "Google" vêm antes do toque (mesma regra do painel do Google Ads)', () => {
    const touches = [{ t: { source: 'facebook', medium: 'cpc' }, at: at('2026-10-01') }]
    const ads = { adsVia: 'ANUNCIO', adsCampaignId: '123', adsCampaign: 'Filtros', adsTerm: 'filtro jcb' }
    expect(attribute(ads, touches, at('2026-10-02'), 'ultimo', 30)).toMatchObject({ channel: 'google_ads', campaignId: '123', how: 'clique_google' })
    expect(attribute({ ...ads, adsVia: 'ORIGEM' }, touches, at('2026-10-02'), 'ultimo', 30)).toMatchObject({ channel: 'google_ads', how: 'origem_google' })
    expect(attribute({ ...ads, adsVia: null }, touches, at('2026-10-02'), 'ultimo', 30)).toMatchObject({ channel: 'meta_ads', how: 'toque' })
    expect(attribute({ ...ads, adsVia: null }, [], at('2026-10-02'), 'ultimo', 30).channel).toBe('nao_identificado')
  })

  it('chave da campanha', () => {
    expect(campaignKey(GOOGLE('99'))).toBe('google_ads|id:99')
    expect(campaignKey({ channel: 'meta_ads', campaignId: null, campaign: ' Peças JCB ' })).toBe('meta_ads|nome:peças jcb')
    expect(campaignKey(NO_ATTR)).toBe('nao_identificado|-')
  })
})

describe('Marketing: etapas e contagem sem duplicar', () => {
  it('venda implica oportunidade, que implica atendimento', () => {
    expect(stagesOf(row({ id: 'a', saleStatus: 'SIM', imported: true }), 'repasse')).toMatchObject({ attended: true, qualified: true, opportunity: true, sale: true })
    expect(stagesOf(row({ id: 'b', leadStage: 'QUALIFICADO' }), 'estagio')).toMatchObject({ attended: false, qualified: true })
    expect(stagesOf(row({ id: 'c', leadStage: 'QUALIFICADO' }), 'repasse').qualified).toBe(false)
    expect(stagesOf(row({ id: 'd', forwarded: true }), 'estagio_ou_repasse')).toMatchObject({ attended: true, qualified: true, opportunity: false })
  })

  it('a mesma pessoa com dois atendimentos conta como um lead', () => {
    const d: Dataset = {
      rows: [row({ id: 'r1', contactKey: 'L1', leadAt: at('2026-10-02') }), row({ id: 'r2', contactKey: 'L1', leadAt: at('2026-10-09'), forwarded: true }), row({ id: 'r3', contactKey: 'L2' })],
      orders: [],
      costs: [],
    }
    const s = summarizePeriod(d, ctx, OCT)
    expect(s.leads).toBe(2)
    expect(s.attended).toBe(1)
    expect(s.unattended).toBe(1)
  })

  it('venda conta na data da venda, não na data do lead', () => {
    const d: Dataset = { rows: [row({ id: 'r1', leadAt: at('2026-09-20'), saleStatus: 'SIM', saleValue: 1000, saleAt: at('2026-10-03') })], orders: [], costs: [] }
    const s = summarizePeriod(d, ctx, OCT)
    expect(s.leads).toBe(0)
    expect(s.sales).toBe(1)
    expect(s.revenue).toBe(1000)
  })

  it('pedido da loja que é a mesma compra da venda do CRM não conta duas vezes', () => {
    const rows = [row({ id: 'r1', leadId: 'L1', contactKey: 'L1', saleStatus: 'SIM', saleValue: 500, saleAt: at('2026-10-10') })]
    const orders: StoreOrder[] = [
      { id: 'o1', leadId: 'L1', at: at('2026-10-11'), value: 500, recurring: false, state: 'SC', region: 'Sul', attribution: NO_ATTR },
      { id: 'o2', leadId: 'L1', at: at('2026-10-25'), value: 300, recurring: true, state: 'SC', region: 'Sul', attribution: NO_ATTR },
      { id: 'o3', leadId: null, at: at('2026-10-12'), value: 200, recurring: false, state: null, region: null, attribution: NO_ATTR },
    ]
    const kept = dedupeOrders(orders, rows)
    expect(kept.map((o) => o.id)).toEqual(['o2', 'o3'])
    const s = summarizePeriod({ rows, orders: kept, costs: [] }, ctx, OCT)
    expect(s.sales).toBe(3)
    expect(s.revenue).toBe(1000)
  })

  it('conversões da plataforma ficam separadas das vendas do CRM', () => {
    const s = summarizePeriod({ rows: [], orders: [], costs: [cost('2026-10-05', '1', 100)] }, ctx, OCT)
    expect(s.platformConversions).toBe(1)
    expect(s.sales).toBe(0)
  })
})

describe('Marketing: indicadores', () => {
  const d: Dataset = {
    rows: [
      row({ id: 'r1', contactKey: 'A', attribution: GOOGLE('1'), forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 2000, saleAt: at('2026-10-08') }),
      row({ id: 'r2', contactKey: 'B', attribution: GOOGLE('1'), forwarded: true, firstContactAt: at('2026-10-05') }),
      row({ id: 'r3', contactKey: 'C', attribution: GOOGLE('2') }),
      row({ id: 'r4', contactKey: 'D', saleStatus: 'SIM', saleValue: 1000, saleAt: at('2026-10-09'), recurring: true }),
    ],
    orders: [],
    costs: [cost('2026-10-05', '1', 300), cost('2026-10-06', '2', 300)],
  }

  it('CPL, ROAS e CAC usam só os leads e a receita das mídias com custo', () => {
    const v = kpiValues(summarizePeriod(d, ctx, OCT), ctx)
    expect(v.investimento).toBe(600)
    expect(v.leads).toBe(4)
    expect(v.cpl).toBe(200) // 600 / 3 leads do Google Ads
    expect(v.roas).toBe(2000 / 600)
    expect(v.cac).toBe(600) // 1 cliente novo do Google Ads
    expect(v.vendas).toBe(2)
    expect(v.faturamento).toBe(3000)
    expect(v.ticket).toBe(1500)
    expect(v.conversao).toBe(0.5)
    expect(v.roi).toBeNull()
  })

  it('sem mídia conectada, investimento, CPL e ROAS ficam indisponíveis (não zero)', () => {
    const v = kpiValues(summarizePeriod({ ...d, costs: [] }, { ...ctx, costChannels: new Set() }, OCT), { ...ctx, costChannels: new Set() })
    expect(v.investimento).toBeNull()
    expect(v.cpl).toBeNull()
    expect(v.roas).toBeNull()
  })

  it('compara com o período anterior e monta o histórico', () => {
    const prevRow = row({ id: 'p1', contactKey: 'P', leadAt: at('2026-09-10') })
    const { kpis, buckets } = buildKpis({ ...d, rows: [...d.rows, prevRow] }, ctx, OCT, previousPeriod(OCT), 'semana')
    const leads = kpis.find((k) => k.id === 'leads')!
    expect(leads.value).toBe(4)
    expect(leads.previous).toBe(1)
    expect(leads.variation).toBe(3)
    expect(leads.series.length).toBe(buckets.length)
    expect(leads.series.reduce((a, b) => a! + b!, 0)).toBe(4)
  })

  it('quebra por campanha junta custo e leads pela mesma chave; canal sem custo não mostra R$ 0', () => {
    const byCampaign = breakdown(d, ctx, OCT, (r) => campaignKey(r.attribution), (o) => campaignKey(o.attribution), (c) => `${c.channel}|id:${c.campaignId}`, (k) => k.startsWith('google_ads'))
    const c1 = byCampaign.find((r) => r.key === 'google_ads|id:1')!
    expect(c1).toMatchObject({ leads: 2, sales: 1, revenue: 2000, cost: 300, cpl: 150 })
    expect(byCampaign.find((r) => r.key === 'nao_identificado|-')!.cost).toBeNull()
  })

  it('filtros: investimento só acompanha canal e campanha; filtros do CRM tiram a loja', () => {
    expect(costFollowsFilters({ channel: 'google_ads' })).toBe(true)
    expect(costFollowsFilters({ seller: 'x' })).toBe(false)
    const o: StoreOrder = { id: 'o', leadId: null, at: at('2026-10-02'), value: 1, recurring: false, state: 'SC', region: 'Sul', attribution: NO_ATTR }
    expect(filterOrders([o], { brand: 'b' })).toEqual([])
    expect(filterOrders([o], { state: 'SC' })).toHaveLength(1)
    expect(filterRows(d.rows, { channel: 'google_ads', campaign: 'google_ads|id:1' }).map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(filterRows(d.rows, { client: 'recorrente' }).map((r) => r.id)).toEqual(['r4'])
  })
})

describe('Marketing: funil, tempos e pontos de atenção', () => {
  it('funil encaixado com passagem e maior perda', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row({ id: `n${i}` })),
      ...Array.from({ length: 10 }, (_, i) => row({ id: `f${i}`, forwarded: true, firstContactAt: at('2026-10-05') })),
      row({ id: 's', forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 100, saleAt: at('2026-10-06') }),
    ]
    const stages = funnel(summarizePeriod({ rows, orders: [], costs: [] }, ctx, OCT), false)
    expect(stages.map((s) => s.value)).toEqual([31, 11, 11, 1, 1, 100])
    expect(stages[1]!.passRate).toBeCloseTo(11 / 31)
    expect(biggestDrop(stages)?.id).toBe('oportunidades')
    expect(stages.some((s) => s.id === 'impressoes')).toBe(false)
  })

  it('tempo até o primeiro atendimento ignora importados e mostra quantos faltam', () => {
    const rows = [
      row({ id: 'a', leadAt: at('2026-10-05'), firstContactAt: new Date(at('2026-10-05').getTime() + 2 * 3_600_000) }),
      row({ id: 'b', leadAt: at('2026-10-05'), firstContactAt: new Date(at('2026-10-05').getTime() + 4 * 3_600_000) }),
      row({ id: 'c', imported: true }),
    ]
    const t = timings(rows, OCT)
    expect(t.firstContact).toMatchObject({ avgHours: 3, medianHours: 3, n: 2, missing: 1 })
  })

  it('não emite alerta de taxa com amostra pequena, e diz isso', () => {
    const s = summarizePeriod({ rows: [row({ id: 'a' })], orders: [], costs: [] }, ctx, OCT)
    const pts = attentionPoints(s, s, ctx, { campaignsWithoutLeads: [], identifiedShare: 0, costStaleHours: null })
    expect(pts.map((p) => p.title)).toEqual(['Amostra pequena'])
  })

  it('aponta leads sem atendimento e campanha que gasta sem gerar lead, com os números', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ id: `x${i}`, forwarded: i < 18 }))
    const s = summarizePeriod({ rows, orders: [], costs: [] }, ctx, OCT)
    const pts = attentionPoints(s, s, ctx, { campaignsWithoutLeads: [{ name: 'Material rodante', cost: 450 }], identifiedShare: 0.9, costStaleHours: 72 })
    expect(pts.find((p) => p.title === 'Leads sem atendimento')?.evidence).toContain('12 de 30')
    expect(pts.find((p) => p.title === 'Campanha com investimento e sem leads')?.evidence).toContain('Material rodante')
    expect(pts.some((p) => p.title === 'Investimento desatualizado')).toBe(true)
  })
})

describe('Marketing: filtros da URL', () => {
  it('aceita só valores no formato esperado', () => {
    expect(parseFilters({ canal: 'google_ads', uf: 'SC', status: 'SIM', cliente: 'novo', vendedor: 'x' })).toEqual({ channel: 'google_ads', state: 'SC', status: 'SIM', client: 'novo' })
    expect(parseFilters({ canal: 'drop table', uf: 'santa catarina', campanha: 'google_ads|id:123' })).toEqual({ campaign: 'google_ads|id:123' })
  })
})
