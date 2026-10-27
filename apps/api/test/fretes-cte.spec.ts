import { describe, expect, it } from 'vitest'
import { internalRateFrom, parseCteXml } from '../src/fretes/cte'

const xml = (ide: string, icms: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe xmlns="http://www.portalfiscal.inf.br/cte"><infCte Id="CTe42261000428307000198570100003409891000000000" versao="4.00">
<ide><cUF>42</cUF><CFOP>5353</CFOP><natOp>PRESTACAO DE SERVICO</natOp><mod>57</mod><serie>10</serie><nCT>340989</nCT><dhEmi>2026-10-20T10:00:00-03:00</dhEmi>${ide}</ide>
<emit><CNPJ>00428307000198</CNPJ><xNome>EXPRESSO SAO MIGUEL</xNome></emit>
<vPrest><vTPrest>104.55</vTPrest><vRec>104.55</vRec><Comp><xNome>FRETE PESO</xNome><vComp>74.70</vComp></Comp><Comp><xNome>FRETE VALOR</xNome><vComp>1.50</vComp></Comp><Comp><xNome>OUTROS</xNome><vComp>17.77</vComp></Comp></vPrest>
<imp><ICMS>${icms}</ICMS></imp></infCte></CTe></cteProc>`

const sc = '<xMunIni>MARAVILHA</xMunIni><UFIni>SC</UFIni><xMunFim>PALHOCA</xMunFim><UFFim>SC</UFFim>'

describe('fretes: XML do CT-e', () => {
  it('lê chave, trecho, componentes e ICMS', () => {
    const c = parseCteXml(xml(sc, '<ICMS00><CST>00</CST><vBC>104.55</vBC><pICMS>17.00</pICMS><vICMS>17.77</vICMS></ICMS00>'))
    expect(c).toMatchObject({ key: '42261000428307000198570100003409891000000000', number: '340989', series: '10', ufIni: 'SC', ufFim: 'SC', cityFim: 'PALHOCA', total: 104.55, emitCnpj: '00428307000198' })
    expect(c.components).toEqual([{ name: 'FRETE PESO', value: 74.7 }, { name: 'FRETE VALOR', value: 1.5 }, { name: 'OUTROS', value: 17.77 }])
    expect(c.icms).toMatchObject({ group: 'ICMS00', cst: '00', rate: 17, value: 17.77 })
    expect(internalRateFrom(c)).toMatchObject({ ok: true, uf: 'SC', rate: 17 })
    expect(() => parseCteXml('<nfeProc/>')).toThrow(/não é um XML de CT-e/)
  })

  it('só aprende alíquota de frete no mesmo estado com ICMS tributado', () => {
    const inter = parseCteXml(xml('<UFIni>RS</UFIni><UFFim>SC</UFFim>', '<ICMS00><CST>00</CST><vBC>79.11</vBC><pICMS>12.00</pICMS><vICMS>9.49</vICMS></ICMS00>'))
    expect(internalRateFrom(inter)).toMatchObject({ ok: false, reason: expect.stringMatching(/interestadual/) })
    const isento = parseCteXml(xml(sc, '<ICMS45><CST>40</CST></ICMS45>'))
    expect(internalRateFrom(isento)).toMatchObject({ ok: false })
    const reducao = parseCteXml(xml(sc, '<ICMS20><CST>20</CST><pRedBC>20.00</pRedBC><vBC>80</vBC><pICMS>17.00</pICMS><vICMS>13.60</vICMS></ICMS20>'))
    expect(internalRateFrom(reducao)).toMatchObject({ ok: true, rate: 13.6, note: '17% com redução de base de 20%' })
  })
})
