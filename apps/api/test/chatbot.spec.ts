import { describe, expect, it } from 'vitest'
import { answersNote, continueFlow, type Flow, menuText, pickOption, startFlow, validateFlow } from '../src/whatsapp/fluxo'

const flow: Flow = {
  startStepId: 'boas',
  steps: [
    { id: 'boas', type: 'mensagem', text: 'Olá, {nome}! Bem-vindo à Usaparts.', go: { next: 'menu' } },
    {
      id: 'menu',
      type: 'menu',
      text: 'Como podemos ajudar?',
      options: [
        { label: 'Comprar peças', next: 'maquina' },
        { label: 'Falar com o Financeiro', sectorId: 'fin' },
        { label: 'Garantia', next: 'garantia' },
      ],
    },
    { id: 'maquina', type: 'pergunta', text: 'Qual a marca e o modelo da máquina?', label: 'Máquina', go: { next: 'vendas' } },
    { id: 'vendas', type: 'transferir', text: 'Obrigado! Um vendedor já vai te atender.', go: { sectorId: 'ven' } },
    { id: 'garantia', type: 'encerrar', text: 'Para garantia, envie fotos da peça e a nota fiscal. Um atendente responde em breve.' },
  ],
}

describe('chatbot de atendimento', () => {
  it('começa: boas-vindas com o nome e o menu numerado, esperando a resposta', () => {
    const r = startFlow(flow, 'João da Silva')
    expect(r.messages).toEqual(['Olá, João! Bem-vindo à Usaparts.', 'Como podemos ajudar?\n\n*1.* Comprar peças\n*2.* Falar com o Financeiro\n*3.* Garantia'])
    expect(r.state).toEqual({ stepId: 'menu', tries: 0, answers: [] })
  })

  it('escolhe pelo número ou pelo texto da opção', () => {
    const menu = flow.steps[1]!
    expect(pickOption(menu, '2')).toBe(1)
    expect(pickOption(menu, ' opção 3 ')).toBe(2)
    expect(pickOption(menu, 'financeiro')).toBe(1)
    expect(pickOption(menu, 'Comprar peças')).toBe(0)
    expect(pickOption(menu, '9')).toBeNull()
    expect(pickOption(menu, 'oi')).toBeNull()
  })

  it('opção que transfere direto para um setor', () => {
    const r = continueFlow(flow, { stepId: 'menu', tries: 0, answers: [] }, '2', 'João')
    expect(r).toMatchObject({ messages: [], state: null, transfer: { sectorId: 'fin', userId: null }, ended: 'transferido' })
  })

  it('pergunta guarda a resposta e segue até transferir para Vendas', () => {
    const a = continueFlow(flow, { stepId: 'menu', tries: 0, answers: [] }, '1', 'João')
    expect(a.messages).toEqual(['Qual a marca e o modelo da máquina?'])
    const b = continueFlow(flow, a.state!, 'Caterpillar 320D', 'João')
    expect(b.messages).toEqual(['Obrigado! Um vendedor já vai te atender.'])
    expect(b.transfer).toEqual({ sectorId: 'ven', userId: null })
    expect(answersNote([{ label: 'Máquina', text: 'Caterpillar 320D' }])).toBe('Respostas ao robô de atendimento:\n• Máquina: Caterpillar 320D')
  })

  it('resposta fora do menu: repete uma vez e depois passa para a fila', () => {
    const a = continueFlow(flow, { stepId: 'menu', tries: 0, answers: [] }, 'bom dia', 'João')
    expect(a.messages[0]).toMatch(/^Não entendi\. Responda com o número/)
    expect(a.state).toMatchObject({ stepId: 'menu', tries: 1 })
    const b = continueFlow(flow, a.state!, 'quero falar com alguém', 'João')
    expect(b).toMatchObject({ state: null, transfer: { sectorId: null, userId: null }, ended: 'sem_resposta_valida' })
  })

  it('encerrar manda a mensagem e deixa a conversa na fila', () => {
    expect(continueFlow(flow, { stepId: 'menu', tries: 0, answers: [] }, '3', null)).toMatchObject({ state: null, ended: 'encerrado' })
  })

  it('não entra em laço: etapas que apontam umas para as outras param', () => {
    const loop: Flow = { startStepId: 'a', steps: [{ id: 'a', type: 'mensagem', text: 'a', go: { next: 'b' } }, { id: 'b', type: 'mensagem', text: 'b', go: { next: 'a' } }] }
    const r = startFlow(loop, null)
    expect(r.state).toBeNull()
    expect(r.messages.length).toBeLessThanOrEqual(20)
  })

  it('confere o fluxo antes de salvar', () => {
    expect(validateFlow(flow)).toBeNull()
    expect(validateFlow({ ...flow, startStepId: 'x' })).toMatch(/etapa inicial/)
    expect(validateFlow({ startStepId: 'm', steps: [{ id: 'm', type: 'menu', text: 'Escolha', options: [] }] })).toMatch(/opções/)
    expect(validateFlow({ startStepId: 'm', steps: [{ id: 'm', type: 'mensagem', text: 'Oi', go: { next: 'nada' } }] })).toMatch(/não existe/)
    expect(validateFlow({ startStepId: 't', steps: [{ id: 't', type: 'transferir', text: '' }] })).toMatch(/setor ou a pessoa/)
    expect(menuText({ id: 'm', type: 'menu', text: 'Escolha:', options: [{ label: 'A' }] })).toBe('Escolha:\n\n*1.* A')
  })
})

describe('qual fluxo começa', () => {
  const base = { numberIds: [] as string[], keywords: [] as string[], onlyAfterHours: false }
  const flows = [
    { ...base, id: 'geral', trigger: 'NOVA_CONVERSA' },
    { ...base, id: 'garantia', trigger: 'PALAVRA', keywords: ['garantia', 'defeito'] },
    { ...base, id: 'noite', trigger: 'NOVA_CONVERSA', onlyAfterHours: true, numberIds: ['n2'] },
  ]
  it('palavra-chave ganha; senão, conversa nova ou parada', async () => {
    const { chooseFlow } = await import('../src/whatsapp/fluxo')
    expect(chooseFlow(flows, { numberId: 'n1', text: 'A peça veio com DEFEITO', idle: false, afterHours: false })?.id).toBe('garantia')
    expect(chooseFlow(flows, { numberId: 'n1', text: 'bom dia', idle: true, afterHours: false })?.id).toBe('geral')
    // Conversa em andamento (não parada) e sem palavra-chave: o robô não entra.
    expect(chooseFlow(flows, { numberId: 'n1', text: 'bom dia', idle: false, afterHours: false })).toBeNull()
    // "garantias" não é a palavra "garantia".
    expect(chooseFlow(flows, { numberId: 'n1', text: 'garantias', idle: false, afterHours: false })).toBeNull()
  })
  it('respeita o número e o "só fora do horário"', async () => {
    const { chooseFlow } = await import('../src/whatsapp/fluxo')
    const onlyNight = [flows[2]!]
    expect(chooseFlow(onlyNight, { numberId: 'n2', text: 'oi', idle: true, afterHours: true })?.id).toBe('noite')
    expect(chooseFlow(onlyNight, { numberId: 'n2', text: 'oi', idle: true, afterHours: false })).toBeNull()
    expect(chooseFlow(onlyNight, { numberId: 'n1', text: 'oi', idle: true, afterHours: true })).toBeNull()
  })
})
