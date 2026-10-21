/**
 * Resumo do Marketing Inteligente escrito pela IA (Gemini). A IA recebe só números agregados (plataformas, campanhas,
 * regiões, marcas, tipos de peça e os diagnósticos já calculados), nunca nomes de clientes, telefones, e-mails ou
 * vendedores. Os números vêm prontos: a IA só redige. Funções puras, testadas.
 */
import type { MarketingService } from './marketing.service'

type Analysis = Awaited<ReturnType<MarketingService['analyze']>>

export const AI_SYSTEM = [
  'Você é analista de marketing de uma distribuidora de peças para máquinas pesadas (linha amarela) no Brasil.',
  'Escreva em português do Brasil, direto e profissional, para a diretoria.',
  'Use SOMENTE os números do JSON recebido; não invente valores, percentuais nem causas.',
  'Diga "correlação" quando dois números andarem juntos; nunca afirme causa sem evidência.',
  'Não prometa aumento de vendas ou faturamento.',
  'Formato: até 7 tópicos curtos começando com "- ", do mais importante para o menos, e no fim uma linha "Próximos passos:" com 2 ou 3 ações que dependem de decisão humana.',
].join('\n')

const top = <T extends { name: string }>(list: T[], n: number, pick: (x: T) => Record<string, unknown>) => list.filter((x) => x.name !== 'Não informado').slice(0, n).map((x) => ({ nome: x.name, ...pick(x) }))

/** Só agregados (sem pessoas): o que vai para o Gemini. */
export function aiPayload(d: Analysis) {
  const k = (i: Analysis['now']) => ({
    investimento_midia: i.mediaCost,
    custo_total: i.totalCost,
    leads: i.leads,
    qualificados: i.qualified,
    oportunidades: i.opportunities,
    vendas: i.sales,
    faturamento: i.revenue,
    faturamento_marketing: i.mktRevenue,
    cpl: i.cpl,
    cac: i.cac,
    conversao_pct: i.conversionRate,
    roas: i.roas,
    roi_estimado_pct: i.roi,
    ticket_medio: i.ticket,
    atendidos_pct: i.attendedRate,
    perdidas_pct: i.lostRate,
  })
  const row = (x: Analysis['byCampaign'][number]) => ({ investido: x.mediaCost, leads: x.leads, vendas: x.sales, faturamento: x.revenue, cpl: x.cpl, roas: x.roas, conversao_pct: x.conversionRate })
  return {
    periodo: { de: d.period.from, ate: d.period.to, anterior: { de: d.period.prevFrom, ate: d.period.prevTo } },
    regras: { lead_qualificado: d.rules.qualified, margem_pct: d.rules.marginPct, atribuicao: d.rules.attribution },
    atual: k(d.now),
    anterior: k(d.before),
    plataformas: top(d.byPlatform, 5, row),
    campanhas: top(d.byCampaign, 10, row),
    regioes: top(d.byRegion, 6, row),
    marcas: top(d.byBrand, 8, row),
    tipos_de_peca: top(d.byPartType, 8, row),
    funil: d.funnel.steps.map((s) => ({ etapa: s.label, volume: s.value, passagem_pct: s.rate })),
    diagnosticos: d.recommendations.map((r) => ({ problema: r.problem, evidencia: r.evidence, prioridade: r.priority, confianca: r.confidence })),
    qualidade: { leads_google_com_campanha: d.quality.googleWithCampaign, leads_google: d.quality.googleLeads },
  }
}

export function aiPrompt(d: Analysis) {
  return `Resuma o desempenho de marketing e vendas do período, comparando com o anterior, e aponte o que pede atenção.\n\nDados (JSON):\n${JSON.stringify(aiPayload(d))}`
}

/** Limpa a resposta: só texto, sem markdown pesado, até 3.000 caracteres. */
export function cleanAiText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[ \t]*[*•][ \t]+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000)
}
