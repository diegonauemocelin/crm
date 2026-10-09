/**
 * Criador de relatórios: fontes de dados, campos (dimensões) e métricas permitidos.
 * Todo SQL vem desta lista fixa; o que o usuário escolhe são só chaves, e os valores de filtro vão como parâmetros.
 * Funções puras (testadas em test/relatorios.spec.ts).
 */
import { UFS } from '../atendimento/br'
import { Prisma } from '../generated/prisma/client'

export type Scope = 'OWN' | 'UNIT' | 'ALL'
export type Format = 'int' | 'brl' | 'pct' | 'num'

export interface Dimension {
  key: string
  label: string
  /** Expressão SQL (constante) do valor agrupado. */
  sql: string
  /** Junções que a expressão precisa (chaves de `Source.joins`). */
  joins?: string[]
  /** Campo de lista (tags, marcas): um registro conta em cada item. O filtro usa `filterSql` em vez da junção. */
  array?: { join: string; filterSql: string; emptySql: string }
  /** Nome exibido para cada valor guardado (ex.: PRE_VENDAS -> Pré-Vendas). */
  labels?: Record<string, string>
  /** Agrupamento por data (dia, semana, mês): ordena pela data em vez da métrica. */
  time?: boolean
}

export interface Metric {
  key: string
  label: string
  sql: string
  format: Format
  joins?: string[]
}

export interface Source {
  key: string
  label: string
  description: string
  /** Tabela principal (alias t) e, se preciso, junções obrigatórias. */
  from: string
  /** Coluna da empresa (para fontes em que ela fica na tabela ligada). */
  tenant: string
  /** Data que define o período. */
  date: string
  dateLabel: string
  where?: string
  joins: Record<string, string>
  /** Como aplicar "só os próprios" / "só a unidade": pelo lead ligado, pelo atendimento, ou não dá (dados do site). */
  scopedBy: 'lead' | 'record' | 'none'
  dimensions: Dimension[]
  metrics: Metric[]
}

const SP = `'America/Sao_Paulo'`
const local = (col: string) => `((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${SP}`
const timeDims = (col: string): Dimension[] => [
  { key: 'dia', label: 'Dia', sql: `to_char(date_trunc('day', ${local(col)}), 'YYYY-MM-DD')`, time: true },
  { key: 'semana', label: 'Semana', sql: `to_char(date_trunc('week', ${local(col)}), 'YYYY-MM-DD')`, time: true },
  { key: 'mes', label: 'Mês', sql: `to_char(date_trunc('month', ${local(col)}), 'YYYY-MM')`, time: true },
  {
    key: 'dia_semana',
    label: 'Dia da semana',
    sql: `extract(isodow from ${local(col)})::int::text`,
    labels: { '1': 'Segunda', '2': 'Terça', '3': 'Quarta', '4': 'Quinta', '5': 'Sexta', '6': 'Sábado', '7': 'Domingo' },
  },
  { key: 'hora', label: 'Hora do dia', sql: `lpad(extract(hour from ${local(col)})::int::text, 2, '0') || 'h'` },
]

const yesNo = (cond: string) => `CASE WHEN ${cond} THEN 'Sim' ELSE 'Não' END`
const region = (col: string) => {
  const byRegion = new Map<string, string[]>()
  for (const [uf, v] of Object.entries(UFS)) byRegion.set(v.region, [...(byRegion.get(v.region) ?? []), uf])
  return `CASE ${[...byRegion].map(([r, ufs]) => `WHEN ${col} IN (${ufs.map((u) => `'${u}'`).join(',')}) THEN '${r}'`).join(' ')} ELSE NULL END`
}
const ratio = (part: string, total: string) => `(${part})::float8 / nullif(${total}, 0)`
const DEVICE_LABELS = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador', app: 'App' }
const pathOf = (col: string) => `nullif(split_part(${col}, '?', 1), '')`

