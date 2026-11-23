import { describe, expect, it } from 'vitest'
import { bestCampaign, campaignApplies, campaignLabel, campaignPrice, cleanCampaigns, type FreightCampaign } from '../src/fretes/campanhas'

const base: FreightCampaign = { id: '11111111-1111-1111-1111-111111111111', name: 'SC grátis', active: true, mode: 'GRATIS', value: 0, carrierIds: [], ufs: ['SC'], cities: [], minCargoValue: null, tableAbove: null, startsOn: null, endsOn: null }
const t = { carrierId: 'c1', destUf: 'SC', destCity: 'Maravilha', cargoValue: 2000, date: '2026-11-11' }

describe('campanhas de frete', () => {
  it('limpa o que vem da tela', () => {
    let i = 0
    const r = cleanCampaigns([{ name: ' 3% NF ', mode: 'PERCENT_NF', value: '3,5', ufs: ['sc', 'XX1'], minCargoValue: '0' }, { name: '', mode: 'GRATIS' }, { name: 'x', mode: 'OUTRO' }], () => `00000000-0000-0000-0000-00000000000${++i}`)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: '3% NF', mode: 'PERCENT_NF', value: 3.5, ufs: ['SC'], minCargoValue: null, active: true })
  })
  it('vale por UF, cidade, transportadora, valor mínimo e vigência', () => {
    expect(campaignApplies(base, t)).toBe(true)
    expect(campaignApplies(base, { ...t, destUf: 'PR' })).toBe(false)
    expect(campaignApplies({ ...base, cities: ['Maravilha/SC'] }, { ...t, destCity: 'MARAVILHA' })).toBe(true)
    expect(campaignApplies({ ...base, cities: ['Chapecó/SC'] }, t)).toBe(false)
    expect(campaignApplies({ ...base, carrierIds: ['c2'] }, t)).toBe(false)
    expect(campaignApplies({ ...base, minCargoValue: 3000 }, t)).toBe(false)
    expect(campaignApplies({ ...base, endsOn: '2026-11-10' }, t)).toBe(false)
    expect(campaignApplies({ ...base, active: false }, t)).toBe(false)
  })
  it('preço: % da nota, desconto na tabela e grátis (nunca acima da tabela)', () => {
    expect(campaignPrice({ ...base, mode: 'PERCENT_NF', value: 3 }, 150, 2000)).toBe(60)
    expect(campaignPrice({ ...base, mode: 'PERCENT_NF', value: 10 }, 150, 2000)).toBe(150)
    expect(campaignPrice({ ...base, mode: 'DESCONTO', value: 20 }, 150, 2000)).toBe(120)
    expect(campaignPrice(base, 150, 2000)).toBe(0)
  })
  it('escolhe a melhor para o cliente', () => {
    const r = bestCampaign([{ ...base, mode: 'DESCONTO', value: 10, name: 'A' }, { ...base, mode: 'PERCENT_NF', value: 2, name: 'B' }], t, 150)
    expect(r).toMatchObject({ name: 'B', customerPrice: 40, discount: 110, label: '2% da nota' })
    expect(bestCampaign([], t, 150)).toBeNull()
  })
})

describe('campanha só quando o frete da tabela passa de um valor', () => {
  const z: FreightCampaign = { ...base, name: 'Zanotelli SP', mode: 'PERCENT_NF_ACIMA', value: 3, ufs: ['SP'], tableAbove: 150 }
  const sp = { ...t, destUf: 'SP', destCity: 'Guarulhos' }
  it('% da nota comum continua valendo sempre', () => {
    expect(bestCampaign([{ ...z, mode: 'PERCENT_NF', tableAbove: null }], { ...sp, cargoValue: 790 }, 150)?.customerPrice).toBe(23.7)
  })
  it('tabela até R$ 150: vale a tabela (sem campanha)', () => {
    expect(bestCampaign([z], { ...sp, cargoValue: 790 }, 150)).toBeNull()
  })
  it('tabela acima de R$ 150: cobra só os 3% da nota', () => {
    expect(bestCampaign([z], { ...sp, cargoValue: 4_000 }, 200)?.customerPrice).toBe(120)
    expect(bestCampaign([z], { ...sp, cargoValue: 10_000 }, 500)?.customerPrice).toBe(300)
  })
  it('guarda o limite e mostra no rótulo', () => {
    const [x, y] = cleanCampaigns([{ name: 'Zanotelli SP', mode: 'PERCENT_NF_ACIMA', value: 3, tableAbove: '150,00' }, { name: 'Simples', mode: 'PERCENT_NF', value: 3, tableAbove: 150 }], () => '00000000-0000-0000-0000-000000000000')
    expect(x!.tableAbove).toBe(150)
    expect(y!.tableAbove).toBeNull()
    expect(campaignLabel(x!)).toBe('3% da nota (frete acima de R$\u00a0150,00)')
  })
})

describe('repasse da transportadora (a empresa não banca)', () => {
  const r: FreightCampaign = { ...base, name: 'Repasse Chapecó', mode: 'REPASSE', value: 4, ufs: ['SC'], cities: ['Chapecó/SC'] }
  it('cobra o % da nota mesmo acima da tabela, sem diferença paga pela empresa', () => {
    const x = bestCampaign([r], { ...t, destCity: 'Chapeco', cargoValue: 5_000 }, 150)
    expect(x).toMatchObject({ customerPrice: 200, discount: 0, label: '4% da nota (repasse da transportadora)' })
  })
  it('só na cidade escolhida', () => {
    expect(bestCampaign([r], { ...t, destCity: 'Maravilha', cargoValue: 5_000 }, 150)).toBeNull()
  })
})

describe('acréscimo na tabela (reajuste)', () => {
  const up: FreightCampaign = { ...base, name: 'Reajuste dezembro', mode: 'ACRESCIMO', value: 10, ufs: [], carrierIds: ['c1'], startsOn: '2026-12-01', endsOn: '2026-12-31' }
  const dez = { ...t, date: '2026-12-10' }
  it('cobra a tabela + o % só no período e na transportadora escolhida', () => {
    expect(bestCampaign([up], dez, 200)).toMatchObject({ customerPrice: 220, discount: 0, label: 'acréscimo de 10% na tabela' })
    expect(bestCampaign([up], t, 200)).toBeNull()
    expect(bestCampaign([up], { ...dez, carrierId: 'c2' }, 200)).toBeNull()
  })
  it('promoção vale antes do acréscimo; entre acréscimos, o maior', () => {
    expect(bestCampaign([up, { ...base, mode: 'DESCONTO', value: 5, name: 'Promo' }], dez, 200)).toMatchObject({ name: 'Promo', customerPrice: 190 })
    expect(bestCampaign([up, { ...up, name: 'Geral', value: 15, carrierIds: [] }], dez, 200)).toMatchObject({ name: 'Geral', customerPrice: 230 })
  })
  it('a tela aceita o novo tipo', () => {
    expect(cleanCampaigns([{ name: 'Reajuste', mode: 'ACRESCIMO', value: '12,5' }], () => '00000000-0000-0000-0000-000000000001')[0]).toMatchObject({ mode: 'ACRESCIMO', value: 12.5 })
  })
})
