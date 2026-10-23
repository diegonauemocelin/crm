import { describe, expect, it } from 'vitest'
import { DEFAULT_GOOGLE_ADS } from '../src/googleads/googleads'
import { OrigemAdsService } from '../src/leads/origem-ads.service'

// Atendimento marcado como Google Ads só quando o lead clicou num anúncio antes do contato.
function make(visits: Record<string, unknown>) {
  const leadAt = new Date('2026-10-23T14:00:00Z')
  const updates: { id: unknown; via: unknown }[] = []
  const prisma = {
    serviceRecord: { findMany: async () => [{ id: 'r1', leadId: 'l1', leadAt }] },
    lead: { findMany: async () => [{ id: 'l1', firstConversion: null, firstConversionAt: null, lastConversion: null, lastConversionAt: null }] },
    leadEvent: { findMany: async () => [] },
    siteVisitor: { findMany: async () => (Object.keys(visits).length ? [{ leadId: 'l1', firstTouch: visits, firstSeenAt: new Date('2026-10-23T13:50:00Z'), lastTouch: null, lastSeenAt: null }] : []) },
    captureSubmission: { findMany: async () => [] },
    $executeRaw: async (_s: TemplateStringsArray, via: unknown, ...rest: unknown[]) => {
      updates.push({ via, id: rest.at(-1) })
      return 1
    },
  }
  // A origem "WhatsApp E-commerce" está marcada para o envio ao Google: não pode marcar o atendimento.
  const settings = { get: async () => ({ ...DEFAULT_GOOGLE_ADS, originIds: ['origem-whatsapp'] }) }
  return { svc: new OrigemAdsService(prisma as never, settings as never), updates }
}

describe('Origem Google Ads do atendimento', () => {
  it('quem chamou direto no WhatsApp não é Google Ads, mesmo com a origem marcada para o envio', async () => {
    const { svc, updates } = make({})
    await svc.syncRecords('t1', ['r1'])
    expect(updates).toEqual([{ id: 'r1', via: null }])
  })

  it('quem clicou no anúncio antes do contato é Google Ads', async () => {
    const { svc, updates } = make({ landing: 'https://loja.exemplo/pecas?gclid=abc123', source: 'google', medium: 'cpc' })
    await svc.syncRecords('t1', ['r1'])
    expect(updates).toEqual([{ id: 'r1', via: 'ANUNCIO' }])
  })
})
