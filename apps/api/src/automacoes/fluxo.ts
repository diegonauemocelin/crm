/**
 * Regras puras das automações (testadas em test/automacoes.spec.ts): gatilhos, condições, passos,
 * validação do que vem do painel e o "mapa" de qual passo vem depois de qual.
 */

export const TRIGGER_TYPES = [
  'lead_novo',
  'formulario',
  'atendimento',
  'pos_venda',
  'carrinho',
  'carrinho_abandonado',
  'checkout',
  'compra',
  'email_aberto',
  'email_clicado',
  'visita',
  'etapa',
  'inatividade',
  'manual',
] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export interface Trigger {
  type: TriggerType
  /** lead_novo: só desta origem. */
  originId?: string | null
  /** formulario: nome do formulário/pop-up/botão contém; visita: endereço da página contém. */
  text?: string
  /** email_aberto / email_clicado: só desta campanha ou modelo. */
  campaignId?: string | null
  /** etapa: a etapa que o lead passou a ter. */
  stage?: string
  /** inatividade: dias sem acessar o site (site) ou sem nenhuma interação (interacao). */
  days?: number
  kind?: 'site' | 'interacao'
  /** lead_novo: inclui leads vindos de importação de planilha. */
  includeImported?: boolean
}

export const RULE_TYPES = [
  'carrinho_abandonado',
  'checkout_sem_compra',
  'comprou',
  'sem_visita',
  'sem_interacao',
  'abriu_email',
  'clicou_email',
  'tem_tag',
  'etapa',
  'nota',
  'origem',
  'vendedor',
  'tem_telefone',
  'aceita_email',
] as const
export type RuleType = (typeof RULE_TYPES)[number]

export interface Rule {
  type: RuleType
  /** Inverte a regra ("não tem a tag", "não comprou"). */
  negate?: boolean
  days?: number
  /** abriu_email / clicou_email: o e-mail enviado por este fluxo (ultimo) ou qualquer e-mail. */
  scope?: 'ultimo' | 'qualquer'
  tag?: string
  stage?: string
  grades?: string[]
  originId?: string | null
  /** vendedor: um vendedor específico ou "nenhum" (sem vendedor). */
  ownerId?: string | null
}

export type Step =
  | { id: string; type: 'esperar'; amount: number; unit: 'minutos' | 'horas' | 'dias' }
  | { id: string; type: 'condicao'; match: 'todas' | 'qualquer'; rules: Rule[]; yes: Step[]; no: Step[] }
  | { id: string; type: 'enviar_email'; templateId: string }
  | { id: string; type: 'adicionar_tag'; tags: string[] }
  | { id: string; type: 'remover_tag'; tags: string[] }
  | { id: string; type: 'alterar_vendedor'; ownerId: string }
  | { id: string; type: 'alterar_etapa'; stage: string }
  | { id: string; type: 'criar_atendimento'; ownerId: string | null; note: string }
  | { id: string; type: 'notificar'; userIds: string[]; message: string }
  | { id: string; type: 'encerrar' }

export type StepType = Step['type']
export const STEP_TYPES: StepType[] = ['esperar', 'condicao', 'enviar_email', 'adicionar_tag', 'remover_tag', 'alterar_vendedor', 'alterar_etapa', 'criar_atendimento', 'notificar', 'encerrar']

export const STAGES = ['LEAD', 'QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE'] as const

/** Tipos de evento do histórico do lead que cada gatilho escuta. */
export const EVENT_TRIGGERS: Record<string, TriggerType[]> = {
  conversao: ['formulario'],
  atendimento: ['atendimento'],
  carrinho: ['carrinho'],
  carrinho_abandonado: ['carrinho_abandonado'],
  checkout: ['checkout'],
  venda: ['compra'],
  compra_site: ['compra'],
  email_aberto: ['email_aberto'],
  email_clique: ['email_clicado'],
  visita: ['visita'],
  estagio: ['etapa'],
}
export const PURCHASE_EVENTS = ['venda', 'compra_site']
/** Eventos que contam como interação do lead (regra "sem interação"). */
export const INTERACTION_EVENTS = ['visita', 'conversao', 'email_aberto', 'email_clique', 'carrinho', 'checkout', 'venda', 'compra_site', 'atendimento']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[A-Za-z0-9_-]{1,40}$/
const MAX_STEPS = 100
const MAX_DEPTH = 6

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)
const int = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const tags = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).map((t) => str(t, 60).toLowerCase()).filter(Boolean))].slice(0, 10)

