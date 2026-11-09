/**
 * Power BI (fase 2): medidas DAX do projeto (tabela _Medidas), em pastas por área. Base: as medidas sugeridas do
 * contrato (bi-contrato.ts, seção 6), mais comparações com o ano e o mês anteriores e os cenários (what-if).
 */
import { CALENDARIO, CENARIOS, daxTable, FMT, type PbiMeasure } from './powerbi-modelo'

const D = `${CALENDARIO}[Data]`

const m = (pasta: string, nome: string, expressao: string, formato: string, descricao?: string): PbiMeasure => ({ pasta, nome, expressao, formato, ...(descricao ? { descricao } : {}) })

const COMERCIAL: PbiMeasure[] = [
  m('Comercial', 'Pré-vendas', 'CALCULATE ( COUNTROWS ( fato_atendimentos ), fato_atendimentos[tipo] = "PRE_VENDAS" )', FMT.inteiro, 'Atendimentos de pré-venda (leads que chegaram), pela data do lead.'),
  m('Comercial', 'Vendas', 'CALCULATE ( [Pré-vendas], fato_atendimentos[venda] = TRUE () )', FMT.inteiro, 'Pré-vendas que viraram venda, pela data do lead.'),
  m('Comercial', 'Perdas', 'CALCULATE ( [Pré-vendas], fato_atendimentos[situacao_venda] = "NAO" )', FMT.inteiro),
  m('Comercial', 'Em negociação', 'CALCULATE ( [Pré-vendas], fato_atendimentos[situacao_venda] = "NEGOCIACAO" )', FMT.inteiro),
  m('Comercial', 'Taxa de conversão', 'DIVIDE ( [Vendas], [Pré-vendas] )', FMT.pct),
  m('Comercial', 'Taxa de perda', 'DIVIDE ( [Perdas], [Pré-vendas] )', FMT.pct),
  m('Comercial', 'Receita das pré-vendas', 'CALCULATE ( SUM ( fato_atendimentos[valor_venda] ), fato_atendimentos[tipo] = "PRE_VENDAS", fato_atendimentos[venda] = TRUE () )', FMT.moeda),
  m('Comercial', 'Ticket médio', 'DIVIDE ( [Receita das pré-vendas], [Vendas] )', FMT.moeda),
  m('Comercial', 'Receita total (pré-vendas + loja)', '[Receita das pré-vendas] + [Receita da loja]', FMT.moeda),
  m('Comercial', 'Vendas pela data do resultado', `CALCULATE ( [Vendas], USERELATIONSHIP ( fato_atendimentos[data_resultado], ${D} ) )`, FMT.inteiro, 'Vendas contadas no dia do resultado (relação inativa com o calendário).'),
  m('Comercial', 'Receita pela data do resultado', `CALCULATE ( [Receita das pré-vendas], USERELATIONSHIP ( fato_atendimentos[data_resultado], ${D} ) )`, FMT.moeda),
  m('Comercial', 'Tempo até o repasse (min, mediana)', 'MEDIAN ( fato_atendimentos[minutos_ate_repasse] )', FMT.decimal),
  m('Comercial', 'Tempo até a primeira ação (min, mediana)', 'MEDIAN ( fato_atendimentos[minutos_ate_primeira_acao] )', FMT.decimal),
  m('Comercial', 'Horas até o resultado (média)', 'AVERAGE ( fato_atendimentos[horas_ate_resultado] )', FMT.decimal),
  m('Comercial', 'Pós-vendas', 'CALCULATE ( COUNTROWS ( fato_atendimentos ), fato_atendimentos[tipo] = "POS_VENDAS" )', FMT.inteiro),
  m('Comercial', 'Pós-vendas pendentes', 'CALCULATE ( COUNTROWS ( fato_atendimentos ), fato_atendimentos[tipo] = "POS_VENDAS", fato_atendimentos[acompanhamento] = "PENDENTE" )', FMT.inteiro),
  m('Comercial', 'Leads', 'COUNTROWS ( fato_leads )', FMT.inteiro, 'Leads que entraram na base no período.'),
  m('Comercial', 'Leads clientes', 'CALCULATE ( [Leads], fato_leads[estagio] = "CLIENTE" )', FMT.inteiro),
  m('Comercial', '% leads que viraram clientes', 'DIVIDE ( [Leads clientes], [Leads] )', FMT.pct),
  m('Comercial', 'Leads da carteira do vendedor', `CALCULATE ( [Leads], USERELATIONSHIP ( fato_leads[vendedor_carteira_id], dim_vendedor[vendedor_id] ) )`, FMT.inteiro, 'Leads pelo vendedor da carteira (relação inativa).'),
]

