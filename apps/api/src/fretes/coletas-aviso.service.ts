import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { PushService } from '../app-movel/push.service'
import { PrismaService } from '../prisma/prisma.service'
import { type Pickup, pickupAlerts, spClock, spDate } from './coletas'

/**
 * Avisos no celular (app) da expedição: 15 minutos antes do ponto de corte e da chegada das coletas de horário fixo, e do
 * início do período das coletas agendadas. Vai para quem tem a permissão de coletas (pela filial liberada); o
 * Administrador não recebe por padrão (dá a permissão ao perfil dele para receber).
 */
@Injectable()
export class ColetasAvisoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ColetasAviso')
  private timer: NodeJS.Timeout | null = null
  private sent = new Set<string>()
  private sentDay = ''
  private busy = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async tick(now = new Date()) {
    if (this.busy) return
    this.busy = true
    try {
      const date = spDate(now)
      if (date !== this.sentDay) {
        this.sent = new Set()
        this.sentDay = date
      }
      const clock = spClock(now)
      const carriers = await this.prisma.freightCarrier.findMany({ where: { active: true, pickup: true, pickupMode: 'COLETA' }, select: { id: true, tenantId: true, name: true, quoteName: true, pickups: true, pickupBySchedule: true } })
      const tenants = [...new Set(carriers.map((c) => c.tenantId))]
      for (const tenantId of tenants) {
        const own = carriers.filter((c) => c.tenantId === tenantId)
        const rows = await this.prisma.freightPickupSchedule.findMany({ where: { tenantId, date: new Date(`${date}T00:00:00Z`), status: { not: 'CANCELADA' } } })
        const name = (id: string) => {
          const c = own.find((x) => x.id === id)
          return c ? c.quoteName || c.name : 'Transportadora'
        }
        const fixed = own.filter((c) => !c.pickupBySchedule).map((c) => ({ carrierId: c.id, carrier: c.quoteName || c.name, pickups: (c.pickups ?? []) as unknown as Pickup[] }))
        const alerts = pickupAlerts(fixed, rows.map((r) => ({ id: r.id, carrierId: r.carrierId, carrier: name(r.carrierId), unitId: r.unitId, period: r.period, status: r.status, slot: r.slot })), clock, date).filter((a) => !this.sent.has(`${tenantId}|${a.key}`))
        if (!alerts.length) continue
        const people = await this.recipients(tenantId)
        const units = await this.prisma.unit.findMany({ where: { tenantId }, select: { id: true, name: true } })
        for (const a of alerts) {
          this.sent.add(`${tenantId}|${a.key}`)
          const to = people.filter((p) => !a.unitId || p.units === null || p.units.includes(a.unitId)).map((p) => p.id)
          if (!to.length) continue
          const where = a.unitId ? ` · ${units.find((u) => u.id === a.unitId)?.name ?? ''}` : ''
          const msg =
            a.kind === 'CORTE'
              ? { title: `Corte em 15 min: ${a.carrier}`, body: `Pedido até ${a.at} para sair na coleta das ${a.pickup}${where}.` }
              : a.kind === 'COLETA'
                ? { title: `${a.carrier} chega em 15 min`, body: `Coleta às ${a.at}${where}. Toque para marcar quando chegar.` }
                : { title: `Coleta agendada: ${a.carrier}`, body: `Período começa às ${a.at}${where}. Toque para marcar quando chegar.` }
          await this.push.notify(tenantId, to, { ...msg, url: '/app/coletas', tag: `coleta-${a.key}` }).catch(() => 0)
        }
      }
    } catch (e) {
      this.logger.warn(`Avisos das coletas: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  /** Quem recebe: usuários ativos com o perfil que vê as coletas; a filial vem do escopo da permissão. */
  private async recipients(tenantId: string) {
    const perms = await this.prisma.rolePermission.findMany({ where: { module: 'fretes_coletas', canView: true, role: { tenantId, active: true } }, select: { roleId: true, scope: true } })
    if (!perms.length) return []
    const users = await this.prisma.user.findMany({ where: { tenantId, active: true, deletedAt: null, roleId: { in: perms.map((p) => p.roleId) } }, select: { id: true, roleId: true, unitId: true, extraUnitIds: true } })
    return users.map((u) => {
      const scope = perms.find((p) => p.roleId === u.roleId)?.scope
      return { id: u.id, units: scope === 'ALL' ? null : [u.unitId, ...u.extraUnitIds].filter((x): x is string => !!x) }
    })
  }
}