export function cleanTrigger(raw: unknown): { trigger: Trigger } | { error: string } {
  const t = (raw ?? {}) as Record<string, unknown>
  if (!TRIGGER_TYPES.includes(t.type as TriggerType)) return { error: 'Escolha o gatilho (o que faz o lead entrar no fluxo).' }
  const type = t.type as TriggerType
  const out: Trigger = { type }
  if (type === 'lead_novo') {
    out.originId = uuidOrNull(t.originId)
    out.includeImported = t.includeImported === true
  }
  if (type === 'formulario' || type === 'visita') out.text = str(t.text, 120)
  if (type === 'email_aberto' || type === 'email_clicado') out.campaignId = uuidOrNull(t.campaignId)
  if (type === 'etapa') {
    if (!STAGES.includes(t.stage as (typeof STAGES)[number])) return { error: 'Escolha a etapa do gatilho.' }
    out.stage = t.stage as string
  }
  if (type === 'inatividade') {
    const days = int(t.days, 1, 365)
    if (!days) return { error: 'Informe de 1 a 365 dias de inatividade.' }
    out.days = days
    out.kind = t.kind === 'interacao' ? 'interacao' : 'site'
  }
  return { trigger: out }
}

function cleanRule(raw: unknown): Rule | string {
  const r = (raw ?? {}) as Record<string, unknown>
  if (!RULE_TYPES.includes(r.type as RuleType)) return 'Condição com regra desconhecida.'
  const type = r.type as RuleType
  const out: Rule = { type, negate: r.negate === true }
  if (type === 'abriu_email' || type === 'clicou_email') out.scope = r.scope === 'qualquer' ? 'qualquer' : 'ultimo'
  // "O e-mail enviado por este fluxo" não tem prazo; as demais regras de tempo precisam dos dias.
  if (['carrinho_abandonado', 'checkout_sem_compra', 'comprou', 'sem_visita', 'sem_interacao', 'abriu_email', 'clicou_email'].includes(type) && out.scope !== 'ultimo') {
    const days = int(r.days, 1, 365)
    if (!days) return 'Informe os dias da condição (1 a 365).'
    out.days = days
  }
  if (type === 'tem_tag') {
    const tag = str(r.tag, 60).toLowerCase()
    if (!tag) return 'Informe a tag da condição.'
    out.tag = tag
  }
  if (type === 'etapa') {
    if (!STAGES.includes(r.stage as (typeof STAGES)[number])) return 'Escolha a etapa da condição.'
    out.stage = r.stage as string
  }
  if (type === 'nota') {
    const grades = (Array.isArray(r.grades) ? r.grades : []).filter((g): g is string => ['A', 'B', 'C', 'D'].includes(g as string))
    if (!grades.length) return 'Escolha pelo menos uma nota (A, B, C ou D).'
    out.grades = [...new Set(grades)]
  }
  if (type === 'origem') {
    out.originId = uuidOrNull(r.originId)
    if (!out.originId) return 'Escolha a origem da condição.'
  }
  if (type === 'vendedor') out.ownerId = r.ownerId === 'nenhum' ? 'nenhum' : uuidOrNull(r.ownerId)
  return out
}

function cleanList(raw: unknown, depth: number, seen: Set<string>): Step[] | string {
  if (!Array.isArray(raw)) return 'Passos inválidos.'
  if (depth > MAX_DEPTH) return `No máximo ${MAX_DEPTH} condições uma dentro da outra.`
  const out: Step[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const id = str(r?.id, 40)
    if (!ID.test(id) || seen.has(id)) return 'Passo com identificador inválido ou repetido.'
    seen.add(id)
    if (seen.size > MAX_STEPS) return `No máximo ${MAX_STEPS} passos por fluxo.`
    switch (r.type) {
      case 'esperar': {
        const unit = ['minutos', 'horas', 'dias'].includes(r.unit as string) ? (r.unit as 'minutos' | 'horas' | 'dias') : null
        const amount = int(r.amount, 1, unit === 'minutos' ? 1440 : unit === 'horas' ? 720 : 365)
        if (!unit || !amount) return 'Espera inválida: use de 1 a 1440 minutos, 720 horas ou 365 dias.'
        out.push({ id, type: 'esperar', amount, unit })
        break
      }
      case 'condicao': {
        const rules: Rule[] = []
        for (const rr of Array.isArray(r.rules) ? (r.rules as unknown[]).slice(0, 10) : []) {
          const c = cleanRule(rr)
          if (typeof c === 'string') return c
          rules.push(c)
        }
        if (!rules.length) return 'Condição sem regra: adicione pelo menos uma.'
        const yes = cleanList(r.yes ?? [], depth + 1, seen)
        if (typeof yes === 'string') return yes
        const no = cleanList(r.no ?? [], depth + 1, seen)
        if (typeof no === 'string') return no
        out.push({ id, type: 'condicao', match: r.match === 'qualquer' ? 'qualquer' : 'todas', rules, yes, no })
        break
      }
      case 'enviar_email': {
        const templateId = uuidOrNull(r.templateId)
        if (!templateId) return 'Escolha o modelo de e-mail do passo "Enviar e-mail".'
        out.push({ id, type: 'enviar_email', templateId })
        break
      }
      case 'adicionar_tag':
      case 'remover_tag': {
        const t = tags(r.tags)
        if (!t.length) return 'Informe a tag do passo.'
        out.push({ id, type: r.type, tags: t })
        break
      }
      case 'alterar_vendedor': {
        const ownerId = uuidOrNull(r.ownerId)
        if (!ownerId) return 'Escolha o vendedor do passo "Trocar vendedor".'
        out.push({ id, type: 'alterar_vendedor', ownerId })
        break
      }
      case 'alterar_etapa':
        if (!STAGES.includes(r.stage as (typeof STAGES)[number])) return 'Escolha a etapa do passo "Mudar etapa".'
        out.push({ id, type: 'alterar_etapa', stage: r.stage as string })
        break
      case 'criar_atendimento':
        out.push({ id, type: 'criar_atendimento', ownerId: uuidOrNull(r.ownerId), note: str(r.note, 1000) })
        break
      case 'notificar': {
        const userIds = [...new Set((Array.isArray(r.userIds) ? r.userIds : []).map(uuidOrNull).filter((x): x is string => !!x))].slice(0, 20)
        if (!userIds.length) return 'Escolha quem recebe o aviso.'
        out.push({ id, type: 'notificar', userIds, message: str(r.message, 1000) })
        break
      }
      case 'encerrar':
        out.push({ id, type: 'encerrar' })
        break
      default:
        return `Tipo de passo desconhecido: ${String(r?.type)}`
    }
  }
  return out
}

