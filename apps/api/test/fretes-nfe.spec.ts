import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { confrontNfeCte, type CteSide, type NfeSide } from '../src/fretes/confronto'
import { parseCteXml } from '../src/fretes/cte'
import { expandUpload, hasFreight, isCancellation, parseNfeEvent, parseNfeXml, unsafeXml } from '../src/fretes/nfe'

// NF-e fictícia (CNPJs de exemplo, sem dados reais): venda de Maravilha/SC para Cascavel/PR, frete CIF por transportadora.
const KEY = '42261111222333000181550010000123451000123456'
const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${KEY}" versao="4.00">
    <ide><cUF>42</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>12345</nNF><dhEmi>2026-11-05T10:20:00-03:00</dhEmi><tpNF>1</tpNF></ide>
    <emit><CNPJ>11222333000181</CNPJ><xNome>EMPRESA EXEMPLO LTDA</xNome></emit>
    <dest><CNPJ>44555666000199</CNPJ><xNome>CLIENTE EXEMPLO &amp; CIA LTDA</xNome>
      <enderDest><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>4104808</cMun><xMun>Cascavel</xMun><UF>PR</UF><CEP>85804606</CEP></enderDest></dest>
    <det nItem="1"><prod><cProd>PROD001</cProd><xProd>FILTRO</xProd><qCom>2.0000</qCom><vProd>91.80</vProd></prod></det>
    <total><ICMSTot><vProd>1400.00</vProd><vFrete>100.00</vFrete><vNF>1500.00</vNF></ICMSTot></total>
    <transp><modFrete>0</modFrete>
      <transporta><CNPJ>77888999000155</CNPJ><xNome>TRANSPORTES EXEMPLO</xNome><UF>SC</UF></transporta>
      <vol><qVol>2</qVol><esp>CAIXA</esp><pesoL>10.500</pesoL><pesoB>11.250</pesoB></vol>
      <vol><qVol>1</qVol><esp>PALETE</esp><pesoL>40.000</pesoL><pesoB>42.000</pesoB></vol>
    </transp>
  </infNFe></NFe>
  <protNFe versao="4.00"><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat></infProt></protNFe>
</nfeProc>`

const CANCEL = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00"><infEvento Id="ID110111${KEY}01"><cOrgao>42</cOrgao><tpAmb>1</tpAmb><CNPJ>11222333000181</CNPJ><chNFe>${KEY}</chNFe>
    <dhEvento>2026-11-05T15:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>
    <detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>142260000000001</nProt><xJust>Pedido cancelado pelo cliente</xJust></detEvento></infEvento></evento>
  <retEvento versao="1.00"><infEvento><cStat>135</cStat><chNFe>${KEY}</chNFe><tpEvento>110111</tpEvento></infEvento></retEvento>
</procEventoNFe>`

