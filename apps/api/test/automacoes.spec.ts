import { describe, expect, it } from 'vitest'
import { allSteps, branchStart, cleanSteps, cleanTrigger, compile, eventMatches, fillMessage, type Step, waitMs } from '../src/automacoes/fluxo'

const T = '11111111-1111-4111-8111-111111111111'

const steps = (raw: unknown[]) => {
  const r = cleanSteps(raw)
  if ('error' in r) throw new Error(r.error)
  return r.steps
}

describe('gatilhos', () => {
  it('confere tipo e configuração', () => {
    expect(cleanTrigger({ type: 'x' })).toMatchObject({ error: expect.any(String) })
    expect(cleanTrigger({ type: 'inatividade', days: 0 })).toMatchObject({ error: expect.stringMatching(/dias/) })
    expect(cleanTrigger({ type: 'inatividade', days: 30, kind: 'interacao' })).toEqual({ trigger: { type: 'inatividade', days: 30, kind: 'interacao' } })
    expect(cleanTrigger({ type: 'etapa', stage: 'CLIENTE', lixo: 1 })).toEqual({ trigger: { type: 'etapa', stage: 'CLIENTE' } })
    expect(cleanTrigger({ type: 'lead_novo', originId: 'abc' })).toEqual({ trigger: { type: 'lead_novo', originId: null, includeImported: false } })
  })

  it('evento do histórico dispara só o gatilho certo', () => {
    expect(eventMatches({ type: 'carrinho_abandonado' }, { type: 'carrinho_abandonado', title: '', data: null })).toBe(true)
    expect(eventMatches({ type: 'carrinho_abandonado' }, { type: 'checkout', title: '', data: null })).toBe(false)
    expect(eventMatches({ type: 'compra' }, { type: 'compra_site', title: '', data: null })).toBe(true)
    expect(eventMatches({ type: 'formulario', text: 'jcb' }, { type: 'conversao', title: 'Formulário LP JCB', data: null })).toBe(true)
    expect(eventMatches({ type: 'formulario', text: 'case' }, { type: 'conversao', title: 'Formulário LP JCB', data: null })).toBe(false)
    expect(eventMatches({ type: 'visita', text: '/peças' }, { type: 'visita', title: '', data: { pagina: 'https://x.com/peças/filtro' } })).toBe(true)
    expect(eventMatches({ type: 'email_clicado', campaignId: T }, { type: 'email_clique', title: '', data: { campanha: 'outra' } })).toBe(false)
  })
})

describe('passos', () => {
  it('recusa passo incompleto, id repetido e tipo desconhecido', () => {
    expect(cleanSteps([{ id: 'a', type: 'enviar_email' }])).toMatchObject({ error: expect.stringMatching(/modelo/) })
    expect(cleanSteps([{ id: 'a', type: 'encerrar' }, { id: 'a', type: 'encerrar' }])).toMatchObject({ error: expect.stringMatching(/repetido/) })
    expect(cleanSteps([{ id: 'a', type: 'esperar', amount: 2000, unit: 'minutos' }])).toMatchObject({ error: expect.stringMatching(/Espera/) })
    expect(cleanSteps([{ id: 'a', type: 'condicao', rules: [] }])).toMatchObject({ error: expect.stringMatching(/regra/) })
    expect(cleanSteps([{ id: 'a', type: 'apagar_tudo' }])).toMatchObject({ error: expect.stringMatching(/desconhecido/) })
    expect(cleanSteps([{ id: '<script>', type: 'encerrar' }])).toMatchObject({ error: expect.any(String) })
  })

  it('"abriu o e-mail deste fluxo" não pede dias; "qualquer e-mail" pede', () => {
    expect(steps([{ id: 'c', type: 'condicao', rules: [{ type: 'abriu_email', scope: 'ultimo' }], yes: [], no: [] }])[0]).toMatchObject({ rules: [{ type: 'abriu_email', scope: 'ultimo' }] })
    expect(cleanSteps([{ id: 'c', type: 'condicao', rules: [{ type: 'clicou_email', scope: 'qualquer' }], yes: [], no: [] }])).toMatchObject({ error: expect.stringMatching(/dias/) })
  })

  it('limpa tags e regras', () => {
    const [a, c] = steps([
      { id: 'a', type: 'adicionar_tag', tags: [' Promo ', 'promo', ''] },
      { id: 'c', type: 'condicao', match: 'qualquer', rules: [{ type: 'sem_visita', days: 15 }, { type: 'tem_tag', tag: 'VIP', negate: true }], yes: [], no: [] },
    ])
    expect(a).toEqual({ id: 'a', type: 'adicionar_tag', tags: ['promo'] })
    expect(c).toMatchObject({ match: 'qualquer', rules: [{ type: 'sem_visita', days: 15, negate: false }, { type: 'tem_tag', tag: 'vip', negate: true }] })
  })

  it('mapa do fluxo: depois de um caminho Sim/Não volta para depois da condição', () => {
    const s: Step[] = steps([
      { id: 'w', type: 'esperar', amount: 1, unit: 'dias' },
      {
        id: 'c',
        type: 'condicao',
        rules: [{ type: 'carrinho_abandonado', days: 7 }],
        yes: [{ id: 'e1', type: 'enviar_email', templateId: T }, { id: 't1', type: 'adicionar_tag', tags: ['recuperar'] }],
        no: [],
      },
      { id: 'fim', type: 'notificar', userIds: [T], message: '' },
    ])
    const map = compile(s)
    expect(map.get('w')!.next).toBe('c')
    expect(branchStart(map.get('c')!, true)).toBe('e1')
    expect(map.get('e1')!.next).toBe('t1')
    expect(map.get('t1')!.next).toBe('fim')
    // Caminho "Não" vazio: segue direto para depois da condição.
    expect(branchStart(map.get('c')!, false)).toBe('fim')
    expect(map.get('fim')!.next).toBeNull()
    expect(allSteps(s).map((x) => x.id)).toEqual(['w', 'c', 'e1', 't1', 'fim'])
  })

  it('tempo das esperas', () => {
    expect(waitMs({ amount: 2, unit: 'horas' })).toBe(7_200_000)
    expect(waitMs({ amount: 3, unit: 'dias' })).toBe(259_200_000)
  })

  it('mensagem do aviso para a equipe', () => {
    expect(fillMessage('Ligar para {nome} ({telefone}): {link}', { name: 'Ana', email: null, phone: '49 9999', link: 'https://crm/l/1', automation: 'X' })).toBe('Ligar para Ana (49 9999): https://crm/l/1')
    expect(fillMessage('', { name: null, email: null, phone: null, link: '', automation: 'Carrinho' })).toContain('"Carrinho"')
  })
})