const WHATSAPP: PbiMeasure[] = [
  m('WhatsApp', 'Atendimentos WhatsApp', 'COUNTROWS ( fato_conversas_whatsapp )', FMT.inteiro),
  m('WhatsApp', 'Atendimentos recebidos', 'CALCULATE ( [Atendimentos WhatsApp], fato_conversas_whatsapp[iniciado_por] = "cliente" )', FMT.inteiro),
  m('WhatsApp', 'Primeira resposta (min, mediana)', 'MEDIAN ( fato_conversas_whatsapp[minutos_primeira_resposta] )', FMT.decimal),
  m('WhatsApp', 'Primeira resposta comercial (min, mediana)', 'MEDIAN ( fato_conversas_whatsapp[minutos_primeira_resposta_comercial] )', FMT.decimal, 'Só conta o horário comercial das regras do WhatsApp.'),
  m('WhatsApp', 'Tempo médio de resposta (min)', 'AVERAGE ( fato_conversas_whatsapp[minutos_resposta_media] )', FMT.decimal),
  m(
    'WhatsApp',
    '% respondidos em 15 min',
    'DIVIDE ( CALCULATE ( [Atendimentos recebidos], fato_conversas_whatsapp[minutos_primeira_resposta_comercial] <= 15 ), CALCULATE ( [Atendimentos recebidos], NOT ISBLANK ( fato_conversas_whatsapp[minutos_primeira_resposta] ) ) )',
    FMT.pct,
  ),
  m('WhatsApp', 'Sem resposta', 'CALCULATE ( [Atendimentos recebidos], ISBLANK ( fato_conversas_whatsapp[primeira_resposta_em] ) )', FMT.inteiro),
  m('WhatsApp', '% sem resposta', 'DIVIDE ( [Sem resposta], [Atendimentos recebidos] )', FMT.pct),
  m('WhatsApp', 'Aguardando agora', 'CALCULATE ( [Atendimentos WhatsApp], fato_conversas_whatsapp[aguardando_resposta] = TRUE () )', FMT.inteiro),
  m('WhatsApp', 'Mensagens recebidas', 'SUM ( fato_conversas_whatsapp[mensagens_cliente] )', FMT.inteiro),
  m('WhatsApp', 'Mensagens enviadas', 'SUM ( fato_conversas_whatsapp[mensagens_empresa] )', FMT.inteiro),
  m('WhatsApp', 'Respondidos por quem respondeu', `CALCULATE ( [Atendimentos recebidos], USERELATIONSHIP ( fato_conversas_whatsapp[respondido_por_id], dim_usuario[usuario_id] ) )`, FMT.inteiro, 'Atendimentos recebidos por quem deu a primeira resposta pelo CRM (relação inativa).'),
]

const LOJA: PbiMeasure[] = [
  m('Loja', 'Pedidos', 'COUNTROWS ( fato_pedidos_loja )', FMT.inteiro),
  m('Loja', 'Pedidos pagos', 'CALCULATE ( COUNTROWS ( fato_pedidos_loja ), fato_pedidos_loja[grupo_situacao] = "pago" )', FMT.inteiro),
  m('Loja', 'Receita da loja', 'CALCULATE ( SUM ( fato_pedidos_loja[total] ), fato_pedidos_loja[grupo_situacao] = "pago" )', FMT.moeda),
  m('Loja', 'Ticket médio da loja', 'DIVIDE ( [Receita da loja], [Pedidos pagos] )', FMT.moeda),
  m('Loja', 'Itens vendidos', 'CALCULATE ( SUM ( fato_itens_pedido[quantidade] ), fato_itens_pedido[grupo_situacao] = "pago" )', FMT.inteiro),
  m('Loja', 'Receita dos itens', 'CALCULATE ( SUM ( fato_itens_pedido[total] ), fato_itens_pedido[grupo_situacao] = "pago" )', FMT.moeda),
  m('Loja', 'Carrinhos', 'COUNTROWS ( fato_carrinhos )', FMT.inteiro),
  m('Loja', 'Carrinhos abandonados', 'CALCULATE ( COUNTROWS ( fato_carrinhos ), fato_carrinhos[situacao] = "abandonado" )', FMT.inteiro),
  m('Loja', 'Taxa de compra dos carrinhos', 'DIVIDE ( CALCULATE ( COUNTROWS ( fato_carrinhos ), fato_carrinhos[situacao] = "comprado" ), COUNTROWS ( fato_carrinhos ) )', FMT.pct),
  m('Loja', 'Valor em carrinhos abandonados', 'CALCULATE ( SUM ( fato_carrinhos[valor] ), fato_carrinhos[situacao] = "abandonado" )', FMT.moeda),
]

