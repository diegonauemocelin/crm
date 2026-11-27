import { describe, expect, it } from 'vitest'
import { cteXmlExtras, parseCteAi } from '../src/fretes/cte-ia'

describe('análise inteligente do CT-e', () => {
  it('tira do XML pesos, produto, tomador e observações', () => {
    const xml = '<cteProc><CTe><infCte><ide><toma3><toma>0</toma></toma3></ide><compl><xObs>Produto:[ECOMM_CORP] cliente retira no aeroporto</xObs></compl><infCTeNorm><infCarga><vCarga>13642.27</vCarga><proPred>CABECOTE JUNTA</proPred><infQ><cUnid>01</cUnid><tpMed>PESO REAL</tpMed><qCarga>67.2000</qCarga></infQ><infQ><cUnid>01</cUnid><tpMed>PESO CUBADO</tpMed><qCarga>25.0000</qCarga></infQ></infCarga></infCTeNorm></infCte></CTe></cteProc>'
    const r = cteXmlExtras(xml)
    expect(r.produtoPredominante).toBe('CABECOTE JUNTA')
    expect(r.tomador).toBe('Remetente')
    expect(r.quantidades).toEqual([{ medida: 'PESO REAL', unidade: '01', quantidade: 67.2 }, { medida: 'PESO CUBADO', unidade: '01', quantidade: 25 }])
    expect(r.observacoes).toContain('ECOMM_CORP')
  })

  it('lê a resposta da IA (inclusive dentro de ```json) e normaliza os campos', () => {
    const r = parseCteAi('```json\n{"veredito":"COBRADO_A_MAIS","resumo":"Frete 10% acima.","itens":[{"componente":"FRETE PESO","tabela":"R$ 193,60","cobrado":"R$ 212,96","explicacao":"+10%","acao":"PERGUNTAR"},{"componente":"X","acao":"QUALQUER"}],"acoes":[{"tipo":"CONTESTAR","texto":"Contestar"}],"perguntasTransportadora":["De onde vêm os 10%?"]}\n```')
    expect(r.veredito).toBe('COBRADO_A_MAIS')
    expect(r.itens[0]).toMatchObject({ componente: 'FRETE PESO', acao: 'PERGUNTAR' })
    expect(r.itens[1]!.acao).toBe('CONFERIR')
    expect(r.acoes).toHaveLength(1)
    expect(r.perguntasTransportadora).toEqual(['De onde vêm os 10%?'])
  })

  it('resposta fora do formato vira erro claro', () => {
    expect(() => parseCteAi('não sei')).toThrow(/formato esperado/)
    expect(() => parseCteAi('{"veredito":"OK"}')).toThrow(/formato esperado/)
  })
})
