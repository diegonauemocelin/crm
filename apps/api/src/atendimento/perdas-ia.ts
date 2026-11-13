// Análise das perdas com IA (Claude): lê o motivo e as observações das pré-vendas perdidas e devolve as causas, os
// códigos e as peças pedidas, o que foi respondido ao cliente e as decisões sugeridas. Funções puras (sem banco e sem
// rede), testadas em test/perdas-ia.spec.ts.
//
// LGPD: para a IA vão só códigos (C1, C2... para clientes; V1, V2... para vendedores e atendentes). Telefone, e-mail,
// CPF/CNPJ e links nas observações são trocados por marcadores antes do envio. Os nomes voltam só aqui, no CRM.

export const LOSS_AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const
export type LossAiModel = (typeof LOSS_AI_MODELS)[number]
export const LOSS_AI_MODEL_LABEL: Record<LossAiModel, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5 (mais completo)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (equilibrado)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (mais barato)',
}
/** Preço por milhão de tokens (entrada, saída) em US$, para mostrar o custo aproximado de cada relatório. */
export const LOSS_AI_PRICE: Record<LossAiModel, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}
/** Perdas por relatório (as mais recentes). O que passar disso aparece como "ficaram de fora". */
export const LOSS_AI_MAX = 300
const NOTES_MAX = 800

export interface LossInput {
  id: string
  client: string
  /** Vendedor que recebeu o repasse; sem repasse, quem atendeu na pré-venda. */
  person: string | null
  stage: 'vendedor' | 'pre_venda'
  reason: string | null
  notes: string | null
  brands: string[]
  partTypes: string[]
  origin: string | null
  /** Data da perda (AAAA-MM-DD). */
  date: string
}

/** Tira telefone, e-mail, CPF/CNPJ e links do texto (a IA não precisa deles). */
export function scrubNotes(text: string | null): string {
  if (!text) return ''
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]')
    // Telefone só com DDD entre parênteses, +55 ou celular (9xxxx-xxxx): códigos de peça com hífen ("1234-5678") ficam.
    .replace(/(\+?55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}\b|\+55\s?\d{2}\s?9?\d{4}-?\d{4}\b|\b(\d{2}\s)?9\d{4}-\d{4}\b/g, '[telefone]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTES_MAX)
}

export interface LossPayload {
  /** JSON enviado à IA (só códigos, sem nomes). */
  content: string
  clients: Record<string, LossInput>
  people: Record<string, string>
}

export function buildLossPayload(items: LossInput[]): LossPayload {
  const clients: Record<string, LossInput> = {}
  const people: Record<string, string> = {}
  const personRef = new Map<string, string>()
  const rows = items.map((it, i) => {
    const ref = `C${i + 1}`
    clients[ref] = it
    let p: string | null = null
    if (it.person) {
      p = personRef.get(it.person) ?? null
      if (!p) {
        p = `V${personRef.size + 1}`
        personRef.set(it.person, p)
        people[p] = it.person
      }
    }
    return {
      ref,
      data: it.date,
      etapa: it.stage === 'vendedor' ? 'repassado ao vendedor' : 'só na pré-venda (não repassado)',
      atendente: p,
      motivo_marcado: it.reason,
      observacoes: scrubNotes(it.notes) || null,
      marcas: it.brands,
      tipos_de_peca: it.partTypes,
      origem: it.origin,
    }
  })
  return { content: JSON.stringify({ perdas: rows }), clients, people }
}

