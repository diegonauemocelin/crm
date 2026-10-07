/**
 * Lead scoring em duas dimensões. Função pura (testada em test/leads.spec.ts).
 * - Perfil: quanto o lead se parece com o cliente ideal (atributos do cadastro).
 * - Interesse: quanto ele interagiu recentemente (eventos dentro da janela). Fora da janela, os pontos somem:
 *   é o "decaimento por inatividade".
 */

export interface ScoreRuleShape {
  dimension: 'PERFIL' | 'INTERESSE'
  field: string
  operator: string
  value: unknown
  points: number
  active: boolean
}

export interface ScoreSettings {
  /** Eventos mais antigos que isso deixam de contar para o interesse. */
  interestWindowDays: number
  /** Nota mínima (perfil + interesse) para cada faixa. */
  gradeA: number
  gradeB: number
  gradeC: number
  /** Teto de cada dimensão, para um único fator não dominar a nota. */
  maxProfile: number
  maxInterest: number
}

export const DEFAULT_SCORE_SETTINGS: ScoreSettings = {
  interestWindowDays: 90,
  gradeA: 60,
  gradeB: 35,
  gradeC: 15,
  maxProfile: 60,
  maxInterest: 60,
}

/** Regras iniciais: ajustáveis na tela de configuração do lead scoring. */
export const DEFAULT_RULES: (Omit<ScoreRuleShape, 'active'> & { name: string })[] = [
  { dimension: 'PERFIL', name: 'É cliente', field: 'stage', operator: 'eq', value: 'CLIENTE', points: 25 },
  { dimension: 'PERFIL', name: 'É oportunidade', field: 'stage', operator: 'eq', value: 'OPORTUNIDADE', points: 15 },
  { dimension: 'PERFIL', name: 'É lead qualificado', field: 'stage', operator: 'eq', value: 'QUALIFICADO', points: 10 },
  { dimension: 'PERFIL', name: 'Revenda', field: 'tag', operator: 'eq', value: 'revenda', points: 20 },
  { dimension: 'PERFIL', name: 'Tem telefone', field: 'has_phone', operator: 'eq', value: true, points: 10 },
  { dimension: 'PERFIL', name: 'Região Sul (unidades)', field: 'state', operator: 'in', value: ['SC', 'PR', 'RS'], points: 10 },
  { dimension: 'INTERESSE', name: 'Converteu (formulário, LP, WhatsApp)', field: 'conversao', operator: 'each', value: null, points: 10 },
  { dimension: 'INTERESSE', name: 'Atendimento de Pré/Pós-Vendas', field: 'atendimento', operator: 'each', value: null, points: 15 },
  { dimension: 'INTERESSE', name: 'Comprou', field: 'venda', operator: 'each', value: null, points: 25 },
  { dimension: 'INTERESSE', name: 'Visitou o site', field: 'visita', operator: 'each', value: null, points: 2 },
  { dimension: 'INTERESSE', name: 'Iniciou o checkout na loja', field: 'checkout', operator: 'each', value: null, points: 5 },
  { dimension: 'INTERESSE', name: 'Abriu e-mail', field: 'email_aberto', operator: 'each', value: null, points: 2 },
  { dimension: 'INTERESSE', name: 'Clicou em e-mail', field: 'email_clique', operator: 'each', value: null, points: 5 },
]

export interface LeadForScore {
  stage: string
  state: string | null
  phone: string | null
  email: string | null
  tags: string[]
  customFields: Record<string, unknown>
}

function matches(rule: ScoreRuleShape, lead: LeadForScore): boolean {
  let actual: unknown
  if (rule.field === 'stage') actual = lead.stage
  else if (rule.field === 'state') actual = lead.state
  else if (rule.field === 'has_phone') actual = !!lead.phone
  else if (rule.field === 'has_email') actual = !!lead.email
  else if (rule.field === 'tag') return lead.tags.includes(String(rule.value).toLowerCase())
  else if (rule.field.startsWith('custom:')) actual = lead.customFields[rule.field.slice(7)]
  else return false

  switch (rule.operator) {
    case 'eq':
      return Array.isArray(actual) ? actual.includes(rule.value) : actual === rule.value
    case 'in':
      return Array.isArray(rule.value) && (rule.value as unknown[]).includes(actual)
    case 'exists':
      return actual !== null && actual !== undefined && actual !== '' && !(Array.isArray(actual) && actual.length === 0)
    case 'gte':
      return typeof actual === 'number' && actual >= Number(rule.value)
    default:
      return false
  }
}

export function gradeOf(total: number, s: ScoreSettings): 'A' | 'B' | 'C' | 'D' {
  if (total >= s.gradeA) return 'A'
  if (total >= s.gradeB) return 'B'
  if (total >= s.gradeC) return 'C'
  return 'D'
}

export function computeScore(
  lead: LeadForScore,
  events: { type: string; occurredAt: Date }[],
  rules: ScoreRuleShape[],
  settings: ScoreSettings,
  now = new Date(),
) {
  const active = rules.filter((r) => r.active)
  const profileRaw = active.filter((r) => r.dimension === 'PERFIL' && matches(r, lead)).reduce((s, r) => s + r.points, 0)
  const since = now.getTime() - settings.interestWindowDays * 86_400_000
  const recent = events.filter((e) => e.occurredAt.getTime() >= since)
  let interestRaw = 0
  for (const r of active.filter((x) => x.dimension === 'INTERESSE')) {
    interestRaw += recent.filter((e) => e.type === r.field).length * r.points
  }
  const profile = Math.max(0, Math.min(settings.maxProfile, profileRaw))
  const interest = Math.max(0, Math.min(settings.maxInterest, interestRaw))
  return { profile, interest, total: profile + interest, grade: gradeOf(profile + interest, settings) }
}
