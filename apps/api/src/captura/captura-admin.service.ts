import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { normalizePhone } from '../atendimento/br'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { EMAIL_IMAGE_LIMIT, FilesService } from '../files/files.service'
import { LeadConfigService } from '../leads/lead-config.service'
import { normalizeTags } from '../leads/mapeamento'
import { PrismaService } from '../prisma/prisma.service'
import { env } from '../config/env'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { SettingsService } from '../settings/settings.service'
import { type CaptureSettings, CapturaService } from './captura.service'
import { cleanDesign } from './design'
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
  customerTypeId?: string | null
  brandIds?: string[]
  tags: string[]
  createRecord: boolean
  active: boolean
}

export interface WhatsappInput {
  name: string
  phone: string
  buttonText: string
  title: string
  subtitle: string
  askEmail: boolean
  requireName?: boolean
  requireEmail?: boolean
  originName?: string
  message: string
  position: 'direita' | 'esquerda'
  color: string
  include: string[]
  exclude: string[]
  device: 'todos' | 'celular' | 'computador'
  ownerId?: string | null
  customerTypeId?: string | null
  brandIds?: string[]
  tags: string[]
  createRecord: boolean
  active: boolean
  sortOrder: number
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
  ownerId?: string | null
  customerTypeId?: string | null
  brandIds?: string[]
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
    private readonly files: FilesService,
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

