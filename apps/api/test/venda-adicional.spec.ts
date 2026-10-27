import { describe, expect, it } from 'vitest'
import type { AiResult, AssistContext } from '../src/assistente/ia'
import { addComplements, modelTokens, productKey, titleComplements } from '../src/assistente/venda-adicional'

const row = (id: string, title: string, o: { status?: string; qty?: number; sku?: string } = {}) => ({ id, title, status: o.status ?? 'active', availableQuantity: o.qty ?? 5, sellerSku: o.sku ?? null, partNumber: null, attributes: [] })
const rows = [
  row('MLB1', 'Filtro De Ar Primário Jcb Js200 Js220 32/925682', { sku: '32/925682' }),
  row('MLB2', 'Filtro De Óleo Motor Jcb Js200'),
  row('MLB3', 'Filtro De Ar Secundário Jcb Js200 Js220'),
  row('MLB4', 'Filtro De Ar Primário Fleetguard Jcb Js200'),
  row('MLB5', 'Filtro Hidráulico Retorno Jcb Js200', { status: 'paused' }),
  row('MLB6', 'Filtro De Ar Primário Jcb 3cx'),
  row('MLB7', 'Filtro Combustível Jcb Js200', { qty: 0 }),
]
const store = new Set(rows.map((r) => r.id))

describe('venda adicional nas respostas do Mercado Livre', () => {
  it('reconhece modelo de máquina e tipo do produto pelo título', () => {
    expect(modelTokens('Filtro De Ar Primário Jcb Js200 Js220 32/925682 10mm')).toEqual(['js200', 'js220'])
    expect(productKey('Filtro De Ar Primário Jcb Js200')).toEqual(['filtro', 'ar', 'primario'])
    expect(productKey('Kit Filtro De Óleo Motor Komatsu PC200')).toEqual(['filtro', 'oleo', 'motor'])
  })

  it('pediu filtro de ar primário da JS200: indica secundário, óleo e combustível, sem repetir o mesmo produto', () => {
    const out = titleComplements('tem pronta entrega?', rows[0]!, rows, store, new Set())
    expect(out.map((c) => c.id)).toEqual(['MLB3', 'MLB2', 'MLB7'])
    expect(out[0]!.aplicacao_confirmada).toBe('JS200, JS220 (conforme o título do anúncio)')
  })

  it('modelo citado na pergunta vale mais que o do anúncio; sem modelo não indica nada', () => {
    expect(titleComplements('serve na 3cx?', rows[2]!, rows, store, new Set()).map((c) => c.id)).toEqual(['MLB6'])
    expect(titleComplements('tem?', row('X', 'Filtro De Ar Universal'), rows, store, new Set())).toEqual([])
  })

  const ctx = (ids: string[]) =>
    ({ anuncios_complementares: ids.map((id) => ({ id, titulo: `Produto ${id}`, codigo: '', sistema: null, aplicacao_confirmada: 'JS200' })), anuncios_com_link_permitido: ids }) as unknown as AssistContext
  const res = (o: Partial<AiResult>) => ({ decision: 'responder', answer: 'Bom dia!\nTemos sim: {{LINK:MLB1}}', complementary_item_ids: [], ...o }) as AiResult

  it('acrescenta até o máximo configurado e conta o que a IA já ofereceu', () => {
    const s = { upsell_enabled: true, max_complementary: 2, max_answer_chars: 1200 }
    const r = addComplements(res({}), ctx(['MLB3', 'MLB2', 'MLB7']), s)
    expect(r.answer).toContain('Aproveite e confira também, para a mesma máquina:\n• Produto MLB3: {{LINK:MLB3}}\n• Produto MLB2: {{LINK:MLB2}}')
    expect(r.complementary_item_ids).toEqual(['MLB3', 'MLB2'])
    const ai = addComplements(res({ answer: 'Olá!\nTemos sim. Leve também o secundário: {{LINK:MLB3}}' }), ctx(['MLB3', 'MLB2', 'MLB7']), s)
    expect(ai.complementary_item_ids).toEqual(['MLB3', 'MLB2'])
    expect(ai.answer.match(/LINK:MLB3/g)).toHaveLength(1)
  })

  it('não indica quando está desligado, ao pedir dados ou quando não cabe na resposta', () => {
    const c = ctx(['MLB3'])
    expect(addComplements(res({}), c, { upsell_enabled: false, max_complementary: 2, max_answer_chars: 1200 }).answer).not.toContain('Aproveite')
    expect(addComplements(res({ decision: 'solicitar_info' }), c, { upsell_enabled: true, max_complementary: 2, max_answer_chars: 1200 }).answer).not.toContain('Aproveite')
    expect(addComplements(res({}), c, { upsell_enabled: true, max_complementary: 2, max_answer_chars: 120 }).answer).not.toContain('Aproveite')
  })
})
