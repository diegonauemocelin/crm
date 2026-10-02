import { describe, expect, it } from 'vitest'
import { normalizePhone, parseBrDate, parseMoney, regionOf, ufFromPhone, ufFromText } from '../src/atendimento/br'
import { buildDashboard, type DashRow } from '../src/atendimento/dashboard'
import { sheetCsvUrl } from '../src/atendimento/import.service'
import { findHeader, mapRow, mapSheet, parseCsv, type RowIssue } from '../src/atendimento/planilha'
import { applyAutomaticFields, diffRecord, isOverdue, validateRecord } from '../src/atendimento/regras'

describe('dados brasileiros', () => {
  it('normaliza telefones em vários formatos para E.164', () => {
    expect(normalizePhone('55 47 9647-0159')).toBe('+554796470159')
    expect(normalizePhone('55 13 99143-1193')).toBe('+5513991431193')
    expect(normalizePhone('(51) 99999-9999')).toBe('+5551999999999')
    expect(normalizePhone('5547996470159')).toBe('+5547996470159')
    expect(normalizePhone('47 3333-4444')).toBe('+554733334444')
  })

  it('recusa o que não é telefone brasileiro', () => {
    expect(normalizePhone('compras cotando')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('00 99999-9999')).toBeNull()
    expect(normalizePhone('(47) 89999-9999')).toBeNull()
  })

  it('identifica estado pelo nome, sigla ou DDD', () => {
    expect(ufFromText('São Paulo')).toBe('SP')
    expect(ufFromText('sao paulo')).toBe('SP')
    expect(ufFromText('rs')).toBe('RS')
    expect(ufFromText('Paraguai')).toBeNull()
    expect(ufFromPhone('+554796470159')).toBe('SC')
    expect(ufFromPhone('+5531984049637')).toBe('MG')
    expect(regionOf('PR')).toBe('Sul')
    expect(regionOf('BA')).toBe('Nordeste')
  })

  it('converte valores em reais e datas', () => {
    expect(parseMoney('R$ 9.540,00')).toBe(9540)
    expect(parseMoney('R$ 5.894,61')).toBe(5894.61)
    expect(parseMoney('')).toBeNull()
    expect(parseBrDate('17/07/2026')?.toISOString()).toBe('2026-07-17T15:00:00.000Z')
    expect(parseBrDate('04/08/0206')).toBeNull()
    expect(parseBrDate('31/02/2026')).toBeNull()
  })
})

