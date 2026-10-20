/**
 * Chatbot de atendimento (sem IA): fluxos de etapas que recebem o cliente, mostram menus, fazem perguntas e
 * direcionam a conversa para um setor ou uma pessoa. Funções puras (testadas em test/chatbot.spec.ts); quem envia
 * e grava é o ChatService.
 */

export type StepType = 'mensagem' | 'menu' | 'pergunta' | 'transferir' | 'encerrar'

/** O que acontece ao escolher uma opção do menu (ou depois de uma mensagem/pergunta). */
export interface Go {
  /** Próxima etapa (id). */
  next?: string | null
  /** Ou transferir direto: fila de um setor ou uma pessoa. */
  sectorId?: string | null
  userId?: string | null
}

export interface MenuOption extends Go {
  label: string
}

export interface FlowStep {
  id: string
  type: StepType
  /** Texto enviado ao cliente ({nome} vira o primeiro nome). */
  text: string
  /** Menu: opções numeradas (o cliente responde com o número ou com o texto da opção). */
  options?: MenuOption[]
  /** Mensagem e pergunta: para onde segue. Transferir: setor ou pessoa. */
  go?: Go
  /** Pergunta: nome curto do que foi perguntado (ex.: "Modelo da máquina"), para a nota da conversa. */
  label?: string
}

export interface Flow {
  steps: FlowStep[]
  startStepId: string
  /** Resposta que não é opção do menu: quantas vezes repete antes de passar para a fila. */
  maxTries?: number
}

/** Onde a conversa está no fluxo. */
export interface BotState {
  stepId: string
  tries: number
  answers: { label: string; text: string }[]
}

export interface BotOutcome {
  /** Mensagens para enviar, na ordem. */
  messages: string[]
  /** Estado seguinte (null = o robô saiu da conversa). */
  state: BotState | null
  /** Saiu transferindo: setor e/ou pessoa (vazio = fila geral do número). */
  transfer?: { sectorId: string | null; userId: string | null }
  /** Saiu por quê (para a nota da conversa). */
  ended?: 'transferido' | 'encerrado' | 'sem_resposta_valida' | 'etapa_invalida'
  /** Saiu: as respostas do cliente às perguntas, para a nota de quem vai atender. */
  answers?: BotState['answers']
}

const MAX_CHAIN = 20
export const MAX_STEPS = 60
export const MAX_OPTIONS = 12

const norm = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** Texto do menu: a pergunta e as opções numeradas. */
export function menuText(step: FlowStep) {
  const opts = (step.options ?? []).map((o, i) => `*${i + 1}.* ${o.label}`)
  return [step.text.trim(), '', ...opts].join('\n').trim()
}

/** Qual opção o cliente escolheu: pelo número ("2", "2.", "opção 2") ou pelo texto da opção. */
export function pickOption(step: FlowStep, reply: string): number | null {
  const opts = step.options ?? []
  const r = norm(reply)
  if (!r) return null
  const num = /^(?:opcao |op |numero |n )?(\d{1,2})$/.exec(r)
  if (num) {
    const i = Number(num[1]) - 1
    return i >= 0 && i < opts.length ? i : null
  }
  const exact = opts.findIndex((o) => norm(o.label) === r)
  if (exact >= 0) return exact
  // Uma opção só contém o que foi escrito (ex.: "financeiro" em "Falar com o Financeiro").
  const partial = opts.map((o, i) => [i, norm(o.label)] as const).filter(([, l]) => r.length >= 3 && l.includes(r))
  return partial.length === 1 ? partial[0]![0] : null
}

const fill = (text: string, name: string | null) => text.replace(/\{nome\}/gi, (name ?? '').trim().split(/\s+/)[0] ?? '').replace(/[ \t]+([,.!?])/g, '$1').trim()

/**
 * Anda pelo fluxo a partir de uma etapa, enviando as mensagens até precisar de resposta (menu ou pergunta)
 * ou sair (transferir, encerrar).
 */
function run(flow: Flow, from: Go, state: Omit<BotState, 'stepId'>, name: string | null, messages: string[]): BotOutcome {
  let go: Go = from
  for (let i = 0; i < MAX_CHAIN; i++) {
    if (go.sectorId || go.userId || !go.next) {
      // Transferência direta (opção do menu) ou fim do caminho: sai para o setor/pessoa ou para a fila.
      return { messages, state: null, transfer: { sectorId: go.sectorId ?? null, userId: go.userId ?? null }, ended: go.sectorId || go.userId ? 'transferido' : 'encerrado', answers: state.answers }
    }
    const step = flow.steps.find((s) => s.id === go.next)
    if (!step) return { messages, state: null, transfer: { sectorId: null, userId: null }, ended: 'etapa_invalida', answers: state.answers }
    const text = fill(step.type === 'menu' ? menuText(step) : step.text, name)
    if (step.type === 'menu' || step.type === 'pergunta') {
      if (text) messages.push(text)
      return { messages, state: { ...state, stepId: step.id, tries: 0 } }
    }
    if (text) messages.push(text)
    if (step.type === 'transferir') return { messages, state: null, transfer: { sectorId: step.go?.sectorId ?? null, userId: step.go?.userId ?? null }, ended: 'transferido', answers: state.answers }
    if (step.type === 'encerrar') return { messages, state: null, transfer: { sectorId: null, userId: null }, ended: 'encerrado', answers: state.answers }
    go = step.go ?? {}
  }
  return { messages, state: null, transfer: { sectorId: null, userId: null }, ended: 'etapa_invalida', answers: state.answers }
}

