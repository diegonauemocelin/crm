import { describe, expect, it } from 'vitest'
import { menuFor, menuOptions } from '../../web/src/lib/menu'
import { parseMessage } from '../src/whatsapp/mensagens'

const key = { id: 'M1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false }
const RD = 'Qual produto você deseja atendimento? Clique na opção desejada\n1 Marketing\n2 Conversas\n3 CRM\n4 Mentor IA'

describe('menu de robô no chat', () => {
  it('acha as opções numeradas do menu (como o da RD Station)', () => {
    expect(menuOptions(RD).map((o) => o.label)).toEqual(['Marketing', 'Conversas', 'CRM', 'Mentor IA'])
    expect(menuOptions('Escolha:\n1) Financeiro\n2 - Comercial\n*3.* Suporte').map((o) => o.label)).toEqual(['Financeiro', 'Comercial', 'Suporte'])
    expect(menuOptions('Tem 1 filtro e 2 correias')).toEqual([])
    expect(menuOptions('1 Marketing')).toEqual([])
    expect(menuOptions('2 Conversas\n3 CRM')).toEqual([])
  })

  it('cliente listando peças não vira botão; menu que pede para escolher, sim', () => {
    expect(menuFor('Preciso de:\n1 filtro de óleo\n2 correia', 'CLIENTE')).toEqual([])
    expect(menuFor(RD, 'CLIENTE')).toHaveLength(4)
    expect(menuFor('Setores:\n1 Vendas\n2 Financeiro', 'FORNECEDOR')).toHaveLength(2)
  })

  it('lê botões, lista e mensagem interativa do WhatsApp como texto com as opções', () => {
    const btn = parseMessage({ key, message: { buttonsMessage: { contentText: 'Como podemos ajudar?', buttons: [{ buttonText: { displayText: 'Comprar' } }, { buttonText: { displayText: 'Suporte' } }] } } })
    expect(btn?.text).toBe('Como podemos ajudar?\n1 Comprar\n2 Suporte')
    const list = parseMessage({ key, message: { listMessage: { description: 'Escolha o setor', sections: [{ rows: [{ title: 'Vendas' }, { title: 'Financeiro' }] }] } } })
    expect(list?.text).toBe('Escolha o setor\n1 Vendas\n2 Financeiro')
    const inter = parseMessage({ key, message: { viewOnceMessage: { message: { interactiveMessage: { body: { text: 'Qual produto?' }, nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Ver', sections: [{ rows: [{ title: 'Marketing', id: 'mkt' }, { title: 'CRM', id: 'crm' }] }] }) }] } } } } } })
    expect(inter?.text).toBe('Qual produto?\n1 Marketing\n2 CRM')
    expect(menuOptions(inter?.text).map((o) => o.label)).toEqual(['Marketing', 'CRM'])
  })

  it('opção tocada no celular aparece como a resposta escolhida', () => {
    expect(parseMessage({ key: { ...key, fromMe: true }, message: { buttonsResponseMessage: { selectedDisplayText: 'Suporte', selectedButtonId: 's' } } })?.text).toBe('Suporte')
    expect(parseMessage({ key: { ...key, fromMe: true }, message: { listResponseMessage: { title: 'Financeiro', singleSelectReply: { selectedRowId: 'f' } } } })?.text).toBe('Financeiro')
  })
})

describe('formatos de botões que chegavam como "tipo que o CRM ainda não mostra"', () => {
  it('botões de resposta rápida (interativa) e a resposta tocada no celular', () => {
    const quick = parseMessage({ key, message: { interactiveMessage: { body: { text: 'Selecione uma das opções abaixo:' }, nativeFlowMessage: { buttons: [{ name: 'quick_reply', buttonParamsJson: '{"display_text":"Informar Email","id":"1"}' }, { name: 'quick_reply', buttonParamsJson: '{"display_text":"Não tenho e-mail","id":"2"}' }] } } } })
    expect(quick?.text).toBe('Selecione uma das opções abaixo:\n1 Informar Email\n2 Não tenho e-mail')
    expect(menuFor(quick?.text, 'CLIENTE').map((o) => o.label)).toEqual(['Informar Email', 'Não tenho e-mail'])
    const reply = parseMessage({ key: { ...key, fromMe: true }, message: { interactiveResponseMessage: { body: { text: 'Sim' }, nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: '{"id":"s"}' }, contextInfo: { stanzaId: 'Q', quotedMessage: { interactiveMessage: { body: { text: 'Deseja continuar?' } } } } } } })
    expect(reply?.text).toBe('Sim')
    expect(reply?.quoted).toEqual({ waId: 'Q', text: 'Deseja continuar?' })
  })

  it('modelo com botões e formato desconhecido: pega o texto e os botões', () => {
    const tpl = parseMessage({ key, message: { templateMessage: { hydratedTemplate: { hydratedContentText: 'Deseja continuar?', hydratedButtons: [{ quickReplyButton: { displayText: 'Sim' } }, { quickReplyButton: { displayText: 'Não' } }] } } } })
    expect(tpl?.text).toBe('Deseja continuar?\n1 Sim\n2 Não')
    const novo = parseMessage({ key, message: { algumTipoNovoMessage: { header: { text: 'Escolha' }, actions: [{ displayText: 'A' }, { displayText: 'B' }] } } })
    expect(novo).toMatchObject({ type: 'texto', text: 'Escolha\n1 A\n2 B' })
  })
})
