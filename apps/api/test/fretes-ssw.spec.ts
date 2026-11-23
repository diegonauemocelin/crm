import { describe, expect, it } from 'vitest'
import { parseSswQuote, sswQuoteEnvelope } from '../src/fretes/integracoes'

const wrap = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns1:cotarResponse xmlns:ns1="urn:sswinfbr.sswCotacao"><return xsi:type="xsd:string">${inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</return></ns1:cotarResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`

describe('TW Transportes (SSW)', () => {
  it('monta o cotar() com peso, volume em m³ e escapa a senha', () => {
    const x = sswQuoteEnvelope({ domain: 'TWT', login: 'usaparts', password: 'a<b&c', cnpj: '01704079000100', goods: 1 }, { from: '89874-000', to: '78000-000', recipientDoc: '12.345.678/0001-90' }, { weightKg: 42.12345, heightCm: 50, widthCm: 40, lengthCm: 30, value: 4850, cubicM3: 0.18, count: 3 })
    expect(x).toContain('<urn:cotar>')
    expect(x).toContain('<senha>a&lt;b&amp;c</senha>')
    expect(x).toContain('<cepOrigem>89874000</cepOrigem>')
    expect(x).toContain('<peso>42.123</peso>')
    expect(x).toContain('<volume>0.1800</volume>')
    expect(x).toContain('<quantidade>3</quantidade>')
    expect(x).toContain('<valorNF>4850.00</valorNF>')
    expect(x).toContain('<cnpjDestinatario>12345678000190</cnpjDestinatario>')
  })

  it('sem cubagem calcula pelas medidas; CPF não vai como CNPJ do destinatário', () => {
    const x = sswQuoteEnvelope({ domain: 'TWT', login: 'l', password: 's', cnpj: '1', goods: 9 }, { from: '1', to: '2', recipientDoc: '12345678901' }, { weightKg: 1, heightCm: 10, widthCm: 20, lengthCm: 30, value: 1 })
    expect(x).toContain('<volume>0.0060</volume>')
    expect(x).toContain('<cnpjDestinatario></cnpjDestinatario>')
    expect(x).toContain('<mercadoria>9</mercadoria>')
  })

  it('lê o valor e o prazo', () => {
    const r = parseSswQuote(wrap('<?xml version="1.0" encoding="utf-8"?><cotacao><erro>0</erro><mensagem/><pesoCalculo>4.456</pesoCalculo><prazo>2</prazo><totalFrete>140.53</totalFrete></cotacao>'))
    expect(r).toEqual({ price: 140.53, deadlineDays: 2, error: null })
  })

  it('erro vira mensagem (com acento e login recusado)', () => {
    expect(parseSswQuote(wrap('<cotacao><erro>1</erro><mensagem>CIDADE DESTINO N&Atilde;O CADASTRADA</mensagem></cotacao>')).error).toBe('CIDADE DESTINO NÃO CADASTRADA')
    expect(parseSswQuote(wrap('<cotacao><erro>-2</erro><mensagem>LOGIN INVALIDO</mensagem></cotacao>')).error).toMatch(/recusou o acesso/)
    expect(parseSswQuote('<html>erro</html>').error).toBeTruthy()
  })
})
