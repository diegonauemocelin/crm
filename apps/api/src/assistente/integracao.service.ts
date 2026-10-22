import { BadRequestException, ConflictException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { decrypt, encrypt } from '../common/crypto'
import { env } from '../config/env'
import { MercadoLivreService } from '../marketplaces/mercadolivre.service'
import { type Actor, AssistService } from './assist.service'
import { AssistMlService } from './assist-ml.service'
import { AssistKnowledgeService } from './conhecimento.service'
import { INTEGRATION_KEY, type IntegrationSettings, PAINEL_KEY } from './constantes'
import { AssistPipelineService } from './pipeline.service'
import { AssistSalesService } from './vendas.service'

/** Credenciais e tokens trazidos do painel antigo (guardados até o CRM assumir o atendimento). */
export interface PainelImport {
  importedAt?: string
  version?: string | null
  clientId?: string | null
  clientSecretEnc?: string | null
  accessTokenEnc?: string | null
  refreshTokenEnc?: string | null
  tokenExpiresAt?: string | null
  sellerId?: string | null
  nickname?: string | null
  counts?: Record<string, number>
}

interface ItemSync {
  running: boolean
  phase: string | null
  done: number
  total: number
  startedAt: string | null
  finishedAt: string | null
  result: { found: number; stored: number; linked: number; linkable: number } | null
  error: string | null
  by: string | null
}

/** Integração do assistente com o Mercado Livre: anúncios, loja oficial, troca do painel para o CRM e rotinas. */
@Injectable()
export class AssistIntegrationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Assistente')
  private readonly itemSyncs = new Map<string, ItemSync>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private readonly lastPoll = new Map<string, number>()
  private readonly lastSales = new Map<string, number>()

  constructor(
    private readonly assist: AssistService,
    private readonly ml: AssistMlService,
    private readonly mlConn: MercadoLivreService,
    private readonly knowledge: AssistKnowledgeService,
    private readonly pipeline: AssistPipelineService,
    private readonly sales: AssistSalesService,
  ) {}

  onApplicationBootstrap() {
    // primeira rodada depois de 1 min (o sistema acabou de subir); depois, a cada minuto
    setTimeout(() => void this.bootRecover(), 60_000).unref()
    this.timer = setInterval(() => void this.tick(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  webhookUrl() {
    return `${env.appUrl}/api/webhooks/mercadolivre`
  }

  private async activeTenants() {
    const rows = await this.assist.prisma.tenantSetting.findMany({ where: { key: INTEGRATION_KEY }, select: { tenantId: true, value: true } })
    return rows.filter((r) => (r.value as Partial<IntegrationSettings> | null)?.active).map((r) => r.tenantId)
  }

  private async bootRecover() {
    for (const t of await this.activeTenants().catch(() => [])) await this.pipeline.recoverQueue(t).catch(() => undefined)
  }

  /** A cada minuto, só nas empresas em que o CRM assumiu o atendimento. */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const tenantId of await this.activeTenants()) {
        try {
          await this.pipeline.verifyPendingConfirmations(tenantId)
          await this.pipeline.retryAiFailures(tenantId)
          await this.pipeline.fillCustomerNicknames(tenantId).catch(() => 0)
          const s = await this.assist.integration(tenantId)
          if (!(await this.ml.active(tenantId))) continue
          const now = Date.now()
          if (s.polling_enabled && now - (this.lastPoll.get(tenantId) ?? 0) >= s.poll_minutes * 60_000) {
            this.lastPoll.set(tenantId, now)
            await this.pipeline.syncQuestions(tenantId)
          }
          // primeira busca de vendas ~5 min depois de subir
          if (!this.lastSales.has(tenantId)) this.lastSales.set(tenantId, now - (s.sales_sync_minutes - 5) * 60_000)
          if (s.sales_enabled && now - this.lastSales.get(tenantId)! >= s.sales_sync_minutes * 60_000) {
            this.lastSales.set(tenantId, now)
            await this.sales.sync(tenantId).catch(() => undefined)
          }
        } catch (e) {
          await this.assist.log(tenantId, 'error', `Rotina do assistente: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      this.logger.error(`Rotina do assistente: ${(e as Error).message}`)
    } finally {
      this.ticking = false
    }
  }

  // ---------- Situação ----------

  async status(tenantId: string) {
    const [c, integ, st, store, painel, items, salesLinked] = await Promise.all([
      this.mlConn.config(tenantId),
      this.assist.integration(tenantId),
      this.assist.state(tenantId),
      this.assist.store(tenantId),
      this.assist.settings.get<PainelImport>(tenantId, PAINEL_KEY, {}),
      this.assist.prisma.assistItem.count({ where: { tenantId } }),
      this.assist.prisma.assistSale.count({ where: { tenantId } }),
    ])
    const connected = c.status !== 'DESCONECTADO' && !!c.refreshTokenEnc
    const active = await this.ml.active(tenantId)
    const webhookRecent = !!st.lastWebhookAt && Date.now() - Date.parse(st.lastWebhookAt) < 7 * 86_400_000
    return {
      connected,
      account: c.userId ? { sellerId: c.userId, nickname: c.nickname } : null,
      active,
      taken: integ.active,
      status: !connected ? 'desconectada' : !integ.active ? 'painel_antigo' : active ? 'ativa' : 'aguardando_teste',
      webhookUrl: this.webhookUrl(),
      lastTestAt: st.lastTestAt ?? null,
      lastTestOk: !!st.lastTestOk,
      lastItemsSyncAt: st.lastItemsSyncAt ?? null,
      lastQuestionsSyncAt: st.lastQuestionsSyncAt ?? null,
      lastWebhookAt: st.lastWebhookAt ?? null,
      webhookStatus: st.lastWebhookAt ? (webhookRecent ? 'recebendo' : 'sem_notificacoes_recentes') : 'nenhuma_notificacao',
      lastError: st.lastError ?? null,
      lastErrorAt: st.lastErrorAt ?? null,
      items,
      sales: { lastSyncAt: st.lastOrdersSyncAt ?? null, error: st.ordersError ?? null, running: this.sales.running, lastResult: this.sales.lastResult, linked: salesLinked },
      store: { ...store, linkable_now: (await this.ml.allowedLinkItemIds(tenantId)).size },
      settings: integ,
      recentLogs: st.logs ?? [],
      painel: painel.importedAt ? { importedAt: painel.importedAt, version: painel.version ?? null, nickname: painel.nickname ?? null, sellerId: painel.sellerId ?? null, hasTokens: !!painel.refreshTokenEnc, hasApp: !!painel.clientId, counts: painel.counts ?? {} } : null,
      itemSync: this.itemSyncs.get(tenantId) ?? null,
    }
  }

  async test(tenantId: string) {
    const c = await this.mlConn.config(tenantId)
    if (!c.refreshTokenEnc) throw new ConflictException('Conecte a conta do Mercado Livre antes de testar (Marketplaces › Conexões).')
    return this.ml.testConnection(tenantId)
  }

  // ---------- Troca do painel antigo para o CRM ----------

  /**
   * "Assumir o atendimento": a partir daqui o CRM lê as perguntas, responde e liga as vendas. Se o CRM ainda não está
   * conectado ao Mercado Livre e o painel foi importado, usa o aplicativo e o acesso que o painel usava.
   */
  async takeOver(tenantId: string, actor: Actor, usePainelAccess: boolean) {
    const c = await this.mlConn.config(tenantId)
    if (usePainelAccess) {
      const p = await this.assist.settings.get<PainelImport>(tenantId, PAINEL_KEY, {})
      if (!p.refreshTokenEnc || !p.clientId || !p.clientSecretEnc) throw new BadRequestException('O acesso do painel antigo não foi importado. Conecte o Mercado Livre em Marketplaces › Conexões.')
      await this.mlConn.patch(tenantId, {
        clientId: p.clientId,
        clientSecretEnc: p.clientSecretEnc,
        accessTokenEnc: p.accessTokenEnc ?? null,
        refreshTokenEnc: p.refreshTokenEnc,
        tokenExpiresAt: p.tokenExpiresAt ?? new Date(0).toISOString(),
        userId: p.sellerId ?? c.userId,
        nickname: p.nickname ?? c.nickname,
        status: 'CONECTADO',
        connectedAt: new Date().toISOString(),
        connectedBy: `${actor.name ?? 'Sistema'} (acesso do painel antigo)`,
        lastError: null,
      })
    } else if (c.status === 'DESCONECTADO' || !c.refreshTokenEnc) {
      throw new BadRequestException('Conecte a conta do Mercado Livre em Marketplaces › Conexões (ou use o acesso do painel antigo).')
    }
    const test = await this.ml.testConnection(tenantId)
    if (!test.ok) throw new BadRequestException(`O teste da conexão falhou: ${test.error}`)
    const integ = await this.assist.integration(tenantId)
    await this.assist.saveIntegration(tenantId, { ...integ, active: true, activatedAt: new Date().toISOString(), activatedBy: actor.name })
    await this.assist.log(tenantId, 'info', `O CRM assumiu o atendimento do Mercado Livre (${actor.name ?? 'sistema'}).`)
    await this.pipeline.recoverQueue(tenantId)
    return { ok: true, nickname: test.nickname }
  }

  /** Para de atender pelo CRM (ex.: voltar para o painel antigo durante a conferência). */
  async release(tenantId: string, actor: Actor) {
    const integ = await this.assist.integration(tenantId)
    await this.assist.saveIntegration(tenantId, { ...integ, active: false })
    await this.assist.log(tenantId, 'info', `Atendimento do Mercado Livre pelo CRM desligado (${actor.name ?? 'sistema'}).`)
    return { ok: true }
  }

  async saveSettings(tenantId: string, b: Partial<IntegrationSettings>) {
    const cur = await this.assist.integration(tenantId)
    const next: IntegrationSettings = {
      ...cur,
      polling_enabled: b.polling_enabled ?? cur.polling_enabled,
      poll_minutes: b.poll_minutes !== undefined ? Math.min(Math.max(Number(b.poll_minutes) || 5, 2), 60) : cur.poll_minutes,
      sales_enabled: b.sales_enabled ?? cur.sales_enabled,
      sales_window_days: b.sales_window_days !== undefined ? Math.min(Math.max(Number(b.sales_window_days) || 30, 1), 90) : cur.sales_window_days,
    }
    await this.assist.saveIntegration(tenantId, next)
    return next
  }

  // ---------- Loja oficial e anúncios ----------

  async setStore(tenantId: string, input: string, actor: Actor) {
    if (!(await this.mlConn.config(tenantId)).refreshTokenEnc) throw new ConflictException('Conecte a conta do Mercado Livre antes de informar a loja.')
    let store
    try {
      store = await this.ml.resolveStore(tenantId, input)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    const { is_connected_account, ...rest } = store
    await this.assist.saveStore(tenantId, { ...rest, configured_at: new Date().toISOString(), configured_by: actor.name })
    return { store: { ...rest, is_connected_account } }
  }

  async removeStore(tenantId: string) {
    await this.assist.saveStore(tenantId, { seller_id: null })
    return { ok: true }
  }

  /** Sincronização dos anúncios da loja em segundo plano (lojas grandes levam minutos; a tela acompanha o andamento). */
  async syncItems(tenantId: string, actor: Actor) {
    if (!(await this.mlConn.config(tenantId)).refreshTokenEnc) throw new ConflictException('Conecte a conta do Mercado Livre antes de sincronizar.')
    const store = await this.assist.store(tenantId)
    if (!store.seller_id) throw new ConflictException('Informe a loja oficial no Mercado Livre antes de sincronizar os anúncios.')
    const cur = this.itemSyncs.get(tenantId)
    if (!cur?.running) void this.runItemSync(tenantId, actor)
    return { started: true, status: this.itemSyncs.get(tenantId) }
  }

  itemSyncStatus(tenantId: string) {
    return this.itemSyncs.get(tenantId) ?? null
  }

  private async runItemSync(tenantId: string, actor: Actor) {
    const s: ItemSync = { running: true, phase: 'listando', done: 0, total: 0, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null, by: actor.name }
    this.itemSyncs.set(tenantId, s)
    try {
      const store = await this.assist.store(tenantId)
      const ids = await this.ml.listStoreItemIds(tenantId, store)
      Object.assign(s, { phase: 'baixando', total: ids.length })
      const stored = await this.ml.fetchAndStoreItems(tenantId, ids, (d) => (s.done = d))
      s.phase = 'vinculando'
      const linked = await this.knowledge.relinkApplications(tenantId)
      const linkable = (await this.ml.allowedLinkItemIds(tenantId)).size
      await this.assist.patchState(tenantId, { lastItemsSyncAt: new Date().toISOString() })
      await this.assist.saveStore(tenantId, { ...store, last_sync_at: new Date().toISOString(), synced_items: stored, linkable_items: linkable })
      s.result = { found: ids.length, stored, linked, linkable }
      await this.assist.log(tenantId, 'info', `Sincronização concluída: ${stored} de ${ids.length} anúncios; ${linkable} com link liberado.`)
    } catch (e) {
      s.error = (e as Error).message
      await this.assist.log(tenantId, 'error', `Falha na sincronização de anúncios: ${(e as Error).message}`)
    } finally {
      Object.assign(s, { running: false, phase: 'concluido', finishedAt: new Date().toISOString() })
    }
  }

  async syncQuestionsNow(tenantId: string) {
    if (!(await this.ml.active(tenantId))) throw new ConflictException('O CRM ainda não assumiu o atendimento (ou a conexão não foi testada).')
    return this.pipeline.syncQuestions(tenantId)
  }

  async syncSalesNow(tenantId: string, days?: number) {
    if (!(await this.ml.active(tenantId))) throw new ConflictException('O CRM ainda não assumiu o atendimento (ou a conexão não foi testada).')
    try {
      return await this.sales.sync(tenantId, days)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
  }

  // ---------- Webhook ----------

  /** Notificação do Mercado Livre (tópicos questions e orders_v2). Só a empresa dona do vendedor e do aplicativo. */
  async webhook(body: { topic?: string; resource?: string; user_id?: number | string; application_id?: number | string }) {
    const userId = String(body.user_id ?? '')
    if (!/^\d{1,30}$/.test(userId)) return
    const rows = await this.assist.prisma.tenantSetting.findMany({ where: { key: 'marketplace_ml' }, select: { tenantId: true, value: true } })
    const owner = rows.find((r) => {
      const v = r.value as { userId?: string; clientId?: string } | null
      return v?.userId === userId && String(v?.clientId ?? '') === String(body.application_id ?? '')
    })
    if (!owner) return
    const tenantId = owner.tenantId
    if (!(await this.assist.integration(tenantId)).active) return
    await this.assist.patchState(tenantId, { lastWebhookAt: new Date().toISOString() })
    const resource = String(body.resource ?? '')
    if (body.topic === 'orders_v2' && /^\/orders\/\d+$/.test(resource)) {
      if (!(await this.assist.integration(tenantId)).sales_enabled) return
      const order = await this.ml.getOrder(tenantId, resource.split('/').pop()!).catch((e: Error) => void this.assist.log(tenantId, 'warn', `Webhook: falha ao obter o pedido ${resource}: ${e.message}`))
      if (order) await this.sales.processOrder(tenantId, order as never)
      return
    }
    if (body.topic !== 'questions' || !/^\/questions\/\d+$/.test(resource)) return
    const id = resource.split('/').pop()!
    try {
      await this.pipeline.ingest(tenantId, await this.ml.getQuestion(tenantId, id), 'webhook')
    } catch (e) {
      await this.assist.log(tenantId, 'error', `Webhook: falha ao obter a pergunta ${id}: ${(e as Error).message}`)
    }
  }
}

/** Recriptografa um segredo do painel antigo com a chave do CRM (usado pela importação). */
export const reencrypt = (plain: string | null | undefined) => (plain ? encrypt(plain) : null)
export const tryDecrypt = (enc: string | null | undefined) => {
  try {
    return enc ? decrypt(enc) : null
  } catch {
    return null
  }
}
