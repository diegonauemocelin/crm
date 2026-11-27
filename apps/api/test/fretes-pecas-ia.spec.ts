import { describe, expect, it } from 'vitest'
import { imageMime, parsePartsAi } from '../src/fretes/pecas-ia'

describe('leitura do orçamento por imagem (IA)', () => {
  it('lê itens, medidas e peso; sem fonte ou medida vira estimado', () => {
    const r = parsePartsAi('Aqui está:\n```json\n{"itens":[{"referencia":"172448-82950","descricao":"UNHA","quantidade":"3","comprimento":17,"largura":"8,5","altura":7,"peso":1.2,"fonte":null,"estimado":false},{"referencia":"6I-2501","descricao":"FILTRO","quantidade":2,"comprimento":15,"largura":10,"altura":10,"peso":0.9,"fonte":"parts.cat.com"}]}\n```')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ referencia: '172448-82950', quantidade: 3, largura: 8.5, estimado: true, fonte: null })
    expect(r[1]).toMatchObject({ referencia: '6I-2501', estimado: false, fonte: 'parts.cat.com' })
  })
  it('valores absurdos viram vazio e o item fica estimado', () => {
    const r = parsePartsAi('{"itens":[{"referencia":"X","descricao":"Y","quantidade":1,"comprimento":-5,"largura":9999,"altura":3,"peso":0,"fonte":"site"}]}')
    expect(r[0]).toMatchObject({ comprimento: null, largura: null, peso: null, estimado: true })
  })
  it('sem itens ou sem JSON: erro claro', () => {
    expect(() => parsePartsAi('não consegui ler')).toThrow(/print mais nítido/)
    expect(() => parsePartsAi('{"itens":[]}')).toThrow(/Nenhum item/)
  })
  it('reconhece PNG e JPEG pelos bytes', () => {
    expect(imageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMime(Buffer.from('%PDF-1.7'))).toBeNull()
  })
})

describe('cabeçalho do orçamento (IA)', () => {
  it('lê número, vendedor, cliente, documento, CEP e total', async () => {
    const { parseQuoteHeader } = await import('../src/fretes/pecas-ia')
    const h = parseQuoteHeader('{"cabecalho":{"numero":"126593","vendedor":"101 - E-COMMERCE","cliente":"CLAUDIO","documento":"303.584.618-98","cidade":"Mogi das Cruzes","uf":"sp","cep":"08.717-630","valorTotal":"269,70"},"itens":[]}')
    expect(h).toEqual({ numero: '126593', vendedor: '101 - E-COMMERCE', cliente: 'CLAUDIO', documento: '30358461898', cidade: 'Mogi das Cruzes', uf: 'SP', cep: '08717630', valorTotal: 269.7 })
    expect(parseQuoteHeader('{"itens":[]}')).toBeNull()
  })
})
