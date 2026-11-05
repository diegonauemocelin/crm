import { describe, expect, it } from 'vitest'
import { braspressBody, correiosPriceQuery, melhorEnvioBody, packageOf, parseBraspress, parseCorreiosDeadline, parseCorreiosPrice, parseMelhorEnvio } from '../src/fretes/integracoes'

describe('fretes: cotação online (Melhor Envio, Correios, Braspress)', () => {
  const pkg = packageOf({ realWeight: 3.5, volumes: [{ quantity: 2, height: 10, width: 20, length: 30 }] }, 1500)
  it('caixa única: altura somada dos volumes, mínimos dos Correios', () => {
    expect(pkg).toEqual({ weightKg: 3.5, heightCm: 20, widthCm: 20, lengthCm: 30, value: 1500 })
    expect(packageOf({ realWeight: 0.2 }, 0)).toMatchObject({ heightCm: 2, widthCm: 11, lengthCm: 16 })
  })
  it('Melhor Envio: pedido e resposta (serviço com erro fica sem preço)', () => {
    expect(melhorEnvioBody('89874000', '01001000', pkg, [1, 2])).toMatchObject({ from: { postal_code: '89874000' }, package: { height: 20, weight: 3.5 }, options: { insurance_value: 1500 }, services: '1,2' })
    const r = parseMelhorEnvio([
      { id: 3, name: '.Package', price: '45.90', custom_price: '44.10', delivery_time: 5, custom_delivery_time: 6, company: { name: 'Jadlog' } },
      { id: 1, name: 'PAC', error: 'Serviço indisponível para o trecho.', company: { name: 'Correios' } },
    ])
    expect(r[0]).toMatchObject({ carrier: 'Jadlog', service: '.Package', price: 44.1, deadlineDays: 6, error: null })
    expect(r[1]).toMatchObject({ price: null, error: 'Serviço indisponível para o trecho.' })
  })
  it('Correios: peso em gramas e leitura do preço "45,90" e do prazo', () => {
    const q = correiosPriceQuery('89874000', '01001000', pkg)
    expect(q.get('psObjeto')).toBe('3500')
    expect(q.get('tpObjeto')).toBe('2')
    expect(parseCorreiosPrice({ pcFinal: '1.045,90' })).toBe(1045.9)
    expect(parseCorreiosDeadline({ prazoEntrega: 7 })).toBe(7)
  })
  it('Braspress: medidas em metros e leitura do total', () => {
    expect(braspressBody({ senderDoc: '01704079000102', recipientDoc: '12345678000190', from: '89874000', to: '01001000', modal: 'R' }, pkg)).toMatchObject({ cnpjRemetente: '01704079000102', tipoFrete: '1', cubagem: [{ altura: 0.2, largura: 0.2, comprimento: 0.3 }] })
    expect(parseBraspress({ id: 1, prazo: 4, totalFrete: 123.45 })).toEqual({ price: 123.45, deadlineDays: 4, error: null })
  })
})
