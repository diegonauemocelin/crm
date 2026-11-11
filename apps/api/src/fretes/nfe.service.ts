import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { allowedUnits, assertCan } from './acesso'
import { CteService } from './cte.service'
import { MarketplaceTaxService } from '../marketplaces/precos/impostos.service'
import { expandUpload, hasFreight, isCancellation, type NfeData, parseNfeEvent, parseNfeXml, unsafeXml } from './nfe'

const MAX_ISSUES = 200

export interface NfeImportCounts {
  novas: number
  existentes: number
  canceladas: number
  ignoradas: number
  erros: number
  pedidosCriados: number
  ctesLigados: number
}

/**
 * Importação dos XMLs das NF-e de saída (o .zip do dia baixado do ERP): cada nota autorizada, emitida por um CNPJ da
 * empresa, cria o pedido de frete (ou completa o que já tem a chave) e liga os CT-es que citam a nota. Cancelamentos
 * (procEventoNFe 110111) cancelam a nota e o pedido. Repetidas são puladas pela chave.
 */
@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctes: CteService,
    private readonly mlTaxes: MarketplaceTaxService,
  ) {}

  /** CNPJs da empresa: filiais (Fretes › Filiais) e o certificado da captura na SEFAZ. */
  private async ownUnits(tenantId: string) {
    const [units, sefaz] = await Promise.all([
      this.prisma.unit.findMany({ where: { tenantId }, select: { id: true, cnpj: true, isHeadquarters: true, zip: true, active: true } }),
      this.prisma.freightSefazConfig.findMany({ where: { tenantId }, select: { cnpj: true } }),
    ])
    const cnpjs = new Set([...units.map((u) => (u.cnpj ?? '').replace(/\D/g, '')), ...sefaz.map((s) => s.cnpj)].filter((c) => c.length === 14))
    return { units, cnpjs }
  }

  async importXml(user: AuthUser, files: Express.Multer.File[], ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'create')
    if (!files?.length) throw new BadRequestException('Envie o .zip com os XMLs das notas (ou os arquivos .xml).')
    let expanded: ReturnType<typeof expandUpload>
    try {
      expanded = expandUpload(files.map((f) => ({ name: f.originalname, buffer: f.buffer })))
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    const T = user.tenantId
    const { units, cnpjs } = await this.ownUnits(T)
    if (!cnpjs.size) throw new BadRequestException('Cadastre o CNPJ das filiais em Fretes › Filiais: só entram notas emitidas pela empresa.')
    const allowed = allowedUnits(user, 'fretes_pedidos')
    const importId = randomUUID()
    const counts: NfeImportCounts = { novas: 0, existentes: 0, canceladas: 0, ignoradas: 0, erros: 0, pedidosCriados: 0, ctesLigados: 0 }
    const issues: { file: string; reason: string; kind: 'ignorada' | 'erro' }[] = []
    const issue = (file: string, reason: string, kind: 'ignorada' | 'erro') => {
      counts[kind === 'erro' ? 'erros' : 'ignoradas']++
      if (issues.length < MAX_ISSUES) issues.push({ file, reason, kind })
    }
    for (const s of expanded.skipped) issue(s.name, s.reason, 'ignorada')
    // Impostos das vendas do Mercado Livre (Marketplaces › Preços e promoções): notas do Mercado Envios.
    const knownMe = await this.mlTaxes.knownCnpjs(T).catch(() => [] as string[])
    let mlTaxChanged = false
    // Notas primeiro, cancelamentos depois (o cancelamento pode vir no mesmo .zip da nota).
    const docs = [...expanded.docs].sort((a, b) => Number(/infEvento/.test(a.text)) - Number(/infEvento/.test(b.text)))
    for (const d of docs) {
      try {
        if (unsafeXml(d.text)) {
          issue(d.name, 'XML com DOCTYPE/entidades não é aceito.', 'erro')
          continue
        }
        const ev = parseNfeEvent(d.text)
        if (ev) {
          if (!isCancellation(ev)) {
            issue(d.name, `Evento ${ev.type} da NF-e ignorado (só o cancelamento é usado).`, 'ignorada')
            continue
          }
          if (await this.mlTaxes.cancel(T, ev.key).catch(() => false)) mlTaxChanged = true
          const done = await this.cancel(T, ev.key, user)
          if (done === 'NAO_ENCONTRADA') issue(d.name, 'Cancelamento de nota que não está no CRM.', 'ignorada')
          else if (done === 'JA') counts.existentes++
          else counts.canceladas++
          continue
        }
        if (/<(?:\w+:)?infCte[\s>]/.test(d.text)) {
          issue(d.name, 'É um CT-e: importe em Fretes › CT-e.', 'ignorada')
          continue
        }
        let nf: NfeData
        try {
          nf = parseNfeXml(d.text)
        } catch (e) {
          issue(d.name, (e as Error).message, 'erro')
          continue
        }
        if (nf.model && nf.model !== '55') {
          issue(d.name, `Modelo ${nf.model} (só NF-e modelo 55).`, 'ignorada')
          continue
        }
        if (nf.direction !== '1') {
          issue(d.name, `NF-e ${nf.number ?? ''} é de entrada: só notas de saída.`, 'ignorada')
          continue
        }
        if (!nf.emitCnpj || !cnpjs.has(nf.emitCnpj)) {
          issue(d.name, `NF-e ${nf.number ?? ''} emitida por outro CNPJ (${nf.emitCnpj ?? 'sem CNPJ'}), não pela empresa.`, 'ignorada')
          continue
        }
        if (!nf.protocolStatus) {
          issue(d.name, `NF-e ${nf.number ?? ''} sem protocolo de autorização (use o XML autorizado, nfeProc).`, 'ignorada')
          continue
        }
        if (nf.protocolStatus !== '100' && nf.protocolStatus !== '150') {
          issue(d.name, `NF-e ${nf.number ?? ''} não autorizada (situação ${nf.protocolStatus}).`, 'ignorada')
          continue
        }
        // Também para notas já importadas: reimportar o .zip antigo ensina os impostos das vendas passadas.
        if (await this.mlTaxes.record(T, d.text, nf, knownMe).catch((e: unknown) => (this.logger.warn(`Impostos da NF-e ${nf.key}: ${(e as Error).message}`), false))) mlTaxChanged = true
        if (await this.prisma.freightNfe.count({ where: { tenantId: T, key: nf.key } })) {
          counts.existentes++
          continue
        }
        const same = units.filter((u) => (u.cnpj ?? '').replace(/\D/g, '') === nf.emitCnpj)
        const unit = same.find((u) => u.isHeadquarters) ?? same.find((u) => u.zip) ?? same[0] ?? units.find((u) => u.isHeadquarters) ?? units[0]
        if (!unit) {
          issue(d.name, 'Nenhuma filial cadastrada.', 'erro')
          continue
        }
        if (allowed && !allowed.includes(unit.id)) {
          issue(d.name, `NF-e ${nf.number ?? ''} de filial que não está liberada para o seu usuário.`, 'ignorada')
          continue
        }
        const r = await this.apply(T, unit.id, nf, importId)
        counts.novas++
        if (r.created) counts.pedidosCriados++
        counts.ctesLigados += r.ctesLinked
      } catch (e) {
        this.logger.warn(`Importação de NF-e (${d.name}): ${(e as Error).message}`)
        issue(d.name, 'Não foi possível gravar esta nota.', 'erro')
      }
    }
    if (mlTaxChanged) await this.mlTaxes.recompute(T).catch((e: unknown) => this.logger.warn(`Impostos do Mercado Livre: ${(e as Error).message}`))
    const names = files.map((f) => f.originalname).join(', ').slice(0, 500)
    await this.prisma.freightNfeImport.create({ data: { id: importId, tenantId: T, fileNames: names, counts: counts as unknown as Prisma.InputJsonValue, issues: issues as unknown as Prisma.InputJsonValue, createdById: user.id, createdByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'frete.nfe.importadas', 'freight_nfe_import', importId, { arquivos: names, ...counts })
    return { id: importId, counts, issues }
  }

  /** Cancela a nota e o pedido de frete dela (se ainda não estiver cancelado). */
  private async cancel(tenantId: string, key: string, user: AuthUser): Promise<'OK' | 'JA' | 'NAO_ENCONTRADA'> {
    const nfe = await this.prisma.freightNfe.findUnique({ where: { tenantId_key: { tenantId, key } } })
    if (!nfe) return 'NAO_ENCONTRADA'
    if (nfe.status === 'CANCELADA') return 'JA'
    await this.prisma.freightNfe.update({ where: { id: nfe.id }, data: { status: 'CANCELADA', cancelledAt: new Date() } })
    const ship = nfe.shipmentId ? await this.prisma.freightShipment.findUnique({ where: { id: nfe.shipmentId } }) : await this.prisma.freightShipment.findFirst({ where: { tenantId, invoiceKey: key } })
    if (ship && ship.status !== 'CANCELADO') {
      await this.prisma.freightShipment.update({ where: { id: ship.id }, data: { status: 'CANCELADO' } })
      await this.prisma.freightShipmentEvent.create({ data: { shipmentId: ship.id, status: 'CANCELADO', note: `NF-e ${nfe.number} cancelada (evento de cancelamento importado)`, userName: user.name.slice(0, 120) } })
    }
    return 'OK'
  }

  /** Transportadora pelo CNPJ da nota (o mesmo CNPJ, senão a mesma raiz: outra filial da transportadora). */
  private async carrierOf(tenantId: string, cnpj: string | null) {
    if (!cnpj) return null
    const exact = await this.prisma.freightCarrier.findFirst({ where: { tenantId, cnpj }, select: { id: true } })
    if (exact) return exact.id
    return (await this.prisma.freightCarrier.findFirst({ where: { tenantId, cnpj: { startsWith: cnpj.slice(0, 8) }, kind: 'TRANSPORTADORA' }, select: { id: true } }))?.id ?? null
  }

  /** Grava a nota, cria ou completa o pedido de frete e liga os CT-es que já citam a nota. */
  private async apply(tenantId: string, unitId: string, nf: NfeData, importId: string) {
    const by = 'Importação de NF-e'
    const carrierId = await this.carrierOf(tenantId, nf.carrierCnpj)
    const existing = await this.prisma.freightShipment.findFirst({ where: { tenantId, invoiceKey: nf.key, status: { not: 'CANCELADO' } } })
    const withFreight = hasFreight(nf)
    const number = nf.number ? String(Number(nf.number)) : null
    const fromNf = {
      invoiceNumber: number,
      customerName: nf.destName,
      customerDoc: nf.destCnpj,
      personType: nf.destPersonType ?? 'PJ',
      destZip: nf.destZip,
      destCity: nf.destCity,
      destUf: nf.destUf,
      cargoValue: nf.value,
      weight: nf.grossWeight ?? nf.netWeight,
      volumesCount: nf.volumes,
      carrierId,
    }
    let shipmentId: string | null = null
    let created = false
    if (existing) {
      // Pedido já cadastrado (à mão ou pela cotação): só completa o que está em branco.
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fromNf)) if ((existing as Record<string, unknown>)[k] == null && v != null) patch[k] = v
      if (Object.keys(patch).length) {
        await this.prisma.freightShipment.update({ where: { id: existing.id }, data: patch as Prisma.FreightShipmentUncheckedUpdateInput })
        await this.prisma.freightShipmentEvent.create({ data: { shipmentId: existing.id, status: existing.status, note: `Dados completados pela NF-e ${number ?? ''}`, userName: by } })
      }
      shipmentId = existing.id
    } else if (withFreight) {
      const s = await this.prisma.freightShipment.create({
        data: {
          tenantId,
          unitId,
          ...fromNf,
          invoiceKey: nf.key,
          status: carrierId ? 'AGUARDANDO_COLETA' : 'AGUARDANDO_COTACAO',
          notes: carrierId || !nf.carrierCnpj ? null : `Transportadora da nota (CNPJ ${nf.carrierCnpj}${nf.carrierName ? `, ${nf.carrierName}` : ''}) não está cadastrada em Fretes › Transportadoras.`,
          createdById: '00000000-0000-0000-0000-000000000000',
          createdByName: by,
        },
      })
      await this.prisma.freightShipmentEvent.create({ data: { shipmentId: s.id, status: s.status, note: `Criado pela NF-e ${number ?? ''} importada`, userName: by } })
      shipmentId = s.id
      created = true
    }
    await this.prisma.freightNfe.create({
      data: {
        tenantId,
        key: nf.key,
        number: Number(nf.number) || Number(nf.key.slice(25, 34)),
        series: nf.series,
        issuedAt: nf.issuedAt && !Number.isNaN(Date.parse(nf.issuedAt)) ? new Date(nf.issuedAt) : null,
        emitCnpj: nf.emitCnpj,
        unitId,
        value: nf.value,
        freightValue: nf.freightValue,
        freightMode: nf.freightMode?.slice(0, 2) ?? null,
        carrierCnpj: nf.carrierCnpj,
        carrierId,
        volumes: nf.volumes,
        grossWeight: nf.grossWeight,
        netWeight: nf.netWeight,
        destCnpj: nf.destCnpj,
        destZip: nf.destZip,
        destCity: nf.destCity,
        destUf: nf.destUf,
        destIbge: nf.destIbge,
        shipmentId,
        status: shipmentId ? 'PEDIDO' : 'SEM_FRETE',
        importId,
      },
    })
    let ctesLinked = 0
    if (shipmentId) {
      // CT-e que chegou antes da nota: liga agora e concilia.
      const ctes = await this.prisma.freightCte.findMany({ where: { tenantId, shipmentId: null, nfeKeys: { has: nf.key } }, select: { id: true, number: true } })
      for (const c of ctes) {
        await this.prisma.freightCte.update({ where: { id: c.id }, data: { shipmentId } })
        const s = await this.prisma.freightShipment.findUnique({ where: { id: shipmentId }, select: { status: true } })
        if (s && !['ENTREGUE', 'CONCILIADO', 'CANCELADO', 'AGUARDANDO_CONCILIACAO'].includes(s.status)) {
          await this.prisma.freightShipment.update({ where: { id: shipmentId }, data: { status: 'AGUARDANDO_CONCILIACAO' } })
          await this.prisma.freightShipmentEvent.create({ data: { shipmentId, status: 'AGUARDANDO_CONCILIACAO', note: `CT-e ${c.number ?? ''} ligado pela NF-e`, userName: by } })
        }
        await this.ctes.reconcileOne(this.systemUser(tenantId), c.id).catch((e: unknown) => this.logger.warn(`Conciliação do CT-e ${c.id}: ${(e as Error).message}`))
        ctesLinked++
      }
    }
    return { created, ctesLinked }
  }

  private systemUser(tenantId: string): AuthUser {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId,
      email: 'nfe@sistema',
      name: 'Importação de NF-e',
      familyId: '',
      unitId: null,
      extraUnitIds: [],
      pending2faSetup: false,
      role: { id: '', name: 'Sistema', isSystem: true, require2fa: false },
      permissions: {} as AuthUser['permissions'],
    }
  }

  /** Histórico das importações (as 30 mais recentes). */
  async history(user: AuthUser) {
    assertCan(user, 'fretes_pedidos', 'view')
    const rows = await this.prisma.freightNfeImport.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 30 })
    return rows.map((r) => ({ id: r.id, fileNames: r.fileNames, counts: r.counts, issues: r.issues, createdByName: r.createdByName, createdAt: r.createdAt }))
  }
}