/** Campos do lead ligado (alias l), reaproveitados nas fontes que têm lead. */
const leadDims = (prefix = 'Lead'): Dimension[] => [
  { key: 'lead_fonte', label: `${prefix}: fonte (1ª conversão)`, sql: `l."firstConversion"->>'source'`, joins: ['lead'] },
  { key: 'lead_meio', label: `${prefix}: meio (1ª conversão)`, sql: `l."firstConversion"->>'medium'`, joins: ['lead'] },
  { key: 'lead_campanha', label: `${prefix}: campanha (1ª conversão)`, sql: `l."firstConversion"->>'campaign'`, joins: ['lead'] },
  {
    key: 'lead_campanha_numero',
    label: `${prefix}: número da campanha do Google Ads`,
    sql: `coalesce(l."lastConversion"->>'campaignId', substring(l."lastConversion"->>'landing' from '[?&]gad_campaignid=([0-9]+)'), l."firstConversion"->>'campaignId', substring(l."firstConversion"->>'landing' from '[?&]gad_campaignid=([0-9]+)'))`,
    joins: ['lead'],
  },
  { key: 'lead_termo', label: `${prefix}: palavra-chave (1ª conversão)`, sql: `l."firstConversion"->>'term'`, joins: ['lead'] },
  { key: 'lead_campanha_ultima', label: `${prefix}: campanha (última conversão)`, sql: `l."lastConversion"->>'campaign'`, joins: ['lead'] },
  {
    key: 'lead_google_ads',
    label: `${prefix}: veio de anúncio do Google`,
    sql: `CASE WHEN l.id IS NULL THEN NULL WHEN (l."firstConversion"->>'landing' ~ '[?&](gclid|gbraid|wbraid)=') OR (l."lastConversion"->>'landing' ~ '[?&](gclid|gbraid|wbraid)=') OR (lower(l."firstConversion"->>'source') = 'google' AND lower(l."firstConversion"->>'medium') IN ('cpc','ppc','paid','cpa','cpm','cpv')) OR (lower(l."lastConversion"->>'source') = 'google' AND lower(l."lastConversion"->>'medium') IN ('cpc','ppc','paid','cpa','cpm','cpv')) THEN 'Sim' ELSE 'Não' END`,
    joins: ['lead'],
  },
  { key: 'lead_estado', label: `${prefix}: estado`, sql: `l.state`, joins: ['lead'] },
  { key: 'lead_regiao', label: `${prefix}: região`, sql: region('l.state'), joins: ['lead'] },
  { key: 'lead_vendedor', label: `${prefix}: vendedor responsável`, sql: `lsel.name`, joins: ['lead', 'leadSeller'] },
  { key: 'lead_etapa', label: `${prefix}: etapa do funil`, sql: `l.stage::text`, joins: ['lead'], labels: STAGE_LABELS() },
]
function STAGE_LABELS() {
  return { LEAD: 'Lead', QUALIFICADO: 'Qualificado', OPORTUNIDADE: 'Oportunidade', CLIENTE: 'Cliente' }
}
const LEAD_JOINS = {
  lead: `LEFT JOIN leads l ON l.id = t."leadId"`,
  leadSeller: `LEFT JOIN sellers lsel ON lsel.id = l."ownerId"`,
}

