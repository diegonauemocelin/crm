import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bytesOf, decryptSecretEdit, openSecretEdit, parseMessage, parseSecretEdit, protoMessageText } from '../src/whatsapp/mensagens'

/** Protobuf mínimo: campo de tamanho variável (wire 2). */
const field = (no: number, bytes: Buffer) => Buffer.concat([Buffer.from([(no << 3) | 2, bytes.length]), bytes])
const text = (s: string) => Buffer.from(s, 'utf8')

/** Cifra como o WhatsApp: HKDF(messageSecret, id + quem escreveu + quem editou + "Message Edit") e AES-256-GCM. */
function encrypt(secret: Buffer, id: string, sender: string, plain: Buffer) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), Buffer.from(`${id}${sender}${sender}Message Edit`), 32))
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
  return { enc, iv }
}

/** Buffer como a Evolution manda no JSON ({ "0": 12, "1": 34, ... }). */
const asJson = (b: Buffer) => Object.fromEntries([...b].map((v, i) => [String(i), v]))

describe('edição criptografada do WhatsApp (secretEncryptedMessage)', () => {
  const secret = randomBytes(32)
  const lid = '123456789012345@lid'
  const phone = '5549999999999@s.whatsapp.net'
  // protocolMessage (12) com editedMessage (14) = { conversation (1): "Texto corrigido" }
  const plain = field(12, field(14, field(1, text('Texto corrigido'))))
  const { enc, iv } = encrypt(secret, 'ORIG1', lid, plain)
  const event = {
    key: { id: 'EDIT1', remoteJid: lid, remoteJidAlt: phone, fromMe: false },
    message: { messageContextInfo: {}, secretEncryptedMessage: { targetMessageKey: { id: 'ORIG1', remoteJid: lid }, encPayload: asJson(enc), encIv: asJson(iv), secretEncType: 2 } },
  }

  it('não vira "mensagem de tipo desconhecido" na conversa', () => {
    expect(parseMessage(event)).toBeNull()
  })

  it('lê o evento e abre com a chave da mensagem original', () => {
    const e = parseSecretEdit(event)!
    expect(e.targetWaId).toBe('ORIG1')
    expect(e.senders).toEqual([lid, phone])
    expect(decryptSecretEdit(secret.toString('base64'), e.targetWaId, e.senders, e.encPayload, e.encIv)).toBe('Texto corrigido')
  })

  it('chave errada não abre (e não inventa texto)', () => {
    const e = parseSecretEdit(event)!
    expect(decryptSecretEdit(randomBytes(32).toString('base64'), e.targetWaId, e.senders, e.encPayload, e.encIv)).toBeNull()
  })

  it('guarda a chave das mensagens que chegam', () => {
    const p = parseMessage({ key: { id: 'X1', remoteJid: phone, fromMe: false }, message: { conversation: 'Oi', messageContextInfo: { messageSecret: asJson(secret) } } })
    expect(p?.secret).toBe(secret.toString('base64'))
    expect(bytesOf(secret.toString('base64'))?.equals(secret)).toBe(true)
    expect(bytesOf({ type: 'Buffer', data: [1, 2] })?.equals(Buffer.from([1, 2]))).toBe(true)
  })

  it('texto do protobuf: direto, extendedTextMessage e legenda de foto', () => {
    expect(protoMessageText(field(1, text('Oi')))).toBe('Oi')
    expect(protoMessageText(field(6, field(1, text('Com link'))))).toBe('Com link')
    expect(protoMessageText(field(3, field(3, text('Legenda'))))).toBe('Legenda')
    expect(protoMessageText(Buffer.from([0xff, 0xff]))).toBeNull()
  })

  it('chave em hexadecimal ou no BufferJSON do Baileys', () => {
    expect(bytesOf(secret.toString('hex'))?.equals(secret)).toBe(true)
    expect(bytesOf({ type: 'Buffer', data: secret.toString('base64') })?.equals(secret)).toBe(true)
  })

  it('diz no registro por que não abriu, sem telefone inteiro nem chave', () => {
    const e = parseSecretEdit(event)!
    const r = openSecretEdit(randomBytes(32).toString('base64'), e.targetWaId, e.senders, e.encPayload, e.encIv)
    expect(r.opened).toBe(false)
    expect(r.reason).toContain('nenhuma combinação abriu')
    expect(r.reason).toContain('…2345@lid')
    expect(r.reason).not.toContain('5549999999999')
    expect(openSecretEdit(Buffer.alloc(8).toString('base64'), 'X', [], e.encPayload, e.encIv).reason).toContain('tamanho errado')
  })

  it('abriu mas o texto veio num formato desconhecido: mostra só os números dos campos', () => {
    const odd = encrypt(secret, 'ORIG2', lid, field(15, field(5, text('segredo'))))
    const r = openSecretEdit(secret.toString('base64'), 'ORIG2', [lid], odd.enc, odd.iv)
    expect(r).toMatchObject({ opened: true, text: null })
    expect(r.reason).toContain('15{5}')
    expect(r.reason).not.toContain('segredo')
  })

  it('edição feita pelo celular da empresa (o número dela escreveu e editou)', () => {
    const me = '5547988887777@s.whatsapp.net'
    const mine = encrypt(secret, 'ORIG3', me, field(1, text('Corrigido pela empresa')))
    expect(decryptSecretEdit(secret.toString('base64'), 'ORIG3', [me, lid], mine.enc, mine.iv)).toBe('Corrigido pela empresa')
  })
})