const ML: PbiMeasure[] = [
  m('Mercado Livre', 'Investimento ML Ads', 'CALCULATE ( SUM ( fato_ml_ads_diario[investimento] ), fato_ml_ads_diario[nivel] = "campaign" )', FMT.moeda),
  m('Mercado Livre', 'Receita ML Ads', 'CALCULATE ( SUM ( fato_ml_ads_diario[receita] ), fato_ml_ads_diario[nivel] = "campaign" )', FMT.moeda),
  m('Mercado Livre', 'ROAS ML', 'DIVIDE ( [Receita ML Ads], [Investimento ML Ads] )', FMT.razao),
  m('Mercado Livre', 'ACOS ML', 'DIVIDE ( [Investimento ML Ads], [Receita ML Ads] )', FMT.pct),
  m('Mercado Livre', 'Perguntas', 'COUNTROWS ( fato_ml_perguntas )', FMT.inteiro),
  m('Mercado Livre', '% respondidas pelo CRM', 'DIVIDE ( CALCULATE ( [Perguntas], fato_ml_perguntas[respondida_pelo_crm] = TRUE () ), [Perguntas] )', FMT.pct),
  m('Mercado Livre', 'Tempo de resposta ML (min, mediana)', 'MEDIAN ( fato_ml_perguntas[minutos_resposta] )', FMT.decimal),
  m('Mercado Livre', 'Vendas do assistente', 'CALCULATE ( SUM ( fato_ml_vendas[quantidade] ), fato_ml_vendas[pago_antes] = FALSE () )', FMT.inteiro),
  m('Mercado Livre', 'Receita do assistente', 'CALCULATE ( SUM ( fato_ml_vendas[total] ), fato_ml_vendas[pago_antes] = FALSE () )', FMT.moeda),
]

