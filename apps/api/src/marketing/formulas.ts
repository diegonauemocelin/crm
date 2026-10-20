/**
 * Marketing Inteligente: fórmulas dos indicadores, num lugar só (testadas em test/marketing.spec.ts).
 * Taxas são frações (0,034 = 3,4%); a tela formata em porcentagem.
 * Divisão por zero, ou faltando um dos lados, dá null, que a tela mostra como "Não disponível". Nunca zero inventado.
 */

type N = number | null | undefined

const ok = (v: N): v is number => typeof v === 'number' && Number.isFinite(v)

/** a / b, ou null quando falta um dos lados ou o divisor é zero. */
export function div(a: N, b: N): number | null {
  return ok(a) && ok(b) && b !== 0 ? a / b : null
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** CTR: cliques / impressões. */
export const ctr = (clicks: N, impressions: N) => div(clicks, impressions)
/** CPC médio: investimento / cliques. */
export const cpc = (cost: N, clicks: N) => div(cost, clicks)
/** CPM: investimento / impressões × 1.000. */
export const cpm = (cost: N, impressions: N) => {
  const v = div(cost, impressions)
  return v === null ? null : v * 1000
}
/** CPL: investimento em mídia / leads únicos atribuídos à mídia que tem custo conhecido. Sem investimento, não há CPL. */
export const cpl = (cost: N, leads: N) => (ok(cost) && cost > 0 ? div(cost, leads) : null)
/** Custo por lead qualificado: investimento / leads qualificados únicos. */
export const costPerQualified = (cost: N, qualified: N) => (ok(cost) && cost > 0 ? div(cost, qualified) : null)
/** CAC de mídia: investimento / clientes novos adquiridos pela mídia. */
export const cac = (cost: N, newCustomers: N) => (ok(cost) && cost > 0 ? div(cost, newCustomers) : null)
/** ROAS de mídia: receita atribuída à mídia / investimento em mídia. É um múltiplo (4 = R$ 4 por R$ 1), não é ROI. */
export const roas = (revenue: N, cost: N) => div(revenue, cost)
/**
 * ROI de marketing: (contribuição atribuída − custos de marketing) / custos de marketing.
 * Precisa da margem de contribuição e de todos os custos (mídia + agência, ferramentas, produção). Sem eles: null.
 */
export function roi(contribution: N, marketingCosts: N): number | null {
  if (!ok(contribution) || !ok(marketingCosts) || marketingCosts <= 0) return null
  return (contribution - marketingCosts) / marketingCosts
}
/** Ticket médio: receita / pedidos (vendas) únicos. */
export const ticket = (revenue: N, orders: N) => div(revenue, orders)
/** Taxa genérica: parte / total (conversão, atendimento, qualificação, abertura, clique). */
export const rate = (part: N, total: N) => div(part, total)

/** Variação contra o período anterior: (atual − anterior) / anterior. Sem base (anterior nulo ou zero): null. */
export function variation(now: N, before: N): number | null {
  if (!ok(now) || !ok(before) || before === 0) return null
  return (now - before) / Math.abs(before)
}

/**
 * Tendência da série pela inclinação da reta (mínimos quadrados), relativa à média.
 * Precisa de 3 pontos com valor e média diferente de zero; abaixo de 5% por período é "estável".
 */
export function trend(series: N[]): 'alta' | 'queda' | 'estavel' | null {
  const pts = series.map((y, x) => ({ x, y })).filter((p): p is { x: number; y: number } => ok(p.y))
  if (pts.length < 3) return null
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  if (my === 0) return null
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  const rel = slope / Math.abs(my)
  return Math.abs(rel) < 0.05 ? 'estavel' : rel > 0 ? 'alta' : 'queda'
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Documentação das fórmulas, mostrada na tela ao lado de cada indicador. */
export const FORMULAS = {
  investimento: 'Soma do investimento das plataformas de mídia conectadas no período (cada dia e campanha conta uma vez).',
  investimentoPlataforma: 'Investimento separado por plataforma de mídia.',
  leads: 'Pessoas diferentes que entraram no Pré-Vendas no período (o mesmo lead com vários atendimentos conta uma vez).',
  qualificados: 'Leads que atendem à regra de qualificação escolhida em Integrações e Configurações.',
  oportunidades: 'Leads com retorno do vendedor ("Retornou: Sim") ou com venda.',
  vendas: 'Atendimentos com "Venda: Sim" na data da venda, mais os pedidos pagos da loja virtual que não são a mesma compra.',
  faturamento: 'Soma do valor das vendas acima (valor informado no atendimento e total do pedido pago da loja).',
  cpl: 'Investimento em mídia ÷ leads únicos atribuídos às mídias com custo conhecido.',
  cplQualificado: 'Investimento em mídia ÷ leads qualificados únicos atribuídos às mídias com custo conhecido.',
  cac: 'Investimento em mídia ÷ clientes novos (primeira compra) atribuídos às mídias com custo conhecido. Considera só o custo de mídia.',
  conversao: 'Leads do período que compraram ÷ leads do período.',
  roas: 'Receita atribuída às mídias com custo conhecido ÷ investimento nessas mídias. É um múltiplo, não é ROI.',
  roi: '(Contribuição atribuída − custos de marketing) ÷ custos de marketing. Precisa da margem de contribuição e dos custos fora de mídia.',
  ticket: 'Faturamento ÷ quantidade de vendas únicas.',
  atendidos: 'Leads com algum atendimento (ação de uma pessoa, repasse ao vendedor ou "chamei o cliente") ÷ leads.',
  semAtendimento: 'Leads sem nenhum atendimento registrado ÷ leads.',
  perdidas: 'Oportunidades com "Venda: Não" ÷ oportunidades.',
  ctr: 'Cliques ÷ impressões.',
  cpc: 'Investimento ÷ cliques.',
  cpm: 'Investimento ÷ impressões × 1.000.',
  aberturaEmail: 'Aberturas registradas ÷ e-mails entregues. Alguns programas (Apple Mail, antivírus) abrem as imagens sozinhos, então a abertura registrada não é leitura real.',
  cliqueEmail: 'Pessoas que clicaram ÷ e-mails entregues.',
} as const