/** Cliente chamou: começa o fluxo pela etapa inicial. */
export function startFlow(flow: Flow, name: string | null): BotOutcome {
  return run(flow, { next: flow.startStepId }, { tries: 0, answers: [] }, name, [])
}

/** Resposta do cliente com o robô esperando (menu ou pergunta). */
export function continueFlow(flow: Flow, state: BotState, reply: string, name: string | null): BotOutcome {
  const step = flow.steps.find((s) => s.id === state.stepId)
  if (!step) return { messages: [], state: null, transfer: { sectorId: null, userId: null }, ended: 'etapa_invalida' }
  if (step.type === 'pergunta') {
    const answer = reply.trim().slice(0, 500)
    const answers = answer ? [...state.answers, { label: step.label?.trim() || step.text.trim().slice(0, 60), text: answer }].slice(-20) : state.answers
    return run(flow, step.go ?? {}, { tries: 0, answers }, name, [])
  }
  const i = pickOption(step, reply)
  if (i === null) {
    const tries = state.tries + 1
    if (tries >= (flow.maxTries ?? 2)) {
      return { messages: ['Não entendi. Vou passar você para um atendente, só um instante.'], state: null, transfer: { sectorId: null, userId: null }, ended: 'sem_resposta_valida', answers: state.answers }
    }
    return { messages: [`Não entendi. Responda com o número de uma das opções:\n\n${fill(menuText(step), name)}`], state: { ...state, tries } }
  }
  const opt = step.options![i]!
  return run(flow, opt, { tries: 0, answers: state.answers }, name, [])
}

/** Confere o fluxo salvo pela tela: etapas válidas, ligações para etapas que existem, menu com opções. */
export function validateFlow(flow: Flow): string | null {
  const ids = new Set(flow.steps.map((s) => s.id))
  if (!flow.steps.length) return 'Crie ao menos uma etapa.'
  if (flow.steps.length > MAX_STEPS) return `No máximo ${MAX_STEPS} etapas.`
  if (ids.size !== flow.steps.length) return 'Há etapas repetidas.'
  if (!ids.has(flow.startStepId)) return 'Escolha a etapa inicial.'
  for (const [n, s] of flow.steps.entries()) {
    const where = `Etapa ${n + 1}`
    if (!['mensagem', 'menu', 'pergunta', 'transferir', 'encerrar'].includes(s.type)) return `${where}: tipo inválido.`
    if (!s.text.trim() && s.type !== 'transferir' && s.type !== 'encerrar') return `${where}: escreva a mensagem.`
    if (s.text.length > 1000) return `${where}: mensagem longa demais (até 1.000 letras).`
    const gos: Go[] = s.type === 'menu' ? (s.options ?? []) : [s.go ?? {}]
    if (s.type === 'menu') {
      if (!s.options?.length) return `${where}: o menu precisa de opções.`
      if (s.options.length > MAX_OPTIONS) return `${where}: no máximo ${MAX_OPTIONS} opções.`
      if (s.options.some((o) => !o.label.trim())) return `${where}: dê um nome a cada opção.`
    }
    if (s.type === 'transferir' && !s.go?.sectorId && !s.go?.userId) return `${where}: escolha o setor ou a pessoa que recebe a conversa.`
    for (const g of gos) if (g.next && !ids.has(g.next)) return `${where}: aponta para uma etapa que não existe.`
  }
  return null
}

/** Nota da conversa com as respostas do cliente ao robô, para o atendente ler antes de responder. */
export function answersNote(answers: BotState['answers']) {
  return answers.length ? ['Respostas ao robô de atendimento:', ...answers.map((a) => `• ${a.label}: ${a.text}`)].join('\n') : null
}

// ---------- Fluxos salvos ----------

/** Fluxo como está no banco (etapas em JSON). */
export function flowOf(row: { steps: unknown; startStepId: string }): Flow {
  return { steps: Array.isArray(row.steps) ? (row.steps as FlowStep[]) : [], startStepId: row.startStepId }
}

/** Estado do robô gravado na conversa (ou vazio). */
export function botStateOf(raw: unknown): BotState {
  const s = (raw ?? {}) as Partial<BotState>
  return { stepId: typeof s.stepId === 'string' ? s.stepId : '', tries: typeof s.tries === 'number' ? s.tries : 0, answers: Array.isArray(s.answers) ? s.answers.slice(-20) : [] }
}

export interface FlowRow {
  id: string
  numberIds: string[]
  trigger: string
  keywords: string[]
  onlyAfterHours: boolean
}

/**
 * Qual fluxo começa quando um cliente sem atendente escreve: primeiro os de palavra-chave (a mensagem contém uma
 * das palavras), depois os de conversa nova ou parada. Respeita os números de cada fluxo e o "só fora do horário".
 */
export function chooseFlow<T extends FlowRow>(flows: T[], c: { numberId: string; text: string; idle: boolean; afterHours: boolean }): T | null {
  const ok = flows.filter((f) => (!f.numberIds.length || f.numberIds.includes(c.numberId)) && (!f.onlyAfterHours || c.afterHours))
  const text = ` ${norm(c.text)} `
  const byWord = ok.find((f) => f.trigger === 'PALAVRA' && f.keywords.some((k) => norm(k) && text.includes(` ${norm(k)} `)))
  if (byWord) return byWord
  return c.idle ? (ok.find((f) => f.trigger === 'NOVA_CONVERSA') ?? null) : null
}