describe('importação da planilha', () => {
  const csv = [
    ',,Pré e Pós Vendas,,,,,,,,,,,,,,',
    'Data,Cód. Cliente,Nome,Número,Vendedor,Origem,Tipo Cliente,Região - Estado,Produto/Serviço,Repassou,Retornou,Venda Realizada,Venda Perdida,Motivos de Perda,N° NF,Valor,Observação Pré e Pós Vendas',
    '17/07/2026,21.555,~METZLER - Claudio,55 47 9647-0159,Evandro - Itajaí,WhatsApp,Revenda,Santa Catarina,XCMG,TRUE,FALSE,FALSE,TRUE,Não respondeu,,,Orçamento enviado',
    '30/06/2026,22.518,~Jose Aldo,55 13 99143-1193,Davi,WhatsApp,Revenda,São Paulo,"JCB, Motor",TRUE,TRUE,TRUE,FALSE,Vendeu,144833,"R$ 9.540,00",vendeu',
    '17/07/2026,s/c,Cleber,55 32 9909-1451,Davi,RD Station,Não informado,Paraguai,,TRUE,FALSE,FALSE,,Aguardando Vendedor,,,',
    ',,,,,,,,,FALSE,FALSE,FALSE,FALSE,,,,',
    '04/08/0206,1,Erro,55 11 99999-9999,Davi,,,,,FALSE,FALSE,FALSE,FALSE,,,,',
  ].join('\n')

  it('encontra o cabeçalho depois das linhas de título', () => {
    const h = findHeader(parseCsv(csv))
    expect(h?.index).toBe(1)
    expect(h?.map.nome).toBe(2)
  })

  it('converte as linhas aplicando as regras combinadas com a empresa', () => {
    const { records, issues } = mapSheet(csv)
    expect(records).toHaveLength(3)
    const [lost, sold, waiting] = records as [typeof records[0], typeof records[0], typeof records[0]]

    expect(lost.name).toBe('METZLER - Claudio')
    expect(lost.seller).toBe('Evandro')
    expect(lost.phone).toBe('+554796470159')
    expect(lost.state).toBe('SC')
    expect(lost.saleStatus).toBe('NAO')
    expect(lost.lostReason).toBe('Não respondeu')
    expect(lost.returnStatus).toBe('NAO')
    expect(lost.brands).toEqual(['XCMG'])

    expect(sold.saleStatus).toBe('SIM')
    expect(sold.lostReason).toBeNull()
    expect(sold.saleValue).toBe(9540)
    expect(sold.invoiceNumber).toBe('144833')
    expect(sold.brands).toEqual(['JCB'])
    expect(sold.partTypes).toEqual(['Motor'])
    expect(sold.returnStatus).toBe('SIM')

    expect(waiting.customerCode).toBeNull()
    expect(waiting.customerType).toBeNull()
    expect(waiting.country).toBe('Paraguai')
    expect(waiting.state).toBeNull()
    expect(waiting.returnStatus).toBe('PENDENTE')
    expect(waiting.saleStatus).toBe('NEGOCIACAO')

    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toMatch(/Data inválida "04\/08\/0206"/)
  })

  it('gera a mesma chave para a mesma linha (reimportar não duplica)', () => {
    const a = mapSheet(csv).records.map((r) => r.externalKey)
    const b = mapSheet(csv).records.map((r) => r.externalKey)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
  })

  it('guarda o telefone inválido nas observações em vez de perder a informação', () => {
    const issues: RowIssue[] = []
    const h = findHeader(parseCsv(csv))!
    const r = mapRow(['17/07/2026', '', 'Fulano', 'ligar depois', '', '', '', '', '', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '', '', '', ''], h.map, 9, issues)
    expect(r?.phone).toBeNull()
    expect(r?.notes).toContain('Telefone original: ligar depois')
  })

  it('só busca planilhas do Google (proteção contra SSRF)', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/1QgR4p155CqCATkcvN9nD7Cq88ScP2veQDrWsnCqoi44/edit?gid=307777003#gid=307777003')).toBe(
      'https://docs.google.com/spreadsheets/d/1QgR4p155CqCATkcvN9nD7Cq88ScP2veQDrWsnCqoi44/export?format=csv&gid=307777003',
    )
    expect(() => sheetCsvUrl('http://169.254.169.254/latest/meta-data')).toThrow()
    expect(() => sheetCsvUrl('https://docs.google.com.evil.com/spreadsheets/d/1QgR4p155CqCATkcvN9nD7Cq88ScP2veQDrWsnCqoi44')).toThrow()
    expect(() => sheetCsvUrl('http://docs.google.com/spreadsheets/d/1QgR4p155CqCATkcvN9nD7Cq88ScP2veQDrWsnCqoi44')).toThrow()
  })
})

