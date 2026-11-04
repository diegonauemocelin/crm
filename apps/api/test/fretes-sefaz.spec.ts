import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { companyRoles } from '../src/fretes/cte'
import { distEnvelope, docKind, nsuLess, parseDistResponse, readCertificate, unzipDoc, withinDays } from '../src/fretes/sefaz'

const zip = (xml: string) => gzipSync(Buffer.from(xml, 'utf8')).toString('base64')

describe('fretes: captura de CT-e na SEFAZ (Distribuição DF-e)', () => {
  it('monta a consulta por último NSU com o CNPJ da matriz', () => {
    const x = distEnvelope({ env: 'PRODUCAO', ufCode: 42, cnpj: '01.704.079/0001-02', ultNsu: '123' })
    expect(x).toContain('<tpAmb>1</tpAmb><cUFAutor>42</cUFAutor><CNPJ>01704079000102</CNPJ><distNSU><ultNSU>000000000000123</ultNSU></distNSU>')
    expect(x).toContain('soap12:Envelope')
    expect(distEnvelope({ env: 'HOMOLOGACAO', ufCode: 41, cnpj: '1', ultNsu: '0' })).toContain('<tpAmb>2</tpAmb>')
  })

  it('lê a resposta: situação, NSUs e os documentos compactados', () => {
    const cte = '<cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe42261100428307000350570010000000011000000010"><ide><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide></infCte></CTe></cteProc>'
    const ev = '<procEventoCTe><eventoCTe><infEvento><tpEvento>110111</tpEvento></infEvento></eventoCTe></procEventoCTe>'
    const xml = `<soap:Envelope><soap:Body><cteDistDFeInteresseResponse><cteDistDFeInteresseResult><retDistDFeInt versao="1.00"><tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000005</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="procCTe_v4.00.xsd">${zip(cte)}</docZip><docZip NSU="000000000000002" schema="procEventoCTe_v4.00.xsd">${zip(ev)}</docZip><docZip NSU="000000000000003" schema="x">não é base64</docZip></loteDistDFeInt></retDistDFeInt></cteDistDFeInteresseResult></cteDistDFeInteresseResponse></soap:Body></soap:Envelope>`
    const r = parseDistResponse(xml)
    expect(r).toMatchObject({ cStat: '138', xMotivo: 'Documento(s) localizado(s)', ultNsu: '000000000000002', maxNsu: '000000000000005' })
    expect(r.docs.map((d) => [d.nsu, docKind(d)])).toEqual([
      ['000000000000001', 'CTE'],
      ['000000000000002', 'EVENTO'],
    ])
    expect(nsuLess(r.ultNsu, r.maxNsu)).toBe(true)
    expect(nsuLess('5', '000000000000005')).toBe(false)
    expect(unzipDoc('@@')).toBeNull()
    expect(() => parseDistResponse('<soap:Fault><soap:Text>Erro de certificado</soap:Text></soap:Fault>')).toThrow('SEFAZ: Erro de certificado')
  })

  it('ignora CT-e emitido há mais dos dias configurados (até 7)', () => {
    const now = new Date('2026-11-04T12:00:00-03:00')
    expect(withinDays('<dhEmi>2026-10-30T10:00:00-03:00</dhEmi>', 7, now)).toBe(true)
    expect(withinDays('<dhEmi>2026-10-20T10:00:00-03:00</dhEmi>', 7, now)).toBe(false)
    expect(withinDays('<x/>', 7, now)).toBe(true)
  })

  it('papel da empresa no CT-e pela raiz do CNPJ (matriz e filiais)', () => {
    expect(companyRoles({ tomadorDoc: '01704079000102', senderDoc: '01704079000285', recipientDoc: '99999999000191', expedDoc: null, recebDoc: null }, ['01704079000102', null])).toEqual(['TOMADOR', 'REMETENTE'])
    expect(companyRoles({ tomadorDoc: '12345678901', senderDoc: null, recipientDoc: null, expedDoc: null, recebDoc: null }, ['01704079000102'])).toEqual([])
  })

  it('lê o certificado A1: senha, titular, validade e CNPJ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-'))
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '30', '-subj', '/C=BR/O=ICP-Brasil/CN=EMPRESA TESTE LTDA:01704079000102'], { stdio: 'ignore' })
      execFileSync('openssl', ['pkcs12', '-export', '-out', join(dir, 't.pfx'), '-inkey', join(dir, 'k.pem'), '-in', join(dir, 'c.pem'), '-passout', 'pass:senha123'], { stdio: 'ignore' })
      const pfx = readFileSync(join(dir, 't.pfx'))
      const info = readCertificate(pfx, 'senha123')
      expect(info.cnpj).toBe('01704079000102')
      expect(info.subject).toBe('EMPRESA TESTE LTDA:01704079000102')
      expect(info.validTo.getTime()).toBeGreaterThan(Date.now())
      expect(() => readCertificate(pfx, 'errada')).toThrow('Senha do certificado incorreta.')
      expect(() => readCertificate(Buffer.from('xx'), 'a')).toThrow(/Não foi possível abrir/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
