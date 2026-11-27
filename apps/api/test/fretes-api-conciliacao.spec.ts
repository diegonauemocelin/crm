import { describe, expect, it } from 'vitest'
import { onlineIntegrationFor } from '../src/fretes/integracoes'

describe('CT-e de transportadora cotada pela API', () => {
  const cfg = { braspress: { enabled: true }, jadlog: { enabled: false }, correios: { enabled: true }, ssw: { enabled: true, name: 'TW Transportes' } } as never
  it('reconhece pela integração ligada e pelo nome', () => {
    expect(onlineIntegrationFor(cfg, 'BRASPRESS TRANSPORTES URGENTES LTDA')).toBe('Braspress')
    expect(onlineIntegrationFor(cfg, null, 'Empresa Brasileira de Correios e Telégrafos')).toBe('Correios')
    expect(onlineIntegrationFor(cfg, 'TW TRANSPORTES E LOGISTICA LTDA')).toBe('TW Transportes')
  })
  it('integração desligada ou outra transportadora: não', () => {
    expect(onlineIntegrationFor(cfg, 'JADLOG LOGISTICA S.A')).toBeNull()
    expect(onlineIntegrationFor(cfg, 'ZANOTELLI TRANSPORTES')).toBeNull()
    expect(onlineIntegrationFor(cfg, 'TWIST CARGAS')).toBeNull()
    expect(onlineIntegrationFor(null, 'BRASPRESS')).toBeNull()
  })
})
