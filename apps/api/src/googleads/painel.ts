/**
 * Painel do Google Ads: investimento (vindo do script do Google Ads) cruzado com os contatos e as vendas do CRM.
 * Funções puras: limpeza do que o script manda e as contas do painel.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^\d{1,20}$/
const MAX_ROWS = 5000
const MATCH = new Set(['EXACT', 'PHRASE', 'BROAD'])

export interface CampaignDayRow {
  date: string
  campaignId: string
  campaignName: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
}
export interface KeywordDayRow {
  date: string
  campaignId: string
  adGroupId: string
  criterionId: string
  keyword: string
  matchType: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
}

const text = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, n)
const num = (v: unknown, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null
}

/** Confere o que o script mandou: datas, números de campanha/grupo/palavra, valores não negativos. Linhas ruins são descartadas. */
export function cleanStats(raw: unknown): { campaigns: CampaignDayRow[]; keywords: KeywordDayRow[] } | { error: string } {
  const s = (raw as { stats?: unknown } | null)?.stats as { campaigns?: unknown; keywords?: unknown } | undefined
  if (!s || typeof s !== 'object') return { error: 'Dados de investimento ausentes.' }
  const camp = Array.isArray(s.campaigns) ? s.campaigns : []
  const kw = Array.isArray(s.keywords) ? s.keywords : []
  if (camp.length > MAX_ROWS || kw.length > MAX_ROWS) return { error: 'Linhas demais em um envio (máximo 5.000).' }
  const campaigns: CampaignDayRow[] = []
  for (const r of camp as Record<string, unknown>[]) {
    const date = String(r?.d ?? '')
    const campaignId = String(r?.c ?? '')
    const cost = num(r?.cost, 1e9)
    const clicks = num(r?.cl, 1e9)
    const impressions = num(r?.im, 1e10)
    const conversions = num(r?.cv, 1e9)
    if (!DATE.test(date) || !ID.test(campaignId) || cost === null || clicks === null || impressions === null || conversions === null) continue
    campaigns.push({ date, campaignId, campaignName: text(r.n, 160) || `campanha nº ${campaignId}`, cost: round2(cost), clicks: Math.round(clicks), impressions: Math.round(impressions), conversions: round2(conversions) })
  }
  const keywords: KeywordDayRow[] = []
  for (const r of kw as Record<string, unknown>[]) {
    const date = String(r?.d ?? '')
    const campaignId = String(r?.c ?? '')
    const adGroupId = String(r?.g ?? '')
    const criterionId = String(r?.k ?? '')
    const keyword = text(r?.t, 200)
    const matchType = MATCH.has(String(r?.m)) ? String(r?.m) : 'BROAD'
    const cost = num(r?.cost, 1e9)
    const clicks = num(r?.cl, 1e9)
    const impressions = num(r?.im, 1e10)
    const conversions = num(r?.cv, 1e9)
    if (!DATE.test(date) || !ID.test(campaignId) || !ID.test(adGroupId) || !ID.test(criterionId) || !keyword || cost === null || clicks === null || impressions === null || conversions === null) continue
    keywords.push({ date, campaignId, adGroupId, criterionId, keyword, matchType, cost: round2(cost), clicks: Math.round(clicks), impressions: Math.round(impressions), conversions: round2(conversions) })
  }
  return { campaigns, keywords }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Palavra-chave para cruzar o link (utm_term={keyword}) com a do Google: minúscula, sem [ ] " +. */
export function keywordKey(k: string | null | undefined) {
  return (k ?? '')
    .toLowerCase()
    .replace(/[[\]"+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Indicadores de uma linha: custo por clique, por lead e por venda, conversão e retorno (ROAS). */
export function ratios(r: { cost: number; clicks: number; leads: number; sales: number; revenue: number }) {
  const div = (a: number, b: number) => (b > 0 ? a / b : null)
  return {
    cpc: div(r.cost, r.clicks),
    costPerLead: r.cost > 0 ? div(r.cost, r.leads) : null,
    costPerSale: r.cost > 0 ? div(r.cost, r.sales) : null,
    conversionRate: div(r.sales, r.leads),
    roas: div(r.revenue, r.cost),
  }
}

/** Período do painel: datas "aaaa-mm-dd" (padrão: últimos 30 dias, até hoje, no horário de Brasília). */
export function panelPeriod(from?: string, to?: string) {
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  const t = to && DATE.test(to) ? to : today
  const f = from && DATE.test(from) ? from : new Date(Date.parse(`${t}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  if (f > t) return { from: t, to: f }
  // Até 400 dias por consulta.
  const min = new Date(Date.parse(`${t}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10)
  return { from: f < min ? min : f, to: t }
}

/**
 * Script do Google Ads (Ferramentas → Ações em massa → Scripts), programado para rodar 1 vez por dia:
 * manda ao CRM o número e o nome das campanhas e o investimento dos últimos 35 dias por dia, campanha e palavra-chave.
 */
export function adsScript(url: string) {
  return `/** CRM Usaparts: envia ao CRM as campanhas (número e nome), o investimento por dia, campanha e palavra-chave e os
 *  detalhes (termos de pesquisa, dispositivo, rede, região, anúncios, grupos, páginas de destino e tipo de campanha)
 *  dos últimos 35 dias. Programe para rodar 1 vez por dia ou de hora em hora. Só lê a conta; não altera nada. */
var CRM = '${url}';
function main() {
  var lista = [];
  var fontes = ['campaigns', 'performanceMaxCampaigns', 'shoppingCampaigns', 'videoCampaigns'];
  for (var i = 0; i < fontes.length; i++) {
    try {
      var it = AdsApp[fontes[i]]().get();
      while (it.hasNext()) { var c = it.next(); lista.push({ id: String(c.getId()), name: c.getName() }); }
    } catch (e) { Logger.log('Pulando ' + fontes[i] + ': ' + e); }
  }
  enviar({ campaigns: lista }, lista.length + ' campanhas');

  var tz = AdsApp.currentAccount().getTimeZone();
  var hoje = new Date();
  var de = Utilities.formatDate(new Date(hoje.getTime() - 34 * 86400000), tz, 'yyyy-MM-dd');
  var ate = Utilities.formatDate(hoje, tz, 'yyyy-MM-dd');
  var periodo = " WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "' AND metrics.impressions > 0";
  var m = function (r) { return { cost: Number(r.metrics.costMicros || 0) / 1000000, cl: Number(r.metrics.clicks || 0), im: Number(r.metrics.impressions || 0), cv: Number(r.metrics.conversions || 0) }; };

  var camp = [];
  var rc = AdsApp.search('SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign' + periodo);
  while (rc.hasNext()) { var r = rc.next(); var x = m(r); x.d = r.segments.date; x.c = String(r.campaign.id); x.n = r.campaign.name; camp.push(x); }
  partes(camp, function (p) { return { stats: { from: de, to: ate, campaigns: p } }; }, 'dias de campanha');

  var kw = [];
  try {
    var rk = AdsApp.search('SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM keyword_view' + periodo);
    while (rk.hasNext()) { var k = rk.next(); var y = m(k); y.d = k.segments.date; y.c = String(k.campaign.id); y.g = String(k.adGroup.id); y.k = String(k.adGroupCriterion.criterionId); y.t = k.adGroupCriterion.keyword.text; y.m = k.adGroupCriterion.keyword.matchType; kw.push(y); }
  } catch (e) { Logger.log('Sem palavras-chave: ' + e); }
  partes(kw, function (p) { return { stats: { from: de, to: ate, keywords: p } }; }, 'dias de palavra-chave');

  // Detalhes para o Marketing Inteligente (cada consulta separada: se uma não existir na conta, as outras seguem).
  var det = [];
  var pega = function (nome, gaql, linha) {
    try {
      var it = AdsApp.search(gaql + periodo);
      while (it.hasNext()) { var r = it.next(); var x = m(r); x.d = r.segments.date; x.c = String(r.campaign.id); x.val = Number(r.metrics.conversionsValue || 0); linha(r, x); det.push(x); }
    } catch (e) { Logger.log('Sem ' + nome + ': ' + e); }
  };
  var mv = ', metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value';
  pega('tipo de campanha', 'SELECT segments.date, campaign.id, campaign.advertising_channel_type, metrics.search_impression_share' + mv + ' FROM campaign', function (r, x) { x.dim = 'type'; x.k = String(r.campaign.advertisingChannelType); x.l = x.k; var s = Number(r.metrics.searchImpressionShare); if (s > 0 && s <= 1) x.is = s; });
  pega('dispositivo', 'SELECT segments.date, campaign.id, segments.device' + mv + ' FROM campaign', function (r, x) { x.dim = 'device'; x.k = String(r.segments.device); x.l = x.k; });
  pega('rede', 'SELECT segments.date, campaign.id, segments.ad_network_type' + mv + ' FROM campaign', function (r, x) { x.dim = 'network'; x.k = String(r.segments.adNetworkType); x.l = x.k; });
  pega('grupo de anúncios', 'SELECT segments.date, campaign.id, ad_group.id, ad_group.name' + mv + ' FROM ad_group', function (r, x) { x.dim = 'adgroup'; x.k = String(r.adGroup.id); x.l = r.adGroup.name; });
  pega('anúncio', 'SELECT segments.date, campaign.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group.name' + mv + ' FROM ad_group_ad', function (r, x) { x.dim = 'ad'; x.k = String(r.adGroupAd.ad.id); x.l = (r.adGroupAd.ad.name || r.adGroup.name + ' · ' + r.adGroupAd.ad.type); });
  pega('página de destino', 'SELECT segments.date, campaign.id, landing_page_view.unexpanded_final_url' + mv + ' FROM landing_page_view', function (r, x) { x.dim = 'landing'; x.k = String(r.landingPageView.unexpandedFinalUrl); x.l = x.k; });
  var regioes = [];
  pega('região', 'SELECT segments.date, campaign.id, segments.geo_target_region' + mv + ' FROM geographic_view', function (r, x) { x.dim = 'region'; x.k = String(r.segments.geoTargetRegion || '').replace('geoTargetConstants/', ''); x.l = x.k; if (x.k && regioes.indexOf(x.k) < 0) regioes.push(x.k); });
  if (regioes.length) {
    try {
      var nomes = {};
      var rg = AdsApp.search('SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (' + regioes.slice(0, 500).join(',') + ')');
      while (rg.hasNext()) { var g = rg.next(); nomes[String(g.geoTargetConstant.id)] = g.geoTargetConstant.name; }
      for (var j = 0; j < det.length; j++) if (det[j].dim === 'region' && nomes[det[j].k]) det[j].l = nomes[det[j].k];
    } catch (e) { Logger.log('Sem nomes das regiões: ' + e); }
  }
  partes(det, function (p) { return { detail: { from: de, to: ate, rows: p } }; }, 'linhas de detalhe');

  var termos = [];
  try {
    var rt = AdsApp.search('SELECT segments.date, campaign.id, ad_group.id, search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM search_term_view' + periodo + ' AND metrics.clicks > 0');
    while (rt.hasNext()) { var t = rt.next(); var z = m(t); z.d = t.segments.date; z.c = String(t.campaign.id); z.g = String(t.adGroup.id); z.t = t.searchTermView.searchTerm; termos.push(z); }
  } catch (e) { Logger.log('Sem termos de pesquisa: ' + e); }
  partes(termos, function (p) { return { terms: { from: de, to: ate, rows: p } }; }, 'termos de pesquisa');
}
function partes(linhas, corpo, nome) {
  for (var i = 0; i < linhas.length; i += 3000) { enviar(corpo(linhas.slice(i, i + 3000)), Math.min(3000, linhas.length - i) + ' ' + nome); Utilities.sleep(4000); }
}
function enviar(corpo, nome) {
  var r = UrlFetchApp.fetch(CRM, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true });
  Logger.log('CRM respondeu ' + r.getResponseCode() + ' (' + nome + '): ' + r.getContentText());
}
`
}

/** Saldo pré-pago do Google Ads (Pix/boleto): o Google não informa pela API, então o CRM estima. */
export interface BalanceState {
  /** Saldo informado (como aparece no Google Ads) e o gasto já conhecido, a partir daquele dia, naquele momento. */
  anchor?: { amount: number; at: string; date: string; knownCost: number; by?: string }
  /** Recargas registradas depois do saldo informado (valor creditado no Google, já sem impostos). */
  deposits: { id: string; amount: number; at: string; note?: string; by?: string }[]
  /** Avisar quando o saldo durar menos que estes dias. */
  alertDays: number
  alertEmails: string[]
  lastAlertAt?: string | null
}
export const DEFAULT_BALANCE: BalanceState = { deposits: [], alertDays: 5, alertEmails: [] }

/**
 * Saldo estimado = saldo informado + recargas depois dele - gasto desde então.
 * costFromAnchorDate: gasto (do script) a partir do dia do saldo informado, inclusive; o que já era conhecido no momento
 * do saldo informado não conta de novo. last7: gasto de cada um dos últimos 7 dias completos (média diária).
 */
export function estimateBalance(s: BalanceState, costFromAnchorDate: number, last7: number[]) {
  if (!s.anchor) return null
  const anchorAt = Date.parse(s.anchor.at)
  const spent = round2(Math.max(0, costFromAnchorDate - s.anchor.knownCost))
  const deposits = round2(s.deposits.filter((d) => Date.parse(d.at) > anchorAt).reduce((a, d) => a + d.amount, 0))
  const balance = round2(s.anchor.amount + deposits - spent)
  const avgDaily = last7.length ? round2(last7.reduce((a, v) => a + v, 0) / 7) : null
  const daysLeft = avgDaily && avgDaily > 0 ? Math.max(0, balance) / avgDaily : null
  const low = balance <= 0 || (daysLeft !== null && daysLeft < s.alertDays)
  return { balance, spent, deposits, avgDaily, daysLeft, low, anchor: s.anchor }
}
