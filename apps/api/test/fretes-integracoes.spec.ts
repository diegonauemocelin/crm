import { describe, expect, it } from 'vitest'
import { decimalText, dhlRatesQuery, nextBusinessDay, parseDhlRates, parseRodonaves, parseRodonavesCity, parseRodonavesToken, rodonavesBody, rodonavesTokenForm, braspressBody, jadlogBody, jadlogWeight, parseJadlog, correiosDeclaredService, correiosPriceQuery, melhorEnvioBody, packageOf, parseBraspress, parseCorreiosDeadline, parseCorreiosPrice, parseMelhorEnvio } from '../src/fretes/integracoes'

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
  it('Correios: com valor da mercadoria vai o Valor Declarado do produto (019 SEDEX, 064 PAC)', () => {
    expect(correiosDeclaredService({ code: '03220', name: 'SEDEX' })).toBe('019')
    expect(correiosDeclaredService({ code: '03298', name: 'PAC' })).toBe('064')
    const q = correiosPriceQuery('89874000', '01001000', { ...pkg, value: 1000 }, '064')
    expect(q.get('vlDeclarado')).toBe('1000.00')
    expect(q.get('servicosAdicionais')).toBe('064')
    expect(correiosPriceQuery('89874000', '01001000', { ...pkg, value: 1000 }, null).has('vlDeclarado')).toBe(false)
  })
  it('Braspress: medidas em metros e leitura do total', () => {
    expect(braspressBody({ senderDoc: '01704079000102', recipientDoc: '12345678000190', from: '89874000', to: '01001000', modal: 'R' }, pkg)).toMatchObject({ cnpjRemetente: '01704079000102', tipoFrete: '1', cubagem: [{ altura: 0.2, largura: 0.2, comprimento: 0.3 }] })
    expect(parseBraspress({ id: 1, prazo: 4, totalFrete: 123.45 })).toEqual({ price: 123.45, deadlineDays: 4, error: null })
  })
})

describe('fretes: despacho até a transportadora', () => {
  it('o valor do despacho sai da conferência do CT-e', async () => {
    const { dropOffOf } = await import('../src/fretes/cotacao.service')
    expect(dropOffOf({ components: [{ code: 'FRETE_PESO', value: 100 }, { code: 'DESPACHO_TERCEIRO', value: 25 }] })).toBe(25)
    expect(dropOffOf({ components: [] })).toBe(0)
  })
})

describe('fretes: Jadlog (simulador de frete)', () => {
  const pkg = packageOf({ realWeight: 2, volumes: [{ quantity: 1, height: 50, width: 40, length: 30 }] }, 120.456)
  const cfg = { account: '000123', contract: '', delivery: 'D' as const, cubageFactor: 0 }
  it('peso: o maior entre real e cubado (fator da Jadlog)', () => {
    expect(jadlogWeight(pkg, 0)).toBe(2)
    expect(jadlogWeight(pkg, 300)).toBe(18) // 0,06 m³ × 300
  })
  it('pedido no formato da documentação', () => {
    const b = jadlogBody({ ...cfg, cubageFactor: 300 }, { from: '89874-000', to: '01001-000', cnpj: '01.704.079/0001-00' }, pkg, [3, 5, 7, 9])
    expect(b.frete).toHaveLength(3)
    expect(b.frete[0]).toEqual({ cepori: '89874000', cepdes: '01001000', frap: 'N', peso: 18, cnpj: '01704079000100', conta: '000123', contrato: null, modalidade: 3, tpentrega: 'D', tpseguro: 'N', vldeclarado: 120.46, vlcoleta: 0 })
  })
  it('resposta: preço e prazo por modalidade; erro geral', () => {
    const mods = [{ code: 3, name: '.Package' }]
    expect(parseJadlog({ frete: [{ modalidade: 3, vltotal: 7.5, prazo: 5 }] }, mods)).toEqual([{ source: 'JADLOG', serviceId: '3', carrier: 'Jadlog', service: '.Package', price: 7.5, deadlineDays: 5, error: null }])
    const e = parseJadlog({ frete: [{ modalidade: 3 }], error: { id: -1, descricao: 'frete[0].contrato Numero de contrato invalido' } }, mods)
    expect(e[0]).toMatchObject({ price: null, error: 'frete[0].contrato Numero de contrato invalido' })
    expect(parseJadlog({}, mods)[0]).toMatchObject({ service: '.Package', price: null })
  })
})

