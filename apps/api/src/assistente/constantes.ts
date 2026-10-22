// Assistente de perguntas do Mercado Livre: situações, motivos e configurações padrão (as mesmas do painel).

export const FINAL_STATUSES = ['respondida', 'resolvida', 'nao_aplicavel']
export const PENDING_STATUSES = ['nova', 'aguardando_analise', 'em_atendimento', 'aguardando_cliente', 'aguardando_validacao', 'conhecimento_aprovacao']
export const QUESTION_STATUSES = [...PENDING_STATUSES, ...FINAL_STATUSES]
export const ML_ANSWER_LIMIT = 2000

export const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova',
  aguardando_analise: 'Aguardando análise',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando o cliente',
  aguardando_validacao: 'Aguardando validação técnica',
  conhecimento_aprovacao: 'Conhecimento em aprovação',
  respondida: 'Respondida',
  resolvida: 'Resolvida',
  nao_aplicavel: 'Não se aplica',
}

export const REASONS: Record<string, string> = {
  A: 'Falta de conhecimento técnico',
  B: 'Falta de dados do cliente',
  C: 'Informações conflitantes',
  D: 'Produto não localizado',
  E: 'Dúvida comercial',
  F: 'Falha de integração',
  G: 'Necessita de análise humana',
}

export const KNOWLEDGE_STATUSES = ['ativo', 'em_revisao', 'inativo', 'rascunho']
export const VALIDATION = ['confirmada', 'pendente', 'nao_confirmada']

export const KNOWLEDGE_CATEGORIES = [
  'Marcas de máquinas',
  'Modelos de máquinas',
  'Códigos de peças',
  'Aplicações e compatibilidade',
  'Informações técnicas',
  'Dúvidas frequentes',
  'Garantia e troca',
  'Frete e envio',
  'Informações comerciais',
  'Orientações de atendimento',
  'Motor',
  'Hidráulico',
  'Filtros',
  'Transmissão',
  'Material rodante',
  'Elétrica',
]

export const AI_KEY = 'assist_ai'
export const STORE_KEY = 'assist_store'
export const INTEGRATION_KEY = 'assist_integration'
export const STATE_KEY = 'assist_state'
export const SECRET_KEY = (p: 'claude' | 'gemini') => `assist_secret_${p}`
/** Credenciais e tokens trazidos do painel, guardados até o CRM assumir o atendimento. */
export const PAINEL_KEY = 'assist_painel'

export const PROVIDERS: Record<string, string> = {
  claude: 'Claude (Anthropic): pago por uso',
  gemini: 'Google Gemini: plano gratuito',
  sem_ia: 'Sem IA: só respostas aprovadas (custo zero)',
}
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5']
export const EFFORTS = ['low', 'medium', 'high']
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']

export interface AiSettings {
  assistant_name: string
  tone: string
  formality: 'formal' | 'semiformal'
  greeting_by_time: boolean
  max_answer_chars: number
  auto_reply: boolean
  min_confidence: number
  upsell_enabled: boolean
  upsell_rules: string
  max_complementary: number
  request_info_when: string
  request_info_mode: 'enviar' | 'revisar'
  forward_when: string
  allowed_categories: string[]
  custom_instructions: string
  provider: 'claude' | 'gemini' | 'sem_ia'
  gemini_model: string
  gemini_fallback: boolean
  auto_learn: boolean
  auto_learn_status: 'ativo' | 'em_revisao'
  auto_learn_from_ai: boolean
  model: string
  effort: string
  import_status_mode: 'planilha' | 'revisao'
  /** Frete calculado na Magazord para perguntas de frete com CEP. */
  frete_enabled: boolean
  frete_intro: string
  frete_outro: string
  frete_ask_cep: boolean
  frete_ask_cep_text: string
}