export const SOURCES: Source[] = [
  {
    key: 'leads',
    label: 'Leads',
    description: 'Pessoas da base (criadas no período).',
    from: 'leads t',
    tenant: 't."tenantId"',
    date: 't."createdAt"',
    dateLabel: 'data de entrada na base',
    where: 't."deletedAt" IS NULL',
    scopedBy: 'lead',
    joins: {
      origin: `LEFT JOIN lookup_items lo ON lo.id = t."originId"`,
      seller: `LEFT JOIN sellers ls ON ls.id = t."ownerId"`,
      unit: `LEFT JOIN units lu ON lu.id = t."unitId"`,
      tag: `LEFT JOIN LATERAL unnest(t.tags) AS tg(v) ON true`,
    },
    dimensions: [
      { key: 'etapa', label: 'Etapa do funil', sql: 't.stage::text', labels: STAGE_LABELS() },
      { key: 'origem', label: 'Origem (cadastro)', sql: 'lo.name', joins: ['origin'] },
      { key: 'fonte', label: 'Fonte (1ª conversão)', sql: `t."firstConversion"->>'source'` },
      { key: 'meio', label: 'Meio (1ª conversão)', sql: `t."firstConversion"->>'medium'` },
      { key: 'campanha', label: 'Campanha (1ª conversão)', sql: `t."firstConversion"->>'campaign'` },
      { key: 'fonte_ultima', label: 'Fonte (última conversão)', sql: `t."lastConversion"->>'source'` },
      { key: 'estado', label: 'Estado', sql: 't.state' },
      { key: 'regiao', label: 'Região', sql: region('t.state') },
      { key: 'cidade', label: 'Cidade', sql: 't.city' },
      { key: 'vendedor', label: 'Vendedor responsável', sql: 'ls.name', joins: ['seller'] },
      { key: 'unidade', label: 'Unidade', sql: 'lu.name', joins: ['unit'] },
      { key: 'nota', label: 'Nota (lead scoring)', sql: 't."scoreGrade"' },
      { key: 'tag', label: 'Tag', sql: 'tg.v', array: { join: 'tag', filterSql: '{v} = ANY(t.tags)', emptySql: 'cardinality(t.tags) = 0' } },
      { key: 'aceita_email', label: 'Aceita e-mail', sql: yesNo('t."emailOptIn"') },
      { key: 'tem_telefone', label: 'Tem telefone', sql: yesNo('t.phone IS NOT NULL') },
      { key: 'comprou', label: 'Já comprou', sql: yesNo('t."lastSaleAt" IS NOT NULL') },
      {
        key: 'entrada',
        label: 'Como entrou na base',
        sql: `CASE WHEN t."importBatch" IS NOT NULL THEN 'importado' WHEN t."ecommerceId" IS NOT NULL AND t."firstConversionAt" IS NULL THEN 'loja' ELSE 'conversao' END`,
        labels: { importado: 'Importação (planilha ou RD Station)', loja: 'Cadastro na loja virtual', conversao: 'Conversão ou cadastro no CRM' },
      },
      ...timeDims('t."createdAt"'),
    ],
    metrics: [
      { key: 'leads', label: 'Leads', sql: 'count(*)', format: 'int' },
      { key: 'aceitam_email', label: 'Aceitam e-mail', sql: 'count(*) FILTER (WHERE t."emailOptIn")', format: 'int' },
      { key: 'clientes', label: 'Clientes', sql: `count(*) FILTER (WHERE t.stage = 'CLIENTE')`, format: 'int' },
      { key: 'taxa_clientes', label: '% que virou cliente', sql: ratio(`count(*) FILTER (WHERE t.stage = 'CLIENTE')`, 'count(*)'), format: 'pct' },
      { key: 'nota_media', label: 'Pontuação média (interesse)', sql: 'avg(t."scoreInterest")', format: 'num' },
    ],
  },
  {
    key: 'atendimentos',
    label: 'Atendimentos (Pré e Pós-Vendas)',
    description: 'Atendimentos registrados no período.',
    from: 'service_records t',
    tenant: 't."tenantId"',
    date: 't."leadAt"',
    dateLabel: 'data do atendimento',
    where: 't."deletedAt" IS NULL',
    scopedBy: 'record',
    joins: {
      seller: `LEFT JOIN sellers rs ON rs.id = t."sellerId"`,
      unit: `LEFT JOIN units ru ON ru.id = t."unitId"`,
      origin: `LEFT JOIN lookup_items ro ON ro.id = t."originId"`,
      customerType: `LEFT JOIN lookup_items rc ON rc.id = t."customerTypeId"`,
      lostReason: `LEFT JOIN lookup_items rl ON rl.id = t."lostReasonId"`,
      brand: `LEFT JOIN LATERAL unnest(t."brandIds") AS brx(id) ON true LEFT JOIN lookup_items bri ON bri.id = brx.id`,
      part: `LEFT JOIN LATERAL unnest(t."partTypeIds") AS ptx(id) ON true LEFT JOIN lookup_items pti ON pti.id = ptx.id`,
      ...LEAD_JOINS,
    },
    dimensions: [
      { key: 'tipo', label: 'Pré ou Pós-Vendas', sql: 't.kind::text', labels: { PRE_VENDAS: 'Pré-Vendas', POS_VENDAS: 'Pós-Vendas' } },
      { key: 'vendedor', label: 'Vendedor', sql: 'rs.name', joins: ['seller'] },
      { key: 'unidade', label: 'Unidade', sql: 'ru.name', joins: ['unit'] },
      { key: 'origem', label: 'Origem', sql: 'ro.name', joins: ['origin'] },
      { key: 'tipo_cliente', label: 'Tipo de cliente', sql: 'rc.name', joins: ['customerType'] },
      { key: 'estado', label: 'Estado', sql: `CASE WHEN t.country <> 'BR' THEN 'Exterior' ELSE t.state END` },
      { key: 'regiao', label: 'Região', sql: `CASE WHEN t.country <> 'BR' THEN 'Exterior' ELSE ${region('t.state')} END` },
      {
        key: 'marca',
        label: 'Marca da máquina',
        sql: 'bri.name',
        array: { join: 'brand', filterSql: `EXISTS (SELECT 1 FROM lookup_items x WHERE x.id = ANY(t."brandIds") AND x.name = {v})`, emptySql: 'cardinality(t."brandIds") = 0' },
      },
      {
        key: 'tipo_peca',
        label: 'Tipo de peça',
        sql: 'pti.name',
        array: { join: 'part', filterSql: `EXISTS (SELECT 1 FROM lookup_items x WHERE x.id = ANY(t."partTypeIds") AND x.name = {v})`, emptySql: 'cardinality(t."partTypeIds") = 0' },
      },
      { key: 'situacao', label: 'Situação da venda', sql: 't."saleStatus"::text', labels: { SIM: 'Vendeu', NAO: 'Perdida', NEGOCIACAO: 'Em negociação' } },
      { key: 'motivo_perda', label: 'Motivo da perda', sql: 'rl.name', joins: ['lostReason'] },
      { key: 'repassado', label: 'Repassado ao vendedor', sql: yesNo('t.forwarded') },
      { key: 'retorno', label: 'Retorno do vendedor', sql: 't."returnStatus"::text', labels: { SIM: 'Sim', NAO: 'Não', PENDENTE: 'Pendente' } },
      {
        key: 'acompanhamento',
        label: 'Acompanhamento (Pós-Vendas)',
        sql: 't."followStatus"::text',
        labels: { PENDENTE: 'Pendente', CONTATADO: 'Contatado', ANALISANDO: 'Analisando', RESOLVIDO: 'Resolvido', VOLTOU_AO_VENDEDOR: 'Voltou ao vendedor' },
      },
      ...leadDims('Lead').filter((d) => !['lead_estado', 'lead_regiao', 'lead_vendedor'].includes(d.key)),
      ...timeDims('t."leadAt"'),
    ],
    metrics: [
      { key: 'atendimentos', label: 'Atendimentos', sql: 'count(*)', format: 'int' },
      { key: 'vendas', label: 'Vendas', sql: `count(*) FILTER (WHERE t."saleStatus" = 'SIM')`, format: 'int' },
      { key: 'valor_vendido', label: 'Valor vendido', sql: `coalesce(sum(t."saleValue") FILTER (WHERE t."saleStatus" = 'SIM'), 0)`, format: 'brl' },
      { key: 'ticket', label: 'Ticket médio', sql: `avg(t."saleValue") FILTER (WHERE t."saleStatus" = 'SIM')`, format: 'brl' },
      { key: 'conversao', label: 'Conversão em venda', sql: ratio(`count(*) FILTER (WHERE t."saleStatus" = 'SIM')`, 'count(*)'), format: 'pct' },
      { key: 'perdidas', label: 'Vendas perdidas', sql: `count(*) FILTER (WHERE t."saleStatus" = 'NAO')`, format: 'int' },
      { key: 'repassados', label: 'Repassados ao vendedor', sql: 'count(*) FILTER (WHERE t.forwarded)', format: 'int' },
      { key: 'taxa_retorno', label: 'Retorno do vendedor', sql: ratio(`count(*) FILTER (WHERE t."returnStatus" = 'SIM')`, 'count(*) FILTER (WHERE t.forwarded)'), format: 'pct' },
    ],
  },
  {
    key: 'pedidos',
    label: 'Pedidos da loja virtual',
    description: 'Pedidos da Magazord feitos no período.',
    from: 'ecommerce_orders t',
    tenant: 't."tenantId"',
    date: 't."orderedAt"',
    dateLabel: 'data do pedido',
    scopedBy: 'lead',
    joins: { ...LEAD_JOINS },
    dimensions: [
      { key: 'situacao', label: 'Situação', sql: 't."statusGroup"', labels: { pago: 'Pago', pendente: 'Pendente', cancelado: 'Cancelado' } },
      { key: 'status', label: 'Status na loja', sql: 't."statusName"' },
      { key: 'pagamento', label: 'Forma de pagamento', sql: 't.payment' },
      {
        key: 'compra',
        label: 'Primeira compra ou recorrente',
        sql: `CASE WHEN t."leadId" IS NULL THEN NULL WHEN EXISTS (SELECT 1 FROM ecommerce_orders o2 WHERE o2."leadId" = t."leadId" AND o2."statusGroup" = 'pago' AND o2."orderedAt" < t."orderedAt") THEN 'Recorrente' ELSE 'Primeira compra' END`,
      },
      ...leadDims('Cliente'),
      ...timeDims('t."orderedAt"'),
    ],
    metrics: [
      { key: 'pedidos', label: 'Pedidos', sql: 'count(*)', format: 'int' },
      { key: 'pedidos_pagos', label: 'Pedidos pagos', sql: `count(*) FILTER (WHERE t."statusGroup" = 'pago')`, format: 'int' },
      { key: 'receita', label: 'Receita (pagos)', sql: `coalesce(sum(t.total) FILTER (WHERE t."statusGroup" = 'pago'), 0)`, format: 'brl' },
      { key: 'ticket', label: 'Ticket médio (pagos)', sql: `avg(t.total) FILTER (WHERE t."statusGroup" = 'pago')`, format: 'brl' },
      { key: 'valor_total', label: 'Valor de todos os pedidos', sql: 'coalesce(sum(t.total), 0)', format: 'brl' },
      { key: 'clientes', label: 'Clientes', sql: 'count(DISTINCT t."leadId")', format: 'int' },
      { key: 'cancelados', label: 'Cancelados', sql: `count(*) FILTER (WHERE t."statusGroup" = 'cancelado')`, format: 'int' },
    ],
  },
  {
    key: 'carrinhos',
    label: 'Carrinhos da loja virtual',
    description: 'Carrinhos iniciados no período.',
    from: 'ecommerce_carts t',
    tenant: 't."tenantId"',
    date: 'coalesce(t."startedAt", t."createdAt")',
    dateLabel: 'início do carrinho',
    scopedBy: 'lead',
    joins: { ...LEAD_JOINS },
    dimensions: [
      { key: 'situacao', label: 'Situação', sql: 't.status::text', labels: { '1': 'Aberto', '2': 'Abandonado', '3': 'Comprado' } },
      { key: 'checkout', label: 'Chegou ao checkout', sql: yesNo('t."checkoutStarted"') },
      {
        key: 'contato',
        label: 'Contato da equipe',
        sql: 't."contactStatus"',
        labels: { PENDENTE: 'A contatar', CONTATADO: 'Contatado', RECUPERADO: 'Recuperado', PERDIDO: 'Desistiu' },
      },
      { key: 'identificado', label: 'Cliente identificado', sql: yesNo('t."leadId" IS NOT NULL') },
      ...leadDims('Cliente'),
      ...timeDims('coalesce(t."startedAt", t."createdAt")'),
    ],
    metrics: [
      { key: 'carrinhos', label: 'Carrinhos', sql: 'count(*)', format: 'int' },
      { key: 'abandonados', label: 'Abandonados', sql: 'count(*) FILTER (WHERE t.status = 2)', format: 'int' },
      { key: 'comprados', label: 'Comprados', sql: 'count(*) FILTER (WHERE t.status = 3)', format: 'int' },
      { key: 'conversao', label: 'Conversão do carrinho', sql: ratio('count(*) FILTER (WHERE t.status = 3)', 'count(*)'), format: 'pct' },
      { key: 'valor', label: 'Valor em carrinhos', sql: 'coalesce(sum(t.value), 0)', format: 'brl' },
      { key: 'valor_abandonado', label: 'Valor abandonado', sql: 'coalesce(sum(t.value) FILTER (WHERE t.status = 2), 0)', format: 'brl' },
      { key: 'itens', label: 'Itens', sql: 'coalesce(sum(t."itemCount"), 0)', format: 'int' },
    ],
  },
  {
    key: 'emails',
    label: 'E-mails enviados',
    description: 'E-mails de campanhas e de automações enviados no período.',
    from: `email_recipients t JOIN email_campaigns c ON c.id = t."campaignId"`,
    tenant: 'c."tenantId"',
    date: 't."sentAt"',
    dateLabel: 'data do envio',
    where: `t.status = 'ENVIADO'`,
    scopedBy: 'lead',
    joins: { ...LEAD_JOINS, run: `LEFT JOIN automation_runs ar ON ar.id = t."runId" LEFT JOIN automations au ON au.id = ar."automationId"` },
    dimensions: [
      { key: 'campanha', label: 'Campanha ou modelo', sql: 'c.name' },
      { key: 'tipo', label: 'Campanha ou automação', sql: 'c.kind', labels: { CAMPANHA: 'Campanha', MODELO: 'Automação' } },
      { key: 'automacao', label: 'Fluxo de automação', sql: 'au.name', joins: ['run'] },
      { key: 'abriu', label: 'Abriu', sql: yesNo('t."openedAt" IS NOT NULL') },
      { key: 'clicou', label: 'Clicou', sql: yesNo('t."clickedAt" IS NOT NULL') },
      ...leadDims(),
      ...timeDims('t."sentAt"'),
    ],
    metrics: [
      { key: 'enviados', label: 'Enviados', sql: 'count(*)', format: 'int' },
      { key: 'aberturas', label: 'Abriram', sql: 'count(t."openedAt")', format: 'int' },
      { key: 'cliques', label: 'Clicaram', sql: 'count(t."clickedAt")', format: 'int' },
      { key: 'taxa_abertura', label: 'Taxa de abertura', sql: ratio('count(t."openedAt")', 'count(*)'), format: 'pct' },
      { key: 'taxa_clique', label: 'Taxa de clique', sql: ratio('count(t."clickedAt")', 'count(*)'), format: 'pct' },
      { key: 'descadastros', label: 'Descadastros', sql: 'count(t."unsubscribedAt")', format: 'int' },
    ],
  },
  {
    key: 'visitas',
    label: 'Visitas ao site',
    description: 'Visitas (sessões) captadas pelo script de rastreamento.',
    from: 'site_pageviews t',
    tenant: 't."tenantId"',
    date: 't."occurredAt"',
    dateLabel: 'data da visita',
    where: 't."newSession"',
    scopedBy: 'none',
    joins: { visitor: `LEFT JOIN site_visitors sv ON sv.id = t."visitorId"` },
    dimensions: [
      { key: 'fonte', label: 'Fonte', sql: `t.touch->>'source'` },
      { key: 'meio', label: 'Meio', sql: `t.touch->>'medium'` },
      { key: 'fonte_meio', label: 'Fonte / meio', sql: `(t.touch->>'source') || ' / ' || (t.touch->>'medium')` },
      { key: 'campanha', label: 'Campanha', sql: `t.touch->>'campaign'` },
      { key: 'referencia', label: 'Site de referência', sql: `t.touch->>'referrer'` },
      { key: 'pagina_entrada', label: 'Página de entrada', sql: pathOf('t.url') },
      { key: 'dispositivo', label: 'Dispositivo', sql: 't.device', labels: DEVICE_LABELS },
      { key: 'identificado', label: 'Visitante identificado (é lead)', sql: yesNo('sv."leadId" IS NOT NULL'), joins: ['visitor'] },
      ...timeDims('t."occurredAt"'),
    ],
    metrics: [
      { key: 'visitas', label: 'Visitas', sql: 'count(*)', format: 'int' },
      { key: 'visitantes', label: 'Visitantes', sql: 'count(DISTINCT t."visitorId")', format: 'int' },
    ],
  },
  {
    key: 'paginas',
    label: 'Páginas vistas',
    description: 'Cada página aberta no site (com o script de rastreamento).',
    from: 'site_pageviews t',
    tenant: 't."tenantId"',
    date: 't."occurredAt"',
    dateLabel: 'data',
    scopedBy: 'none',
    joins: {},
    dimensions: [
      { key: 'pagina', label: 'Página', sql: pathOf('t.url') },
      { key: 'titulo', label: 'Título da página', sql: 't.title' },
      { key: 'dispositivo', label: 'Dispositivo', sql: 't.device', labels: DEVICE_LABELS },
      ...timeDims('t."occurredAt"'),
    ],
    metrics: [
      { key: 'visualizacoes', label: 'Visualizações', sql: 'count(*)', format: 'int' },
      { key: 'visitas', label: 'Visitas', sql: 'count(DISTINCT t."sessionId")', format: 'int' },
      { key: 'visitantes', label: 'Visitantes', sql: 'count(DISTINCT t."visitorId")', format: 'int' },
    ],
  },
  {
    key: 'conversoes',
    label: 'Conversões (formulários, pop-ups e WhatsApp)',
    description: 'Envios de formulário, pop-up e botão de WhatsApp no período.',
    from: 'capture_submissions t',
    tenant: 't."tenantId"',
    date: 't."createdAt"',
    dateLabel: 'data da conversão',
    scopedBy: 'lead',
    joins: {
      ...LEAD_JOINS,
      capture: `LEFT JOIN capture_forms cf ON cf.id = t."formId" LEFT JOIN capture_popups cp ON cp.id = t."popupId" LEFT JOIN capture_whatsapps cw ON cw.id = t."whatsappId"`,
    },
    dimensions: [
      { key: 'canal', label: 'Canal', sql: 't.channel', labels: { formulario: 'Formulário', popup: 'Pop-up', whatsapp: 'WhatsApp', landing: 'Landing page' } },
      { key: 'captura', label: 'Formulário, pop-up ou botão', sql: 'coalesce(cf.name, cp.name, cw.name)', joins: ['capture'] },
      { key: 'fonte', label: 'Fonte', sql: `t.touch->>'source'` },
      { key: 'meio', label: 'Meio', sql: `t.touch->>'medium'` },
      { key: 'campanha', label: 'Campanha', sql: `t.touch->>'campaign'` },
      { key: 'pagina', label: 'Página', sql: pathOf('t."pageUrl"') },
      { key: 'dispositivo', label: 'Dispositivo', sql: 't.device', labels: DEVICE_LABELS },
      ...leadDims(),
      ...timeDims('t."createdAt"'),
    ],
    metrics: [
      { key: 'conversoes', label: 'Conversões', sql: 'count(*)', format: 'int' },
      { key: 'leads', label: 'Leads', sql: 'count(DISTINCT t."leadId")', format: 'int' },
    ],
  },
]