  /** Tipo de cliente e marcas precisam ser itens das listas da empresa (Cadastros). */
  private async assertLookups(tenantId: string, customerTypeId: string | null | undefined, brandIds: string[] | undefined) {
    if (customerTypeId && !(await this.prisma.lookupItem.count({ where: { id: customerTypeId, tenantId, type: 'TIPO_CLIENTE' } }))) throw new BadRequestException('Tipo de cliente inválido.')
    const brands = [...new Set(brandIds ?? [])]
    if (brands.length && (await this.prisma.lookupItem.count({ where: { id: { in: brands }, tenantId, type: 'MARCA' } })) !== brands.length) throw new BadRequestException('Marca da máquina inválida.')
    return brands
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
    const brandIds = await this.assertLookups(user.tenantId, d.customerTypeId, d.brandIds)
    const redirectUrl = d.afterSubmit === 'redirect' ? safeRedirect(d.redirectUrl) : null
    if (d.afterSubmit === 'redirect' && !redirectUrl) throw new BadRequestException('Informe um endereço válido (https://...) para onde o visitante vai depois de enviar.')
    if (d.afterSubmit === 'whatsapp' && !(await this.prisma.captureWhatsapp.count({ where: { tenantId: user.tenantId, active: true } })))
      throw new BadRequestException('Cadastre e ative um botão de WhatsApp (aba Botões de WhatsApp) antes de usar esta opção.')
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
      customerTypeId: d.customerTypeId ?? null,
      brandIds,
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
    await this.assertOwner(user.tenantId, d.ownerId)
    const popupBrands = await this.assertLookups(user.tenantId, d.customerTypeId, d.brandIds)
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
      ownerId: d.ownerId ?? null,
      customerTypeId: d.customerTypeId ?? null,
      brandIds: popupBrands,
      active: d.active,
    }
    if (id && !(await this.prisma.capturePopup.count({ where: { id, tenantId: user.tenantId } }))) throw new NotFoundException('Pop-up não encontrado.')
    const popup = id ? await this.prisma.capturePopup.update({ where: { id }, data }) : await this.prisma.capturePopup.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'captura.popup_updated' : 'captura.popup_created', 'capture_popup', popup.id, { nome: data.name, ativo: data.active })
    const { tenantId: _t, ...rest } = popup
    return rest
  }

  // ---------- Editor visual ----------

  /** Tudo o que o editor precisa: o layout, o formulário (campos, botão, mensagem) e os dados do pop-up simples. */
  async editor(user: AuthUser, kind: 'popup' | 'form', id: string) {
    this.assertCan(user, 'view')
    const s = await this.captura.settingsOf(user.tenantId)
    const formView = (f: { id: string; name: string; fields: unknown; submitLabel: string; successMessage: string; consentText: string | null }) => ({
      id: f.id,
      name: f.name,
      fields: f.fields,
      submitLabel: f.submitLabel,
      successMessage: f.successMessage,
      consentText: f.consentText,
    })
    if (kind === 'popup') {
      const p = await this.prisma.capturePopup.findFirst({ where: { id, tenantId: user.tenantId }, include: { form: true } })
      if (!p) throw new NotFoundException('Pop-up não encontrado.')
      return {
        kind,
        id: p.id,
        name: p.name,
        active: p.active,
        design: p.design,
        popup: { id: p.id, formId: p.formId, title: p.title, text: p.text, imageUrl: p.imageUrl, color: p.color },
        form: formView(p.form),
        privacyUrl: s.privacyUrl || null,
      }
    }
    const f = await this.prisma.captureForm.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!f) throw new NotFoundException('Formulário não encontrado.')
    return { kind, id: f.id, name: f.name, active: f.active, design: f.design, popup: null, form: formView(f), privacyUrl: s.privacyUrl || null }
  }

  /** Salva o layout do editor (ou volta ao modelo simples com design = null). */
  async saveDesign(user: AuthUser, kind: 'popup' | 'form', id: string, raw: unknown, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    let design: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull
    if (raw !== null) {
      const r = cleanDesign(raw, kind, new URL(env.appUrl).origin)
      if ('error' in r) throw new BadRequestException(r.error)
      design = r.design as unknown as Prisma.InputJsonValue
    }
    const where = { id, tenantId: user.tenantId }
    const found = kind === 'popup' ? await this.prisma.capturePopup.count({ where }) : await this.prisma.captureForm.count({ where })
    if (!found) throw new NotFoundException(kind === 'popup' ? 'Pop-up não encontrado.' : 'Formulário não encontrado.')
    if (kind === 'popup') await this.prisma.capturePopup.update({ where: { id }, data: { design } })
    else await this.prisma.captureForm.update({ where: { id }, data: { design } })
    await this.audit.byUser(user, ctx, 'captura.design_saved', kind === 'popup' ? 'capture_popup' : 'capture_form', id, { layout: raw === null ? 'simples' : 'editor visual' })
    return this.editor(user, kind, id)
  }

  /** Imagem para o pop-up/formulário: fica pública (o site precisa mostrar) e é servida pelo próprio CRM. */
  async uploadImage(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const asset = await this.files.saveImage(user.tenantId, 'captura-image', file, true, { maxBytes: EMAIL_IMAGE_LIMIT, types: ['png', 'jpg', 'gif', 'webp'] })
    await this.audit.byUser(user, ctx, 'captura.image_uploaded', 'file', asset.id, { tamanho: asset.size })
    return { id: asset.id, url: `${env.appUrl}/api/files/public/${asset.id}` }
  }

  async listImages(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.fileAsset.findMany({ where: { tenantId: user.tenantId, kind: { in: ['captura-image', 'email-image'] } }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, createdAt: true } })
    return rows.map((r) => ({ id: r.id, url: `${env.appUrl}/api/files/public/${r.id}` }))
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
    return { privacyUrl: (await this.captura.settingsOf(user.tenantId)).privacyUrl }
  }

  /** Configuração geral da captura: link da política de privacidade (os botões de WhatsApp têm cadastro próprio). */
  async saveSettings(user: AuthUser, d: { privacyUrl: string }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const privacyUrl = d.privacyUrl.trim() ? safeRedirect(d.privacyUrl) : ''
    if (privacyUrl === null) throw new BadRequestException('Link da política de privacidade inválido.')
    const current = await this.captura.settingsOf(user.tenantId)
    const next: CaptureSettings = { ...current, privacyUrl }
    await this.settings.set(user.tenantId, 'captura', next)
    await this.audit.byUser(user, ctx, 'captura.settings_updated', 'settings', 'captura', { privacyUrl })
    return { privacyUrl }
  }

  // ---------- Botões de WhatsApp ----------

  async listWhatsapps(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.captureWhatsapp.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
    const counts = await this.prisma.captureSubmission.groupBy({ by: ['whatsappId'], where: { tenantId: user.tenantId, whatsappId: { not: null } }, _count: { _all: true } })
    const sent = new Map(counts.map((c) => [c.whatsappId, c._count._all]))
    return rows.map(({ tenantId: _t, ...w }) => ({ ...w, submissions: sent.get(w.id) ?? 0 }))
  }

  async saveWhatsapp(user: AuthUser, id: string | null, d: WhatsappInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const phone = normalizePhone(d.phone ?? '')
    if (!phone) throw new BadRequestException('Número de WhatsApp inválido. Use DDD + número.')
    await this.assertOwner(user.tenantId, d.ownerId)
    const brandIds = await this.assertLookups(user.tenantId, d.customerTypeId, d.brandIds)
    const data = {
      name: d.name.trim(),
      phone,
      buttonText: d.buttonText.trim(),
      title: d.title.trim(),
      subtitle: d.subtitle.trim(),
      askEmail: d.askEmail || !!d.requireEmail,
      requireName: d.requireName !== false,
      requireEmail: !!d.requireEmail,
      originName: d.originName?.trim().slice(0, 80) || 'WhatsApp',
      message: d.message.trim(),
      position: d.position,
      color: d.color,
      include: cleanPatterns(d.include),
      exclude: cleanPatterns(d.exclude),
      device: d.device,
      ownerId: d.ownerId ?? null,
      customerTypeId: d.customerTypeId ?? null,
      brandIds,
      tags: normalizeTags(d.tags),
      createRecord: d.createRecord,
      active: d.active,
      sortOrder: d.sortOrder,
    }
    if (id && !(await this.prisma.captureWhatsapp.count({ where: { id, tenantId: user.tenantId } }))) throw new NotFoundException('Botão não encontrado.')
    const row = id ? await this.prisma.captureWhatsapp.update({ where: { id }, data }) : await this.prisma.captureWhatsapp.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'captura.whatsapp_updated' : 'captura.whatsapp_created', 'capture_whatsapp', row.id, { nome: data.name, ativo: data.active })
    const { tenantId: _t, ...rest } = row
    return rest
  }

  async removeWhatsapp(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.captureWhatsapp.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (!r.count) throw new NotFoundException('Botão não encontrado.')
    await this.audit.byUser(user, ctx, 'captura.whatsapp_deleted', 'capture_whatsapp', id)
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