export const AI_DEFAULTS: AiSettings = {
  assistant_name: 'Assistente Usaparts',
  tone: 'consultivo',
  formality: 'formal',
  greeting_by_time: true,
  max_answer_chars: 1200,
  auto_reply: false,
  min_confidence: 0.8,
  upsell_enabled: true,
  upsell_rules:
    'Ofereça apenas itens com aplicação confirmada para o mesmo modelo de máquina e relacionados ao mesmo sistema ou à manutenção em curso (filtros, vedações, componentes do mesmo sistema). A oferta deve ser opcional e breve.',
  max_complementary: 2,
  request_info_when: 'Quando o cliente não informar modelo completo, ano, número de série ou código original e isso for necessário para confirmar a compatibilidade.',
  request_info_mode: 'enviar',
  forward_when:
    'Quando envolver descontos, negociação, prazos ou condições não cadastradas; quando houver dados conflitantes; quando a compatibilidade não estiver confirmada na base; reclamações, garantia ou pós-venda.',
  allowed_categories: KNOWLEDGE_CATEGORIES,
  custom_instructions: '',
  provider: 'sem_ia',
  gemini_model: 'gemini-3.8-flash',
  gemini_fallback: true,
  auto_learn: true,
  auto_learn_status: 'ativo',
  auto_learn_from_ai: true,
  model: 'claude-opus-5-5',
  effort: 'medium',
  import_status_mode: 'planilha',
  frete_enabled: true,
  frete_intro: 'Para o CEP {cep}, as opções de envio são:',
  frete_outro: 'Valores para 1 unidade, sujeitos a confirmação no fechamento da compra. Qualquer dúvida, estamos à disposição!',
  frete_ask_cep: true,
  frete_ask_cep_text: 'Para calcular o frete, por favor nos informe o seu CEP aqui nas perguntas que respondemos com as opções de envio e os prazos. Obrigado!',
}

export interface IntegrationSettings {
  /** O CRM assumiu o atendimento (lê as perguntas, responde e busca as vendas). Antes disso, o painel antigo faz isso. */
  active: boolean
  polling_enabled: boolean
  poll_minutes: number
  sales_enabled: boolean
  sales_window_days: number
  sales_sync_minutes: number
  activatedAt?: string | null
  activatedBy?: string | null
}

export const INTEGRATION_DEFAULTS: IntegrationSettings = {
  active: false,
  polling_enabled: true,
  poll_minutes: 5,
  sales_enabled: true,
  sales_window_days: 30,
  sales_sync_minutes: 30,
}

export interface StoreSettings {
  seller_id: string | null
  nickname?: string | null
  site_id?: string | null
  official_store_id?: string | null
  permalink?: string | null
  input?: string | null
  active_items?: number | null
  configured_at?: string | null
  configured_by?: string | null
  last_sync_at?: string | null
  synced_items?: number | null
  linkable_items?: number | null
}

/** Andamento da conexão do assistente com o Mercado Livre (o token fica na conexão de Marketplaces). */
export interface AssistState {
  lastTestAt?: string | null
  lastTestOk?: boolean
  lastItemsSyncAt?: string | null
  lastQuestionsSyncAt?: string | null
  lastWebhookAt?: string | null
  lastOrdersSyncAt?: string | null
  ordersError?: string | null
  lastError?: string | null
  lastErrorAt?: string | null
  logs?: { level: string; message: string; at: string }[]
}

// Vendas: situações de pedido que contam como venda realizada e o que é desistência no checkout.
export const SOLD_STATUSES = ['paid', 'partially_paid', 'partially_refunded']
export const ABANDON_HOURS = 48
export const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: 'Paga',
  partially_paid: 'Parcialmente paga',
  partially_refunded: 'Parcialmente reembolsada',
  confirmed: 'Confirmada (aguardando pagamento)',
  payment_required: 'Aguardando pagamento',
  payment_in_process: 'Pagamento em processamento',
  pending_cancel: 'Cancelamento pendente',
  cancelled: 'Cancelada',
  invalid: 'Inválida',
}
export const OUTCOME_LABELS: Record<string, string> = {
  comprou: 'Cliente comprou',
  aguardando_pagamento: 'Foi ao checkout · aguardando pagamento',
  desistiu_checkout: 'Foi ao checkout e desistiu (não pagou)',
  cancelou_apos_pagar: 'Comprou, mas cancelou depois',
}

/** Resultado do pedido para o funil: comprou, aguardando pagamento, desistiu no checkout ou cancelou depois de pagar. */
export function outcomeOf(status: string | null | undefined, paidBefore: boolean, orderDate: Date | string, now = Date.now()) {
  if (status && SOLD_STATUSES.includes(status)) return 'comprou'
  if (status === 'cancelled' || status === 'invalid') return paidBefore ? 'cancelou_apos_pagar' : 'desistiu_checkout'
  return now - new Date(orderDate).getTime() > ABANDON_HOURS * 3_600_000 ? 'desistiu_checkout' : 'aguardando_pagamento'
}