export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]))

export const CHARTS = ['tabela', 'barras', 'colunas', 'linha', 'numero'] as const
export type Chart = (typeof CHARTS)[number]
export const PRESETS = ['hoje', 'ontem', '7', '30', '90', 'mes', 'mes_anterior', 'ano', '12m', 'personalizado'] as const
export type Preset = (typeof PRESETS)[number]

export interface Filter {
  field: string
  op: 'igual' | 'diferente'
  /** null = "não informado". */
  values: (string | null)[]
}

export interface ReportConfig {
  source: string
  dimensions: string[]
  metrics: string[]
  filters: Filter[]
  period: { preset: Preset; from?: string; to?: string }
  chart: Chart
  limit: number
  /** Mostra a variação contra o período anterior (no número e no total). */
  compare: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))

/** Confere e normaliza a configuração vinda da tela. Só chaves conhecidas passam. */
export function cleanConfig(raw: unknown): { config: ReportConfig } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const source = SOURCE_BY_KEY.get(String(r.source ?? ''))
  if (!source) return { error: 'Escolha a fonte de dados.' }
  const dimKeys = new Set(source.dimensions.map((d) => d.key))
  const metricKeys = new Set(source.metrics.map((m) => m.key))

  const dimensions = Array.isArray(r.dimensions) ? [...new Set(r.dimensions.map(String))] : []
  if (dimensions.length > 2) return { error: 'Use no máximo 2 campos para agrupar.' }
  if (dimensions.some((d) => !dimKeys.has(d))) return { error: 'Campo de agrupamento inválido para esta fonte.' }
  const arrays = dimensions.filter((d) => source.dimensions.find((x) => x.key === d)?.array)
  if (arrays.length > 1) return { error: 'Só um campo de lista (tags, marcas, peças) por relatório.' }

  const metrics = Array.isArray(r.metrics) ? [...new Set(r.metrics.map(String))] : []
  if (metrics.length < 1) return { error: 'Escolha ao menos uma métrica.' }
  if (metrics.length > 4) return { error: 'Use no máximo 4 métricas.' }
  if (metrics.some((m) => !metricKeys.has(m))) return { error: 'Métrica inválida para esta fonte.' }

  const filters: Filter[] = []
  for (const f of Array.isArray(r.filters) ? r.filters : []) {
    const x = (f ?? {}) as Record<string, unknown>
    const field = String(x.field ?? '')
    const dim = source.dimensions.find((d) => d.key === field)
    if (!dim) return { error: 'Filtro com campo inválido.' }
    if (dim.time) return { error: 'Use o período para filtrar por data.' }
    const op = x.op === 'diferente' ? 'diferente' : 'igual'
    const values = Array.isArray(x.values) ? x.values.map((v) => (v === null ? null : String(v).slice(0, 200))) : []
    if (values.length === 0) return { error: `Escolha ao menos um valor no filtro "${dim.label}".` }
    if (values.length > 50) return { error: 'Use no máximo 50 valores por filtro.' }
    filters.push({ field, op, values: [...new Set(values)] })
  }
  if (filters.length > 10) return { error: 'Use no máximo 10 filtros.' }

  const p = (r.period ?? {}) as Record<string, unknown>
  const preset = (PRESETS as readonly string[]).includes(String(p.preset)) ? (p.preset as Preset) : '30'
  const period: ReportConfig['period'] = { preset }
  if (preset === 'personalizado') {
    if (!validDate(p.from) || !validDate(p.to)) return { error: 'Informe as datas do período.' }
    if (p.from > p.to) return { error: 'A data inicial é depois da final.' }
    if (Date.parse(p.to) - Date.parse(p.from) > 3 * 366 * 86_400_000) return { error: 'Período máximo de 3 anos.' }
    period.from = p.from
    period.to = p.to
  }

  const chart = (CHARTS as readonly string[]).includes(String(r.chart)) ? (r.chart as Chart) : 'tabela'
  if (chart === 'numero' && dimensions.length > 0) return { error: 'O formato "número" não usa campos de agrupamento.' }
  if (chart !== 'numero' && chart !== 'tabela' && dimensions.length === 0) return { error: 'Gráficos precisam de ao menos um campo de agrupamento.' }
  const limit = [10, 20, 50, 100, 500].includes(Number(r.limit)) ? Number(r.limit) : 20
  return { config: { source: source.key, dimensions, metrics, filters, period, chart, limit, compare: r.compare !== false } }
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Hoje em São Paulo (o Brasil não tem mais horário de verão: UTC-3 fixo). */
export function todaySP(now = new Date()) {
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}

