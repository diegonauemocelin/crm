import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SettingsService } from '../../settings/settings.service'
import { aggregateTaxRates, EMPTY_TAX_RATES, isMercadoEnvios, type NfeTaxItem, parseNfeTaxes, type TaxRates } from './impostos'
import { PRECOS_TAX_KEY } from './margem'

/** Só as notas do último ano entram na média (a carga muda com a legislação e o mix de produtos). */
const WINDOW_DAYS = 365

/**
 * Impostos das vendas do Mercado Livre: a importação de XML de NF-e (Fretes › Pedidos) chama record() para cada nota
 * autorizada; as do Mercado Envios ficam guardadas com os impostos por item e as médias são recalculadas no fim.
 */
@Injectable()
export class MarketplaceTaxService {
  private readonly logger = new Logger(MarketplaceTaxService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** CNPJs das transportadoras cadastradas com o nome Mercado Envios (Fretes › Transportadoras), se houver. */
  async knownCnpjs(tenantId: string) {
    const rows = await this.prisma.freightCarrier.findMany({ where: { tenantId, OR: [{ name: { contains: 'mercado envios', mode: 'insensitive' } }, { legalName: { contains: 'mercado envios', mode: 'insensitive' } }] }, select: { cnpj: true } })
    return rows.map((r) => r.cnpj)
  }

  /** Guarda a nota se o transportador for o Mercado Envios. true = guardou (nova ou atualizada). */
  async record(tenantId: string, xml: string, nf: { key: string; issuedAt: string | null; carrierName: string | null; carrierCnpj: string | null }, known: readonly string[]) {
    if (!isMercadoEnvios(nf.carrierName, nf.carrierCnpj, known)) return false
    let t
    try {
      t = parseNfeTaxes(xml)
    } catch (e) {
      this.logger.warn(`Impostos da NF-e ${nf.key}: ${(e as Error).message}`)
      return false
    }
    if (!t.items.length) return false
    const data = {
      issuedAt: nf.issuedAt && !Number.isNaN(Date.parse(nf.issuedAt)) ? new Date(nf.issuedAt) : null,
      carrierName: nf.carrierName,
      carrierCnpj: nf.carrierCnpj,
      productsValue: t.productsValue,
      taxValue: t.taxValue,
      items: t.items as unknown as Prisma.InputJsonValue,
    }
    await this.prisma.marketplaceNfeTax.upsert({ where: { tenantId_key: { tenantId, key: nf.key } }, create: { tenantId, key: nf.key, ...data }, update: data })
    return true
  }

  async cancel(tenantId: string, key: string) {
    const r = await this.prisma.marketplaceNfeTax.updateMany({ where: { tenantId, key, cancelled: false }, data: { cancelled: true } })
    return r.count > 0
  }

  /** Recalcula as médias (SKU, NCM e geral) e guarda nas configurações da empresa. */
  async recompute(tenantId: string): Promise<TaxRates> {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    const rows = await this.prisma.marketplaceNfeTax.findMany({ where: { tenantId, cancelled: false, OR: [{ issuedAt: null }, { issuedAt: { gte: since } }] }, select: { key: true, items: true } })
    const rates = aggregateTaxRates(rows.map((r) => ({ key: r.key, items: (r.items as unknown as NfeTaxItem[]) ?? [] })))
    await this.settings.set(tenantId, PRECOS_TAX_KEY, rates)
    return rates
  }

  async rates(tenantId: string): Promise<TaxRates> {
    return this.settings.get<TaxRates>(tenantId, PRECOS_TAX_KEY, EMPTY_TAX_RATES)
  }
}
