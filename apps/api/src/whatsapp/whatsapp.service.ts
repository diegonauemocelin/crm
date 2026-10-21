import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { randomToken, safeEqual } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'
import type { Prisma } from '../generated/prisma/client'
import { EvolutionClient, EvolutionError, SESSION_DEAD_REASON, cleanQr, isConnectionClosed, type NumberStatus, statusOf } from './evolution'

export interface NumberInput {
  name: string
  unitId?: string | null
  sellerIds?: string[]
  userIds?: string[]
  splitAttendance?: boolean
  defaultUserId?: string | null
  createRecords?: boolean
  signMessages?: boolean
}

/** QR Code vale ~40 s na Evolution; sem leitura em 3 minutos, a conexão é cancelada. */
const QR_TTL_MS = 60_000
const CONNECT_TIMEOUT_MS = 3 * 60_000
const TICK_MS = 60_000
const CHECK_CONNECTED_MS = 5 * 60_000
/** Espera depois de reiniciar a conexão de um número antes de conferir de novo. */
const RESTART_WAIT_MS = 10_000

/**
 * Números de WhatsApp da empresa (Evolution API). Limites do .env: WHATSAPP_MAX_NUMBERS cadastrados e
 * WHATSAPP_MAX_CONNECTED conectados ao mesmo tempo (conferido com trava no banco, sem corrida entre dois cliques).
 * O QR Code fica só na memória: com ele dá para conectar um aparelho ao número, então não vai para o banco.
 */
