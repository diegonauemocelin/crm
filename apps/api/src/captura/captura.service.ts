import { Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { normalizePhone } from '../atendimento/br'
import { Prisma } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { LeadConfigService } from '../leads/lead-config.service'
import { LeadsService } from '../leads/leads.service'
import { convertCustom, type CustomFieldShape } from '../leads/mapeamento'
import { PrismaService } from '../prisma/prisma.service'
import { classifyDevice, CLIENT_ID, domainAllowed, type Touch } from '../rastreamento/origem'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { env } from '../config/env'
import { SettingsService } from '../settings/settings.service'
import { BASE_FIELDS, type FormField, safeRedirect, validateSubmission, waLink, whatsappText } from './regras'

export interface WhatsappWidget {
  enabled: boolean
  /** Número central (Pré-Vendas), E.164. Não vai para o site: o link só é entregue depois do cadastro. */
  phone: string | null
  buttonText: string
  title: string
  subtitle: string
  askEmail: boolean
  message: string
  position: 'direita' | 'esquerda'
  color: string
  include: string[]
  exclude: string[]
  device: 'todos' | 'celular' | 'computador'
  ownerId: string | null
  /** Opcionais: tipo de cliente e marcas da máquina gravados no atendimento. */
  customerTypeId: string | null
  brandIds: string[]
  tags: string[]
  createRecord: boolean
}

export interface CaptureSettings {
  /** Link da política de privacidade do site (aparece nos formulários). */
  privacyUrl: string
  whatsapp: WhatsappWidget
}

export const DEFAULT_WHATSAPP: WhatsappWidget = {
  enabled: false,
  phone: null,
  buttonText: 'Fale no WhatsApp',
  title: 'Fale com a USA Parts',
  subtitle: 'Deixe seu nome e WhatsApp para iniciar a conversa.',
  askEmail: false,
  message: 'Olá! Meu nome é {nome}. Vim pelo site e gostaria de atendimento.',
  position: 'direita',
  color: '#25D366',
  include: [],
  exclude: [],
  device: 'todos',
  ownerId: null,
  customerTypeId: null,
  brandIds: [],
  tags: ['whatsapp-site'],
  createRecord: true,
}

export const DEFAULT_CAPTURE: CaptureSettings = { privacyUrl: '', whatsapp: DEFAULT_WHATSAPP }

export interface PublicSubmit {
  k: string
  kind: 'form' | 'popup' | 'whatsapp' | 'landing' | 'popup_view'
  formId?: string
  popupId?: string
  /** Qual botão de WhatsApp (pode haver vários). */
  whatsappId?: string
  /** Id do navegador (cookie do rastreamento), para ligar as visitas ao lead. */
  v?: string
  u?: string
  d?: Record<string, unknown>
  consent?: boolean
  /** Campo-isca (robôs preenchem) e tempo desde que o formulário apareceu. */
  hp?: string
  t?: number
}

export interface SubmitResult {
  ok: boolean
  message?: string
  redirect?: string | null
  errors?: Record<string, string>
}

const UUID = /^[0-9a-f-]{36}$/
/** Envio mais rápido que isso (ms) é de robô. */
const MIN_FILL_MS = 1500

/**
 * Entrada pública da captura: o script do site e as landing pages enviam para cá.
 * Cria/atualiza o lead (mesma regra de deduplicação da base), registra o consentimento, liga as visitas
 * do navegador ao lead e, se configurado, abre um atendimento na fila de Pré-Vendas.
 */
@Injectable()
export class CapturaService {
  private readonly logger = new Logger(CapturaService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tracking: RastreamentoService,
    private readonly capture: LeadCaptureService,
    private readonly leads: LeadsService,
    private readonly config: LeadConfigService,
    private readonly audit: AuditService,
  ) {}

  settingsOf(tenantId: string) {
    return this.settings.get(tenantId, 'captura', DEFAULT_CAPTURE).then((s) => ({ ...DEFAULT_CAPTURE, ...s, whatsapp: { ...DEFAULT_WHATSAPP, ...s.whatsapp } }))
  }

  /** Origem do navegador é de um domínio do site cadastrado? (usado também para liberar CORS) */
  async allowedOrigin(key: string, origin: string | undefined) {
    const site = await this.tracking.siteByKey(key)
    if (!site?.s.enabled || !origin) return null
    try {
      return domainAllowed(new URL(origin).hostname, site.s.domains) ? { tenantId: site.tenantId, domains: site.s.domains } : null
    } catch {
      return null
    }
  }

  /**
   * Código com script de um formulário: cria o espaço do formulário exatamente onde foi colado e garante que o
   * script do CRM está na página (carrega se faltar). Funciona mesmo em editores que removem o <div> marcador.
   */
  async formScript(key: string, formId: string) {
    const site = await this.tracking.siteByKey(key)
    if (!site?.s.enabled || !UUID.test(formId)) return '/* Formulário do CRM indisponível (rastreamento desligado ou código inválido). */\n'
    const form = await this.prisma.captureForm.findFirst({ where: { id: formId, tenantId: site.tenantId, active: true }, select: { id: true } })
    if (!form) return '/* Formulário do CRM inativo ou excluído. */\n'
    const cfg = JSON.stringify({ f: form.id, s: `${env.appUrl}/api/public/rastreamento/script.js?k=${key}` })
    return `/* CRM - formulário */
(function (d, w) {
  var C = ${cfg};
  var me = d.currentScript;
  var box = d.createElement('div');
  box.setAttribute('data-usacrm-form', C.f);
  if (me && me.parentNode) me.parentNode.insertBefore(box, me); else (d.body || d.documentElement).appendChild(box);
  if (w.__crmEmbed) { w.__crmEmbed(); return; }
  if (!w.__crmTrack && !d.querySelector('script[src*="/api/public/rastreamento/script.js"]')) {
    var t = d.createElement('script'); t.async = true; t.src = C.s; (d.head || d.documentElement).appendChild(t);
  }
})(document, window);
`
  }

  /** O que o script do site precisa para desenhar pop-ups, formulários embutidos e o botão de WhatsApp. */
  async publicConfig(tenantId: string) {
    const [forms, popups, s, buttons] = await Promise.all([
      this.prisma.captureForm.findMany({ where: { tenantId, active: true } }),
      this.prisma.capturePopup.findMany({ where: { tenantId, active: true, form: { active: true } } }),
      this.settingsOf(tenantId),
      this.prisma.captureWhatsapp.findMany({ where: { tenantId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ])
    return {
      privacyUrl: s.privacyUrl || null,
      forms: Object.fromEntries(
        forms.map((f) => [f.id, { id: f.id, fields: f.fields, submitLabel: f.submitLabel, successMessage: f.successMessage, consentText: f.consentText }]),
      ),
      popups: popups.map((p) => ({
        id: p.id,
        formId: p.formId,
        title: p.title,
        text: p.text,
        imageUrl: p.imageUrl,
        trigger: p.trigger,
        delaySec: p.delaySec,
        scrollPct: p.scrollPct,
        include: p.include,
        exclude: p.exclude,
        device: p.device,
        frequencyDays: p.frequencyDays,
        color: p.color,
      })),
      // Vários botões: o script mostra o primeiro que combina com a página e o dispositivo. O número não vai junto.
      whatsapps: buttons.map((w) => ({ id: w.id, buttonText: w.buttonText, title: w.title, subtitle: w.subtitle, askEmail: w.askEmail, position: w.position, color: w.color, include: w.include, exclude: w.exclude, device: w.device })),
    }
  }

  async submit(tenantId: string, p: PublicSubmit, meta: { ip: string | null; userAgent?: string }): Promise<SubmitResult> {
    if (p.kind === 'popup_view') {
      if (p.popupId && UUID.test(p.popupId)) await this.prisma.capturePopup.updateMany({ where: { id: p.popupId, tenantId }, data: { views: { increment: 1 } } })
      return { ok: true }
    }
    const s = await this.settingsOf(tenantId)
    // Robô: responde como se tivesse dado certo, sem gravar nada.
    if (p.hp || (typeof p.t === 'number' && p.t < MIN_FILL_MS)) return { ok: true, message: 'Recebido.' }

    let fields: FormField[]
    let form: Awaited<ReturnType<typeof this.prisma.captureForm.findFirst>> = null
    let popup: { id: string; name: string; ownerId: string | null; customerTypeId: string | null; brandIds: string[] } | null = null
    // Botão usado (ou, se o script for antigo e não mandar o id, o primeiro ativo).
    const wa =
      p.kind === 'whatsapp'
        ? await this.prisma.captureWhatsapp.findFirst({
            where: { tenantId, active: true, ...(p.whatsappId && UUID.test(p.whatsappId) ? { id: p.whatsappId } : {}) },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          })
        : null
    if (p.kind === 'whatsapp') {
      if (!wa) return { ok: false, message: 'Atendimento por WhatsApp indisponível no momento.' }
      fields = [
        { key: 'name', label: 'Nome', required: true },
        { key: 'phone', label: 'WhatsApp', required: true },
        ...(wa!.askEmail ? [{ key: 'email', label: 'E-mail', required: false }] : []),
      ]
    } else {
      if (!p.formId || !UUID.test(p.formId)) return { ok: false, message: 'Formulário inválido.' }
      form = await this.prisma.captureForm.findFirst({ where: { id: p.formId, tenantId, active: true } })
      if (!form) return { ok: false, message: 'Este formulário não está mais disponível.' }
      if (p.kind === 'popup' && p.popupId && UUID.test(p.popupId)) popup = await this.prisma.capturePopup.findFirst({ where: { id: p.popupId, tenantId }, select: { id: true, name: true, ownerId: true, customerTypeId: true, brandIds: true } })
      fields = form.fields as unknown as FormField[]
    }

    const checked = validateSubmission(fields, p.d ?? {})
    if ('errors' in checked) return { ok: false, message: 'Confira os campos destacados.', errors: checked.errors }
    const { contact, custom, message } = checked.data

    // Campos personalizados no tipo certo (número, data, lista...).
    const defs = await this.config.listFields(tenantId)
    const customFields: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(custom)) {
      const def = defs.find((d) => d.key === key && d.active)
      if (!def) continue
      const conv = convertCustom(def as unknown as CustomFieldShape, raw)
      if ('value' in conv && conv.value !== null) customFields[key] = conv.value
    }

    // Origem da visita (UTMs, anúncio...) e dispositivo, se o navegador já era conhecido do rastreamento.
    const visitor = p.v && CLIENT_ID.test(p.v) ? await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: p.v } } }) : null
    const pageUrl = p.u ? safeRedirect(p.u) : null
    const device = classifyDevice(meta.userAgent, null, (await this.tracking.config(tenantId)).appMarkers)
    const touch = ((visitor?.lastTouch ?? visitor?.firstTouch) as Touch | null) ?? { source: 'direto', medium: 'direto' }

    // Vendedor, tipo de cliente e marcas: do botão de WhatsApp, do pop-up (se ele definir) ou do formulário.
    const source = p.kind === 'whatsapp' ? wa! : form!
    const ownerId = (popup?.ownerId ?? source.ownerId) || null
    const customerTypeId = (popup?.customerTypeId ?? source.customerTypeId) || null
    const brandIds = popup?.brandIds.length ? popup.brandIds : (source.brandIds ?? [])
    const lookups = await this.prisma.lookupItem.findMany({ where: { tenantId, id: { in: [customerTypeId, ...brandIds].filter((x): x is string => !!x) } }, select: { id: true, name: true, type: true } })
    const customerType = lookups.find((l) => l.id === customerTypeId && l.type === 'TIPO_CLIENTE') ?? null
    const brands = lookups.filter((l) => brandIds.includes(l.id) && l.type === 'MARCA')

    const channelName = p.kind === 'whatsapp' ? `botão de WhatsApp "${wa!.name}"` : popup ? `pop-up "${popup.name}"` : p.kind === 'landing' ? `landing page (formulário "${form!.name}")` : `formulário "${form!.name}"`
    const result = await this.capture.capture(tenantId, contact, {
      title: p.kind === 'whatsapp' ? 'Chamou no WhatsApp pelo site' : `Converteu no ${channelName}`,
      originName: p.kind === 'whatsapp' ? 'WhatsApp' : form!.originName,
      touch: { ...touch, conversao: channelName, pagina: pageUrl },
      details: {
        canal: p.kind,
        respostas: { ...custom, ...(message ? { mensagem: message } : {}) },
        pagina: pageUrl,
        dispositivo: device,
        ...(customerType ? { tipoCliente: customerType.name } : {}),
        ...(brands.length ? { marcas: brands.map((b) => b.name) } : {}),
      },
      ownerId,
      // O tipo de cliente também vira tag (ex.: "revenda"): entra no lead scoring e nas segmentações.
      tags: [...(p.kind === 'whatsapp' ? wa!.tags : form!.tags), ...(customerType ? [customerType.name] : [])],
      customFields,
    })
    if (!result) return { ok: false, message: 'Informe o e-mail ou o WhatsApp.' }

    // LGPD: consentimento para e-mail marketing só com a caixa marcada (nunca pré-marcada).
    const consentText = p.kind === 'whatsapp' ? null : form!.consentText
    if (consentText && p.consent === true && contact.email) {
      await this.leads.setEmailConsent(tenantId, result.leadId, true, channelName, { text: consentText, ip: meta.ip })
    }
    if (visitor) await this.tracking.identify(tenantId, visitor.id, result.leadId).catch(() => undefined)

    const createRecord = p.kind === 'whatsapp' ? wa!.createRecord : form!.createRecord
    const recordId = createRecord ? await this.preVendas(tenantId, result.leadId, contact, channelName, p.kind === 'whatsapp' ? 'WhatsApp' : form!.originName, ownerId, message, custom, customerType?.id ?? null, brands.map((b) => b.id)).catch((err) => {
      this.logger.error(`Captura: atendimento de Pré-Vendas não criado: ${(err as Error).message}`)
      return null
    }) : null

    await this.prisma.captureSubmission.create({
      data: {
        tenantId,
        channel: p.kind === 'form' ? 'formulario' : p.kind === 'landing' ? 'landing' : p.kind,
        formId: form?.id ?? null,
        popupId: popup?.id ?? null,
        whatsappId: wa?.id ?? null,
        leadId: result.leadId,
        recordId,
        data: {
          ...contact,
          ...custom,
          ...(message ? { message } : {}),
          consentimento: consentText ? p.consent === true : null,
          ...(customerType ? { tipoCliente: customerType.name } : {}),
          ...(brands.length ? { marcas: brands.map((b) => b.name) } : {}),
        } as Prisma.InputJsonValue,
        pageUrl,
        touch: touch as Prisma.InputJsonValue,
        device,
      },
    })
    if (form) await this.prisma.captureForm.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } })
    await this.audit.log({ tenantId, action: 'captura.submitted', entity: 'lead', entityId: result.leadId, ip: meta.ip, data: { canal: p.kind, formulario: form?.id ?? null, novo: result.created } })

    if (p.kind === 'whatsapp') {
      return { ok: true, redirect: waLink(wa!.phone, whatsappText(wa!.message, { name: contact.name, page: pageUrl })) }
    }
    if (form!.afterSubmit === 'whatsapp') {
      // Formulário que abre o WhatsApp: usa o primeiro botão ativo (número central).
      const main = await this.prisma.captureWhatsapp.findFirst({ where: { tenantId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
      if (main) return { ok: true, message: form!.successMessage, redirect: waLink(main.phone, whatsappText(main.message, { name: contact.name, page: pageUrl })) }
    }
    if (form!.afterSubmit === 'redirect') return { ok: true, message: form!.successMessage, redirect: safeRedirect(form!.redirectUrl) }
    return { ok: true, message: form!.successMessage }
  }

  /**
   * Abre o atendimento na fila de Pré-Vendas. Se o lead já tem um aberto nas últimas 24 h (ex.: clicou duas
   * vezes no WhatsApp), não duplica: usa o existente.
   */
  private async preVendas(
    tenantId: string,
    leadId: string,
    c: { name: string | null; email: string | null; phone: string | null; city: string | null; state: string | null },
    channel: string,
    originName: string,
    ownerId: string | null,
    message: string | null,
    custom: Record<string, string>,
    customerTypeId: string | null,
    brandIds: string[],
  ) {
    const recent = await this.prisma.serviceRecord.findFirst({
      where: { tenantId, leadId, kind: 'PRE_VENDAS', deletedAt: null, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      select: { id: true },
    })
    if (recent) return recent.id
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { name: true, email: true, phone: true, state: true, city: true, ownerId: true, unitId: true } })
    const sellerId = ownerId ?? lead?.ownerId ?? null
    const seller = sellerId ? await this.prisma.seller.findFirst({ where: { id: sellerId, tenantId }, select: { id: true, unitId: true } }) : null
    const origin =
      (await this.prisma.lookupItem.findFirst({ where: { tenantId, type: 'ORIGEM', name: { equals: originName, mode: 'insensitive' } }, select: { id: true } })) ??
      (await this.prisma.lookupItem.create({ data: { tenantId, type: 'ORIGEM', name: originName }, select: { id: true } }))
    const answers = Object.entries(custom).map(([k, v]) => `${k}: ${v}`)
    const notes = [`Entrou pelo ${channel}.`, message ? `Mensagem: ${message}` : null, answers.length ? `Respostas: ${answers.join('; ')}` : null].filter(Boolean).join('\n')
    const record = await this.prisma.serviceRecord.create({
      data: {
        tenantId,
        kind: 'PRE_VENDAS',
        leadAt: new Date(),
        name: (c.name ?? lead?.name ?? c.email ?? lead?.email ?? 'Contato do site').slice(0, 160),
        phone: c.phone ?? lead?.phone ?? null,
        email: c.email ?? lead?.email ?? null,
        state: c.state ?? lead?.state ?? null,
        city: c.city ?? lead?.city ?? null,
        sellerId: seller?.id ?? null,
        unitId: seller?.unitId ?? lead?.unitId ?? null,
        originId: origin.id,
        customerTypeId,
        brandIds,
        leadId,
        notes: notes.slice(0, 5000),
        history: { create: { userName: 'Captura do site', action: 'criado automaticamente', changes: {} } },
      },
    })
    await this.prisma.leadEvent.create({ data: { tenantId, leadId, type: 'atendimento', title: 'Atendimento de Pré-Vendas', data: { recordId: record.id }, occurredAt: record.leadAt } })
    await this.config.rescore(tenantId, [leadId])
    return record.id
  }

  static phoneOk(raw: string | null | undefined) {
    return raw ? normalizePhone(raw) : null
  }

  static readonly fieldCatalog = BASE_FIELDS
}
