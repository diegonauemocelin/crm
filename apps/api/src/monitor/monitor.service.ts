import { ForbiddenException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy, Optional } from '@nestjs/common'
import { promises as fs, statfsSync } from 'node:fs'
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os'
import { join } from 'node:path'
import { PushService } from '../app-movel/push.service'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { SystemService } from '../system/system.service'
import { ChatService } from '../whatsapp/chat.service'
import { isOpen } from '../whatsapp/envio'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { bucket, cpuPercent, cpuTimes, type CpuTimes, type Level, numberLevel, RequestCounter, usageLevel } from './monitor'

const SAMPLE_MS = 60_000
const KEEP_MS = 7 * 86_400_000

/** Pedidos da API contados pelo interceptor (um contador para o processo). */
export const REQUESTS = new RequestCounter()

/**
 * Monitoramento (só o Administrador): uma amostra por minuto do servidor (CPU, memória, disco), do banco e da API
 * (pedidos, erros, tempo de resposta), guardada 7 dias; a situação dos sistemas (banco, serviço de WhatsApp, backup,
 * versão) e de cada número de WhatsApp; e as atividades do dia. Número que cai ou para de receber avisa os
 * administradores no celular.
 */
@Injectable()
export class MonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Monitoramento')
  private timer: NodeJS.Timeout | null = null
  private lastCpu: CpuTimes = cpuTimes(cpus())
  /** Último nível conhecido de cada número (para avisar só quando muda para problema). */
  private readonly lastLevel = new Map<string, Level>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemService,
    private readonly whatsapp: WhatsappService,
    private readonly chat: ChatService,
    @Optional() private readonly push?: PushService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.sample().catch((e: unknown) => this.logger.warn(`Amostra: ${(e as Error).message}`)), SAMPLE_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private assertAdmin(user: AuthUser) {
    if (!user.role.isSystem) throw new ForbiddenException('Só o Administrador vê o monitoramento.')
  }

  private disk() {
    try {
      const s = statfsSync(env.uploadDir)
      const total = s.blocks * s.bsize
      const free = s.bavail * s.bsize
      return { pct: total ? Math.round(((total - free) / total) * 1000) / 10 : null, freeGb: Math.round((free / 1024 ** 3) * 10) / 10, totalGb: Math.round((total / 1024 ** 3) * 10) / 10 }
    } catch {
      return { pct: null, freeGb: null, totalGb: null }
    }
  }

  private async dbMs() {
    const t = Date.now()
    await this.prisma.$queryRawUnsafe('SELECT 1')
    return Date.now() - t
  }

  async sample() {
    const cur = cpuTimes(cpus())
    const cpuPct = cpuPercent(this.lastCpu, cur)
    this.lastCpu = cur
    const total = totalmem()
    const used = total - freemem()
    const req = REQUESTS.take()
    await this.prisma.monitorSample.create({
      data: {
        cpuPct,
        load1: Math.round(loadavg()[0]! * 100) / 100,
        memPct: Math.round((used / total) * 1000) / 10,
        memUsedMb: Math.round(used / 1024 ** 2),
        apiMemMb: Math.round(process.memoryUsage().rss / 1024 ** 2),
        diskPct: this.disk().pct,
        dbMs: await this.dbMs().catch(() => -1),
        ...req,
      },
    })
    await this.prisma.monitorSample.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_MS) } } })
    await this.alertNumbers().catch((e: unknown) => this.logger.warn(`Aviso dos números: ${(e as Error).message}`))
  }

  /** Situação de cada número da empresa (com a última mensagem recebida e o movimento do dia). */
  private async numbers(tenantId: string) {
    const list = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, status: true, statusReason: true, connectedAt: true, lastEventAt: true, purpose: true } })
    const hours = (await this.chat.rules(tenantId)).businessHours
    const now = Date.now()
    const today = new Date(new Date().setHours(0, 0, 0, 0))
    return Promise.all(
      list.map(async (n) => {
        const [last, inToday, outToday] = await Promise.all([
          this.prisma.whatsappMessage.findFirst({ where: { conversation: { numberId: n.id }, fromMe: false }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
          this.prisma.whatsappMessage.count({ where: { conversation: { numberId: n.id }, fromMe: false, sentAt: { gte: today } } }),
          this.prisma.whatsappMessage.count({ where: { conversation: { numberId: n.id }, fromMe: true, sentAt: { gte: today } } }),
        ])
        const lastInboundAt = last?.sentAt ?? null
        const lv = numberLevel({ status: n.status, statusReason: n.statusReason, lastInboundAt }, now, n.purpose !== 'MONITORAMENTO' && isOpen(hours, new Date(now)))
        return { ...n, lastInboundAt, inToday, outToday, ...lv }
      }),
    )
  }

  /** Avisa os administradores no celular quando um número passa a ter problema (desconectou ou parou de receber). */
  private async alertNumbers() {
    if (!this.push) return
    const tenants = await this.prisma.whatsappNumber.findMany({ where: { deletedAt: null }, distinct: ['tenantId'], select: { tenantId: true } })
    for (const { tenantId } of tenants) {
      const nums = await this.numbers(tenantId)
      const admins = (await this.prisma.user.findMany({ where: { tenantId, active: true, deletedAt: null, role: { isSystem: true } }, select: { id: true } })).map((u) => u.id)
      for (const n of nums) {
        const before = this.lastLevel.get(n.id)
        this.lastLevel.set(n.id, n.level)
        if (before === undefined || before === 'problema' || n.level !== 'problema' || !admins.length) continue
        await this.push.notify(tenantId, admins, { title: `WhatsApp ${n.name}: ${n.status === 'CONECTADO' ? 'sem receber' : 'desconectado'}`, body: n.why, url: '/administracao/monitoramento', tag: `monitor-${n.id}` }).catch(() => undefined)
      }
    }
  }

  private async lastBackup() {
    if (!env.backupDir) return null
    try {
      const files = (await fs.readdir(env.backupDir)).filter((f) => /^crm-db-.*\.age$/.test(f))
      let best: { name: string; at: Date; mb: number } | null = null
      for (const f of files) {
        const st = await fs.stat(join(env.backupDir, f))
        if (!best || st.mtime > best.at) best = { name: f, at: st.mtime, mb: Math.round((st.size / 1024 ** 2) * 10) / 10 }
      }
      return { last: best, count: files.length, denied: false }
    } catch (e) {
      // Pasta só do usuário do backup (chmod 700): a API não consegue listar. O deploy.sh deixa em 755.
      return { last: null, count: 0, denied: (e as NodeJS.ErrnoException).code === 'EACCES' }
    }
  }

  /** O painel: servidor agora, gráficos, sistemas, números e atividades. */
  async view(user: AuthUser, hours: number) {
    this.assertAdmin(user)
    const T = user.tenantId
    const since = new Date(Date.now() - hours * 3_600_000)
    const today = new Date(new Date().setHours(0, 0, 0, 0))
    const total = totalmem()
    const used = total - freemem()
    const [samples, dbMs, dbSize, version, waList, numbers, backup, logins, failed, leads, msgsByHour, activeUsers, errors] = await Promise.all([
      this.prisma.monitorSample.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
      this.dbMs().catch(() => null),
      this.prisma.$queryRawUnsafe<{ size: bigint }[]>('SELECT pg_database_size(current_database()) AS size').catch(() => [] as { size: bigint }[]),
      this.system.version().catch(() => null),
      this.whatsapp.list(user).catch(() => null),
      this.numbers(T),
      this.lastBackup(),
      this.prisma.auditLog.count({ where: { tenantId: T, action: { startsWith: 'auth.login' }, createdAt: { gte: today } } }),
      this.prisma.auditLog.count({ where: { tenantId: T, action: 'auth.login_failed', createdAt: { gte: today } } }),
      this.prisma.lead.count({ where: { tenantId: T, createdAt: { gte: today } } }),
      this.prisma.$queryRawUnsafe<{ h: number; fromMe: boolean; n: bigint }[]>(
        `SELECT EXTRACT(HOUR FROM ("sentAt" AT TIME ZONE 'America/Sao_Paulo'))::int AS h, "fromMe", COUNT(*) AS n FROM whatsapp_messages WHERE "tenantId" = $1::uuid AND "sentAt" >= $2 GROUP BY 1, 2`,
        T,
        today,
      ).catch(() => [] as { h: number; fromMe: boolean; n: bigint }[]),
      this.prisma.refreshToken.findMany({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, revokedAt: null, user: { tenantId: T } }, distinct: ['userId'], select: { userId: true } }).catch(() => []),
      this.prisma.monitorSample.aggregate({ where: { at: { gte: today } }, _sum: { errors: true, requests: true } }),
    ])
    const disk = this.disk()
    const bucketMin = hours <= 6 ? 5 : hours <= 24 ? 15 : 60
    const msgHours = Array.from({ length: 24 }, (_, h) => ({ h, in: 0, out: 0 }))
    for (const r of msgsByHour) msgHours[r.h]![r.fromMe ? 'out' : 'in'] += Number(r.n)
    const memPct = Math.round((used / total) * 1000) / 10
    const backupAgeH = backup?.last ? (Date.now() - backup.last.at.getTime()) / 3_600_000 : null
    const systems: { key: string; name: string; level: Level; detail: string }[] = [
      { key: 'api', name: 'Sistema (API)', level: 'ok', detail: `No ar há ${Math.round(process.uptime() / 3600)} h · versão ${version?.version ?? '?'}${version?.updateAvailable ? ` (há ${version.latestAvailable} disponível)` : ''}` },
      { key: 'db', name: 'Banco de dados', level: dbMs === null ? 'problema' : dbMs > 500 ? 'atencao' : 'ok', detail: dbMs === null ? 'Não respondeu' : `Responde em ${dbMs} ms · ${dbSize[0] ? Math.round(Number(dbSize[0].size) / 1024 ** 2) : '?'} MB` },
      { key: 'whatsapp', name: 'Serviço de WhatsApp', level: !waList?.service.configured ? 'atencao' : waList.service.online ? 'ok' : 'problema', detail: !waList?.service.configured ? 'Não ativado neste servidor' : waList.service.online ? `No ar${waList.service.version ? ` · versão ${waList.service.version}` : ''}` : `Fora do ar: ${waList.service.error ?? 'sem resposta'}` },
      {
        key: 'backup',
        name: 'Backup diário',
        level: !env.backupDir ? 'atencao' : backupAgeH === null ? 'problema' : backupAgeH > 30 ? 'problema' : 'ok',
        detail: !env.backupDir ? 'Pasta dos backups não ligada à API (atualize o servidor)' : backup?.last ? `Último em ${backup.last.at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${backup.last.mb} MB · ${backup.count} guardado(s)` : backup?.denied ? 'Sem permissão para ver a pasta dos backups. No servidor: sudo chmod 755 na pasta backups (ou atualize o sistema)' : 'Nenhum backup encontrado',
      },
      { key: 'disk', name: 'Disco', level: usageLevel(disk.pct), detail: disk.pct === null ? 'Sem leitura' : `${disk.pct}% usado · ${disk.freeGb} GB livres de ${disk.totalGb} GB` },
      { key: 'mem', name: 'Memória', level: usageLevel(memPct), detail: `${memPct}% usada · ${Math.round(used / 1024 ** 3 * 10) / 10} de ${Math.round(total / 1024 ** 3 * 10) / 10} GB` },
    ]
    return {
      now: {
        cpuPct: samples.at(-1)?.cpuPct ?? null,
        load: loadavg().map((x) => Math.round(x * 100) / 100),
        cpus: cpus().length,
        memPct,
        disk,
        apiMemMb: Math.round(process.memoryUsage().rss / 1024 ** 2),
        serverUptimeH: Math.round(uptime() / 3600),
        dbMs,
      },
      systems,
      chart: bucket(samples.map((s) => ({ at: s.at, cpuPct: s.cpuPct, memPct: s.memPct, diskPct: s.diskPct, dbMs: s.dbMs, requests: s.requests, errors: s.errors, avgMs: s.avgMs, apiMemMb: s.apiMemMb })), bucketMin),
      bucketMin,
      numbers: numbers.map(({ id, name, phone, status, why, level, lastInboundAt, inToday, outToday, purpose }) => ({ id, name, phone, status, why, level, lastInboundAt, inToday, outToday, purpose })),
      activity: {
        logins,
        failedLogins: failed,
        activeUsers: activeUsers.length,
        leads,
        messagesIn: msgHours.reduce((a, x) => a + x.in, 0),
        messagesOut: msgHours.reduce((a, x) => a + x.out, 0),
        requests: errors._sum.requests ?? 0,
        errors: errors._sum.errors ?? 0,
        byHour: msgHours,
      },
    }
  }
}