export const LOSS_AI_SYSTEM = `Você analisa vendas perdidas de uma distribuidora de peças para máquinas pesadas (linha amarela: escavadeiras, retroescavadeiras, pás carregadeiras, tratores de esteira, motoniveladoras, rolos). Cada perda tem um código de cliente (C1, C2...), o atendente (V1, V2... ou nulo), a etapa (repassado ao vendedor ou só na pré-venda), o motivo marcado e as observações escritas pela equipe.

Para cada perda, extraia das observações:
- codigos: os códigos de peça citados (OEM, referência, part number), exatamente como escritos. Não invente nem complete códigos; sem código no texto, lista vazia.
- pecas: as peças pedidas (ex.: "kit reparo do cilindro do braço", "bomba hidráulica"), com a marca/modelo da máquina se estiver no texto.
- resposta: o que a equipe respondeu ou informou ao cliente (ex.: "sem estoque, prazo de 30 dias", "preço R$ X acima do concorrente"), só se estiver escrito; senão, texto vazio.
- causa: a causa real da perda em poucas palavras (pode diferir do motivo marcado quando as observações mostram outra coisa).
- acao: o que poderia ter evitado a perda ou o que fazer agora (ex.: "incluir o código no estoque", "retomar contato").

Depois, a visão geral para o gestor decidir:
- resumo: 3 a 6 frases com o quadro geral (o que mais fez perder vendas e o que isso indica).
- causas: as causas agrupadas, com a quantidade e as refs dos clientes.
- codigos_mais_pedidos: códigos ou peças que aparecem em mais de uma perda ou que merecem atenção (falta de estoque), com a quantidade e as refs.
- decisoes: ações práticas para a gestão (estoque, preço, prazo, treinamento, processo), com prioridade alta, media ou baixa e o porquê.
- por_atendente: para cada atendente (V1, V2...) com perdas, um comentário curto sobre o padrão das perdas dele (sem julgar a pessoa).
- registro: o que falta nos registros (ex.: perdas sem observação ou sem motivo) para a análise ficar melhor.

Regras: use só o que está nos dados; não invente preços, prazos, estoques ou códigos. Escreva em português do Brasil, direto. Use sempre as refs (C1, V1) e nunca tente adivinhar nomes.`

const STR = { type: 'string' }
const STRS = { type: 'array', items: STR }
const REFS = { type: 'array', items: STR }
export const LOSS_AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'causas', 'codigos_mais_pedidos', 'decisoes', 'por_atendente', 'registro', 'itens'],
  properties: {
    resumo: STR,
    causas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['causa', 'quantidade', 'refs'], properties: { causa: STR, quantidade: { type: 'integer' }, refs: REFS } } },
    codigos_mais_pedidos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['codigo', 'peca', 'quantidade', 'refs'], properties: { codigo: STR, peca: STR, quantidade: { type: 'integer' }, refs: REFS } } },
    decisoes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['acao', 'prioridade', 'porque'], properties: { acao: STR, prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] }, porque: STR } } },
    por_atendente: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'comentario'], properties: { ref: STR, comentario: STR } } },
    registro: STR,
    itens: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'codigos', 'pecas', 'resposta', 'causa', 'acao'], properties: { ref: STR, codigos: STRS, pecas: STRS, resposta: STR, causa: STR, acao: STR } } },
  },
} as const

interface RawResult {
  resumo?: string
  causas?: { causa?: string; quantidade?: number; refs?: string[] }[]
  codigos_mais_pedidos?: { codigo?: string; peca?: string; quantidade?: number; refs?: string[] }[]
  decisoes?: { acao?: string; prioridade?: string; porque?: string }[]
  por_atendente?: { ref?: string; comentario?: string }[]
  registro?: string
  itens?: { ref?: string; codigos?: string[]; pecas?: string[]; resposta?: string; causa?: string; acao?: string }[]
}

export interface LossReportResult {
  summary: string
  causes: { cause: string; count: number; clients: string[] }[]
  codes: { code: string; part: string; count: number; clients: string[] }[]
  decisions: { action: string; priority: 'alta' | 'media' | 'baixa'; why: string }[]
  people: { person: string; comment: string }[]
  records: string
  items: { id: string; client: string; person: string | null; stage: LossInput['stage']; date: string; reason: string | null; notes: string | null; codes: string[]; parts: string[]; answer: string; cause: string; action: string }[]
}

const s = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 30) : [])

