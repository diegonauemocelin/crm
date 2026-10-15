import { describe, expect, it } from 'vitest'
import { cleanQuery, cleanViews, readViews } from '../src/auth/visoes'

describe('Visões salvas', () => {
  it('guarda só os filtros: tira página, aba e parâmetros estranhos', () => {
    expect(cleanQuery('?stage=LEAD&page=3&aba=lista&state=PR&<x>=1&vazio=')).toBe('stage=LEAD&state=PR')
  })

  it('confere nome, repetição e limite', () => {
    const ok = cleanViews([{ name: '  Paraná   Hyundai ', query: 'state=PR' }, { id: 'meus', name: 'Meus', query: 'ownerId=abc' }])
    expect('views' in ok && ok.views).toEqual([
      { id: 'v0-paran-hyundai', name: 'Paraná Hyundai', query: 'state=PR' },
      { id: 'meus', name: 'Meus', query: 'ownerId=abc' },
    ])
    expect(cleanViews([{ name: 'A' }, { name: 'a' }])).toEqual({ error: 'Já existe uma visão chamada "a".' })
    expect(cleanViews([{ name: '' }])).toHaveProperty('error')
    expect(cleanViews(Array.from({ length: 21 }, (_, i) => ({ name: `V${i}` })))).toHaveProperty('error')
    expect(cleanViews('x')).toHaveProperty('error')
  })

  it('lê o que está gravado sem confiar no formato', () => {
    expect(readViews(null, 'leads')).toEqual([])
    expect(readViews({ leads: 'x' }, 'leads')).toEqual([])
    expect(readViews({ leads: [{ id: 'a', name: 'A', query: 'stage=LEAD' }] }, 'leads')).toEqual([{ id: 'a', name: 'A', query: 'stage=LEAD' }])
    expect(readViews({ leads: [{ id: 'a', name: 'A', query: '' }] }, 'pre-vendas')).toEqual([])
  })
})