describe('regras do atendimento', () => {
  const base = { forwarded: false, returnStatus: null, saleStatus: 'NEGOCIACAO' as const, lostReasonId: null, invoiceNumber: null, saleValue: null }

  it('exige motivo na venda perdida e NF + valor na venda realizada', () => {
    expect(validateRecord({ ...base, saleStatus: 'NAO' })).toMatch(/motivo/)
    expect(validateRecord({ ...base, saleStatus: 'NAO', lostReasonId: 'x' })).toBeNull()
    expect(validateRecord({ ...base, saleStatus: 'SIM', saleValue: 100 })).toMatch(/nota fiscal/)
    expect(validateRecord({ ...base, saleStatus: 'SIM', invoiceNumber: '123' })).toMatch(/valor/)
    expect(validateRecord({ ...base, saleStatus: 'SIM', invoiceNumber: '123', saleValue: 100 })).toBeNull()
    expect(validateRecord({ ...base, returnStatus: 'SIM' })).toMatch(/repassado/)
  })

  it('ao repassar marca retorno pendente e registra a hora; ao retornar registra a hora do retorno', () => {
    const t0 = new Date('2026-10-01T12:00:00Z')
    const repassado = applyAutomaticFields({ ...base, forwarded: true }, base, t0)
    expect(repassado.returnStatus).toBe('PENDENTE')
    expect(repassado.forwardedAt).toEqual(t0)
    const t1 = new Date('2026-10-01T15:00:00Z')
    const retornou = applyAutomaticFields({ ...repassado, returnStatus: 'SIM' }, repassado, t1)
    expect(retornou.returnedAt).toEqual(t1)
  })

  it('limpa campos que não se aplicam à situação', () => {
    const r = applyAutomaticFields({ ...base, saleStatus: 'NEGOCIACAO', lostReasonId: 'x', invoiceNumber: '1', saleValue: 10 }, null)
    expect(r.lostReasonId).toBeNull()
    expect(r.invoiceNumber).toBeNull()
    expect(r.saleValue).toBeNull()
  })

  it('alerta de retorno: só para repassados pendentes acima do prazo', () => {
    const now = new Date('2026-10-02T12:00:00Z')
    const old = new Date('2026-10-01T10:00:00Z')
    expect(isOverdue({ forwarded: true, returnStatus: 'PENDENTE', forwardedAt: old }, 24, now)).toBe(true)
    expect(isOverdue({ forwarded: true, returnStatus: 'PENDENTE', forwardedAt: old }, 48, now)).toBe(false)
    expect(isOverdue({ forwarded: true, returnStatus: 'SIM', forwardedAt: old }, 24, now)).toBe(false)
    expect(isOverdue({ forwarded: true, returnStatus: 'PENDENTE', forwardedAt: null }, 24, now)).toBe(false)
  })

  it('histórico registra só o que mudou', () => {
    const changes = diffRecord({ name: 'A', brandIds: ['1', '2'], saleValue: 10 }, { name: 'A', brandIds: ['2', '1'], saleValue: 12 })
    expect(Object.keys(changes)).toEqual(['saleValue'])
  })
})

describe('dashboard', () => {
  const row = (o: Partial<DashRow>): DashRow => ({
    leadAt: new Date('2026-09-10T15:00:00Z'),
    sellerId: 's1',
    originId: 'o1',
    customerTypeId: null,
    state: 'SP',
    country: 'BR',
    brandIds: [],
    partTypeIds: [],
    forwarded: false,
    forwardedAt: null,
    returnStatus: null,
    returnedAt: null,
    saleStatus: 'NEGOCIACAO',
    lostReasonId: null,
    saleValue: null,
    ...o,
  })

  it('calcula taxas, ticket médio, tempo de retorno e Pareto de perdas', () => {
    const rows = [
      row({ forwarded: true, forwardedAt: new Date('2026-09-10T10:00:00Z'), returnStatus: 'SIM', returnedAt: new Date('2026-09-10T14:00:00Z'), saleStatus: 'SIM', saleValue: 1000 }),
      row({ forwarded: true, returnStatus: 'NAO', saleStatus: 'SIM', saleValue: 500, sellerId: 's2' }),
      row({ saleStatus: 'NAO', lostReasonId: 'semProduto' }),
      row({ saleStatus: 'NAO', lostReasonId: 'semProduto' }),
      row({ saleStatus: 'NAO', lostReasonId: 'preco', state: null, country: 'Paraguai' }),
    ]
    const d = buildDashboard(rows, [row({})], { from: '2026-09-01', to: '2026-09-30', alertHours: 24 })
    expect(d.kpis.total).toBe(5)
    expect(d.kpis.forwardRate).toBeCloseTo(0.4)
    expect(d.kpis.returnRate).toBeCloseTo(0.5)
    expect(d.kpis.avgReturnHours).toBe(4)
    expect(d.kpis.sales).toBe(2)
    expect(d.kpis.revenue).toBe(1500)
    expect(d.kpis.ticket).toBe(750)
    expect(d.kpis.conversion).toBeCloseTo(0.4)
    expect(d.previousKpis.total).toBe(1)
    expect(d.lostReasons[0]).toEqual({ id: 'semProduto', count: 2, cumulative: 2 / 3 })
    expect(d.lostReasons.at(-1)!.cumulative).toBe(1)
    expect(d.sellers[0]!.id).toBe('s1')
    expect(d.byState.find((s) => s.id === 'EX')?.leads).toBe(1)
    expect(d.granularity).toBe('dia')
  })
})
