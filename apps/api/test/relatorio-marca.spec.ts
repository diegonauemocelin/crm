import { describe, expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { orderChannel, orderLines } from '../src/integracoes/magazord'
import { storeSheets, toPdf } from '../src/marketing/arquivos'
import { pdfImage } from '../src/marketing/pdf-imagem'

/** PNG mínimo (RGBA 2x1, filtro "sub" na linha) montado à mão. */
function png(type: number, depth: number, w: number, h: number, rows: number[][], extra: Buffer[] = []) {
  const chunk = (kind: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from(kind, 'latin1'), data, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = depth
  ihdr[9] = type
  const raw = Buffer.from(rows.flat())
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', Buffer.from(zlibSync(raw))), chunk('IEND', Buffer.alloc(0))])
}

describe('logo da empresa no PDF', () => {
  it('PNG com transparência vira RGB + máscara; filtros de linha são desfeitos', () => {
    // Linha com filtro 1 (sub): 2º pixel = 1º + diferença.
    const img = pdfImage(png(6, 8, 2, 1, [[1, 10, 20, 30, 255, 5, 5, 5, 128]]), 'image/png')!
    expect(img).toMatchObject({ width: 2, height: 1 })
    expect(img.smask).not.toBeNull()
    expect(img.image.dict).toContain('/SMask {SMASK} 0 R')
  })

  it('PNG de paleta e JPEG; arquivo que não é imagem não quebra', () => {
    const pal = png(3, 8, 1, 1, [[0, 0]], [Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('PLTE'), Buffer.from([200, 10, 10]), Buffer.alloc(4)])])
    expect(pdfImage(pal, 'image/png')).toMatchObject({ width: 1, height: 1, smask: null })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])
    expect(pdfImage(jpg, 'image/jpeg')).toMatchObject({ width: 64, height: 32, smask: null })
    expect(pdfImage(Buffer.from('<svg/>'), 'image/svg+xml')).toBeNull()
  })

  it('PDF com logo, cartões, resumo e tabela continua válido', () => {
    const logo = pdfImage(png(6, 8, 2, 1, [[0, 10, 20, 30, 255, 5, 5, 5, 0]]), 'image/png')
    const pdf = Buffer.from(
      toPdf({
        title: 'Relatório semanal',
        subtitle: 'Semana anterior',
        footer: 'CRM',
        brandName: 'Usaparts',
        logo,
        info: 'usaparts.com.br · (49) 3664-0888',
        cards: [{ label: 'Leads gerados', value: '34', delta: -19, goodUp: true }],
        sheets: [
          { name: 'Resumo do período', kind: 'text', header: ['x'], rows: [['- Ponto 1'], ['Próximos passos:'], ['- Ação']] },
          { name: 'Canais', header: ['Canal', 'Vendas'], rows: Array.from({ length: 120 }, (_, i) => [`Canal ${i}`, i]), colKinds: [null, 'int'] },
        ],
      }),
    ).toString('latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/XObject << /Im1')
    expect(pdf).toContain('/SMask')
    expect(pdf).toContain('usaparts.com.br')
    expect(pdf).toMatch(/\/Count [2-9]/)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
  })
})

describe('loja virtual (Magazord) no relatório', () => {
  it('canal de venda: marketplace pelo nome, senão a origem', () => {
    expect(orderChannel({ origem: 2, marketplaceNome: 'Mercado Livre' })).toBe('Mercado Livre')
    expect(orderChannel({ origem: 1, marketplaceNome: '' })).toBe('Site')
    expect(orderChannel({ origem: 4 })).toBe('PDV (loja física)')
    expect(orderChannel({ lojaDoMarketplaceNome: 'Shopee' })).toBe('Shopee')
    expect(orderChannel({})).toBeNull()
  })

  it('itens do detalhe do pedido (por rastreio), item de kit fica de fora', () => {
    const lines = orderLines({
      arrayPedidoRastreio: [
        { pedidoItem: [{ produtoDerivacaoCodigo: 'FIL-123', produtoNome: 'Filtro de óleo', marcaNome: 'Usaparts', quantidade: 2, valorItem: 180.5 }, { pedidoItemKitId: 9, descricao: 'parte do kit', quantidade: 1, valorItem: 10 }] },
        { pedidoItem: [{ descricao: 'Dente de caçamba', quantidade: 3, valorUnitario: 50 }] },
      ],
    })
    expect(lines).toEqual([
      { sku: 'FIL-123', name: 'Filtro de óleo', brand: 'Usaparts', quantity: 2, total: 180.5 },
      { sku: null, name: 'Dente de caçamba', brand: null, quantity: 3, total: 150 },
    ])
    expect(orderLines(null)).toEqual([])
  })

  it('tabelas da loja: resumo, canais e mais vendidos', () => {
    const sheets = storeSheets({
      period: { from: '2026-10-01', to: '2026-10-07' },
      now: { orders: 10, revenue: 5000, ticket: 500, pending: 2, canceled: 1 },
      before: { orders: 8, revenue: 4000, ticket: 500, pending: 1, canceled: 0 },
      deltas: { orders: 25, revenue: 25, ticket: 0 },
      channels: [{ name: 'Site', orders: 6, revenue: 3000, share: 60 }],
      products: [{ name: 'Filtro', sku: 'F1', quantity: 4, orders: 3, revenue: 400 }],
      pendingItems: 5,
    })
    expect(sheets.map((s) => s.name)).toEqual(['Loja virtual', 'Canais de venda', 'Produtos mais vendidos'])
    expect(sheets[2]!.note).toContain('5 pedido(s)')
  })
})