@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WhatsApp')
  private readonly qrs = new Map<string, { qr: string; at: number }>()
  private timer: NodeJS.Timeout | null = null
  private lastFullCheck = 0
  private running = false
  /** Os testes trocam o cliente. */
  client: EvolutionClient | null = env.evolutionApiKey ? new EvolutionClient({ url: env.evolutionUrl, apiKey: env.evolutionApiKey }) : null

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
  ) {
    this.chat.clientOf = () => this.client
    if (this.client) this.client.onSessionDead = (instanceName) => void this.markDead(instanceName)
  }

  /** Testes encurtam a espera depois de reiniciar a conexão. */
  restartWaitMs = RESTART_WAIT_MS

  /**
   * Sessão morta por dentro da Evolution (ela ainda diz "conectado"): o número passa a aparecer desconectado,
   * com o motivo, para a equipe clicar em Conectar em vez de descobrir no envio.
   */
  async markDead(instanceName: string) {
    const n = await this.prisma.whatsappNumber.findUnique({ where: { instanceName } })
    if (!n || n.deletedAt || n.status !== 'CONECTADO') return
    this.logger.warn(`Sessão do número ${n.name} caiu (Connection Closed).`)
    await this.prisma.whatsappNumber.update({ where: { id: n.id }, data: { status: 'DESCONECTADO', statusReason: SESSION_DEAD_REASON, disconnectedAt: new Date() } })
  }

  /** Apaga a sessão morta e cria a instância de novo (o próximo connect devolve um QR Code novo). */
  private async recreate(evo: EvolutionClient, instanceName: string) {
    await evo.logout(instanceName).catch(() => undefined)
    await evo.deleteInstance(instanceName).catch((err: unknown) => this.logger.warn(`Instância ${instanceName} não apagada: ${(err as Error).message}`))
    await evo.createInstance(instanceName, this.webhookUrl())
  }

  onApplicationBootstrap() {
    if (!this.client) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
    // Instâncias criadas por versões anteriores passam a mandar as mensagens (e o endereço certo do CRM).
    setTimeout(() => void this.syncWebhooks(), 20_000).unref()
  }

  private async syncWebhooks() {
    if (!this.client || !env.evolutionWebhookSecret) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { deletedAt: null, status: { not: 'DESCONECTADO' } }, select: { instanceName: true, name: true } })
    for (const n of numbers) {
      await this.client.setWebhook(n.instanceName, this.webhookUrl()).catch((err: unknown) => this.logger.warn(`Eventos do número ${n.name} não atualizados: ${(err as Error).message}`))
      await this.client.setSettings(n.instanceName).catch((err: unknown) => this.logger.warn(`Ajustes do número ${n.name} não atualizados: ${(err as Error).message}`))
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  limits() {
    return { maxNumbers: env.whatsappMaxNumbers, maxConnected: env.whatsappMaxConnected }
  }

  private evo() {
    if (!this.client) throw new BadRequestException('O WhatsApp ainda não foi ativado no servidor (deploy/whatsapp.sh ativar).')
    return this.client
  }

  private webhookUrl() {
    if (!env.evolutionWebhookSecret) throw new BadRequestException('Falta EVOLUTION_WEBHOOK_SECRET no .env do servidor (deploy/whatsapp.sh ativar).')
    return `${env.internalApiUrl}/api/webhooks/whatsapp/${env.evolutionWebhookSecret}`
  }

  private async load(tenantId: string, id: string) {
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!n) throw new NotFoundException('Número não encontrado.')
    return n
  }

  private view(n: Awaited<ReturnType<WhatsappService['load']>>) {
    const { tenantId: _t, deletedAt: _d, instanceName: _i, ...rest } = n
    return rest
  }

  async list(user: AuthUser) {
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' } })
    let service: { configured: boolean; online: boolean; version: string | null; error: string | null } = { configured: !!this.client, online: false, version: null, error: null }
    if (this.client) {
      try {
        service = { ...service, online: true, version: (await this.client.health()).version }
      } catch (err) {
        service = { ...service, error: (err as Error).message }
      }
    }
    // Para escolher quem usa cada número (só nome; quem vê esta tela é o administrador dos números).
    const users = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
    return {
      users,
      numbers: numbers.map((n) => this.view(n)),
      limits: { ...this.limits(), connected: numbers.filter((n) => n.status !== 'DESCONECTADO').length, registered: numbers.length },
      service,
    }
  }

  private async assertRefs(tenantId: string, d: NumberInput) {
    if (d.unitId && !(await this.prisma.unit.count({ where: { tenantId, id: d.unitId } }))) throw new BadRequestException('Unidade inválida.')
    const ids = [...new Set(d.sellerIds ?? [])]
    if (ids.length && (await this.prisma.seller.count({ where: { tenantId, id: { in: ids } } })) !== ids.length) throw new BadRequestException('Vendedor inválido.')
    return ids
  }

  private async assertUsers(tenantId: string, d: NumberInput) {
    const ids = [...new Set(d.userIds ?? [])]
    if (ids.length && (await this.prisma.user.count({ where: { tenantId, id: { in: ids } } })) !== ids.length) throw new BadRequestException('Usuário inválido.')
    return ids
  }

  async create(user: AuthUser, d: NumberInput, ctx: RequestCtx) {
    const name = d.name.trim().slice(0, 80)
    if (name.length < 2) throw new BadRequestException('Dê um nome ao número (ex.: Vendas Paraná).')
    const sellerIds = await this.assertRefs(user.tenantId, d)
    const userIds = await this.assertUsers(user.tenantId, d)
    const n = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-numbers:${user.tenantId}`}))`
      const count = await tx.whatsappNumber.count({ where: { tenantId: user.tenantId, deletedAt: null } })
      if (count >= env.whatsappMaxNumbers) throw new BadRequestException(`Limite de ${env.whatsappMaxNumbers} números cadastrados. Exclua um para cadastrar outro.`)
      return tx.whatsappNumber.create({
        data: { tenantId: user.tenantId, name, instanceName: `crm-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, unitId: d.unitId ?? null, sellerIds, userIds, splitAttendance: d.splitAttendance ?? false, defaultUserId: d.defaultUserId && userIds.includes(d.defaultUserId) ? d.defaultUserId : null, createRecords: d.createRecords ?? true, signMessages: d.signMessages ?? true },
      })
    })
    await this.audit.byUser(user, ctx, 'whatsapp.numero_criado', 'whatsapp_number', n.id, { nome: name })
    return this.view(n)
  }

  async update(user: AuthUser, id: string, d: NumberInput, ctx: RequestCtx) {
    await this.load(user.tenantId, id)
    const name = d.name.trim().slice(0, 80)
    if (name.length < 2) throw new BadRequestException('Dê um nome ao número.')
    const sellerIds = await this.assertRefs(user.tenantId, d)
    // Sem a lista na requisição (tela antiga), mantém os usuários atuais.
    const userIds = d.userIds ? await this.assertUsers(user.tenantId, d) : undefined
    const current = await this.prisma.whatsappNumber.findUnique({ where: { id }, select: { userIds: true, defaultUserId: true } })
    // Atendente padrão: precisa ser um dos usuários do número (saiu do número: deixa de receber).
    const finalUsers = userIds ?? current?.userIds ?? []
    const wanted = d.defaultUserId === undefined ? (current?.defaultUserId ?? null) : d.defaultUserId
    const defaultUserId = wanted && finalUsers.includes(wanted) ? wanted : null
    const n = await this.prisma.whatsappNumber.update({ where: { id }, data: { name, unitId: d.unitId ?? null, sellerIds, defaultUserId, ...(userIds ? { userIds } : {}), ...(d.splitAttendance !== undefined ? { splitAttendance: d.splitAttendance } : {}), ...(d.createRecords !== undefined ? { createRecords: d.createRecords } : {}), ...(d.signMessages !== undefined ? { signMessages: d.signMessages } : {}) } })
    await this.audit.byUser(user, ctx, 'whatsapp.numero_alterado', 'whatsapp_number', id, { nome: name, vendedores: sellerIds.length, usuarios: userIds?.length ?? null })
    return this.view(n)
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const n = await this.load(user.tenantId, id)
    if (this.client) {
      // Desconecta e apaga a sessão na Evolution; se o serviço estiver fora, o número sai do CRM do mesmo jeito.
      await this.client.logout(n.instanceName).catch(() => undefined)
      await this.client.deleteInstance(n.instanceName).catch((err: unknown) => this.logger.warn(`Instância ${n.instanceName} não apagada: ${(err as Error).message}`))
    }
    this.qrs.delete(id)
    await this.prisma.whatsappNumber.update({ where: { id }, data: { deletedAt: new Date(), status: 'DESCONECTADO' } })
    await this.audit.byUser(user, ctx, 'whatsapp.numero_excluido', 'whatsapp_number', id, { nome: n.name, telefone: n.phone })
    return { ok: true }
  }

  /** Começa a conexão: reserva uma das vagas de conexão e pede o QR Code. */
  async connect(user: AuthUser, id: string, ctx: RequestCtx) {
    const evo = this.evo()
    const webhook = this.webhookUrl()
    const n = await this.load(user.tenantId, id)
    if (n.status === 'CONECTADO') return this.qrStatus(user, id)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-connect:${user.tenantId}`}))`
      const busy = await tx.whatsappNumber.count({ where: { tenantId: user.tenantId, deletedAt: null, status: { in: ['CONECTADO', 'CONECTANDO'] }, id: { not: id } } })
      if (busy >= env.whatsappMaxConnected) {
        throw new BadRequestException(`Limite de ${env.whatsappMaxConnected} números conectados ao mesmo tempo. Desconecte um para conectar este.`)
      }
      await tx.whatsappNumber.update({ where: { id }, data: { status: 'CONECTANDO', statusReason: null, connectingAt: new Date() } })
    })
    try {
      let r = await evo.connect(n.instanceName).catch(async (err: unknown) => {
        // Primeira conexão: a instância ainda não existe na Evolution.
        if (err instanceof EvolutionError && err.status === 404) {
          await evo.createInstance(n.instanceName, webhook)
          return evo.connect(n.instanceName)
        }
        throw err
      })
      if (!r.qr && r.state !== 'open') r = await evo.connect(n.instanceName)
      // A Evolution diz "open", mas a sessão pode estar morta (Connection Closed): recria e pede QR Code novo.
      if (r.state === 'open' && (await evo.alive(n.instanceName, n.phone)) === false) {
        await this.recreate(evo, n.instanceName)
        r = await evo.connect(n.instanceName)
        if (!r.qr && r.state !== 'open') r = await evo.connect(n.instanceName)
      }
      if (r.qr) this.qrs.set(id, { qr: r.qr, at: Date.now() })
      if (r.state === 'open') await this.applyState(n.id, n.instanceName, 'open', null)
    } catch (err) {
      await this.prisma.whatsappNumber.update({ where: { id }, data: { status: 'DESCONECTADO', statusReason: 'Falha ao pedir o QR Code' } })
      throw err instanceof EvolutionError ? new BadRequestException(err.message) : err
    }
    await this.audit.byUser(user, ctx, 'whatsapp.conexao_iniciada', 'whatsapp_number', id, { nome: n.name })
    return this.qrStatus(user, id)
  }

  /** A tela consulta a cada poucos segundos enquanto mostra o QR Code. */
  async qrStatus(user: AuthUser, id: string) {
    let n = await this.load(user.tenantId, id)
    if (n.status === 'CONECTANDO' && this.client) {
      const state = await this.client.state(n.instanceName).catch(() => null)
      if (state === 'open') n = (await this.applyState(n.id, n.instanceName, 'open', null)) ?? n
    }
    const q = this.qrs.get(id)
    const qr = n.status === 'CONECTANDO' && q && Date.now() - q.at < QR_TTL_MS ? q.qr : null
    return { status: n.status as NumberStatus, qr, phone: n.phone, profileName: n.profileName, statusReason: n.statusReason }
  }

  async disconnect(user: AuthUser, id: string, ctx: RequestCtx) {
    const n = await this.load(user.tenantId, id)
    const evo = this.evo()
    await evo.logout(n.instanceName).catch(async (err: unknown) => {
      // Sessão morta (Connection Closed): a Evolution não consegue sair dela; apaga a instância e segue.
      if (err instanceof EvolutionError && isConnectionClosed(err.message)) return evo.deleteInstance(n.instanceName).catch(() => undefined)
      throw err instanceof EvolutionError ? new BadRequestException(err.message) : err
    })
    this.qrs.delete(id)
    const r = await this.prisma.whatsappNumber.update({ where: { id }, data: { status: 'DESCONECTADO', statusReason: 'Desconectado pelo CRM', disconnectedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'whatsapp.desconectado', 'whatsapp_number', id, { nome: n.name, telefone: n.phone })
    return this.view(r)
  }

  /** Grava a nova situação; ao conectar, busca o número e o nome do perfil. */
  private async applyState(id: string, instanceName: string, state: string, reason: string | null) {
    const status = statusOf(state)
    const now = new Date()
    const current = await this.prisma.whatsappNumber.findUnique({ where: { id } })
    if (!current || current.deletedAt) return null
    // "close" enquanto espera a leitura do QR Code não derruba a tentativa (a Evolution fecha e reabre ao gerar outro QR).
    if (status === 'DESCONECTADO' && current.status === 'CONECTANDO' && current.connectingAt && now.getTime() - current.connectingAt.getTime() < CONNECT_TIMEOUT_MS && !reason) return current
    let extra: { phone?: string | null; profileName?: string | null } = {}
    if (status === 'CONECTADO' && current.status !== 'CONECTADO' && this.client) {
      extra = await this.client.info(instanceName).catch(() => ({}))
      this.qrs.delete(id)
    }
    if (status === current.status && !extra.phone) return this.prisma.whatsappNumber.update({ where: { id }, data: { lastEventAt: now } })
    return this.prisma.whatsappNumber.update({
      where: { id },
      data: {
        status,
        statusReason: reason?.slice(0, 160) ?? null,
        lastEventAt: now,
        ...(status === 'CONECTADO' ? { connectedAt: now, ...(extra.phone ? { phone: extra.phone } : {}), ...(extra.profileName ? { profileName: extra.profileName } : {}) } : {}),
        ...(status === 'DESCONECTADO' ? { disconnectedAt: now } : {}),
      },
    })
  }

  /** Eventos da Evolution (rede interna), autenticados pelo segredo no caminho. */
  async webhook(secret: string, body: unknown) {
    if (!env.evolutionWebhookSecret || !safeEqual(secret, env.evolutionWebhookSecret)) return false
    const b = (body ?? {}) as { event?: string; instance?: string; data?: Record<string, unknown> }
    if (typeof b.instance !== 'string' || !/^crm-[a-z0-9x]{6,20}$/.test(b.instance)) return true
    const n = await this.prisma.whatsappNumber.findUnique({ where: { instanceName: b.instance } })
    if (!n || n.deletedAt) return true
    const event = String(b.event ?? '').toLowerCase().replace(/_/g, '.')
    // Mensagem recebida, enviada pelo celular (upsert com fromMe) ou pelo CRM (send.message).
    if (event === 'messages.upsert' || event === 'send.message') {
      const list = Array.isArray(b.data) ? b.data : [b.data]
      for (const item of list.slice(0, 50)) void this.chat.ingest(n, item, this.client)
      return true
    }
    // Confirmação de entrega e leitura (os tracinhos do WhatsApp); a edição de uma mensagem também vem aqui.
    if (event === 'messages.update') {
      void this.chat.applyReceipts(n, b.data).catch((err: unknown) => this.logger.warn(`Confirmação de leitura não gravada: ${(err as Error).message}`))
      void this.chat.ingestRevisions(n, event, b.data).catch((err: unknown) => this.logger.warn(`Edição de mensagem não gravada: ${(err as Error).message}`))
      return true
    }
    // Mensagem editada ou apagada para todos (Evolution 2.3: eventos próprios, fora do messages.upsert).
    if (event === 'messages.edited' || event === 'messages.delete') {
      void this.chat.ingestRevisions(n, event, b.data).catch((err: unknown) => this.logger.warn(`Edição ou exclusão de mensagem não gravada: ${(err as Error).message}`))
      return true
    }
    if (event === 'call') {
      void this.chat.ingestCalls(n, b.data).catch((err: unknown) => this.logger.warn(`Ligação não registrada: ${(err as Error).message}`))
      return true
    }
    if (event === 'qrcode.updated') {
      const qr = cleanQr((b.data?.qrcode as { base64?: unknown } | undefined)?.base64)
      if (qr) this.qrs.set(n.id, { qr, at: Date.now() })
    } else if (event === 'connection.update') {
      const state = typeof b.data?.state === 'string' ? b.data.state : null
      if (state) {
        const code = b.data?.statusReason
        // 401 = o aparelho desconectou o CRM (em "Aparelhos conectados" no celular).
        const reason = state === 'close' ? (code === 401 ? 'Desconectado pelo celular' : typeof code === 'number' ? `Conexão encerrada (código ${code})` : null) : null
        await this.applyState(n.id, b.instance, state, reason)
      }
    }
    return true
  }

  /** Cancela conexões sem leitura do QR Code e confere de tempos em tempos os conectados (caso um evento se perca). */
  async tick() {
    if (this.running || !this.client) return
    this.running = true
    try {
      const stale = await this.prisma.whatsappNumber.findMany({ where: { deletedAt: null, status: 'CONECTANDO', connectingAt: { lt: new Date(Date.now() - CONNECT_TIMEOUT_MS) } } })
      for (const n of stale) {
        const state = await this.client.state(n.instanceName).catch(() => null)
        if (state === 'open') {
          await this.applyState(n.id, n.instanceName, 'open', null)
          continue
        }
        await this.client.logout(n.instanceName).catch(() => undefined)
        this.qrs.delete(n.id)
        await this.prisma.whatsappNumber.update({ where: { id: n.id }, data: { status: 'DESCONECTADO', statusReason: 'QR Code não foi lido a tempo', disconnectedAt: new Date() } })
      }
      if (Date.now() - this.lastFullCheck >= CHECK_CONNECTED_MS) {
        this.lastFullCheck = Date.now()
        const connected = await this.prisma.whatsappNumber.findMany({ where: { deletedAt: null, status: 'CONECTADO' } })
        for (const n of connected) {
          const state = await this.client.state(n.instanceName).catch(() => undefined)
          // Sem resposta do serviço: não muda nada (não é o número que caiu).
          if (state === 'close') await this.applyState(n.id, n.instanceName, 'close', 'Conexão perdida')
          // "open" pode mentir: confere usando a conexão; morta, reinicia e confere de novo antes de avisar.
          else if (state === 'open' && n.phone && (await this.client.alive(n.instanceName, n.phone)) === false) {
            await this.client.restart(n.instanceName).catch(() => undefined)
            await new Promise((r) => setTimeout(r, this.restartWaitMs))
            if ((await this.client.alive(n.instanceName, n.phone)) === false) await this.markDead(n.instanceName)
            else this.logger.log(`Sessão do número ${n.name} recuperada sozinha.`)
          }
          // Número ainda sem telefone (a consulta falhou na hora de conectar): tenta de novo.
          else if (state === 'open' && !n.phone) {
            const info = await this.client.info(n.instanceName).catch(() => null)
            if (info?.phone) await this.prisma.whatsappNumber.update({ where: { id: n.id }, data: { phone: info.phone, profileName: info.profileName ?? n.profileName } })
          }
        }
      }
    } catch (err) {
      this.logger.error(`WhatsApp (conferência): ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
