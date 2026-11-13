import { describe, expect, it } from 'vitest'
import { buildLossPayload, type LossInput, lossAiCost, lossAiWhatsapp, restoreLossReport, scrubNotes } from '../src/atendimento/perdas-ia'

const loss = (o: Partial<LossInput> = {}): LossInput => ({
  id: 'r1',
  client: 'Leonardo Compras RJ Vale',
  person: 'Fabíola Renner',
  stage: 'pre_venda',
  reason: 'Sem produto disponível',
  notes: 'kit reparo 12727744 Entrou pelo WhatsApp. Cliente (49) 98863-2548, joao@x.com.br',
  brands: ['Volvo'],
  partTypes: ['Vedações'],
  origin: 'WhatsApp',
  date: '2026-11-13',
  ...o,
})

describe('análise das perdas com IA', () => {
  it('tira telefone, e-mail, CNPJ e link, mas mantém os códigos de peça', () => {
    const t = scrubNotes('cod 1234-5678 e 12727744, fone (47) 99999-8888 ou +55 47 3333-4444, 99876-1234, cnpj 12.345.678/0001-90, site https://x.com/a, a@b.com')
    expect(t).toContain('1234-5678')
    expect(t).toContain('12727744')
    expect(t).not.toMatch(/99999-8888|3333-4444|99876-1234|0001-90|https|a@b/)
    expect(t).toContain('[telefone]')
  })

  it('manda só códigos (C1, V1) para a IA e devolve os nomes no CRM', () => {
    const p = buildLossPayload([loss(), loss({ id: 'r2', client: 'Maria Obras', person: 'Fabíola Renner' }), loss({ id: 'r3', client: 'Zé', person: 'Alana', stage: 'vendedor' })])
    expect(p.content).not.toContain('Leonardo')
    expect(p.content).not.toContain('Fabíola')
    expect(p.content).not.toContain('98863')
    expect(p.content).toContain('12727744')
    expect(Object.keys(p.people)).toEqual(['V1', 'V2'])
    const r = restoreLossReport(
      {
        resumo: 'C1 e C2 perderam por falta de estoque; V1 registrou bem.',
        causas: [{ causa: 'Sem estoque', quantidade: 2, refs: ['C1', 'C2', 'C99'] }],
        codigos_mais_pedidos: [{ codigo: '12727744', peca: 'kit reparo', quantidade: 2, refs: ['C1', 'C2'] }],
        decisoes: [{ acao: 'Comprar o kit 12727744', prioridade: 'urgente', porque: 'Pedido por C1 e C2' }],
        por_atendente: [{ ref: 'V1', comentario: 'Perdas por estoque' }, { ref: 'V9', comentario: 'x' }],
        registro: '',
        itens: [{ ref: 'C1', codigos: ['12727744'], pecas: ['kit reparo'], resposta: 'sem estoque', causa: 'estoque', acao: 'comprar' }],
      },
      p,
    )
    expect(r.summary).toBe('Leonardo Compras RJ Vale e Maria Obras perderam por falta de estoque; Fabíola Renner registrou bem.')
    expect(r.causes[0]!.clients).toEqual(['Leonardo Compras RJ Vale', 'Maria Obras'])
    expect(r.decisions[0]!.priority).toBe('media')
    expect(r.people).toEqual([{ person: 'Fabíola Renner', comment: 'Perdas por estoque' }])
    expect(r.items).toHaveLength(3)
    expect(r.items[0]).toMatchObject({ client: 'Leonardo Compras RJ Vale', person: 'Fabíola Renner', codes: ['12727744'], answer: 'sem estoque' })
    // A perda que a IA pulou continua na lista, sem análise.
    expect(r.items[2]).toMatchObject({ client: 'Zé', stage: 'vendedor', codes: [], cause: '' })
    const msg = lossAiWhatsapp(r, 3)
    expect(msg).toContain('Análise das perdas com IA (3 perda(s))')
    expect(msg).toContain('• 12727744 · kit reparo (2x)')
    expect(msg).toContain('🟡 Comprar o kit 12727744')
  })

  it('custo aproximado pelo preço do modelo', () => {
    expect(lossAiCost('claude-opus-5-5', 50_000, 20_000)).toBe(0.6)
    expect(lossAiCost('claude-haiku-5-5', 50_000, 20_000)).toBe(0.02)
  })
})