/** Troca as refs pelos nomes (só no CRM) e confere o que a IA devolveu. Perdas que a IA pulou entram sem análise. */
export function restoreLossReport(raw: RawResult, payload: LossPayload): LossReportResult {
  const name = (ref: string) => payload.clients[ref]?.client ?? payload.people[ref] ?? ref
  // Troca refs soltas no texto (C12, V3) pelos nomes.
  const text = (t: string) => t.replace(/\b([CV]\d{1,4})\b/g, (m) => (payload.clients[m] || payload.people[m] ? name(m) : m))
  const refs = (v: unknown) => list(v).filter((r) => payload.clients[r]).map(name)
  const byRef = new Map((raw.itens ?? []).filter((x) => x?.ref && payload.clients[x.ref]).map((x) => [x.ref!, x]))
  return {
    summary: text(s(raw.resumo, 4000)),
    causes: (raw.causas ?? []).slice(0, 30).map((c) => ({ cause: text(s(c.causa, 300)), count: Math.max(0, Math.round(Number(c.quantidade) || 0)), clients: refs(c.refs) })).filter((c) => c.cause),
    codes: (raw.codigos_mais_pedidos ?? []).slice(0, 50).map((c) => ({ code: s(c.codigo, 120), part: text(s(c.peca, 300)), count: Math.max(0, Math.round(Number(c.quantidade) || 0)), clients: refs(c.refs) })).filter((c) => c.code || c.part),
    decisions: (raw.decisoes ?? []).slice(0, 20).map((d) => ({ action: text(s(d.acao, 500)), priority: (['alta', 'media', 'baixa'].includes(d.prioridade ?? '') ? d.prioridade : 'media') as 'alta' | 'media' | 'baixa', why: text(s(d.porque, 600)) })).filter((d) => d.action),
    people: (raw.por_atendente ?? []).filter((p) => p.ref && payload.people[p.ref]).map((p) => ({ person: payload.people[p.ref!]!, comment: text(s(p.comentario, 600)) })),
    records: text(s(raw.registro, 1000)),
    items: Object.entries(payload.clients).map(([ref, it]) => {
      const a = byRef.get(ref)
      return { id: it.id, client: it.client, person: it.person, stage: it.stage, date: it.date, reason: it.reason, notes: it.notes?.trim() || null, codes: list(a?.codigos), parts: list(a?.pecas), answer: text(s(a?.resposta, 600)), cause: text(s(a?.causa, 300)), action: text(s(a?.acao, 400)) }
    }),
  }
}

/** Custo aproximado em US$ pelos tokens usados. */
export function lossAiCost(model: string, input: number, output: number) {
  const p = LOSS_AI_PRICE[model as LossAiModel] ?? LOSS_AI_PRICE['claude-opus-5-5']
  return Math.round(((input * p[0] + output * p[1]) / 1_000_000) * 100) / 100
}

const PRIORITY = { alta: '🔴', media: '🟡', baixa: '🟢' } as const

/** Parte da análise que vai no WhatsApp dos gestores (o relatório completo fica no CRM). */
export function lossAiWhatsapp(r: LossReportResult, total: number, omitted = 0) {
  const out = [`*🤖 Análise das perdas com IA (${total} perda(s)${omitted ? `, ${omitted} fora da análise` : ''})*`]
  if (r.summary) out.push(r.summary)
  if (r.causes.length) out.push('', '*Principais causas*', ...r.causes.slice(0, 6).map((c) => `• ${c.cause}: ${c.count}`))
  if (r.codes.length) out.push('', '*Códigos e peças pedidos*', ...r.codes.slice(0, 10).map((c) => `• ${[c.code, c.part].filter(Boolean).join(' · ')}${c.count > 1 ? ` (${c.count}x)` : ''}`))
  if (r.decisions.length) out.push('', '*Decisões sugeridas*', ...r.decisions.slice(0, 6).map((d) => `${PRIORITY[d.priority]} ${d.action}`))
  out.push('', 'Relatório completo (cliente, vendedor, códigos e respostas): CRM › Atendimento Comercial › Análise das perdas (IA).')
  return out.join('\n')
}