describe('NF-e: leitura do XML', () => {
  it('lê chave, valores, frete, transportadora, volumes, pesos, destino e protocolo', () => {
    const nf = parseNfeXml(NFE)
    expect(nf).toMatchObject({
      key: KEY,
      number: '12345',
      series: '1',
      model: '55',
      direction: '1',
      emitCnpj: '11222333000181',
      issuedAt: '2026-11-05T10:20:00-03:00',
      value: 1500,
      freightValue: 100,
      freightMode: '0',
      carrierCnpj: '77888999000155',
      volumes: 3,
      grossWeight: 53.25,
      netWeight: 50.5,
      destName: 'CLIENTE EXEMPLO & CIA LTDA',
      destCnpj: '44555666000199',
      destPersonType: 'PJ',
      destZip: '85804606',
      destCity: 'Cascavel',
      destUf: 'PR',
      destIbge: '4104808',
      protocolStatus: '100',
    })
    expect(hasFreight(nf)).toBe(true)
    expect(hasFreight({ freightMode: '9' })).toBe(false)
    expect(hasFreight({ freightMode: '3' })).toBe(false)
  })

  it('destinatário pessoa física: o CPF não sai do XML', () => {
    const pf = parseNfeXml(NFE.replace('<CNPJ>44555666000199</CNPJ>', '<CPF>12345678909</CPF>'))
    expect(pf.destCnpj).toBeNull()
    expect(pf.destPersonType).toBe('PF')
    expect(JSON.stringify(pf)).not.toContain('12345678909')
  })

  it('recusa o que não é NF-e e XML com DOCTYPE/entidade (XXE)', () => {
    expect(() => parseNfeXml('<cteProc/>')).toThrow()
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${NFE.replace(/^<\?xml[^>]*>/, '')}`
    expect(unsafeXml(xxe)).toBe(true)
    expect(() => parseNfeXml(xxe)).toThrow(/DOCTYPE/)
    expect(parseNfeEvent(xxe)).toBeNull()
  })

  it('evento de cancelamento (110111, registrado)', () => {
    const ev = parseNfeEvent(CANCEL)!
    expect(ev).toEqual({ key: KEY, type: '110111', status: '135', emitCnpj: '11222333000181' })
    expect(isCancellation(ev)).toBe(true)
    expect(isCancellation({ ...ev, status: '573' })).toBe(false)
    expect(isCancellation({ ...ev, type: '110110' })).toBe(false)
    expect(parseNfeEvent(NFE)).toBeNull()
  })
})

describe('NF-e: arquivos enviados', () => {
  const enc = (s: string) => new TextEncoder().encode(s)

  it('abre o .zip: só .xml, sem caminho, com limites', () => {
    const zip = Buffer.from(zipSync({ 'notas/../../etc/nota1.xml': enc(NFE), 'leia-me.txt': enc('x'), 'sub/cancel.XML': enc(CANCEL), 'grande.xml': new Uint8Array(3000) }))
    const r = expandUpload([{ name: 'xml-do-dia.zip', buffer: zip }], { files: 10, entryBytes: 2500, totalBytes: 1_000_000 })
    expect(r.docs.map((d) => d.name).sort()).toEqual(['xml-do-dia.zip › cancel.XML', 'xml-do-dia.zip › nota1.xml'])
    expect(r.skipped).toEqual([{ name: 'xml-do-dia.zip › grande.xml', reason: 'XML maior que 2 MB.' }])
    expect(r.docs.find((d) => d.name.endsWith('nota1.xml'))!.text).toBe(NFE)
  })

  it('XML solto, arquivo estranho, zip corrompido e excesso de arquivos', () => {
    const r = expandUpload([
      { name: 'C:\\temp\\nota.xml', buffer: Buffer.from(NFE) },
      { name: 'foto.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ])
    expect(r.docs.map((d) => d.name)).toEqual(['nota.xml'])
    expect(r.skipped).toEqual([{ name: 'foto.png', reason: 'Não é .xml nem .zip.' }])
    expect(() => expandUpload([{ name: 'x.zip', buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0]) }])).toThrow(/Não foi possível abrir/)
    const many = Buffer.from(zipSync({ 'a.xml': enc('<a/>'), 'b.xml': enc('<b/>'), 'c.xml': enc('<c/>') }))
    expect(() => expandUpload([{ name: 'm.zip', buffer: many }], { files: 2, entryBytes: 1000, totalBytes: 10_000 })).toThrow(/mais de 2/)
  })
})

describe('CT-e: volumes e peso em toneladas', () => {
  const cte = (infQ: string) => `<cteProc><CTe><infCte Id="CTe${'4'.repeat(44)}"><ide><nCT>1</nCT><serie>1</serie></ide><emit><CNPJ>77888999000155</CNPJ></emit>
    <vPrest><vTPrest>100.00</vTPrest></vPrest><infCTeNorm><infCarga><vCarga>1500.00</vCarga>${infQ}</infCarga>
    <infDoc><infNFe><chave>${KEY}</chave></infNFe></infDoc></infCTeNorm></infCte></CTe></cteProc>`
  it('lê a quantidade em unidades e converte toneladas', () => {
    const c = parseCteXml(cte('<infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>53.2500</qCarga></infQ><infQ><cUnid>03</cUnid><tpMed>VOLUMES</tpMed><qCarga>3.0000</qCarga></infQ>'))
    expect(c).toMatchObject({ weight: 53.25, volumes: 3, nfeKeys: [KEY], cargoValue: 1500 })
    expect(parseCteXml(cte('<infQ><cUnid>02</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1.2505</qCarga></infQ>'))).toMatchObject({ weight: 1250.5, volumes: null })
  })
})

describe('Confronto NF-e × CT-e', () => {
  const nf: NfeSide = { key: KEY, number: 12345, value: 1500, grossWeight: 53.25, volumes: 3, destUf: 'PR', destCity: 'Cascavel', carrierCnpj: '77888999000155', freightMode: '0', emitCnpj: '11222333000181', destCnpj: '44555666000199' }
  const cte: CteSide = { nfeKeys: [KEY], cargoValue: 1500, weight: 53.25, volumes: 3, ufFim: 'PR', cityFim: 'CASCAVEL', emitCnpj: '77888999000270', tomadorDoc: '11222333000262' }

  it('tudo confere (transportadora e tomador pela raiz do CNPJ, cidade sem acento/caixa)', () => {
    const r = confrontNfeCte(cte, [nf])
    expect(r.status).toBe('OK')
    expect(r.divergences).toEqual([])
    expect(r.checks.map((c) => `${c.code}:${c.status}`)).toEqual(['NOTAS:OK', 'VALOR:OK', 'PESO:OK', 'VOLUMES:OK', 'DESTINO:OK', 'TRANSPORTADORA:OK', 'TOMADOR:OK'])
  })

  it('aponta as divergências com frases claras', () => {
    const r = confrontNfeCte({ ...cte, cargoValue: 1600, weight: 60, volumes: 4, ufFim: 'SC', cityFim: 'Chapecó', emitCnpj: '99888777000166', tomadorDoc: '44555666000199' }, [nf])
    expect(r.status).toBe('DIVERGENTE')
    expect(r.divergences).toEqual([
      'Valor da carga maior que o das notas',
      'Peso cobrado maior que o da nota',
      'Volumes diferentes da nota',
      'Destino diferente da nota',
      'Transportadora diferente da nota',
      'Frete CIF na nota, mas o tomador do CT-e é outro',
    ])
  })

  it('folgas: peso ±2% ou 1 kg (vale a maior), valor ±R$ 1; configuráveis', () => {
    expect(confrontNfeCte({ ...cte, weight: 54.3, cargoValue: 1501 }, [nf]).status).toBe('OK')
    expect(confrontNfeCte({ ...cte, weight: 54.4 }, [nf]).divergences).toEqual(['Peso cobrado maior que o da nota'])
    expect(confrontNfeCte({ ...cte, weight: 50 }, [nf]).divergences).toEqual(['Peso cobrado menor que o da nota'])
    expect(confrontNfeCte({ ...cte, cargoValue: 1498 }, [nf]).divergences).toEqual(['Valor da carga menor que o das notas'])
    expect(confrontNfeCte({ ...cte, weight: 60 }, [nf], { pesoPercentual: 15, pesoKg: 0, valor: 1 }).status).toBe('OK')
    // 2% de 1.000 kg = 20 kg de folga.
    expect(confrontNfeCte({ ...cte, weight: 1019 }, [{ ...nf, grossWeight: 1000 }]).status).toBe('OK')
  })

  it('soma várias notas; nota faltando não deixa somar', () => {
    const k2 = KEY.replace(/3456$/, '3457')
    const nf2: NfeSide = { ...nf, key: k2, number: 12346, value: 500, grossWeight: 10, volumes: 1 }
    const both = confrontNfeCte({ ...cte, nfeKeys: [KEY, k2], cargoValue: 2000, weight: 63.25, volumes: 4 }, [nf, nf2])
    expect(both.status).toBe('OK')
    const one = confrontNfeCte({ ...cte, nfeKeys: [KEY, k2] }, [nf])
    expect(one.divergences).toEqual(['Nota não encontrada (importe o XML)'])
    expect(one.checks.find((c) => c.code === 'PESO')!.status).toBe('SEM_DADO')
    expect(one.notes).toEqual([{ key: KEY, number: '12345', found: true }, { key: k2, number: '12345', found: false }])
  })

  it('sem nota importada, sem chave no CT-e, FOB e dados ausentes', () => {
    expect(confrontNfeCte(cte, []).status).toBe('SEM_NOTA')
    expect(confrontNfeCte(cte, []).divergences).toEqual(['Nota não encontrada'])
    expect(confrontNfeCte({ ...cte, nfeKeys: [] }, [nf]).status).toBe('SEM_CHAVE')
    const fob = { ...nf, freightMode: '1' }
    expect(confrontNfeCte({ ...cte, tomadorDoc: '44555666000199' }, [fob]).status).toBe('OK')
    expect(confrontNfeCte(cte, [fob]).divergences).toEqual(['Frete FOB na nota, mas o tomador do CT-e não é o destinatário'])
    const r = confrontNfeCte({ ...cte, volumes: null }, [{ ...nf, carrierCnpj: null, freightMode: '9' }])
    expect(r.status).toBe('OK')
    expect(r.checks.filter((c) => c.status === 'SEM_DADO').map((c) => c.code)).toEqual(['VOLUMES', 'TRANSPORTADORA', 'TOMADOR'])
  })
})
