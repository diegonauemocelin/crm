import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { normalizePhone } from '../atendimento/br'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { LeadConfigService } from '../leads/lead-config.service'
import { normalizeTags } from '../leads/mapeamento'
import { PrismaService } from '../prisma/prisma.service'
import { env } from '../config/env'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { SettingsService } from '../settings/settings.service'
import { type CaptureSettings, CapturaService, type WhatsappWidget } from './captura.service'
import { BASE_FIELDS, cleanFields, type CustomDef, safeRedirect } from './regras'

export interface FormInput {
  name: string
  fields: unknown
  submitLabel: string
  successMessage: string
  afterSubmit: 'mensagem' | 'whatsapp' | 'redirect'
  redirectUrl?: string | null
  consentText?: string | null
  originName: string
  ownerId?: string | null
  tags: string[]
  createRecord: boolean
  active: boolean
}

export interface PopupInput {
  name: string
  formId: string
  title: string
  text?: string | null
  imageUrl?: string | null
  trigger: 'delay' | 'exit' | 'scroll'
  delaySec: number
  scrollPct: number
  include: string[]
  exclude: string[]
  device: 'todos' | 'celular' | 'computador'
  frequencyDays: number
  color: string
  active: boolean
}

const cleanPatterns = (list: string[]) => [...new Set(list.map((p) => p.trim()).filter(Boolean).map((p) => p.slice(0, 200)))].slice(0, 30)