const MARKETING: PbiMeasure[] = [
  m('Marketing', 'Investimento', 'SUM ( fato_anuncios_diario[investimento] )', FMT.moeda, 'Investimento nas plataformas de anúncios (Google, Meta, TikTok).'),
  m('Marketing', 'Investimento Google', 'CALCULATE ( [Investimento], fato_anuncios_diario[plataforma] = "google" )', FMT.moeda),
  m('Marketing', 'Investimento Meta', 'CALCULATE ( [Investimento], fato_anuncios_diario[plataforma] = "meta" )', FMT.moeda),
  m('Marketing', 'Investimento total em anúncios', '[Investimento] + [Investimento ML Ads]', FMT.moeda, 'Plataformas de anúncios + Mercado Livre Ads.'),
  m('Marketing', 'Cliques', 'SUM ( fato_anuncios_diario[cliques] )', FMT.inteiro),
  m('Marketing', 'Impressões', 'SUM ( fato_anuncios_diario[impressoes] )', FMT.inteiro),
  m('Marketing', 'CTR', 'DIVIDE ( [Cliques], [Impressões] )', FMT.pct),
  m('Marketing', 'CPC', 'DIVIDE ( [Investimento], [Cliques] )', FMT.moeda),
  m('Marketing', 'Leads dos anúncios', 'SUM ( fato_anuncios_diario[leads] )', FMT.inteiro, 'Leads informados pela plataforma de anúncios.'),
  m('Marketing', 'Conversões dos anúncios', 'SUM ( fato_anuncios_diario[conversoes] )', FMT.decimal),
  m('Marketing', 'CPL (plataforma)', 'DIVIDE ( [Investimento], [Leads dos anúncios] )', FMT.moeda, 'Custo por lead pelos leads que a plataforma informa.'),
  m('Marketing', 'CPA (plataforma)', 'DIVIDE ( [Investimento], [Conversões dos anúncios] )', FMT.moeda, 'Custo por conversão pelas conversões que a plataforma informa.'),
  m('Marketing', 'Leads Google Ads', 'CALCULATE ( [Pré-vendas], fato_atendimentos[veio_google_ads] = TRUE () )', FMT.inteiro, 'Pré-vendas de quem clicou num anúncio do Google antes do contato.'),
  m('Marketing', 'Vendas Google Ads', 'CALCULATE ( [Vendas], fato_atendimentos[veio_google_ads] = TRUE () )', FMT.inteiro),
  m('Marketing', 'Receita Google Ads', 'CALCULATE ( [Receita das pré-vendas], fato_atendimentos[veio_google_ads] = TRUE () )', FMT.moeda),
  m('Marketing', 'CPL Google', 'DIVIDE ( [Investimento Google], [Leads Google Ads] )', FMT.moeda),
  m('Marketing', 'CPA Google', 'DIVIDE ( [Investimento Google], [Vendas Google Ads] )', FMT.moeda),
  m('Marketing', 'ROAS Google', 'DIVIDE ( [Receita Google Ads], [Investimento Google] )', FMT.razao),
  m(
    'Marketing',
    'Receita Google Ads da campanha',
    'CALCULATE ( [Receita Google Ads], TREATAS ( VALUES ( fato_anuncios_diario[campanha_id] ), fato_atendimentos[campanha_google_id] ) )',
    FMT.moeda,
    'Receita das pré-vendas do Google Ads ligada às campanhas do diário de anúncios (use por campanha).',
  ),
  m('Marketing', 'Leads Google Ads da campanha', 'CALCULATE ( [Leads Google Ads], TREATAS ( VALUES ( fato_anuncios_diario[campanha_id] ), fato_atendimentos[campanha_google_id] ) )', FMT.inteiro),
  m('Marketing', 'CPL da campanha (CRM)', 'DIVIDE ( [Investimento], [Leads Google Ads da campanha] )', FMT.moeda),
  m('Marketing', 'ROAS da campanha', 'DIVIDE ( [Receita Google Ads da campanha], [Investimento] )', FMT.razao),
  m('Marketing\\E-mail e Web Push', 'E-mails enviados', 'SUM ( fato_email_campanhas[enviados] )', FMT.inteiro),
  m('Marketing\\E-mail e Web Push', 'Taxa de abertura', 'DIVIDE ( SUM ( fato_email_campanhas[abriram] ), [E-mails enviados] )', FMT.pct),
  m('Marketing\\E-mail e Web Push', 'Taxa de clique (e-mail)', 'DIVIDE ( SUM ( fato_email_campanhas[clicaram] ), [E-mails enviados] )', FMT.pct),
  m('Marketing\\E-mail e Web Push', 'CTOR', 'DIVIDE ( SUM ( fato_email_campanhas[clicaram] ), SUM ( fato_email_campanhas[abriram] ) )', FMT.pct),
  m('Marketing\\E-mail e Web Push', 'Descadastro', 'DIVIDE ( SUM ( fato_email_campanhas[descadastros] ), [E-mails enviados] )', FMT.pct),
  m('Marketing\\E-mail e Web Push', 'Taxa de clique (Web Push)', 'DIVIDE ( SUM ( fato_webpush[cliques] ), SUM ( fato_webpush[entregues] ) )', FMT.pct),
]

