import { describe, expect, it } from 'vitest'
import { bestCampaign, campaignApplies, campaignPrice, cleanCampaigns, type FreightCampaign } from '../src/fretes/campanhas'

const base: FreightCampaign = { id: '11111111-1111-1111-1111-111111111111', name: 'SC grátis', active: true, mode: 'GRATIS', value: 0, carrierIds: [], ufs: ['SC'], cities: [], minCargoValue: null, startsOn: null, endsOn: null }
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
