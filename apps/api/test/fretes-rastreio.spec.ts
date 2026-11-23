import { describe, expect, it } from 'vitest'
import { isDelivery, parseSswTracking, trackingLine } from '../src/fretes/rastreio'

const ev = (o: Record<string, string>) => ({ dominio: 'TWT', filial: 'POA', cidade: 'PORTO ALEGRE / RS', descricao: '', nome_recebedor: '', nro_doc_recebedor: '', ...o })
const body = {
  success: true,
  message: 'Documento localizado com sucesso',
  documento: {
    header: { remetente: 'X', destinatario: 'Y', nro_nf: '92', pedido: '' },
    tracking: [
      ev({ data_hora: '2020-07-20T10:36:12', ocorrencia: 'MERCADORIA RECEBIDA PARA TRANSPORTE (80)', tipo: 'Informativo', data_hora_efetiva: '2020-07-20T10:36:12' }),
      ev({ data_hora: '2020-07-23T13:51:19', ocorrencia: 'MERCADORIA PRE-ENTREGUE (MOBILE) (02)', tipo: 'Pre-Entrega', data_hora_efetiva: '2020-07-23T13:51:12' }),
      ev({ data_hora: '2020-07-23T19:56:11', ocorrencia: 'MERCADORIA ENTREGUE (01)', tipo: 'Entrega', data_hora_efetiva: '2020-07-23T13:51:12' }),
    ],
  },
}

describe('rastreamento SSW (TW Transportes)', () => {
  it('lê as ocorrências, a mais recente primeiro, e a data efetiva da entrega', () => {
    const r = parseSswTracking(body)
    expect(r.found).toBe(true)
    expect(r.carrier).toBe('TWT')
    expect(r.events[0]!.occurrence).toBe('MERCADORIA ENTREGUE (01)')
    expect(r.deliveredAt).toBe('2020-07-23T16:51:12.000Z')
    expect(trackingLine(r)).toBe('MERCADORIA ENTREGUE · PORTO ALEGRE / RS')
  })
  it('pré-entrega não conta como entregue', () => {
    expect(isDelivery({ kind: 'Pre-Entrega', occurrence: 'MERCADORIA PRE-ENTREGUE (MOBILE) (02)' })).toBe(false)
    const r = parseSswTracking({ ...body, documento: { tracking: body.documento.tracking.slice(0, 2) } })
    expect(r.deliveredAt).toBeNull()
  })
  it('nota não encontrada', () => {
    expect(parseSswTracking({ success: false, message: 'Nenhum documento localizado' })).toMatchObject({ found: false, message: 'Nenhum documento localizado', events: [] })
  })
})
