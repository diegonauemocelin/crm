export interface FieldCatalogItem {
  key: string
  label: string
  type: string
  options?: string[]
  custom: boolean
}

export interface FormField {
  key: string
  label: string
  required: boolean
  type?: string
  options?: string[]
}

export type AfterSubmit = 'mensagem' | 'whatsapp' | 'redirect'

export interface CaptureForm {
  id: string
  name: string
  fields: FormField[]
  submitLabel: string
  successMessage: string
  afterSubmit: AfterSubmit
  redirectUrl: string | null
  consentText: string | null
  originName: string
  ownerId: string | null
  tags: string[]
  createRecord: boolean
  active: boolean
  submissions: number
  popups?: number
  createdAt: string
}

export type Trigger = 'delay' | 'exit' | 'scroll'
export type DeviceRule = 'todos' | 'celular' | 'computador'

export interface CapturePopup {
  id: string
  name: string
  formId: string
  title: string
  text: string | null
  imageUrl: string | null
  trigger: Trigger
  delaySec: number
  scrollPct: number
  include: string[]
  exclude: string[]
  device: DeviceRule
  frequencyDays: number
  color: string
  active: boolean
  views: number
  submissions: number
}

export interface WhatsappWidget {
  enabled: boolean
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
  device: DeviceRule
  ownerId: string | null
  tags: string[]
  createRecord: boolean
}

export interface CaptureSettings {
  privacyUrl: string
  whatsapp: WhatsappWidget
}

export interface Submission {
  id: string
  channel: 'formulario' | 'popup' | 'whatsapp' | 'landing'
  formId: string | null
  popupId: string | null
  leadId: string | null
  recordId: string | null
  data: Record<string, unknown>
  pageUrl: string | null
  device: string | null
  createdAt: string
  form: { name: string } | null
}

export const CHANNEL_LABEL: Record<Submission['channel'], string> = { formulario: 'Formulário no site', popup: 'Pop-up', whatsapp: 'Botão de WhatsApp', landing: 'Landing page' }
export const TRIGGER_LABEL: Record<Trigger, string> = { delay: 'Depois de alguns segundos', exit: 'Ao tentar sair da página', scroll: 'Ao rolar a página' }
export const DEVICE_RULE_LABEL: Record<DeviceRule, string> = { todos: 'Celular e computador', celular: 'Só celular', computador: 'Só computador' }

export const DEFAULT_CONSENT = 'Quero receber ofertas e novidades da USA Parts por e-mail. Posso cancelar quando quiser.'

/** Uma linha por padrão de página (o painel guarda como lista). */
export const linesOf = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)
