import { describe, expect, it } from 'vitest'
import { QUICK_REPLY_MAX_FILES, replyFiles } from '../src/whatsapp/mensagens'

describe('respostas rápidas com vários arquivos', () => {
  it('lê a lista e o formato antigo (um arquivo só)', () => {
    expect(QUICK_REPLY_MAX_FILES).toBe(3)
    expect(replyFiles({ files: [], fileId: null, fileName: null })).toEqual([])
    expect(replyFiles({ files: [], fileId: 'a', fileName: 'catalogo.pdf' })).toEqual([{ fileId: 'a', fileName: 'catalogo.pdf' }])
    expect(replyFiles({ files: [{ fileId: 'b', fileName: 'video.mp4' }, { nada: 1 }], fileId: 'a', fileName: null })).toEqual([
      { fileId: 'a', fileName: 'arquivo' },
      { fileId: 'b', fileName: 'video.mp4' },
    ])
    expect(replyFiles({ files: [{ fileId: 'a', fileName: 'x.pdf' }], fileId: 'a', fileName: 'x.pdf' })).toEqual([{ fileId: 'a', fileName: 'x.pdf' }])
  })
})

describe('mensagem encaminhada', () => {
  it('marca o texto ou a legenda, sem repetir', async () => {
    const { FORWARD_TAG, forwardedText } = await import('../src/whatsapp/mensagens')
    expect(forwardedText('Segue o orçamento')).toBe(`${FORWARD_TAG}\nSegue o orçamento`)
    expect(forwardedText(null)).toBe(FORWARD_TAG)
    expect(forwardedText(`${FORWARD_TAG}\nSegue`)).toBe(`${FORWARD_TAG}\nSegue`)
  })
})