/** Cadastro dos formulários, pop-ups e do botão de WhatsApp (módulo "Captura" do perfil de acesso). */
@Injectable()
export class CapturaAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly captura: CapturaService,
    private readonly config: LeadConfigService,
    private readonly audit: AuditService,
    private readonly tracking: RastreamentoService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'captura', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  /** Campos que um formulário pode pedir: os do lead e os personalizados ativos. */
  async catalog(user: AuthUser) {
    this.assertCan(user, 'view')
    const customs = await this.config.listFields(user.tenantId)
    return [
      ...Object.entries(BASE_FIELDS).map(([key, f]) => ({ key, label: f.label, type: f.type, custom: false })),
      ...customs.filter((c) => c.active).map((c) => ({ key: `custom:${c.key}`, label: c.label, type: c.type.toLowerCase(), options: c.options, custom: true })),
    ]
  }

  private async assertOwner(tenantId: string, ownerId: string | null | undefined) {
    if (ownerId && !(await this.prisma.seller.count({ where: { id: ownerId, tenantId } }))) throw new BadRequestException('Responsável inválido.')
  }

  // ---------- Formulários ----------

  async listForms(user: AuthUser) {
    this.assertCan(user, 'view')
    const [forms, tracking] = await Promise.all([
      this.prisma.captureForm.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { popups: true } } } }),
      this.tracking.config(user.tenantId),
    ])
    return forms.map(({ tenantId: _t, _count, ...f }) => ({
      ...f,
      popups: _count.popups,
      // Dois jeitos de colocar o formulário numa página: o código com script (funciona em qualquer editor) e o marcador.
      embedScript: `<script async src="${env.appUrl}/api/public/captura/form.js?k=${tracking.siteKey}&f=${f.id}"></script>`,
      embedDiv: `<div data-usacrm-form="${f.id}"></div>`,
      trackingEnabled: tracking.enabled,
    }))
  }

  async saveForm(user: AuthUser, id: string | null, d: FormInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const customs = (await this.config.listFields(user.tenantId)) as unknown as CustomDef[]
    const checked = cleanFields(d.fields, customs.map((c) => ({ ...c, key: c.key })))
    if ('error' in checked) throw new BadRequestException(checked.error)
    await this.assertOwner(user.tenantId, d.ownerId)
    const redirectUrl = d.afterSubmit === 'redirect' ? safeRedirect(d.redirectUrl) : null
    if (d.afterSubmit === 'redirect' && !redirectUrl) throw new BadRequestException('Informe um endereço válido (https://...) para onde o visitante vai depois de enviar.')
    if (d.afterSubmit === 'whatsapp' && !(await this.captura.settingsOf(user.tenantId)).whatsapp.phone) throw new BadRequestException('Cadastre o número do WhatsApp (aba Botão de WhatsApp) antes de usar esta opção.')
    const data = {
      name: d.name.trim(),
      fields: checked.fields as unknown as Prisma.InputJsonValue,
      submitLabel: d.submitLabel.trim() || 'Enviar',
      successMessage: d.successMessage.trim() || 'Recebemos seus dados.',
      afterSubmit: d.afterSubmit,
      redirectUrl,
      consentText: d.consentText?.trim() || null,
      originName: d.originName.trim() || 'Site - LP',
      ownerId: d.ownerId ?? null,
      tags: normalizeTags(d.tags),
      createRecord: d.createRecord,
      active: d.active,
    }
    if (id) {
      const found = await this.prisma.captureForm.count({ where: { id, tenantId: user.tenantId } })
      if (!found) throw new NotFoundException('Formulário não encontrado.')
    }
    const form = id ? await this.prisma.captureForm.update({ where: { id }, data }) : await this.prisma.captureForm.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'captura.form_updated' : 'captura.form_created', 'capture_form', form.id, { nome: data.name, ativo: data.active })
    const { tenantId: _t, ...rest } = form
    return rest
  }

  // ---------- Pop-ups ----------

  async listPopups(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.capturePopup.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' } })
    const counts = await this.prisma.captureSubmission.groupBy({ by: ['popupId'], where: { tenantId: user.tenantId, popupId: { not: null } }, _count: { _all: true } })
    const sent = new Map(counts.map((c) => [c.popupId, c._count._all]))
    return rows.map(({ tenantId: _t, ...p }) => ({ ...p, submissions: sent.get(p.id) ?? 0 }))
  }

  async savePopup(user: AuthUser, id: string | null, d: PopupInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    if (!(await this.prisma.captureForm.count({ where: { id: d.formId, tenantId: user.tenantId } }))) throw new BadRequestException('Escolha um formulário.')
    const imageUrl = d.imageUrl?.trim() ? safeRedirect(d.imageUrl) : null
    if (d.imageUrl?.trim() && !imageUrl?.startsWith('https://')) throw new BadRequestException('A imagem precisa de um endereço https://')
    const data = {
      name: d.name.trim(),
      formId: d.formId,
      title: d.title.trim(),
      text: d.text?.trim() || null,
      imageUrl,
      trigger: d.trigger,
      delaySec: d.delaySec,
      scrollPct: d.scrollPct,
      include: cleanPatterns(d.include),
      exclude: cleanPatterns(d.exclude),
      device: d.device,
      frequencyDays: d.frequencyDays,
      color: d.color,
      active: d.active,
    }
    if (id && !(await this.prisma.capturePopup.count({ where: { id, tenantId: user.tenantId } }))) throw new NotFoundException('Pop-up não encontrado.')
    const popup = id ? await this.prisma.capturePopup.update({ where: { id }, data }) : await this.prisma.capturePopup.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'captura.popup_updated' : 'captura.popup_created', 'capture_popup', popup.id, { nome: data.name, ativo: data.active })
    const { tenantId: _t, ...rest } = popup
    return rest
  }

  async removePopup(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.capturePopup.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (!r.count) throw new NotFoundException('Pop-up não encontrado.')
    await this.audit.byUser(user, ctx, 'captura.popup_deleted', 'capture_popup', id)
  }

  // ---------- Botão de WhatsApp e política de privacidade ----------

  async getSettings(user: AuthUser) {
    this.assertCan(user, 'view')
    return this.captura.settingsOf(user.tenantId)
  }

  async saveSettings(user: AuthUser, d: { privacyUrl: string; whatsapp: WhatsappWidget }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const privacyUrl = d.privacyUrl.trim() ? safeRedirect(d.privacyUrl) : ''
    if (privacyUrl === null) throw new BadRequestException('Link da política de privacidade inválido.')
    const phone = d.whatsapp.phone ? normalizePhone(d.whatsapp.phone) : null
    if (d.whatsapp.phone && !phone) throw new BadRequestException('Número de WhatsApp inválido. Use DDD + número.')
    if (d.whatsapp.enabled && !phone) throw new BadRequestException('Informe o número de WhatsApp para ligar o botão.')
    await this.assertOwner(user.tenantId, d.whatsapp.ownerId)
    const next: CaptureSettings = {
      privacyUrl,
      whatsapp: { ...d.whatsapp, phone, include: cleanPatterns(d.whatsapp.include), exclude: cleanPatterns(d.whatsapp.exclude), tags: normalizeTags(d.whatsapp.tags) },
    }
    await this.settings.set(user.tenantId, 'captura', next)
    await this.audit.byUser(user, ctx, 'captura.settings_updated', 'settings', 'captura', { whatsappAtivo: next.whatsapp.enabled })
    return next
  }

  // ---------- Envios ----------

  async submissions(user: AuthUser, f: { channel?: string; formId?: string }, page: number, pageSize: number) {
    this.assertCan(user, 'view')
    const where: Prisma.CaptureSubmissionWhereInput = { tenantId: user.tenantId, ...(f.channel ? { channel: f.channel } : {}), ...(f.formId ? { formId: f.formId } : {}) }
    const [total, rows] = await Promise.all([
      this.prisma.captureSubmission.count({ where }),
      this.prisma.captureSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { form: { select: { name: true } } } }),
    ])
    return { total, page, pageSize, items: rows.map(({ tenantId: _t, ...r }) => r) }
  }
}
