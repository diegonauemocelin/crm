import { describe, expect, it } from 'vitest'
import { DELETE_WINDOW_MS, EDIT_WINDOW_MS, sentActions } from '../src/whatsapp/envio'
import { EvolutionClient } from '../src/whatsapp/evolution'
import { parseMessage, parseRevision } from '../src/whatsapp/mensagens'

const now = Date.parse('2026-10-19T15:00:00Z')
const base = { fromMe: true, internal: false, type: 'texto', deletedAt: null, status: 'ENVIADA', sentAt: new Date(now - 60_000) }

describe('corrigir e apagar mensagem enviada', () => {
  it('texto enviado há pouco: corrige e apaga', () => {
    expect(sentActions(base, now)).toEqual({ edit: true, delete: true })
  })

  it('passados 15 minutos só apaga; passados 2 dias, nada', () => {
    expect(sentActions({ ...base, sentAt: new Date(now - EDIT_WINDOW_MS - 1) }, now)).toEqual({ edit: false, delete: true })
    expect(sentActions({ ...base, sentAt: new Date(now - DELETE_WINDOW_MS - 1) }, now)).toEqual({ edit: false, delete: false })
  })

  it('foto e arquivo só apagam; mensagem do cliente, nota interna, já apagada ou com erro não mexem', () => {
    expect(sentActions({ ...base, type: 'imagem' }, now)).toEqual({ edit: false, delete: true })
    for (const m of [{ fromMe: false }, { internal: true }, { deletedAt: new Date() }, { status: 'ERRO' }]) expect(sentActions({ ...base, ...m }, now)).toEqual({ edit: false, delete: false })
  })

  it('pede ao WhatsApp a correção e a exclusão no formato da Evolution', async () => {
    const calls: { url: string; method: string; body: unknown }[] = []
    const fake = (async (u: string, init: RequestInit) => (calls.push({ url: String(u), method: String(init.method), body: JSON.parse(String(init.body)) }), new Response('{}'))) as unknown as typeof fetch
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, fake, 0)
    await c.editText('loja', { id: 'ABC', remoteJid: '5549999991111@s.whatsapp.net' }, 'Texto certo')
    await c.deleteForEveryone('loja', { id: 'ABC', remoteJid: '5549999991111@s.whatsapp.net' })
    expect(calls[0]).toEqual({ url: 'http://e/chat/updateMessage/loja', method: 'POST', body: { number: '5549999991111', key: { id: 'ABC', remoteJid: '5549999991111@s.whatsapp.net', fromMe: true }, text: 'Texto certo' } })
    expect(calls[1]).toEqual({ url: 'http://e/chat/deleteMessageForEveryone/loja', method: 'DELETE', body: { id: 'ABC', remoteJid: '5549999991111@s.whatsapp.net', fromMe: true } })
  })
})

describe('mensagem apagada ou editada no WhatsApp', () => {
  const key = { id: 'NEW1', remoteJid: '5549999991111@s.whatsapp.net', fromMe: false }
  it('apagada para todos', () => {
    const data = { key, message: { protocolMessage: { key: { id: 'OLD1' }, type: 'REVOKE' } } }
    expect(parseRevision(data)).toEqual({ targetWaId: 'OLD1', kind: 'apagada', text: null })
    expect(parseMessage(data)).toBeNull()
  })

  it('editada (com e sem a embalagem editedMessage)', () => {
    const proto = { protocolMessage: { key: { id: 'OLD2' }, type: 14, editedMessage: { conversation: 'quero 2 filtros' } } }
    expect(parseRevision({ key, message: proto })).toEqual({ targetWaId: 'OLD2', kind: 'editada', text: 'quero 2 filtros' })
    expect(parseRevision({ key, message: { editedMessage: { message: proto } } })).toEqual({ targetWaId: 'OLD2', kind: 'editada', text: 'quero 2 filtros' })
    expect(parseMessage({ key, message: { editedMessage: { message: proto } } })).toBeNull()
  })

  it('mensagem comum não é edição', () => {
    expect(parseRevision({ key, message: { conversation: 'oi' } })).toBeNull()
  })
})