/** Datas (dia inicial e final, inclusive) do período escolhido e do período anterior de mesmo tamanho. */
export function resolvePeriod(period: ReportConfig['period'], today: string) {
  let from: string
  let to = today
  switch (period.preset) {
    case 'hoje':
      from = today
      break
    case 'ontem':
      from = to = addDays(today, -1)
      break
    case '7':
    case '30':
    case '90':
      from = addDays(today, -(Number(period.preset) - 1))
      break
    case 'mes':
      from = `${today.slice(0, 8)}01`
      break
    case 'mes_anterior': {
      to = addDays(`${today.slice(0, 8)}01`, -1)
      from = `${to.slice(0, 8)}01`
      break
    }
    case 'ano':
      from = `${today.slice(0, 4)}-01-01`
      break
    case '12m':
      from = addDays(today, -364)
      break
    default:
      from = period.from ?? today
      to = period.to ?? today
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  const previous = { from: addDays(from, -days), to: addDays(from, -1) }
  return { from, to, days, previous }
}

/** Início do dia em São Paulo, em UTC (como o banco guarda). */
export const spStart = (iso: string) => new Date(`${iso}T03:00:00.000Z`)

export interface ScopeCtx {
  tenantId: string
  scope: Scope
  userId: string
  unitId: string | null
}

const RAW = (s: string) => Prisma.raw(s)

/** Condição de escopo ("só os próprios" / "só da unidade"). */
function scopeSql(source: Source, ctx: ScopeCtx): { sql: Prisma.Sql; joins: string[] } {
  if (ctx.scope === 'ALL') return { sql: Prisma.empty, joins: [] }
  if (source.scopedBy === 'none') return { sql: Prisma.sql` AND false`, joins: [] }
  if (source.scopedBy === 'record') {
    if (ctx.scope === 'OWN') return { sql: Prisma.sql` AND t."sellerId" IN (SELECT id FROM sellers WHERE "userId" = ${ctx.userId}::uuid)`, joins: [] }
    return { sql: ctx.unitId ? Prisma.sql` AND t."unitId" = ${ctx.unitId}::uuid` : Prisma.sql` AND false`, joins: [] }
  }
  // Pelo lead: na fonte "leads" é a própria tabela (t); nas outras, a junção l.
  const alias = source.key === 'leads' ? 't' : 'l'
  const joins = source.key === 'leads' ? [] : ['lead']
  if (ctx.scope === 'OWN') return { sql: Prisma.sql` AND ${RAW(alias)}."ownerId" IN (SELECT id FROM sellers WHERE "userId" = ${ctx.userId}::uuid)`, joins }
  return { sql: ctx.unitId ? Prisma.sql` AND ${RAW(alias)}."unitId" = ${ctx.unitId}::uuid` : Prisma.sql` AND false`, joins }
}

function filterSql(source: Source, f: Filter): { sql: Prisma.Sql; joins: string[] } {
  const dim = source.dimensions.find((d) => d.key === f.field)!
  const values = f.values.filter((v): v is string => v !== null)
  const hasNull = f.values.includes(null)
  const parts: Prisma.Sql[] = []
  if (dim.array) {
    const [before, after] = dim.array.filterSql.split('{v}')
    for (const v of values) parts.push(Prisma.sql`${RAW(before!)}${v}${RAW(after!)}`)
    if (hasNull) parts.push(RAW(dim.array.emptySql))
    const any = parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`false`
    return { sql: f.op === 'igual' ? Prisma.sql` AND ${any}` : Prisma.sql` AND NOT ${any}`, joins: [] }
  }
  const expr = RAW(`(${dim.sql})`)
  if (values.length) parts.push(Prisma.sql`${expr} IN (${Prisma.join(values)})`)
  if (hasNull) parts.push(Prisma.sql`${expr} IS NULL`)
  const any = Prisma.sql`(${Prisma.join(parts, ' OR ')})`
  // "Diferente" também mantém os vazios quando o vazio não está na lista.
  const sql = f.op === 'igual' ? Prisma.sql` AND ${any}` : hasNull ? Prisma.sql` AND NOT ${any}` : Prisma.sql` AND (NOT ${any} OR ${expr} IS NULL)`
  return { sql, joins: dim.joins ?? [] }
}

export interface BuiltQuery {
  sql: Prisma.Sql
  dims: Dimension[]
  metrics: Metric[]
}

/**
 * Monta o SELECT do relatório. `grouped = false` gera o total (sem agrupar e sem as junções de lista,
 * para que um registro com várias tags conte uma vez só).
 */
export function buildQuery(config: ReportConfig, ctx: ScopeCtx, range: { from: string; to: string }, grouped = true): BuiltQuery {
  const source = SOURCE_BY_KEY.get(config.source)!
  const dims = grouped ? config.dimensions.map((k) => source.dimensions.find((d) => d.key === k)!) : []
  const metrics = config.metrics.map((k) => source.metrics.find((m) => m.key === k)!)
  const joins = new Set<string>()
  for (const d of dims) {
    for (const j of d.joins ?? []) joins.add(j)
    if (d.array) joins.add(d.array.join)
  }
  for (const m of metrics) for (const j of m.joins ?? []) joins.add(j)

  const scope = scopeSql(source, ctx)
  for (const j of scope.joins) joins.add(j)
  const filters = config.filters.map((f) => filterSql(source, f))
  for (const f of filters) for (const j of f.joins) joins.add(j)
  // A junção do vendedor do lead depende da junção do lead.
  if (joins.has('leadSeller')) joins.add('lead')
  const joinOrder = Object.keys(source.joins).filter((k) => joins.has(k))

  const select = [
    ...dims.map((d, i) => `(${d.sql})::text AS d${i}`),
    ...metrics.map((m, i) => `(${m.sql})::float8 AS m${i}`),
  ].join(', ')
  const order = dims.length === 0 ? '' : dims[0]!.time ? ' ORDER BY d0 ASC NULLS LAST' : ` ORDER BY m0 DESC NULLS LAST${dims.map((_, i) => `, d${i} ASC NULLS LAST`).join('')}`
  const group = dims.length ? ` GROUP BY ${dims.map((_, i) => i + 1).join(', ')}` : ''
  // Agrupado por data: mostra o período inteiro (o limite de linhas vale só para os outros campos).
  const rowsWanted = dims[0]?.time ? TIME_LIMIT : config.limit
  const limit = dims.length ? Prisma.sql` LIMIT ${Math.min(rowsWanted * (dims.length > 1 ? 20 : 1), 20_000)}` : Prisma.empty

  const sql = Prisma.sql`SELECT ${RAW(select)} FROM ${RAW(source.from)} ${RAW(joinOrder.map((k) => source.joins[k]).join(' '))}
    WHERE ${RAW(source.tenant)} = ${ctx.tenantId}::uuid
      AND ${RAW(source.date)} >= ${spStart(range.from)} AND ${RAW(source.date)} < ${spStart(addDays(range.to, 1))}
      ${source.where ? RAW(`AND ${source.where}`) : Prisma.empty}${scope.sql}${filters.reduce((acc, f) => Prisma.sql`${acc}${f.sql}`, Prisma.empty)}
    ${RAW(group + order)}${limit}`
  return { sql, dims, metrics }
}

/** Máximo de períodos num gráfico por data (3 anos de dias). */
export const TIME_LIMIT = 1100

/** Todos os períodos (dia, semana ou mês) entre as datas, para o gráfico mostrar os vazios como zero. */
export function timeBuckets(key: string, from: string, to: string): string[] | null {
  const out: string[] = []
  if (key === 'dia') {
    for (let d = from; d <= to && out.length <= TIME_LIMIT; d = addDays(d, 1)) out.push(d)
    return out
  }
  if (key === 'semana') {
    const day = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7
    for (let d = addDays(from, -day); d <= to && out.length <= TIME_LIMIT; d = addDays(d, 7)) out.push(d)
    return out
  }
  if (key === 'mes') {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7) && out.length <= TIME_LIMIT; ) {
      out.push(m)
      const [y, mo] = m.split('-').map(Number) as [number, number]
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    }
    return out
  }
  return null
}

