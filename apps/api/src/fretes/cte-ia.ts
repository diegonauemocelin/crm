// Análise inteligente do CT-e (IA): monta o pedido com o CT-e, a conciliação e a tabela de frete do destino, e lê a
// resposta em JSON. Sem banco e sem rede (test/fretes-cte-ia.spec.ts).

/** Dados do XML que a conciliação não guarda: observações, pesos (real, cubado, taxado), produto e tomador. */
export function cteXmlExtras(raw: string) {
  const xml = raw.replace(/^﻿/, '')
  const tag = (src: string, name: string) => new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(src)?.[1]?.trim() ?? null
  const all = (src: string, name: string) => [...src.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'))].map((m) => m[1]!)
  const quantities = all(xml, 'infQ').map((q) => ({ medida: tag(q, 'tpMed'), unidade: tag(q, 'cUnid'), quantidade: Number(tag(q, 'qCarga')) || null }))
  const obs = [tag(xml, 'xObs'), ...all(xml, 'ObsCont').map((o) => tag(o, 'xTexto')), ...all(xml, 'ObsFisco').map((o) => tag(o, 'xTexto'))].filter((x): x is string => !!x)
  const toma = tag(xml, 'toma')
  const TOMA: Record<string, string> = { '0': 'Remetente', '1': 'Expedidor', '2': 'Recebedor', '3': 'Destinatário', '4': 'Outro' }
  return {
    produtoPredominante: tag(xml, 'proPred'),
    outrasCaracteristicas: tag(xml, 'xOutCat'),
    quantidades: quantities,
    tomador: toma !== null ? (TOMA[toma] ?? toma) : xml.includes('toma4') ? 'Outro' : null,
    modal: tag(xml, 'modal'),
    observacoes: obs.join(' | ').slice(0, 2000) || null,
  }
}

export const CTE_AI_ACTIONS = ['OK', 'AJUSTAR_CRM', 'CONTESTAR', 'PERGUNTAR', 'CONFERIR'] as const
export type CteAiAction = (typeof CTE_AI_ACTIONS)[number]
export const CTE_AI_VERDICTS = ['CONFERE', 'COBRADO_A_MAIS', 'COBRADO_A_MENOR', 'TABELA_DESATUALIZADA', 'INCONCLUSIVO'] as const
export type CteAiVerdict = (typeof CTE_AI_VERDICTS)[number]

export interface CteAiResult {
  veredito: CteAiVerdict
  resumo: string
  itens: { componente: string; tabela: string | null; cobrado: string | null; explicacao: string; acao: CteAiAction }[]
  acoes: { tipo: CteAiAction; texto: string }[]
  perguntasTransportadora: string[]
}

export const CTE_AI_PROMPT = `Você é um analista de fretes de uma importadora de peças (Brasil). Compare o que a transportadora cobrou no CT-e com a tabela de frete negociada que está no CRM e explique, componente por componente, o MOTIVO de cada diferença.

Como pensar:
- Refaça as contas com os números da tabela (faixas de peso, excedente por kg, percentuais sobre o valor da nota, taxas fixas, pedágio por fração, ICMS somado "por dentro" = subtotal ÷ (1 − alíquota)). Mostre a conta curta quando ajudar.
- Teste hipóteses comuns: peso taxado diferente (cubagem: o CT-e traz peso real, cubado e taxado nas quantidades), outra faixa ou outra região/classificação do destino, percentual diferente, taxa embutida no frete e cobrada separada (ex.: emissão e capatazia "inclusas"), taxa com outro nome (ex.: "ADICIONAL FRETE" = taxa de combustível, "IMP REPASSADO"/"OUTROS" = ICMS), acréscimo percentual constante (ex.: +10%), ICMS com alíquota ou forma de cobrança diferente, tomador diferente da empresa (frete FOB pago pelo cliente, que usa outro preço), cliente que retira no terminal/aeroporto (o destino da prestação é outro).
- Diga se a diferença é para AJUSTAR_CRM (a tabela/componentes do CRM estão incompletos ou com nome diferente), CONTESTAR (a transportadora cobrou fora do combinado), PERGUNTAR (falta informação da transportadora, ex.: taxa que não está na tabela), CONFERIR (dado do envio a verificar, ex.: medidas do produto) ou OK.
- Não invente valores nem regras: use só os dados enviados. Se não der para explicar, diga que é inconclusivo e o que falta.
- Português do Brasil, direto, valores em R$ com vírgula.

Responda SOMENTE com um JSON neste formato:
{"veredito":"CONFERE|COBRADO_A_MAIS|COBRADO_A_MENOR|TABELA_DESATUALIZADA|INCONCLUSIVO","resumo":"2 a 4 frases com a conclusão","itens":[{"componente":"nome","tabela":"valor ou conta pela tabela ou null","cobrado":"valor no CT-e ou null","explicacao":"motivo da diferença","acao":"OK|AJUSTAR_CRM|CONTESTAR|PERGUNTAR|CONFERIR"}],"acoes":[{"tipo":"AJUSTAR_CRM|CONTESTAR|PERGUNTAR|CONFERIR","texto":"o que fazer, concreto"}],"perguntasTransportadora":["pergunta"]}`

/** Texto com os dados para a IA (JSON enxuto). */
export function cteAiInput(d: Record<string, unknown>) {
  return `Dados (JSON):\n${JSON.stringify(d)}`
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : v === null || v === undefined ? null : String(v).slice(0, max))

/** Lê a resposta da IA (JSON, às vezes dentro de ```json). Lança erro se não der para ler. */
export function parseCteAi(text: string): CteAiResult {
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ''))
  if (!m) throw new Error('A IA não devolveu a análise no formato esperado. Tente de novo.')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    throw new Error('A IA não devolveu a análise no formato esperado. Tente de novo.')
  }
  const act = (v: unknown): CteAiAction => ((CTE_AI_ACTIONS as readonly string[]).includes(String(v)) ? (String(v) as CteAiAction) : 'CONFERIR')
  const verdict = (CTE_AI_VERDICTS as readonly string[]).includes(String(raw.veredito)) ? (String(raw.veredito) as CteAiVerdict) : 'INCONCLUSIVO'
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const resumo = str(raw.resumo, 1500)
  if (!resumo) throw new Error('A IA não devolveu a análise no formato esperado. Tente de novo.')
  return {
    veredito: verdict,
    resumo,
    itens: arr(raw.itens)
      .slice(0, 30)
      .map((i) => ({ componente: str(i.componente, 80) ?? '—', tabela: str(i.tabela, 200), cobrado: str(i.cobrado, 120), explicacao: str(i.explicacao, 600) ?? '', acao: act(i.acao) })),
    acoes: arr(raw.acoes)
      .slice(0, 12)
      .map((a) => ({ tipo: act(a.tipo), texto: str(a.texto, 500) ?? '' }))
      .filter((a) => a.texto),
    perguntasTransportadora: (Array.isArray(raw.perguntasTransportadora) ? raw.perguntasTransportadora : [])
      .map((p) => str(p, 400))
      .filter((p): p is string => !!p)
      .slice(0, 8),
  }
}
