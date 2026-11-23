/**
 * Análise de mercado (fora dos marketplaces): o retrato interno do CRM (canais de venda, marcas e produtos que mais
 * saem, regiões dos leads) e a leitura da IA com a pesquisa do Google: produtos em alta no segmento, concorrentes,
 * comparação de canais, pontos a melhorar, de atenção e oportunidades. Funções puras, testadas em
 * test/mercado.spec.ts. Para a IA vão só números agregados: nunca nomes de clientes, telefones ou e-mails.
 */

export const CONFIG_KEY = 'mercado_analise'
export const PERIOD_DAYS = 90
/** Análise parada há mais que isso (servidor reiniciou no meio) vira erro. */
export const STALE_MS = 20 * 60_000

export interface MarketConfig {
  /** Nome da empresa como o mercado conhece. */
  company: string
  /** O que a empresa vende e para quem. */
  segment: string
  /** Onde atua. */
  region: string
  /** Concorrentes que já conhece (nome ou site), para a IA olhar com atenção. */
  competitors: string[]
  /** Algo específico para a análise olhar (ex.: uma linha de produtos, uma região nova). */
  focus: string
}

export const DEFAULT_CONFIG: MarketConfig = { company: '', segment: '', region: 'Brasil', competitors: [], focus: '' }

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function cleanConfig(raw: Partial<Record<keyof MarketConfig, unknown>>, cur: MarketConfig = DEFAULT_CONFIG): MarketConfig {
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.map((x) => txt(x, 120)).filter(Boolean))].slice(0, 15)
      : typeof v === 'string'
        ? [...new Set(v.split(/[\n;,]/).map((x) => txt(x, 120)).filter(Boolean))].slice(0, 15)
        : cur.competitors
  return {
    company: raw.company !== undefined ? txt(raw.company, 120) : cur.company,
    segment: raw.segment !== undefined ? txt(raw.segment, 500) : cur.segment,
    region: raw.region !== undefined ? txt(raw.region, 200) : cur.region,
    competitors: raw.competitors !== undefined ? list(raw.competitors) : cur.competitors,
    focus: raw.focus !== undefined ? txt(raw.focus, 500) : cur.focus,
  }
}

/** Retrato interno dos últimos 90 dias (só agregados). */
export interface InternalSnapshot {
  periodDays: number
  channels: { canal: string; pedidos: number; faturamento: number }[]
  leads: number
  leadStates: { uf: string; leads: number }[]
  topBrands: { marca: string; unidades: number }[]
  topProducts: { produto: string; unidades: number; canal: string }[]
}

const MARKETPLACE_NAMES: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', tiktok: 'TikTok Shop', magalu: 'Magalu' }
export const marketplaceName = (k: string) => MARKETPLACE_NAMES[k] ?? k

export interface AiReading {
  resumo: string
  produtos: { titulo: string; detalhe: string }[]
  concorrentes: { nome: string; site: string | null; detalhe: string }[]
  canais: { canal: string; detalhe: string }[]
  melhorar: { titulo: string; detalhe: string }[]
  atencao: { titulo: string; detalhe: string }[]
  oportunidades: { titulo: string; detalhe: string }[]
}

/** Pedido à IA com pesquisa na web. */
export function aiPrompt(s: InternalSnapshot, c: MarketConfig, today: string) {
  const interno = {
    periodo_dias: s.periodDays,
    canais_de_venda: s.channels,
    leads_no_periodo: s.leads,
    estados_com_mais_leads: s.leadStates,
    marcas_mais_vendidas_na_loja_virtual: s.topBrands,
    produtos_mais_vendidos: s.topProducts,
  }
  return `Você é analista de mercado de uma empresa brasileira. Hoje é ${today}.
Empresa: ${c.company || 'não informada'}.
Segmento: ${c.segment}.
Região de atuação: ${c.region || 'Brasil'}.
${c.competitors.length ? `Concorrentes que a empresa já conhece: ${c.competitors.join('; ')}.\n` : ''}${c.focus ? `Foco pedido para esta análise: ${c.focus}.\n` : ''}
Números internos da empresa (CRM, últimos ${s.periodDays} dias; só totais, sem clientes):
${JSON.stringify(interno)}

Pesquise na web (Google) o mercado deste segmento FORA dos marketplaces: demanda e tendências do setor no Brasil e na região, sazonalidade, notícias (obras, agro, mineração, crédito, câmbio, importação), produtos e linhas mais procurados, quem são os concorrentes (distribuidores, importadoras, lojas virtuais, fabricantes que vendem direto) e como se posicionam, e em quais canais o cliente desse segmento compra (loja virtual própria, WhatsApp e vendedores, representantes, balcão, marketplaces).

Regras:
- Português do Brasil, direto, para o dono da empresa.
- Não invente números, preços, faturamento nem fatos. Afirmação vinda da pesquisa precisa ter fonte; se não achou, diga que não achou.
- Não cite preços de concorrentes. Não faça promessa de vendas.
- "produtos": linhas e produtos em alta no segmento, e se a empresa parece cobrir (pelos números internos).
- "concorrentes": até 8, com nome, site (se achou) e como se posicionam (canais, foco, diferencial). Sem dados pessoais.
- "canais": compare os canais (os da empresa e os do mercado): onde a empresa está forte, fraca e onde vale crescer.
- "melhorar", "atencao", "oportunidades": de 3 a 6 itens cada, título curto e detalhe de 1 a 3 frases.

Responda SOMENTE com JSON:
{"resumo": "...", "produtos": [{"titulo": "...", "detalhe": "..."}], "concorrentes": [{"nome": "...", "site": "https://... ou null", "detalhe": "..."}], "canais": [{"canal": "...", "detalhe": "..."}], "melhorar": [{"titulo": "...", "detalhe": "..."}], "atencao": [...], "oportunidades": [...]}`
}

const pairs = (v: unknown, a: string, b: string, max = 8) =>
  (Array.isArray(v) ? v : [])
    .map((x) => ({ k: txt((x as Record<string, unknown>)?.[a], 160), d: txt((x as Record<string, unknown>)?.[b], 800) }))
    .filter((x) => x.k)
    .slice(0, max)

/** Leitura da IA (JSON solto no texto ou em bloco de código); null se não veio no formato. */
export function readingFromAi(text: string): AiReading | null {
  const json = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let d: Record<string, unknown>
  try {
    d = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const items = (v: unknown) => pairs(v, 'titulo', 'detalhe').map((x) => ({ titulo: x.k, detalhe: x.d }))
  const concorrentes = (Array.isArray(d.concorrentes) ? d.concorrentes : [])
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      const site = txt(o.site, 200)
      return { nome: txt(o.nome, 120), site: /^https?:\/\/[^\s]+\.[^\s]+/.test(site) ? site : null, detalhe: txt(o.detalhe, 800) }
    })
    .filter((x) => x.nome)
    .slice(0, 10)
  const r: AiReading = {
    resumo: txt(d.resumo, 2000),
    produtos: items(d.produtos),
    concorrentes,
    canais: pairs(d.canais, 'canal', 'detalhe').map((x) => ({ canal: x.k, detalhe: x.d })),
    melhorar: items(d.melhorar),
    atencao: items(d.atencao),
    oportunidades: items(d.oportunidades),
  }
  return r.resumo || r.melhorar.length || r.produtos.length ? r : null
}