/** Contagens e somas viram 0 no período vazio; médias e taxas ficam vazias (não existe média de nada). */
export const zeroWhenEmpty = (m: Metric) => m.sql.startsWith('count(') || m.sql.startsWith('coalesce(sum')

/** Completa os períodos sem registro quando o relatório agrupa só por data. */
export function fillTime(rows: ResultRow[], dimKey: string, metrics: Metric[], from: string, to: string): ResultRow[] {
  const buckets = timeBuckets(dimKey, from, to)
  if (!buckets || rows.some((r) => r.dims[0] === null)) return rows
  const byBucket = new Map(rows.map((r) => [r.dims[0], r]))
  return buckets.map((b) => byBucket.get(b) ?? { dims: [b], values: metrics.map((m) => (zeroWhenEmpty(m) ? 0 : null)) })
}

export interface ResultRow {
  dims: (string | null)[]
  values: (number | null)[]
}

/** Converte as linhas do banco ({d0, d1, m0...}) e aplica o limite por série quando há 2 agrupamentos. */
export function shapeRows(raw: Record<string, unknown>[], dims: number, metrics: number, limit: number): ResultRow[] {
  const rows = raw.map((r) => ({
    dims: Array.from({ length: dims }, (_, i) => (r[`d${i}`] === null || r[`d${i}`] === undefined ? null : String(r[`d${i}`]))),
    values: Array.from({ length: metrics }, (_, i) => {
      const v = r[`m${i}`]
      return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)
    }),
  }))
  if (dims < 2) return rows.slice(0, limit)
  // Dois agrupamentos: limita a quantidade de valores do primeiro campo (os de maior métrica).
  const keep: (string | null)[] = []
  for (const r of rows) if (!keep.includes(r.dims[0]!) && keep.length < limit) keep.push(r.dims[0]!)
  return rows.filter((r) => keep.includes(r.dims[0]!))
}

/** Descrição pública das fontes (para a tela montar os seletores). */
export function catalog(scope: Scope) {
  return SOURCES.map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    dateLabel: s.dateLabel,
    available: scope === 'ALL' || s.scopedBy !== 'none',
    dimensions: s.dimensions.map((d) => ({ key: d.key, label: d.label, labels: d.labels ?? null, time: !!d.time, list: !!d.array })),
    metrics: s.metrics.map((m) => ({ key: m.key, label: m.label, format: m.format })),
  }))
}
