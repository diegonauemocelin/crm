import { describe, expect, it } from 'vitest'
import { answersClient } from '../src/whatsapp/envio'

const t = (text: string) => ({ type: 'texto', text })

describe('tempo de aguardando retorno: o que a empresa manda', () => {
  it('resposta de verdade para o tempo', () => {
    for (const m of ['Encaminhei seu contato para o vendedor Vinicius, que dará continuidade ao seu atendimento. Em breve ele entrará em contato com você!', 'Bom dia! O filtro custa R$ 189,90.', '*Fabíola:*\nTemos sim, pronta entrega.', 'Sim, serve na 416E.']) expect(answersClient(t(m)), m).toBe(true)
    expect(answersClient({ type: 'audio', text: null })).toBe(true)
    expect(answersClient({ type: 'imagem', text: null })).toBe(true)
    expect(answersClient({ type: 'documento', text: 'orcamento.pdf' })).toBe(true)
  })

  it('promessa de retorno e figurinha não param', () => {
    for (const m of ['vou verificar com o setor e lhe retorno', 'Só um momento, por favor', '*Fabíola:*\nUm instante que já te passo', 'Certo! Já encaminhei seus dados para o setor de cadastro. Assim que tiver um retorno, aviso você.', 'Estou verificando o estoque', 'Deixa eu ver aqui', 'Aguarde, por favor', 'Vou consultar e te retorno']) expect(answersClient(t(m)), m).toBe(false)
    expect(answersClient({ type: 'figurinha', text: null })).toBe(false)
    expect(answersClient(t(''))).toBe(false)
  })
})
