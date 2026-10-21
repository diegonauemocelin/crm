/**
 * Recomendações do Marketing Inteligente: regras que olham os números do período e do anterior e dizem
 * o que conferir, com a evidência (os números usados e a fonte). Nada é aplicado sozinho: são sugestões para
 * uma pessoa avaliar. Correlação é apresentada como correlação, nunca como causa.
 * Funções puras (testadas em test/marketing.spec.ts).
 */
import { delta, type Indicators } from './metricas'

export type Priority = 'alta' | 'media' | 'baixa'
export type Confidence = 'alta' | 'media' | 'baixa'

export interface Recommendation {
  id: string
  area: 'Mídia paga' | 'Comercial' | 'Dados' | 'Regiões' | 'Resultado'
  priority: Priority
  confidence: Confidence
  problem: string
  evidence: string[]
  impact: string
  action: string
  metric: string
  validate: string
  source: string
}

interface Row {
  key: string
  name: string
  leads: number
  sales: number
  revenue: number
  mediaCost: number
  conversionRate: number | null
  cpl: number | null
}

export interface RecInput {
  period: { from: string; to: string; prevFrom: string; prevTo: string }
  now: Indicators
  before: Indicators
  campaigns: Row[]
  states: Row[]
  sellers: Row[]
  /** Atendimentos de anúncio do Google sem campanha identificada / total de atendimentos de anúncio do Google. */
  googleWithoutCampaign: { without: number; total: number }
  forwardMedianHours: number | null
  forwardSample: number
  costStaleHours: number | null
  /** Termos de pesquisa sugeridos para negativar (custo somado e quantos). */
  negativeTerms?: { count: number; cost: number; examples: string[] }
  /** Anúncios (Meta/TikTok) com sinais de cansaço. */
  fatigued?: { name: string; reasons: string[] }[]
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const pc = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const confidenceOf = (n: number): Confidence => (n >= 50 ? 'alta' : n >= 20 ? 'media' : 'baixa')
/** Abaixo disto a regra nem roda: amostra pequena demais para dizer algo. */
export const MIN_SAMPLE = 10

export function recommendations(x: RecInput): Recommendation[] {
  const out: Recommendation[] = []
  const crm = 'Pré-Vendas do CRM'
  const ads = 'Google Ads (script) + Pré-Vendas do CRM'

  // 1. CPL subiu.
  const cplDelta = delta(x.now.cpl, x.before.cpl)
  if (cplDelta !== null && cplDelta >= 25 && x.now.leads >= MIN_SAMPLE && x.before.leads >= MIN_SAMPLE) {
    out.push({
      id: 'cpl-subiu',
      area: 'Mídia paga',
      priority: cplDelta >= 50 ? 'alta' : 'media',
      confidence: confidenceOf(Math.min(x.now.leads, x.before.leads)),
      problem: `O custo por lead subiu ${pc(cplDelta)}.`,
      evidence: [`CPL: ${brl(x.before.cpl!)} → ${brl(x.now.cpl!)}`, `Investimento em mídia: ${brl(x.before.mediaCost)} → ${brl(x.now.mediaCost)}`, `Leads: ${x.before.leads} → ${x.now.leads}`],
      impact: 'Mais investimento para cada contato; se a conversão em venda não subir junto, o retorno cai.',
      action: 'Abrir as campanhas com maior alta de custo, conferir termos de pesquisa, lances e páginas de destino.',
      metric: 'CPL do próximo período',
      validate: 'Comparar o CPL das 2 semanas seguintes com o deste período, com o mesmo filtro.',
      source: ads,
    })
  }

  // 2. Campanha com investimento e nenhum lead.
  const totalCost = x.now.mediaCost
  for (const c of x.campaigns) {
    if (c.key === '-' || c.leads > 0 || c.mediaCost < Math.max(100, totalCost * 0.05)) continue
    out.push({
      id: `campanha-sem-lead-${c.key}`,
      area: 'Mídia paga',
      priority: c.mediaCost >= totalCost * 0.15 ? 'alta' : 'media',
      confidence: 'media',
      problem: `“${c.name}” investiu e não gerou nenhum lead no CRM.`,
      evidence: [`Investimento: ${brl(c.mediaCost)} (${pc((c.mediaCost / totalCost) * 100)} do total)`, 'Leads no Pré-Vendas: 0'],
      impact: 'Investimento sem retorno comercial identificado.',
      action: 'Conferir se o anúncio leva ao formulário/WhatsApp certo e se o link mantém o identificador do clique (gclid/UTM). Se estiver tudo certo, revisar a segmentação.',
      metric: 'Leads da campanha',
      validate: 'Ver se a campanha passa a gerar leads nos próximos 7 dias depois da correção.',
      source: ads,
    })
  }

  // 3. Campanha com leads e sem venda (quando o resto vende).
  const avgConv = x.now.conversionRate ?? 0
  for (const c of x.campaigns) {
    if (c.key === '-' || c.leads < 15 || c.sales > 0 || avgConv <= 0) continue
    out.push({
      id: `campanha-sem-venda-${c.key}`,
      area: 'Mídia paga',
      priority: c.mediaCost >= totalCost * 0.1 ? 'alta' : 'media',
      confidence: confidenceOf(c.leads),
      problem: `“${c.name}” trouxe ${c.leads} leads e nenhuma venda.`,
      evidence: [`Leads: ${c.leads}`, 'Vendas: 0', `Conversão média do período: ${pc(avgConv)}`, ...(c.mediaCost ? [`Investimento: ${brl(c.mediaCost)}`] : [])],
      impact: 'Leads que não viram venda: pode ser público fora do perfil ou atendimento que não avançou.',
      action: 'Ler os motivos de perda desses atendimentos e o tipo de peça pedido; ajustar palavras-chave/público se o lead não for o cliente da Usaparts.',
      metric: 'Taxa de conversão da campanha',
      validate: 'Acompanhar as vendas da campanha no próximo período.',
      source: ads,
    })
  }

  // 4. Leads sem atendimento.
  const notAttended = x.now.leads - x.now.attended
  if (x.now.leads >= MIN_SAMPLE && notAttended >= 5 && (x.now.notAttendedRate ?? 0) >= 10) {
    out.push({
      id: 'leads-sem-atendimento',
      area: 'Comercial',
      priority: (x.now.notAttendedRate ?? 0) >= 25 ? 'alta' : 'media',
      confidence: confidenceOf(x.now.leads),
      problem: `${notAttended} leads (${pc(x.now.notAttendedRate)}) ainda estão sem atendimento.`,
      evidence: [`Leads: ${x.now.leads}`, `Atendidos: ${x.now.attended}`],
      impact: 'Contato pago que esfria antes de ser atendido.',
      action: 'Abrir o Pré-Vendas filtrando "sem atendimento" e distribuir para a equipe; conferir os prazos e alertas do atendimento.',
      metric: 'Percentual de leads atendidos',
      validate: 'O percentual de atendidos do próximo período deve subir.',
      source: crm,
    })
  }

  // 5. Demora para repassar ao vendedor.
  if (x.forwardMedianHours !== null && x.forwardSample >= MIN_SAMPLE && x.forwardMedianHours > 24) {
    out.push({
      id: 'demora-repasse',
      area: 'Comercial',
      priority: x.forwardMedianHours > 72 ? 'alta' : 'media',
      confidence: confidenceOf(x.forwardSample),
      problem: `Metade dos leads leva mais de ${Math.round(x.forwardMedianHours)} horas para ser repassada ao vendedor.`,
      evidence: [`Mediana até o repasse: ${Math.round(x.forwardMedianHours)} h`, `Atendimentos medidos: ${x.forwardSample}`],
      impact: 'Quanto mais o lead espera, maior a chance de comprar em outro lugar (relação observada no mercado; confira nos seus números).',
      action: 'Rever a fila do Pré-Vendas e o prazo de "retorno do vendedor" em Configurações › Prazos e alertas.',
      metric: 'Mediana de horas até o repasse',
      validate: 'Comparar a mediana do próximo mês e a taxa de conversão dos leads repassados em até 24 h.',
      source: crm,
    })
  }

  // 6. Regiões com conversão bem acima da média (correlação).
  for (const s of x.states) {
    if (s.key === '-' || s.leads < 15 || avgConv <= 0 || (s.conversionRate ?? 0) < avgConv * 1.5) continue
    out.push({
      id: `estado-converte-${s.key}`,
      area: 'Regiões',
      priority: 'baixa',
      confidence: confidenceOf(s.leads),
      problem: `${s.name} converte ${pc(s.conversionRate)} dos leads, bem acima da média (${pc(avgConv)}).`,
      evidence: [`Leads: ${s.leads}`, `Vendas: ${s.sales}`, `Faturamento: ${brl(s.revenue)}`],
      impact: 'Oportunidade: o estado responde melhor. É uma correlação, não prova de que mais investimento lá trará mais vendas.',
      action: 'Avaliar um teste de reforço de orçamento/segmentação para o estado, com período e meta definidos.',
      metric: 'Leads e vendas do estado',
      validate: 'Comparar CPL e conversão do estado antes e depois do teste.',
      source: crm,
    })
  }

  // 7. Vendedor com conversão bem abaixo da média.
  for (const s of x.sellers) {
    if (s.key === '-' || s.leads < 15 || avgConv <= 0 || (s.conversionRate ?? 0) > avgConv * 0.5) continue
    out.push({
      id: `vendedor-converte-pouco-${s.key}`,
      area: 'Comercial',
      priority: 'media',
      confidence: confidenceOf(s.leads),
      problem: `${s.name} converte ${pc(s.conversionRate)} dos leads, menos da metade da média (${pc(avgConv)}).`,
      evidence: [`Leads: ${s.leads}`, `Vendas: ${s.sales}`],
      impact: 'Pode ser mix diferente de leads (marca, região, tipo de peça) ou atendimento: confira antes de concluir.',
      action: 'Comparar os leads desse vendedor com os dos outros (origem, marca, tipo de peça) e os motivos de perda.',
      metric: 'Conversão do vendedor',
      validate: 'Acompanhar a conversão nos próximos 30 dias.',
      source: crm,
    })
  }

  // 8. Leads de anúncio sem campanha identificada.
  const g = x.googleWithoutCampaign
  if (g.total >= MIN_SAMPLE && g.without / g.total >= 0.2) {
    out.push({
      id: 'leads-sem-campanha',
      area: 'Dados',
      priority: g.without / g.total >= 0.4 ? 'alta' : 'media',
      confidence: confidenceOf(g.total),
      problem: `${pc((g.without / g.total) * 100)} dos leads do Google Ads não têm a campanha identificada.`,
      evidence: [`Sem campanha: ${g.without} de ${g.total}`],
      impact: 'Sem a campanha, o custo por lead e o retorno de cada campanha ficam incompletos.',
      action: 'Conferir a marcação automática (gclid) no Google Ads e se os formulários, botões de WhatsApp e LPs mantêm os parâmetros do link (utm_campaign={campaignid}).',
      metric: 'Percentual de leads com campanha',
      validate: 'O percentual de leads sem campanha deve cair no próximo período.',
      source: crm,
    })
  }

  // 9. Queda de faturamento.
  const revDelta = delta(x.now.revenue, x.before.revenue)
  if (revDelta !== null && revDelta <= -30 && x.before.sales >= 5) {
    out.push({
      id: 'faturamento-caiu',
      area: 'Resultado',
      priority: 'alta',
      confidence: confidenceOf(x.before.sales + x.now.sales),
      problem: `O faturamento do Pré-Vendas caiu ${pc(Math.abs(revDelta))}.`,
      evidence: [`Faturamento: ${brl(x.before.revenue)} → ${brl(x.now.revenue)}`, `Vendas: ${x.before.sales} → ${x.now.sales}`, `Leads: ${x.before.leads} → ${x.now.leads}`],
      impact: 'Menos receita no período. Veja se a queda vem de menos leads ou de menos conversão.',
      action: x.now.leads < x.before.leads ? 'Os leads também caíram: revisar o investimento e as campanhas.' : 'Os leads se mantiveram: revisar o atendimento e os motivos de perda.',
      metric: 'Faturamento e conversão',
      validate: 'Comparar o próximo período com o mesmo filtro.',
      source: crm,
    })
  }

  // 10. Investimento desatualizado.
  if (x.costStaleHours !== null && x.costStaleHours > 36) {
    out.push({
      id: 'investimento-desatualizado',
      area: 'Dados',
      priority: 'alta',
      confidence: 'alta',
      problem: `O investimento do Google Ads não atualiza há ${Math.round(x.costStaleHours / 24)} dia(s).`,
      evidence: [`Última atualização: há ${Math.round(x.costStaleHours)} h`],
      impact: 'CPL, ROAS e custo por venda ficam errados enquanto o investimento não chega.',
      action: 'No Google Ads, em Ferramentas › Scripts, conferir se o script do CRM está programado e sem erro.',
      metric: 'Data da última atualização do investimento',
      validate: 'O aviso some quando o investimento volta a atualizar.',
      source: 'Configurações › Google Ads',
    })
  }

  // 11. Termos de pesquisa com gasto e sem conversão (sugestão de negativas, para revisão).
  const nt = x.negativeTerms
  if (nt && nt.count >= 3 && nt.cost >= 50) {
    out.push({
      id: 'termos-negativos',
      area: 'Mídia paga',
      priority: nt.cost >= x.now.mediaCost * 0.1 ? 'alta' : 'media',
      confidence: nt.count >= 10 ? 'media' : 'baixa',
      problem: `${nt.count} termos de pesquisa gastaram ${brl(nt.cost)} sem conversão.`,
      evidence: [`Exemplos: ${nt.examples.slice(0, 5).join(', ')}`, `Investimento em mídia no período: ${brl(x.now.mediaCost)}`],
      impact: 'Verba indo para buscas que não viram contato. Negativar o que não é cliente libera investimento para os termos que trazem venda.',
      action: 'Revisar a lista em Marketing Inteligente › Google Ads › Termos de pesquisa, marcar o que negativar e aplicar no Google Ads (o CRM não altera a conta).',
      metric: 'Custo dos termos sem conversão',
      validate: 'Comparar o gasto em termos sem conversão e o CPL nas 2 semanas seguintes.',
      source: 'Google Ads (script ampliado)',
    })
  }

  // 12. Anúncios cansados (CTR caindo, custo subindo ou frequência alta).
  for (const f of (x.fatigued ?? []).slice(0, 5)) {
    out.push({
      id: `anuncio-cansado-${f.name}`,
      area: 'Mídia paga',
      priority: 'media',
      confidence: 'media',
      problem: `O anúncio “${f.name}” mostra sinais de cansaço.`,
      evidence: f.reasons,
      impact: 'Quando o público já viu muitas vezes, o anúncio rende menos e o custo sobe.',
      action: 'Testar um criativo novo (imagem, vídeo ou texto) ou ampliar o público; manter o atual até o novo provar resultado.',
      metric: 'CTR e custo por resultado do anúncio',
      validate: 'Comparar o criativo novo com o atual por 7 dias, com o mesmo orçamento.',
      source: 'Meta/TikTok Ads (sincronizado)',
    })
  }

  const order = { alta: 0, media: 1, baixa: 2 }
  return out.sort((a, b) => order[a.priority] - order[b.priority] || order[a.confidence] - order[b.confidence])
}

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