const FRETES: PbiMeasure[] = [
  m('Fretes', 'Frete pago (CT-e)', 'CALCULATE ( SUM ( fato_ctes[valor_frete] ), fato_ctes[situacao_fiscal] <> "CANCELADO" )', FMT.moeda),
  m('Fretes', 'Frete sobre a carga', 'DIVIDE ( [Frete pago (CT-e)], CALCULATE ( SUM ( fato_ctes[valor_carga] ), fato_ctes[situacao_fiscal] <> "CANCELADO" ) )', FMT.pct),
  m('Fretes', 'Frete sobre a venda', 'DIVIDE ( [Frete pago (CT-e)], [Receita das pré-vendas] + [Receita da loja] )', FMT.pct, 'Frete dos CT-es sobre a receita das pré-vendas e da loja no mesmo período (visão geral).'),
  m('Fretes', 'Frete por kg', 'DIVIDE ( [Frete pago (CT-e)], SUM ( fato_ctes[peso_kg] ) )', FMT.moeda),
  m('Fretes', 'CT-es', 'COUNTROWS ( fato_ctes )', FMT.inteiro),
  m('Fretes', 'Divergência cobrada', 'CALCULATE ( SUM ( fato_ctes[diferenca] ), fato_ctes[situacao_conciliacao] = "DIVERGENTE" )', FMT.moeda),
  m('Fretes', 'Crédito das contestações', 'SUM ( fato_ctes[valor_credito] )', FMT.moeda),
  m('Fretes', '% CT-es conciliados', 'DIVIDE ( CALCULATE ( COUNTROWS ( fato_ctes ), fato_ctes[situacao_conciliacao] = "CONCILIADO" ), COUNTROWS ( fato_ctes ) )', FMT.pct),
  m('Fretes', 'Cotações', 'COUNTROWS ( fato_frete_cotacoes )', FMT.inteiro),
  m('Fretes', '% cotações escolhidas', 'DIVIDE ( CALCULATE ( [Cotações], fato_frete_cotacoes[situacao] = "SELECIONADA" ), [Cotações] )', FMT.pct),
  m(
    'Fretes',
    'Frete cotado sobre a carga',
    'DIVIDE ( SUM ( fato_frete_cotacoes[total_escolhido] ), CALCULATE ( SUM ( fato_frete_cotacoes[valor_carga] ), fato_frete_cotacoes[situacao] = "SELECIONADA" ) )',
    FMT.pct,
  ),
]

const BRINDES: PbiMeasure[] = [
  m('Brindes', 'Brindes entregues', 'SUM ( fato_brindes[quantidade] )', FMT.inteiro),
  m('Brindes', 'Valor em brindes', 'SUM ( fato_brindes[valor_total] )', FMT.moeda),
  m('Brindes', 'Brindes por venda', 'DIVIDE ( [Brindes entregues], [Vendas] )', FMT.razao),
]

/** Medidas com comparação (ano anterior e mês anterior): [pasta, medida]. */
const COMPARAR: [string, string][] = [
  ['Comercial', 'Pré-vendas'],
  ['Comercial', 'Vendas'],
  ['Comercial', 'Receita das pré-vendas'],
  ['Comercial', 'Ticket médio'],
  ['Comercial', 'Leads'],
  ['WhatsApp', 'Atendimentos WhatsApp'],
  ['Loja', 'Receita da loja'],
  ['Loja', 'Pedidos pagos'],
  ['Mercado Livre', 'Receita ML Ads'],
  ['Mercado Livre', 'Perguntas'],
  ['Marketing', 'Investimento'],
  ['Fretes', 'Frete pago (CT-e)'],
  ['Brindes', 'Valor em brindes'],
]

function comparacoes(todas: PbiMeasure[]): PbiMeasure[] {
  const fmt = new Map(todas.map((x) => [x.nome, x.formato]))
  const out: PbiMeasure[] = []
  for (const [pasta, nome] of COMPARAR) {
    const f = fmt.get(nome)!
    const p = `${pasta}\\Comparações`
    out.push(
      m(p, `${nome} (ano anterior)`, `CALCULATE ( [${nome}], SAMEPERIODLASTYEAR ( ${D} ) )`, f),
      m(p, `${nome} vs. ano anterior (%)`, ['VAR Atual = [' + nome + ']', `VAR Anterior = [${nome} (ano anterior)]`, 'RETURN', '    IF ( NOT ISBLANK ( Anterior ), DIVIDE ( Atual - Anterior, Anterior ) )'].join('\n'), FMT.variacao),
      m(p, `${nome} (mês anterior)`, `CALCULATE ( [${nome}], DATEADD ( ${D}, -1, MONTH ) )`, f),
      m(p, `${nome} vs. mês anterior (%)`, ['VAR Atual = [' + nome + ']', `VAR Anterior = [${nome} (mês anterior)]`, 'RETURN', '    IF ( NOT ISBLANK ( Anterior ), DIVIDE ( Atual - Anterior, Anterior ) )'].join('\n'), FMT.variacao),
    )
  }
  out.push(
    m('Comercial\\Comparações', 'Taxa de conversão (ano anterior)', `CALCULATE ( [Taxa de conversão], SAMEPERIODLASTYEAR ( ${D} ) )`, FMT.pct),
    m('Comercial\\Comparações', 'Taxa de conversão vs. ano anterior (p.p.)', '[Taxa de conversão] - [Taxa de conversão (ano anterior)]', '+0.0%;-0.0%;0.0%', 'Diferença em pontos percentuais.'),
  )
  return out
}

