/** Tipos e textos das automações (espelham apps/api/src/automacoes/fluxo.ts). */

export type TriggerType =
  | 'lead_novo'
  | 'formulario'
  | 'atendimento'
  | 'pos_venda'
  | 'carrinho'
  | 'carrinho_abandonado'
  | 'checkout'
  | 'compra'
  | 'email_aberto'
  | 'email_clicado'
  | 'visita'
  | 'etapa'
  | 'inatividade'
  | 'manual'

export interface Trigger {
  type: TriggerType
  originId?: string | null
  text?: string
  campaignId?: string | null
  stage?: string
  days?: number
  kind?: 'site' | 'interacao'
  includeImported?: boolean
}

export type RuleType =
  | 'carrinho_abandonado'
  | 'checkout_sem_compra'
  | 'comprou'
  | 'sem_visita'
  | 'sem_interacao'
  | 'abriu_email'
  | 'clicou_email'
  | 'tem_tag'
  | 'etapa'
  | 'nota'
  | 'origem'
  | 'vendedor'
  | 'tem_telefone'
  | 'aceita_email'

export interface Rule {
  type: RuleType
  negate?: boolean
  days?: number
  scope?: 'ultimo' | 'qualquer'
  tag?: string
  stage?: string
  grades?: string[]
  originId?: string | null
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

export interface Automation {
  id: string
  name: string
  description: string | null
  active: boolean
  trigger: Trigger
  steps: Step[]
  reentry: 'nunca' | 'apos_terminar'
  exitOnPurchase: boolean
  activatedAt: string | null
  createdAt: string
  updatedAt: string
  running?: number
}

export interface AutomationListItem extends Omit<Automation, 'steps'> {
  stepCount: number
  running: number
  finished: number
  entered: number
}

export interface AutomationOptions {
  templates: { id: string; name: string; subject: string }[]
  users: { id: string; name: string; email: string }[]
  segments: { id: string; name: string }[]
  campaigns: { id: string; name: string }[]
}

export type RunStatus = 'ATIVO' | 'CONCLUIDO' | 'SAIU' | 'ERRO'

export interface AutomationReport {
  entered: number
  running: number
  completed: number
  exited: number
  errors: number
  emails: { sent: number; opened: number; clicked: number }
  sales: { orders: number; revenue: number; days: number }
  steps: Record<string, Record<string, number>>
  runs: { id: string; status: RunStatus; stepId: string | null; nextRunAt: string | null; startedAt: string; finishedAt: string | null; exitReason: string | null; lead: { id: string; name: string | null; email: string | null } }[]
}

export interface RunLog {
  id: string
  stepId: string | null
  kind: string
  message: string
  createdAt: string
}

export const RUN_STATUS: Record<RunStatus, { label: string; tone: string }> = {
  ATIVO: { label: 'No fluxo', tone: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300' },
  CONCLUIDO: { label: 'Concluiu', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' },
  SAIU: { label: 'Saiu', tone: 'text-muted-foreground' },
  ERRO: { label: 'Erro', tone: 'border-destructive/40 bg-destructive/10 text-destructive' },
}

export const TRIGGERS: { type: TriggerType; label: string; help: string; group: string }[] = [
  { type: 'lead_novo', label: 'Lead novo', help: 'Quando um lead é cadastrado (site, loja, Meta, Pré-Vendas ou manual).', group: 'Cadastro' },
  { type: 'formulario', label: 'Enviou formulário, pop-up ou WhatsApp', help: 'Quando o lead se cadastra por uma captura do site ou da LP.', group: 'Cadastro' },
  { type: 'atendimento', label: 'Entrou no Pré-Vendas', help: 'Quando é aberto um atendimento de Pré-Vendas para o lead.', group: 'Atendimento' },
  { type: 'pos_venda', label: 'Foi para o Pós-Vendas', help: 'Quando o atendimento do lead vai para o Pós-Vendas.', group: 'Atendimento' },
  { type: 'carrinho', label: 'Colocou produto no carrinho', help: 'Quando o lead adiciona um produto ao carrinho no site.', group: 'Loja' },
  { type: 'carrinho_abandonado', label: 'Abandonou o carrinho', help: 'Quando o carrinho fica parado sem compra (Magazord).', group: 'Loja' },
  { type: 'checkout', label: 'Iniciou o checkout', help: 'Quando o lead começa a finalizar a compra no site.', group: 'Loja' },
  { type: 'compra', label: 'Comprou', help: 'Pedido pago na loja ou compra concluída no site.', group: 'Loja' },
  { type: 'email_aberto', label: 'Abriu um e-mail', help: 'Quando o lead abre um e-mail (qualquer um ou um específico).', group: 'E-mail' },
  { type: 'email_clicado', label: 'Clicou em um e-mail', help: 'Quando o lead clica em um link de e-mail.', group: 'E-mail' },
  { type: 'visita', label: 'Visitou o site', help: 'Quando o lead visita o site (ou uma página específica).', group: 'Site' },
  { type: 'inatividade', label: 'Ficou X dias sem acessar', help: 'Quando o lead fica X dias sem acessar o site ou sem nenhuma interação.', group: 'Site' },
  { type: 'etapa', label: 'Mudou de etapa', help: 'Quando o lead passa para uma etapa (ex.: Cliente).', group: 'Funil' },
  { type: 'manual', label: 'Manual (por segmento)', help: 'Só entra quem você colocar, escolhendo um segmento.', group: 'Funil' },
]

export const TRIGGER_LABEL = Object.fromEntries(TRIGGERS.map((t) => [t.type, t.label])) as Record<TriggerType, string>

export const RULES: { type: RuleType; label: string; negLabel: string; days?: boolean }[] = [
  { type: 'carrinho_abandonado', label: 'Tem carrinho abandonado', negLabel: 'Não tem carrinho abandonado', days: true },
  { type: 'checkout_sem_compra', label: 'Iniciou checkout e não comprou', negLabel: 'Não tem checkout parado', days: true },
  { type: 'comprou', label: 'Comprou', negLabel: 'Não comprou', days: true },
  { type: 'sem_visita', label: 'Sem acessar o site', negLabel: 'Acessou o site', days: true },
  { type: 'sem_interacao', label: 'Sem nenhuma interação', negLabel: 'Teve alguma interação', days: true },
  { type: 'abriu_email', label: 'Abriu o e-mail', negLabel: 'Não abriu o e-mail', days: true },
  { type: 'clicou_email', label: 'Clicou no e-mail', negLabel: 'Não clicou no e-mail', days: true },
  { type: 'tem_tag', label: 'Tem a tag', negLabel: 'Não tem a tag' },
  { type: 'etapa', label: 'Está na etapa', negLabel: 'Não está na etapa' },
  { type: 'nota', label: 'Tem a nota', negLabel: 'Não tem a nota' },
  { type: 'origem', label: 'Veio da origem', negLabel: 'Não veio da origem' },
  { type: 'vendedor', label: 'Vendedor é', negLabel: 'Vendedor não é' },
  { type: 'tem_telefone', label: 'Tem telefone', negLabel: 'Não tem telefone' },
  { type: 'aceita_email', label: 'Pode receber e-mail', negLabel: 'Não pode receber e-mail' },
]
export const RULE_INFO = Object.fromEntries(RULES.map((r) => [r.type, r])) as Record<RuleType, (typeof RULES)[number]>

export const STEP_INFO: Record<StepType, { label: string; help: string; group: 'Tempo e decisão' | 'Ações' }> = {
  esperar: { label: 'Esperar', help: 'Aguarda minutos, horas ou dias antes do próximo passo.', group: 'Tempo e decisão' },
  condicao: { label: 'Condição (Sim / Não)', help: 'Divide o caminho: se atender às regras segue por "Sim", senão por "Não".', group: 'Tempo e decisão' },
  enviar_email: { label: 'Enviar e-mail', help: 'Envia um modelo de e-mail (só para quem autorizou).', group: 'Ações' },
  adicionar_tag: { label: 'Adicionar tag', help: 'Coloca uma ou mais tags no lead.', group: 'Ações' },
  remover_tag: { label: 'Remover tag', help: 'Tira tags do lead.', group: 'Ações' },
  alterar_vendedor: { label: 'Trocar vendedor', help: 'Passa o lead para um vendedor.', group: 'Ações' },
  alterar_etapa: { label: 'Mudar etapa', help: 'Muda a etapa do funil do lead.', group: 'Ações' },
  criar_atendimento: { label: 'Criar atendimento no Pré-Vendas', help: 'Abre um atendimento para a equipe ligar ou chamar o lead.', group: 'Ações' },
  notificar: { label: 'Avisar a equipe', help: 'Manda um e-mail para pessoas da equipe com o link do lead.', group: 'Ações' },
  encerrar: { label: 'Encerrar fluxo', help: 'O lead sai do fluxo neste ponto.', group: 'Ações' },
}

export const UNIT_LABEL = { minutos: 'minuto(s)', horas: 'hora(s)', dias: 'dia(s)' }

const rid = () => Math.random().toString(36).slice(2, 10)

export function newStep(type: StepType): Step {
  const id = `${type.slice(0, 3)}-${rid()}`
  switch (type) {
    case 'esperar':
      return { id, type, amount: 1, unit: 'dias' }
    case 'condicao':
      return { id, type, match: 'todas', rules: [{ type: 'carrinho_abandonado', days: 7, negate: false }], yes: [], no: [] }
    case 'enviar_email':
      return { id, type, templateId: '' }
    case 'adicionar_tag':
    case 'remover_tag':
      return { id, type, tags: [] }
    case 'alterar_vendedor':
      return { id, type, ownerId: '' }
    case 'alterar_etapa':
      return { id, type, stage: 'QUALIFICADO' }
    case 'criar_atendimento':
      return { id, type, ownerId: null, note: '' }
    case 'notificar':
      return { id, type, userIds: [], message: 'O lead {nome} ({telefone}) chegou neste passo da automação "{automacao}".' }
    case 'encerrar':
      return { id, type }
  }
}

/** Cópia do passo com novos identificadores (inclusive dentro das condições). */
export function cloneStep(s: Step): Step {
  const c = structuredClone(s)
  const renew = (x: Step) => {
    x.id = `${x.type.slice(0, 3)}-${rid()}`
    if (x.type === 'condicao') [...x.yes, ...x.no].forEach(renew)
  }
  renew(c)
  return c
}

// ---------- Edição da árvore de passos ----------

export type Where = { parent: string | null; branch: 'yes' | 'no' | null }

function mapList(list: Step[], fn: (list: Step[], where: Where) => Step[], where: Where): Step[] {
  const out = fn(list, where)
  return out.map((s) => (s.type === 'condicao' ? { ...s, yes: mapList(s.yes, fn, { parent: s.id, branch: 'yes' }), no: mapList(s.no, fn, { parent: s.id, branch: 'no' }) } : s))
}

const transform = (steps: Step[], fn: (list: Step[], where: Where) => Step[]) => mapList(steps, fn, { parent: null, branch: null })

export function insertStep(steps: Step[], where: Where, index: number, step: Step) {
  return transform(steps, (list, w) => (w.parent === where.parent && w.branch === where.branch ? [...list.slice(0, index), step, ...list.slice(index)] : list))
}

export function updateStep(steps: Step[], id: string, next: Step) {
  return transform(steps, (list) => list.map((s) => (s.id === id ? next : s)))
}

export function removeStep(steps: Step[], id: string) {
  return transform(steps, (list) => list.filter((s) => s.id !== id))
}

export function moveStep(steps: Step[], id: string, d: -1 | 1) {
  return transform(steps, (list) => {
    const i = list.findIndex((s) => s.id === id)
    if (i < 0 || i + d < 0 || i + d >= list.length) return list
    const n = [...list]
    const [x] = n.splice(i, 1)
    n.splice(i + d, 0, x!)
    return n
  })
}

export function findStep(steps: Step[], id: string): Step | null {
  for (const s of steps) {
    if (s.id === id) return s
    if (s.type === 'condicao') {
      const f = findStep(s.yes, id) ?? findStep(s.no, id)
      if (f) return f
    }
  }
  return null
}

export function countSteps(steps: Step[]): number {
  return steps.reduce((n, s) => n + 1 + (s.type === 'condicao' ? countSteps(s.yes) + countSteps(s.no) : 0), 0)
}
