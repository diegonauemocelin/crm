import { describe, expect, it } from 'vitest'
import { aiPrompt, cleanConfig, DEFAULT_CONFIG, readingFromAi } from '../src/mercado/mercado'

describe('análise de mercado (fora dos marketplaces)', () => {
  it('limpa a configuração (concorrentes por linha, vírgula ou ponto e vírgula, sem repetir)', () => {
    const c = cleanConfig({ segment: '  Peças   para linha amarela ', competitors: 'Loja A\nLoja B; Loja A, https://c.com.br' })
    expect(c.segment).toBe('Peças para linha amarela')
    expect(c.competitors).toEqual(['Loja A', 'Loja B', 'https://c.com.br'])
    expect(cleanConfig({}, c)).toEqual(c)
  })

  it('o pedido leva só agregados e as regras de não inventar', () => {
    const p = aiPrompt({ periodDays: 90, channels: [{ canal: 'Loja virtual', pedidos: 10, faturamento: 5000 }], leads: 40, leadStates: [{ uf: 'SC', leads: 12 }], topBrands: [], topProducts: [] }, { ...DEFAULT_CONFIG, company: 'Empresa X', segment: 'peças' }, '23/11/2026')
    expect(p).toContain('"leads_no_periodo":40')
    expect(p).toContain('Não invente')
    expect(p).toContain('FORA dos marketplaces')
  })

  it('lê a resposta da IA (bloco de código) e descarta site inválido', () => {
    const r = readingFromAi('```json\n{"resumo":"Mercado aquecido.","produtos":[{"titulo":"Filtros","detalhe":"Alta procura."}],"concorrentes":[{"nome":"Conc A","site":"https://a.com.br","detalhe":"Loja virtual."},{"nome":"Conc B","site":"nao achei","detalhe":""}],"canais":[{"canal":"WhatsApp","detalhe":"Forte."}],"melhorar":[{"titulo":"Títulos","detalhe":"x"}],"atencao":[],"oportunidades":[]}\n```')
    expect(r?.resumo).toBe('Mercado aquecido.')
    expect(r?.concorrentes).toEqual([
      { nome: 'Conc A', site: 'https://a.com.br', detalhe: 'Loja virtual.' },
      { nome: 'Conc B', site: null, detalhe: '' },
    ])
    expect(r?.canais[0]).toEqual({ canal: 'WhatsApp', detalhe: 'Forte.' })
    expect(readingFromAi('sem json')).toBeNull()
  })
})