function cenarios(): PbiMeasure[] {
  const P = 'Cenários'
  const valor = CENARIOS.map((c) =>
    m(P + '\\Parâmetros', c.medida, `SELECTEDVALUE ( ${daxTable(c.nome)}[${c.nome}], 0 ) / 100`, FMT.variacao, `Valor escolhido em "${c.nome}" (sem escolha: 0%).`),
  )
  const [conv, inv, ticket, frete] = CENARIOS.map((c) => `[${c.medida}]`)
  return [
    ...valor,
    m(P, 'Pré-vendas projetadas', `[Pré-vendas] + [Leads Google Ads] * ${inv}`, FMT.inteiro, 'Hipótese: as pré-vendas que vieram do Google Ads crescem na mesma proporção do investimento.'),
    m(P, 'Taxa de conversão projetada', `MIN ( [Taxa de conversão] * ( 1 + ${conv} ), 1 )`, FMT.pct),
    m(P, 'Vendas projetadas', '[Pré-vendas projetadas] * [Taxa de conversão projetada]', FMT.decimal),
    m(P, 'Ticket médio projetado', `[Ticket médio] * ( 1 + ${ticket} )`, FMT.moeda),
    m(P, 'Receita projetada', '[Vendas projetadas] * [Ticket médio projetado]', FMT.moeda, 'Receita das pré-vendas no cenário (pré-vendas × conversão × ticket).'),
    m(P, 'Diferença de vendas', '[Vendas projetadas] - [Vendas]', '+#,0.0;-#,0.0;0'),
    m(P, 'Diferença de receita', '[Receita projetada] - [Receita das pré-vendas]', '+\\R$ #,0.00;-\\R$ #,0.00;\\R$ 0.00'),
    m(P, 'Diferença de receita (%)', 'DIVIDE ( [Diferença de receita], [Receita das pré-vendas] )', FMT.variacao),
    m(P, 'Investimento projetado', `[Investimento] * ( 1 + ${inv} )`, FMT.moeda),
    m(P, 'Investimento Google projetado', `[Investimento Google] * ( 1 + ${inv} )`, FMT.moeda),
    m(P, 'Receita Google Ads projetada', `[Receita Google Ads] * ( 1 + ${inv} ) * ( 1 + ${conv} ) * ( 1 + ${ticket} )`, FMT.moeda),
    m(P, 'ROAS projetado', 'DIVIDE ( [Receita Google Ads projetada], [Investimento Google projetado] )', FMT.razao, 'ROAS do Google Ads no cenário.'),
    m(P, 'Diferença de ROAS', '[ROAS projetado] - [ROAS Google]', '+#,0.00;-#,0.00;0.00'),
    m(P, 'Frete projetado', `[Frete pago (CT-e)] * ( 1 + ${frete} )`, FMT.moeda),
    m(P, 'Diferença de frete', '[Frete projetado] - [Frete pago (CT-e)]', '+\\R$ #,0.00;-\\R$ #,0.00;\\R$ 0.00'),
    m(P, 'Frete sobre a venda projetado', `DIVIDE ( [Frete projetado], [Receita projetada] + [Receita da loja] * ( 1 + ${ticket} ) )`, FMT.pct),
    m(P, 'Diferença do frete sobre a venda (p.p.)', '[Frete sobre a venda projetado] - [Frete sobre a venda]', '+0.0%;-0.0%;0.0%'),
  ]
}

export function medidas(): PbiMeasure[] {
  const base = [...COMERCIAL, ...WHATSAPP, ...LOJA, ...ML, ...MARKETING, ...FRETES, ...BRINDES]
  return [...base, ...comparacoes(base), ...cenarios()]
}
