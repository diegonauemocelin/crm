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

describe('gatilho: resultado do atendimento', () => {
  it('valida a configuração e dispara só para o resultado, o motivo e o tipo escolhidos', async () => {
    const { cleanTrigger, eventMatches } = await import('../src/automacoes/fluxo')
    const motivo = '11111111-1111-4111-8111-111111111111'
    const r = cleanTrigger({ type: 'resultado_atendimento', result: 'perda', lostReasonId: motivo, serviceKind: 'PRE_VENDAS' })
    expect(r).toEqual({ trigger: { type: 'resultado_atendimento', result: 'perda', lostReasonId: motivo, serviceKind: 'PRE_VENDAS' } })
    const t = (r as { trigger: Parameters<typeof eventMatches>[0] }).trigger
    const ev = (data: Record<string, unknown>) => ({ type: 'resultado_atendimento', title: 'x', data })
    expect(eventMatches(t, ev({ resultado: 'perda', motivoId: motivo, tipo: 'PRE_VENDAS' }))).toBe(true)
    expect(eventMatches(t, ev({ resultado: 'perda', motivoId: 'outro', tipo: 'PRE_VENDAS' }))).toBe(false)
    expect(eventMatches(t, ev({ resultado: 'venda', motivoId: null, tipo: 'PRE_VENDAS' }))).toBe(false)
    expect(eventMatches(t, ev({ resultado: 'perda', motivoId: motivo, tipo: 'POS_VENDAS' }))).toBe(false)
    // Venda não tem motivo; "qualquer" aceita os dois resultados.
    expect((cleanTrigger({ type: 'resultado_atendimento', result: 'venda', lostReasonId: motivo }) as { trigger: { lostReasonId: unknown } }).trigger.lostReasonId).toBeNull()
    const any = (cleanTrigger({ type: 'resultado_atendimento' }) as { trigger: Parameters<typeof eventMatches>[0] }).trigger
    expect(eventMatches(any, ev({ resultado: 'venda', tipo: 'POS_VENDAS' }))).toBe(true)
    expect(eventMatches(any, { type: 'atendimento', title: 'x', data: {} })).toBe(false)
  })
})

describe('automação com WhatsApp e produtos vistos', () => {
  it('passo "Enviar WhatsApp": mensagem obrigatória, número opcional, abrir pré-venda', async () => {
    const { cleanSteps } = await import('../src/automacoes/fluxo')
    expect(cleanSteps([{ id: 'w', type: 'enviar_whatsapp', text: '  ' }])).toEqual({ error: 'Escreva a mensagem do passo "Enviar WhatsApp".' })
    expect(cleanSteps([{ id: 'w', type: 'enviar_whatsapp', text: 'Oi {nome}', numberId: 'x', openRecord: true }])).toEqual({ steps: [{ id: 'w', type: 'enviar_whatsapp', numberId: null, text: 'Oi {nome}', openRecord: true }] })
  })

  it('gatilho "Viu produtos da loja": só visita a página de produto, com filtro pelo nome', async () => {
    const { eventMatches } = await import('../src/automacoes/fluxo')
    const visit = (produto?: string) => ({ type: 'visita', title: 'Visitou o site', data: { pagina: 'https://loja.com/p/filtro', ...(produto ? { produto } : {}) } })
    expect(eventMatches({ type: 'produto_visto' }, visit('Filtro hidráulico 320D'))).toBe(true)
    expect(eventMatches({ type: 'produto_visto' }, visit())).toBe(false)
    expect(eventMatches({ type: 'produto_visto', text: 'filtro' }, visit('Filtro hidráulico 320D'))).toBe(true)
    expect(eventMatches({ type: 'produto_visto', text: 'bomba' }, visit('Filtro hidráulico 320D'))).toBe(false)
    // O gatilho de visita continua igual.
    expect(eventMatches({ type: 'visita' }, visit())).toBe(true)
  })

  it('mensagem com {nome} e {produto}', async () => {
    const { fillWhatsapp } = await import('../src/automacoes/fluxo')
    expect(fillWhatsapp('Oi {nome}, vi que você olhou {produto}. Posso ajudar?', { name: 'Maria Souza', product: 'Filtro 1R-0750' })).toBe('Oi Maria, vi que você olhou Filtro 1R-0750. Posso ajudar?')
    expect(fillWhatsapp('Oi {nome}, {produto}!', { name: null, product: null })).toBe('Oi, o produto!')
  })
})
