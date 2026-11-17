import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { GEMINI_MODELS } from '../assistente/constantes'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { ChatService } from '../whatsapp/chat.service'
import { isOpen } from '../whatsapp/envio'
import { whatsappOf } from '../whatsapp/mensagens'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { cleanCampaign, isOptOut, messagePrompt, nextGapMs, PERSONAL_CHUNK, personalFromAi, personalPrompt, pickVariation, renderMessage, sendPhone, sendWindowOpen, variationsFromAi } from './envio'
import { aiWrite } from './ia'
import type { PhoneContact, ProspectCriteria } from './prospeccao'
import { ProspeccaoService } from './prospeccao.service'

const TICK_MS = 60_000
const LABEL = 'Busca de leads'
/** Respostas conferidas por volta (quem respondeu e quem pediu para sair). */
const REPLY_BATCH = 100
const REPLY_DAYS = 14

/**
 * Busca de leads › chamar no WhatsApp: abre a conversa de uma empresa no chat, escreve a mensagem com a IA e manda em
 * fila para várias, uma de cada vez, com intervalo aleatório, limite por dia e só no horário comercial (para o número
 * não ser bloqueado). Cada empresa que recebe vira lead (origem Prospecção); quem responde "SAIR" vira "não contatar".
 */
@Injectable()
export class ProspeccaoEnvioService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BuscaDeLeadsEnvio')
  private timer: NodeJS.Timeout | null = null
  private running = false
  random = Math.random

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
    private readonly whatsapp: WhatsappService,
    private readonly prospeccao: ProspeccaoService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private assertChat(user: AuthUser) {
    if (!can(user.permissions, user.role.isSystem, 'chat', 'create')) throw new ForbiddenException('Seu perfil não pode iniciar conversas no WhatsApp.')
  }

  /** Números em que o usuário pode iniciar conversa (os ligados a ele; nunca mistura números). */
  async numbers(user: AuthUser) {
    this.prospeccao.assertCan(user, 'view')
    if (!can(user.permissions, user.role.isSystem, 'chat', 'create')) return []
    return this.chat.startOptions(user)
  }

  /** Chamar no WhatsApp: vira lead e abre a conversa no chat, pelo número escolhido. */
  async openChat(user: AuthUser, id: string, d: { numberId: string; phone?: string | null }, ctx: RequestCtx) {
    this.prospeccao.assertCan(user, 'edit')
    this.assertChat(user)
    const p = await this.prisma.prospect.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!p) throw new NotFoundException('Empresa não encontrada.')
    if (p.status === 'NAO_CONTATAR') throw new BadRequestException('Esta empresa está marcada para não contatar.')
    const phones = p.phones as unknown as PhoneContact[]
    const phone = (d.phone && phones.find((x) => x.value === d.phone)) || sendPhone(phones)
    if (!phone) throw new BadRequestException('Esta empresa não tem celular para chamar no WhatsApp.')
    const { leadId } = await this.prospeccao.leadFor(user.tenantId, id, phone.value)
    const conv = await this.chat.start(user, { numberId: d.numberId, phone: phone.value, leadId })
    await this.audit.byUser(user, ctx, 'prospeccao.chamar_whatsapp', 'prospect', id, { empresa: p.name })
    return { conversationId: conv.id, leadId }
  }

  /** Escreve a primeira mensagem com a IA da busca (Claude ou Gemini), em 3 variações. */
  async writeMessage(user: AuthUser, searchId: string, offer: string) {
    this.prospeccao.assertCan(user, 'edit')
    const what = offer.trim()
    if (what.length < 10) throw new BadRequestException('Conte em uma frase o que você oferece (pelo menos 10 letras).')
    const s = await this.prisma.prospectSearch.findFirst({ where: { id: searchId, tenantId: user.tenantId } })
    if (!s) throw new NotFoundException('Busca não encontrada.')
    const cfg = await this.prospeccao.config(user.tenantId)
    const key = await this.prospeccao.key(user.tenantId, cfg.provider)
    if (!key) throw new BadRequestException(`Falta a chave do ${cfg.provider === 'claude' ? 'Claude' : 'Gemini'} (veja a Configuração da busca de leads).`)
    const c = s.criteria as unknown as ProspectCriteria
    const company = (await this.settings.branding(user.tenantId).catch(() => null))?.shortName || 'nossa empresa'
    const prompt = messagePrompt({ offer: what.slice(0, 600), segment: c.segment || c.keywords.join(', ') || null, place: s.centerLabel ?? c.place, company, sender: user.name })
    let text: string
    try {
      text = await aiWrite(cfg.provider, key, cfg.claudeModel, GEMINI_MODELS, prompt)
    } catch (e) {
      throw new BadRequestException(`A IA não escreveu a mensagem: ${(e as Error).message}`)
    }
    const variations = variationsFromAi(text)
    if (!variations.length) throw new BadRequestException('A IA não devolveu a mensagem. Tente de novo ou escreva você mesmo.')
    return { variations }
  }

  /**
   * Uma mensagem diferente para cada empresa, escrita pelo Gemini (plano gratuito do Google) com o nome, o segmento, a
   * cidade e o motivo de cada uma. Pede em grupos pequenos (limite por minuto do plano gratuito). A pessoa revisa antes.
   */
  async writePersonal(user: AuthUser, searchId: string, offer: string, prospectIds: string[]) {
    this.prospeccao.assertCan(user, 'edit')
    const what = offer.trim()
    if (what.length < 10) throw new BadRequestException('Conte em uma frase o que você oferece (pelo menos 10 letras).')
    const ids = [...new Set(prospectIds)].slice(0, 50)
    const rows = await this.prisma.prospect.findMany({ where: { id: { in: ids }, searchId, tenantId: user.tenantId }, select: { id: true, name: true, segment: true, city: true, uf: true, reason: true } })
    if (!rows.length) throw new BadRequestException('Escolha as empresas.')
    const key = await this.prospeccao.key(user.tenantId, 'gemini')
    if (!key) throw new BadRequestException('Falta a chave do Gemini: cadastre em Marketplaces › Assistente ML › Configurações ou no e-mail marketing.')
    const company = (await this.settings.branding(user.tenantId).catch(() => null))?.shortName || 'nossa empresa'
    const messages: Record<string, string> = {}
    for (let i = 0; i < rows.length; i += PERSONAL_CHUNK) {
      const chunk = rows.slice(i, i + PERSONAL_CHUNK)
      const prompt = personalPrompt({ offer: what.slice(0, 600), company, sender: user.name, companies: chunk.map((r) => ({ id: r.id, nome: r.name, segmento: r.segment, cidade: [r.city, r.uf].filter(Boolean).join('/') || null, motivo: r.reason })) })
      try {
        Object.assign(messages, personalFromAi(await aiWrite('gemini', key, '', GEMINI_MODELS, prompt), chunk.map((r) => r.id)))
      } catch (e) {
        if (!Object.keys(messages).length) throw new BadRequestException(`O Gemini não escreveu as mensagens: ${(e as Error).message}`)
        break
      }
    }
    if (!Object.keys(messages).length) throw new BadRequestException('O Gemini não devolveu as mensagens. Tente de novo.')
    return { messages, missing: rows.filter((r) => !messages[r.id]).map((r) => r.id) }
  }

  /** Coloca as empresas escolhidas na fila de envio. */
  async createCampaign(user: AuthUser, searchId: string, raw: Record<string, unknown>, ctx: RequestCtx) {
    this.prospeccao.assertCan(user, 'edit')
    this.assertChat(user)
    let d: ReturnType<typeof cleanCampaign>
    try {
      d = cleanCampaign(raw)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    const s = await this.prisma.prospectSearch.findFirst({ where: { id: searchId, tenantId: user.tenantId }, select: { id: true } })
    if (!s) throw new NotFoundException('Busca não encontrada.')
    const number = (await this.chat.startOptions(user)).find((n) => n.id === d.numberId)
    if (!number) throw new BadRequestException('Escolha um número de WhatsApp que você pode usar.')
    const running = await this.prisma.prospectCampaign.count({ where: { tenantId: user.tenantId, numberId: number.id, status: { in: ['RODANDO', 'PAUSADA'] } } })
    if (running) throw new BadRequestException('Este número já tem um envio em andamento. Espere terminar ou cancele o anterior.')
    const prospects = await this.prisma.prospect.findMany({ where: { id: { in: d.prospectIds }, searchId, tenantId: user.tenantId, status: { in: ['NOVO', 'LEAD'] } } })
    const already = new Set((await this.prisma.prospectSend.findMany({ where: { tenantId: user.tenantId, prospectId: { in: prospects.map((p) => p.id) }, status: { in: ['FILA', 'ENVIANDO', 'ENVIADA'] } }, select: { prospectId: true } })).map((x) => x.prospectId))
    const rows = prospects
      .filter((p) => !already.has(p.id))
      .map((p) => ({ p, phone: sendPhone(p.phones as unknown as PhoneContact[]) }))
      .filter((x): x is { p: (typeof prospects)[number]; phone: PhoneContact } => !!x.phone)
    if (!rows.length) throw new BadRequestException('Nenhuma das empresas escolhidas tem celular com WhatsApp (ou já receberam).')
    if (!d.messages.length && rows.some((x) => !d.perProspect[x.p.id])) throw new BadRequestException('Falta a mensagem de alguma empresa. Gere de novo ou escreva uma mensagem geral.')
    const c = await this.prisma.prospectCampaign.create({
      data: {
        tenantId: user.tenantId,
        searchId,
        numberId: number.id,
        messages: d.messages,
        gapMin: d.gapMin,
        gapMax: d.gapMax,
        dailyMax: d.dailyMax,
        optOut: d.optOut,
        createdById: user.id,
        createdBy: user.name,
        sends: { create: rows.map((x) => ({ tenantId: user.tenantId, prospectId: x.p.id, phone: x.phone.value, text: d.perProspect[x.p.id] ?? null })) },
      },
    })
    await this.audit.byUser(user, ctx, 'prospeccao.envio_criado', 'prospect_campaign', c.id, { numero: number.name, empresas: rows.length, intervalo: `${d.gapMin}-${d.gapMax} min`, porDia: d.dailyMax })
    return { id: c.id, queued: rows.length, skipped: d.prospectIds.length - rows.length }
  }

  /** Envios da busca, com o andamento e a situação de cada empresa. */
  async list(user: AuthUser, searchId: string) {
    this.prospeccao.assertCan(user, 'view')
    const campaigns = await this.prisma.prospectCampaign.findMany({
      where: { tenantId: user.tenantId, searchId },
      orderBy: { createdAt: 'desc' },
      include: { sends: { select: { prospectId: true, status: true, error: true, sentAt: true, repliedAt: true, optedOut: true, conversationId: true } } },
    })
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { id: { in: campaigns.map((c) => c.numberId) } }, select: { id: true, name: true, status: true } })
    const today = this.todayStart()
    return campaigns.map(({ sends, ...c }) => ({
      ...c,
      number: numbers.find((n) => n.id === c.numberId) ?? null,
      total: sends.length,
      sent: sends.filter((x) => x.status === 'ENVIADA').length,
      sentToday: sends.filter((x) => x.status === 'ENVIADA' && x.sentAt && x.sentAt >= today).length,
      queued: sends.filter((x) => x.status === 'FILA' || x.status === 'ENVIANDO').length,
      failed: sends.filter((x) => x.status === 'ERRO' || x.status === 'PULADA').length,
      replied: sends.filter((x) => x.repliedAt).length,
      optedOut: sends.filter((x) => x.optedOut).length,
      sends,
    }))
  }

  async setStatus(user: AuthUser, id: string, action: 'pausar' | 'retomar' | 'cancelar', ctx: RequestCtx) {
    this.prospeccao.assertCan(user, 'edit')
    const c = await this.prisma.prospectCampaign.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Envio não encontrado.')
    if (c.status === 'CONCLUIDA' || c.status === 'CANCELADA') throw new BadRequestException('Este envio já terminou.')
    if (action === 'pausar') await this.prisma.prospectCampaign.update({ where: { id }, data: { status: 'PAUSADA' } })
    if (action === 'retomar') await this.prisma.prospectCampaign.update({ where: { id }, data: { status: 'RODANDO', error: null, nextAt: new Date() } })
    if (action === 'cancelar') {
      await this.prisma.prospectSend.updateMany({ where: { campaignId: id, status: 'FILA' }, data: { status: 'CANCELADA' } })
      await this.prisma.prospectCampaign.update({ where: { id }, data: { status: 'CANCELADA', finishedAt: new Date() } })
    }
    await this.audit.byUser(user, ctx, `prospeccao.envio_${action}`, 'prospect_campaign', id, {})
    return { ok: true }
  }

  private todayStart(now = new Date()) {
    const sp = new Date(now.getTime() - 3 * 3_600_000)
    return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) + 3 * 3_600_000)
  }

  // ---------- Fila ----------

  async tick(now = new Date()) {
    if (this.running) return
    this.running = true
    try {
      const due = await this.prisma.prospectCampaign.findMany({ where: { status: 'RODANDO', nextAt: { lte: now } }, orderBy: { nextAt: 'asc' }, take: 20 })
      for (const c of due) await this.sendNext(c, now).catch((e: unknown) => this.logger.warn(`Envio ${c.id}: ${(e as Error).message}`))
      await this.checkReplies(now).catch((e: unknown) => this.logger.warn(`Respostas: ${(e as Error).message}`))
    } finally {
      this.running = false
    }
  }

  private later(id: string, ms: number, error: string | null = null) {
    return this.prisma.prospectCampaign.update({ where: { id }, data: { nextAt: new Date(Date.now() + ms), error } })
  }

  async sendNext(c: { id: string; tenantId: string; numberId: string; messages: string[]; gapMin: number; gapMax: number; dailyMax: number; optOut: boolean; createdBy: string | null }, now: Date) {
    const hours = (await this.chat.rules(c.tenantId)).businessHours
    if (!sendWindowOpen(hours.enabled, isOpen(hours, now), now)) return this.later(c.id, 5 * 60_000)
    const sentToday = await this.prisma.prospectSend.count({ where: { campaignId: c.id, status: 'ENVIADA', sentAt: { gte: this.todayStart(now) } } })
    if (sentToday >= c.dailyMax) return this.later(c.id, 30 * 60_000, `Limite de ${c.dailyMax} por dia atingido: continua amanhã.`)
    const number = await this.prisma.whatsappNumber.findFirst({ where: { id: c.numberId, tenantId: c.tenantId, deletedAt: null } })
    if (!number) return this.prisma.prospectCampaign.update({ where: { id: c.id }, data: { status: 'PAUSADA', error: 'O número de WhatsApp foi excluído.' } })
    if (number.status !== 'CONECTADO') return this.later(c.id, 5 * 60_000, `O número ${number.name} está desconectado: o envio continua quando ele voltar.`)
    const next = await this.prisma.prospectSend.findFirst({ where: { campaignId: c.id, status: 'FILA' }, orderBy: { createdAt: 'asc' }, include: { prospect: true } })
    if (!next) return this.prisma.prospectCampaign.update({ where: { id: c.id }, data: { status: 'CONCLUIDA', finishedAt: now, error: null } })
    const claimed = await this.prisma.prospectSend.updateMany({ where: { id: next.id, status: 'FILA' }, data: { status: 'ENVIANDO' } })
    if (!claimed.count) return
    const skip = (reason: string) => this.prisma.prospectSend.update({ where: { id: next.id }, data: { status: 'PULADA', error: reason } })
    const p = next.prospect
    if (p.status === 'NAO_CONTATAR' || p.status === 'DESCARTADO') return skip(p.status === 'NAO_CONTATAR' ? 'marcada para não contatar' : 'descartada')
    // Confere o WhatsApp antes (mensagem para número sem WhatsApp conta contra o número da empresa).
    let phone = next.phone
    const client = this.whatsapp.client
    if (client) {
      const variants = /^\+55(\d{2})9(\d{8})$/.test(phone) ? [phone, phone.replace(/^(\+55\d{2})9/, '$1')] : [phone]
      const check = await client.checkNumbers(number.instanceName, variants.map((v) => v.slice(1))).then(whatsappOf).catch(() => null)
      if (check && !check.exists) {
        await skip('sem WhatsApp')
        return this.later(c.id, 60_000)
      }
      if (check?.jid?.endsWith('@s.whatsapp.net')) phone = `+${check.jid.split('@')[0]}`
    }
    try {
      const { leadId } = await this.prospeccao.leadFor(c.tenantId, p.id, next.phone)
      // Mensagem própria da empresa (escrita pela IA e revisada) ou uma das variações gerais.
      const text = renderMessage(next.text ?? pickVariation(c.messages, this.random), { empresa: p.name, cidade: p.city, segmento: p.segment, vendedor: c.createdBy }, c.optOut)
      const sent = await this.chat.sendAutomatic(number, phone, text, LABEL, { leadId, recordId: null, name: p.name })
      if (!sent) {
        // Limite de envios do número no momento: tenta de novo daqui a pouco.
        await this.prisma.prospectSend.update({ where: { id: next.id }, data: { status: 'FILA' } })
        return this.later(c.id, 2 * 60_000)
      }
      await this.prisma.prospectSend.update({ where: { id: next.id }, data: { status: 'ENVIADA', sentAt: new Date(), text, conversationId: sent.conversationId, error: null } })
    } catch (e) {
      await this.prisma.prospectSend.update({ where: { id: next.id }, data: { status: 'ERRO', error: ((e as Error).message || 'erro desconhecido').slice(0, 300) } })
    }
    return this.later(c.id, nextGapMs(c.gapMin, c.gapMax, this.random))
  }

  /** Quem respondeu depois do envio; quem pediu para sair vira "não contatar". */
  private async checkReplies(now: Date) {
    const sends = await this.prisma.prospectSend.findMany({
      where: { status: 'ENVIADA', repliedAt: null, conversationId: { not: null }, sentAt: { gte: new Date(now.getTime() - REPLY_DAYS * 86_400_000) } },
      orderBy: { sentAt: 'asc' },
      take: REPLY_BATCH,
      include: { prospect: true },
    })
    for (const s of sends) {
      const reply = await this.prisma.whatsappMessage.findFirst({ where: { conversationId: s.conversationId!, fromMe: false, sentAt: { gt: s.sentAt! } }, orderBy: { sentAt: 'asc' }, select: { sentAt: true, text: true } })
      if (!reply) continue
      const out = isOptOut(reply.text)
      await this.prisma.prospectSend.update({ where: { id: s.id }, data: { repliedAt: reply.sentAt, optedOut: out } })
      if (out && s.prospect.status !== 'NAO_CONTATAR') await this.prospeccao.block(s.tenantId, s.prospect, 'Pediu para sair (WhatsApp)')
    }
  }
}