export function cleanSteps(raw: unknown): { steps: Step[] } | { error: string } {
  const r = cleanList(raw, 0, new Set())
  return typeof r === 'string' ? { error: r } : { steps: r }
}

export interface Node {
  step: Step
  /** Passo seguinte quando este termina (no fim de um caminho "sim"/"não", volta para depois da condição). */
  next: string | null
}

/** Mapa id → passo e o seguinte, para o executor andar pelo fluxo. */
export function compile(steps: Step[]): Map<string, Node> {
  const map = new Map<string, Node>()
  const walk = (list: Step[], after: string | null) => {
    list.forEach((step, i) => {
      const next = list[i + 1]?.id ?? after
      map.set(step.id, { step, next })
      if (step.type === 'condicao') {
        walk(step.yes, next)
        walk(step.no, next)
      }
    })
  }
  walk(steps, null)
  return map
}

/** Primeiro passo do caminho escolhido numa condição (caminho vazio = segue depois da condição). */
export function branchStart(node: Node, ok: boolean): string | null {
  if (node.step.type !== 'condicao') return node.next
  return (ok ? node.step.yes[0]?.id : node.step.no[0]?.id) ?? node.next
}

export function waitMs(step: { amount: number; unit: 'minutos' | 'horas' | 'dias' }) {
  return step.amount * (step.unit === 'minutos' ? 60_000 : step.unit === 'horas' ? 3_600_000 : 86_400_000)
}

/** Lista plana de todos os passos (para conferências como "modelos usados"). */
export function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((s) => (s.type === 'condicao' ? [s, ...allSteps(s.yes), ...allSteps(s.no)] : [s]))
}

export interface EventInfo {
  type: string
  title: string
  data: Record<string, unknown> | null
}

/** O evento do histórico do lead dispara este gatilho? (etapa é conferida com a etapa atual do lead pelo serviço.) */
export function eventMatches(t: Trigger, e: EventInfo): boolean {
  if (!(EVENT_TRIGGERS[e.type] ?? []).includes(t.type)) return false
  const has = (hay: unknown, needle: string | undefined) => !needle || String(hay ?? '').toLowerCase().includes(needle.toLowerCase())
  if (t.type === 'formulario') return has(e.title, t.text)
  if (t.type === 'visita') return has(e.data?.pagina, t.text)
  if ((t.type === 'email_aberto' || t.type === 'email_clicado') && t.campaignId) return e.data?.campanha === t.campaignId
  return true
}

/** Texto de variáveis nas mensagens internas: {nome}, {email}, {telefone}, {link}. */
export function fillMessage(template: string, v: { name: string | null; email: string | null; phone: string | null; link: string; automation: string }) {
  return (template.trim() || 'O lead {nome} chegou neste passo da automação "{automacao}".')
    .replaceAll('{nome}', v.name ?? 'sem nome')
    .replaceAll('{email}', v.email ?? '-')
    .replaceAll('{telefone}', v.phone ?? '-')
    .replaceAll('{link}', v.link)
    .replaceAll('{automacao}', v.automation)
}