describe('fretes: cotação online (Rodonaves e DHL Express)', () => {
  const pkg = packageOf({ realWeight: 12.5, volumes: [{ quantity: 1, height: 30, width: 40, length: 50 }] }, 2350.5)
  it('Rodonaves: token (form), cidade pelo CEP e corpo da cotação', () => {
    expect(rodonavesTokenForm('usr', 's&nha').toString()).toBe('grant_type=password&username=usr&password=s%26nha&auth_type=DEV')
    expect(parseRodonavesToken({ access_token: 'abc', token_type: 'bearer', expires_in: 28799 })).toEqual({ token: 'abc', expiresInSec: 28799 })
    expect(parseRodonavesToken({ access_token: 'abc' })).toEqual({ token: 'abc', expiresInSec: 28800 })
    expect(parseRodonavesToken({ error: 'invalid_grant' })).toBeNull()
    expect(parseRodonavesCity({ Id: 4521, Description: 'MARAVILHA', IbgeCityCode: 4210506 })).toBe(4521)
    expect(parseRodonavesCity({})).toBeNull()
    const b = rodonavesBody({ from: '89874-000', to: '01001-000', originCityId: 1, destCityId: 2, cnpj: '01.704.079/0001-00', recipientDoc: '123.456.789-09', contactName: 'Fulano', contactPhone: '(49) 3664-0888' }, pkg)
    expect(b).toMatchObject({ OriginZipCode: '89874000', OriginCityId: 1, DestinationZipCode: '01001000', DestinationCityId: 2, TotalWeight: 12.5, EletronicInvoiceValue: 2350.5, CustomerTaxIdRegistration: '01704079000100', ReceiverCpfcnp: '12345678909', ContactPhoneNumber: '4936640888', TotalPackages: 1 })
    expect(b.Packs[0]).toEqual({ AmountPackages: 1, Weight: 12.5, Length: 50, Height: 30, Width: 40 })
  })
  it('Rodonaves: FreightValue em texto (formato BR ou US) ou número', () => {
    expect(decimalText('1.234,56')).toBe(1234.56)
    expect(decimalText('1234.56')).toBe(1234.56)
    expect(decimalText('1,234.56')).toBe(1234.56)
    expect(decimalText('R$ 45,9')).toBe(45.9)
    expect(decimalText(99.999)).toBe(100)
    expect(decimalText('')).toBeNull()
    expect(parseRodonaves({ FreightValue: '1.234,56', ProtocolId: 778899, Status: 'OK' })).toEqual({ price: 1234.56, protocol: '778899', error: null })
    expect(parseRodonaves({ FreightValue: 210.4 })).toMatchObject({ price: 210.4, error: null })
    expect(parseRodonaves({ Message: 'CEP de destino não atendido' })).toMatchObject({ price: null, error: 'CEP de destino não atendido' })
  })
  it('DHL: query nacional e internacional (métrico, próximo dia útil)', () => {
    const date = nextBusinessDay(new Date('2026-11-13T15:00:00Z')) // sexta
    expect(date).toBe('2026-11-16')
    expect(nextBusinessDay(new Date('2026-11-17T02:00:00Z'))).toBe('2026-11-17') // ainda segunda (16) em Brasília
    const origin = { country: 'BR', postalCode: '89874-000', city: 'Maravilha' }
    const dom = dhlRatesQuery({ account: '123456789', origin, dest: { country: 'br', postalCode: '01001-000', city: 'São Paulo' }, customs: false, date }, pkg)
    expect(Object.fromEntries(dom)).toMatchObject({ accountNumber: '123456789', originCountryCode: 'BR', originPostalCode: '89874000', destinationCountryCode: 'BR', destinationPostalCode: '01001000', weight: '12.5', length: '50', width: '40', height: '30', plannedShippingDate: '2026-11-16', isCustomsDeclarable: 'false', unitOfMeasurement: 'metric' })
    const intl = dhlRatesQuery({ account: '1', origin, dest: { country: 'ar', postalCode: 'C1002', city: 'Buenos Aires' }, customs: true, date }, pkg)
    expect(intl.get('destinationCountryCode')).toBe('AR')
    expect(intl.get('destinationPostalCode')).toBe('C1002')
    expect(intl.get('isCustomsDeclarable')).toBe('true')
  })
  it('DHL: preço na moeda de cobrança (BILLC), moeda no nome quando não é real, prazo e erros', () => {
    const r = parseDhlRates({
      products: [
        { productName: 'EXPRESS WORLDWIDE', productCode: 'P', localProductCode: 'P', totalPrice: [{ currencyType: 'PULCL', priceCurrency: 'BRL', price: 900 }, { currencyType: 'BILLC', priceCurrency: 'USD', price: 150.25 }], deliveryCapabilities: { totalTransitDays: 3 } },
        { productName: 'EXPRESS DOMESTIC', productCode: 'N', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'BRL', price: 210.4 }], deliveryCapabilities: { totalTransitDays: '1' } },
        { productName: 'SEM PRECO', productCode: 'X', totalPrice: [] },
      ],
    })
    expect(r[0]).toMatchObject({ source: 'DHL', serviceId: 'P', carrier: 'DHL Express', service: 'EXPRESS WORLDWIDE (USD)', price: 150.25, deadlineDays: 3, error: null })
    expect(r[1]).toMatchObject({ service: 'EXPRESS DOMESTIC', price: 210.4, deadlineDays: 1 })
    expect(r[2]).toMatchObject({ price: null, error: 'Sem preço para este envio.' })
    const e = parseDhlRates({ status: 404, title: 'Product not found', detail: '996: Requested product(s) not available', additionalDetails: ['Destino sem serviço'] })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ source: 'DHL', price: null, error: '996: Requested product(s) not available · Destino sem serviço' })
  })
})
