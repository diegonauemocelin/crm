import { describe, expect, it } from 'vitest'
import { audioMime, cleanSuggestion, cleanTranscript, searchTerms, suggestPrompt } from '../src/whatsapp/ia-chat'

describe('IA no chat', () => {
  it('ajusta o tipo do áudio e limpa a transcrição', () => {
    expect(audioMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(audioMime('audio/mpeg')).toBe('audio/mp3')
    expect(audioMime(null)).toBe('audio/ogg')
    expect(cleanTranscript(' "Bom dia, tem o filtro 600-311?" ')).toBe('Bom dia, tem o filtro 600-311?')
    expect(cleanTranscript('[sem fala]')).toBeNull()
  })
  it('acha os termos do cliente e monta o pedido sem inventar preço', () => {
    const lines = [
      { fromMe: false, text: 'Bom dia, preciso do filtro hidráulico 207-60-71182 da PC200' },
      { fromMe: true, text: 'Bom dia! Vou verificar.' },
    ]
    const t = searchTerms(lines)
    expect(t[0]).toBe('207-60-71182')
    expect(t).toContain('filtro')
    const p = suggestPrompt({ company: 'Usaparts', agent: 'Ana', client: null, lines, knowledge: [], products: [] })
    expect(p).toContain('NÃO invente preço')
    expect(p).toContain('Cliente: Bom dia, preciso do filtro')
    expect(cleanSuggestion('Atendente: "Temos sim!"')).toBe('Temos sim!')
  })
})
