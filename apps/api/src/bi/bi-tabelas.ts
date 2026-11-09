/**
 * Power BI (fase 1): tabelas publicadas em /api/bi/v1 (esquema estrela). Cada tabela diz as colunas (nome, tipo,
 * significado), as ligações com as dimensões e o SQL que a lê. Puro: sem Nest nem banco (testado em bi.spec.ts).
 *
 * LGPD: nenhuma coluna traz nome, telefone, e-mail, CPF/CNPJ ou endereço de cliente, nem texto de mensagem. Pessoas
 * aparecem só pelo número interno (lead_id). Nomes da equipe (vendedor, usuário, filial) e cidade/UF podem.
 */

export type ColType = 'texto' | 'inteiro' | 'decimal' | 'moeda' | 'data' | 'datahora' | 'booleano'

export interface BiColumn {
  nome: string
  tipo: ColType
  /** Pode vir vazia (null). */
  nulo: boolean
  descricao: string
  /** Expressão SQL (tabelas lidas por SQL). */
  sql?: string
}

/** Ligação fato → dimensão (muitos para um, filtro em uma direção). ativa=false: relação inativa (USERELATIONSHIP). */
export interface BiRelation {
  coluna: string
  tabela: string
  chave: string
  ativa?: boolean
}

export interface BiSql {
  /** Expressão da chave da paginação (única e ordenável). */
  key: string
  keyType: 'uuid' | 'int' | 'text'
  /** FROM com os JOINs. */
  from: string
  /** Condição da empresa ($1) e de exclusão lógica. */
  where: string
  /** Data principal da janela padrão (fatos) e do "desde" quando não há data de alteração. */
  janela?: { expr: string; kind: 'ts' | 'date' }
  /** Data/hora da última alteração (para o "desde"). */
  alterado?: string
}

export interface BiTable {
  nome: string
  tipo: 'dimensao' | 'fato'
  descricao: string
  /** O que é uma linha. */
  grao: string
  /** Coluna chave (única) da tabela. */
  chave: string
  colunas: BiColumn[]
  relacoes: BiRelation[]
  /** Colunas de data para ligar ao calendário: a primeira é a relação ativa, as outras inativas. */
  datas: string[]
  /** Como funciona a janela padrão e o "desde" (texto do contrato). */
  janela?: string
  desde?: string
  sql?: BiSql
  /** Lida por código (não por um SQL só). */
  custom?: boolean
}

// ---------- Expressões ----------

const TZ = 'America/Sao_Paulo'
/** Timestamp do banco (UTC, sem fuso) no horário de Brasília. */
const sp = (c: string) => `((${c}) AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}'`
const dt = (c: string) => `to_char(${sp(c)}, 'YYYY-MM-DD"T"HH24:MI:SS')`
const dia = (c: string) => `to_char(${sp(c)}, 'YYYY-MM-DD')`
/** Coluna que já é data (@db.Date). */
const dd = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`
const num = (c: string) => `(${c})::float8`
const int = (c: string) => `(${c})::int`
const txt = (c: string) => `(${c})::text`
const minBetween = (a: string, b: string) => `round((extract(epoch from ((${b}) - (${a}))) / 60.0)::numeric, 1)::float8`

const col = (nome: string, tipo: ColType, nulo: boolean, descricao: string, sql?: string): BiColumn => ({ nome, tipo, nulo, descricao, ...(sql ? { sql } : {}) })
const rel = (coluna: string, tabela: string, chave: string, ativa = true): BiRelation => ({ coluna, tabela, chave, ...(ativa ? {} : { ativa: false }) })

const JANELA = 'Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal.'

// ---------- Dimensões ----------

const lookup = (nome: string, type: string, id: string, descricao: string, oque: string): BiTable => ({
  nome,
  tipo: 'dimensao',
  descricao,
  grao: `Um ${oque} da lista do atendimento (itens desativados continuam, para o histórico).`,
  chave: id,
  colunas: [col(id, 'texto', false, 'Número interno (uuid).', 'x.id::text'), col('nome', 'texto', false, 'Nome do item.', 'x.name'), col('ativo', 'booleano', false, 'Ainda aparece para escolher.', 'x.active')],
  relacoes: [],
  datas: [],
  sql: { key: 'x.id', keyType: 'uuid', from: 'lookup_items x', where: `x."tenantId" = $1::uuid AND x.type = '${type}'` },
})

const DIMENSOES: BiTable[] = [
  {
    nome: 'dim_filial',
    tipo: 'dimensao',
    descricao: 'Unidades da empresa (matriz e filiais).',
    grao: 'Uma unidade.',
    chave: 'filial_id',
    colunas: [
      col('filial_id', 'texto', false, 'Número interno (uuid).', 'u.id::text'),
      col('nome', 'texto', false, 'Nome da unidade.', 'u.name'),
      col('cidade', 'texto', true, 'Cidade.', 'u.city'),
      col('uf', 'texto', true, 'UF (2 letras).', 'u.state'),
      col('matriz', 'booleano', false, 'É a matriz.', 'u."isHeadquarters"'),
      col('ativa', 'booleano', false, 'Unidade ativa.', 'u.active'),
    ],
    relacoes: [],
    datas: [],
    sql: { key: 'u.id', keyType: 'uuid', from: 'units u', where: 'u."tenantId" = $1::uuid' },
  },
  {
    nome: 'dim_vendedor',
    tipo: 'dimensao',
    descricao: 'Vendedores do atendimento (com ou sem login).',
    grao: 'Um vendedor.',
    chave: 'vendedor_id',
    colunas: [
      col('vendedor_id', 'texto', false, 'Número interno (uuid).', 's.id::text'),
      col('nome', 'texto', false, 'Nome do vendedor.', 's.name'),
      col('filial_id', 'texto', true, 'Unidade do vendedor.', 's."unitId"::text'),
      col('usuario_id', 'texto', true, 'Login ligado ao vendedor (dim_usuario).', 's."userId"::text'),
      col('ativo', 'booleano', false, 'Vendedor ativo.', 's.active'),
    ],
    relacoes: [rel('filial_id', 'dim_filial', 'filial_id', false)],
    datas: [],
    sql: { key: 's.id', keyType: 'uuid', from: 'sellers s', where: 's."tenantId" = $1::uuid' },
  },
  {
    nome: 'dim_usuario',
    tipo: 'dimensao',
    descricao: 'Pessoas com login no CRM (atendentes, gestores). Excluídos continuam, para o histórico.',
    grao: 'Um usuário.',
    chave: 'usuario_id',
    colunas: [
      col('usuario_id', 'texto', false, 'Número interno (uuid).', 'u.id::text'),
      col('nome', 'texto', false, 'Nome da pessoa.', 'u.name'),
      col('perfil', 'texto', false, 'Perfil de acesso.', 'pf.name'),
      col('filial_id', 'texto', true, 'Unidade da pessoa.', 'u."unitId"::text'),
      col('vendedor_id', 'texto', true, 'Vendedor ligado ao login.', '(SELECT s.id::text FROM sellers s WHERE s."userId" = u.id LIMIT 1)'),
      col('ativo', 'booleano', false, 'Pode entrar no sistema (ativo e não excluído).', '(u.active AND u."deletedAt" IS NULL)'),
      col('excluido', 'booleano', false, 'Excluído (some das listas; o nome fica no histórico).', '(u."deletedAt" IS NOT NULL)'),
    ],
    relacoes: [rel('filial_id', 'dim_filial', 'filial_id', false)],
    datas: [],
    sql: { key: 'u.id', keyType: 'uuid', from: 'users u JOIN roles pf ON pf.id = u."roleId"', where: 'u."tenantId" = $1::uuid' },
  },
  lookup('dim_origem', 'ORIGEM', 'origem_id', 'Origens do lead e do atendimento (lista Origens: Google, Indicação, WhatsApp - <número>...). A campanha do anúncio fica nos fatos.', 'item'),
  lookup('dim_tipo_cliente', 'TIPO_CLIENTE', 'tipo_cliente_id', 'Tipos de cliente do atendimento.', 'item'),
  lookup('dim_motivo_perda', 'MOTIVO_PERDA', 'motivo_perda_id', 'Motivos de perda da pré-venda.', 'item'),
  {
    nome: 'dim_numero_whatsapp',
    tipo: 'dimensao',
    descricao: 'Números de WhatsApp da empresa ligados ao CRM (sem o telefone).',
    grao: 'Um número.',
    chave: 'numero_id',
    colunas: [
      col('numero_id', 'texto', false, 'Número interno (uuid).', 'n.id::text'),
      col('nome', 'texto', false, 'Nome dado ao número no CRM.', 'n.name'),
      col('filial_id', 'texto', true, 'Unidade do número.', 'n."unitId"::text'),
      col('finalidade', 'texto', false, 'ATENDIMENTO ou MONITORAMENTO.', 'n.purpose'),
      col('situacao', 'texto', false, 'CONECTADO, CONECTANDO ou DESCONECTADO.', 'n.status'),
      col('abre_pre_venda', 'booleano', false, 'Conversa nova abre pré-venda.', 'n."createRecords"'),
      col('atendimento_dividido', 'booleano', false, 'Cada conversa tem um atendente.', 'n."splitAttendance"'),
      col('excluido', 'booleano', false, 'Número removido do CRM.', '(n."deletedAt" IS NOT NULL)'),
    ],
    relacoes: [rel('filial_id', 'dim_filial', 'filial_id', false)],
    datas: [],
    sql: { key: 'n.id', keyType: 'uuid', from: 'whatsapp_numbers n', where: 'n."tenantId" = $1::uuid' },
  },
  {
    nome: 'dim_setor',
    tipo: 'dimensao',
    descricao: 'Setores de atendimento do WhatsApp (Vendas, Pós-venda, Financeiro...).',
    grao: 'Um setor.',
    chave: 'setor_id',
    colunas: [
      col('setor_id', 'texto', false, 'Número interno (uuid).', 's.id::text'),
      col('nome', 'texto', false, 'Nome do setor.', 's.name'),
      col('ativo', 'booleano', false, 'Setor ativo.', 's.active'),
    ],
    relacoes: [],
    datas: [],
    sql: { key: 's.id', keyType: 'uuid', from: 'whatsapp_sectors s', where: 's."tenantId" = $1::uuid' },
  },
  {
    nome: 'dim_produto',
    tipo: 'dimensao',
    descricao: 'Catálogo da loja virtual (Magazord). Grupo e subgrupo vêm do ERP (Tcar) quando o SKU é o mesmo código de lá. Sem custo.',
    grao: 'Uma derivação (SKU) da loja.',
    chave: 'produto_id',
    colunas: [
      col('produto_id', 'texto', false, 'Número interno (uuid).', 'p.id::text'),
      col('sku', 'texto', false, 'Código (SKU) da derivação na loja.', 'p.code'),
      col('derivacao_id', 'texto', false, 'Id da derivação na Magazord.', 'p."externalId"'),
      col('nome', 'texto', false, 'Nome do produto.', 'p.name'),
      col('marca', 'texto', true, 'Marca.', 'p.brand'),
      col('grupo', 'texto', true, 'Grupo do produto no ERP (Tcar).', 't."groupName"'),
      col('subgrupo', 'texto', true, 'Subgrupo do produto no ERP (Tcar).', 't."subgroupName"'),
      col('preco', 'moeda', true, 'Preço de venda atual na loja (R$).', num('p.price')),
      col('preco_de', 'moeda', true, 'Preço "de" (antes do desconto), R$.', num('p."priceFrom"')),
      col('estoque', 'inteiro', true, 'Estoque informado pela loja.', 'p.stock'),
      col('ativo', 'booleano', false, 'Apareceu na última sincronização da loja.', 'p.active'),
    ],
    relacoes: [],
    datas: [],
    sql: {
      key: 'p.id',
      keyType: 'uuid',
      from: `store_products p LEFT JOIN tcar_products t ON t."tenantId" = p."tenantId" AND t.code = p.code AND p.code <> ''`,
      where: 'p."tenantId" = $1::uuid',
    },
  },
  {
    nome: 'dim_transportadora',
    tipo: 'dimensao',
    descricao: 'Transportadoras e prestadores do módulo de fretes (fornecedores da empresa).',
    grao: 'Uma transportadora.',
    chave: 'transportadora_id',
    colunas: [
      col('transportadora_id', 'texto', false, 'Número interno (uuid).', 'c.id::text'),
      col('nome', 'texto', false, 'Nome da transportadora.', 'coalesce(nullif(c."quoteName", \'\'), c.name)'),
      col('tipo', 'texto', false, 'TRANSPORTADORA ou PRESTADOR.', 'c.kind'),
      col('cidade', 'texto', true, 'Cidade.', 'c.city'),
      col('uf', 'texto', true, 'UF.', 'c.state'),
      col('ativa', 'booleano', false, 'Ativa.', 'c.active'),
    ],
    relacoes: [],
    datas: [],
    sql: { key: 'c.id', keyType: 'uuid', from: 'freight_carriers c', where: 'c."tenantId" = $1::uuid' },
  },
  {
    nome: 'dim_brinde',
    tipo: 'dimensao',
    descricao: 'Brindes cadastrados no Controle de brindes.',
    grao: 'Um brinde.',
    chave: 'brinde_id',
    colunas: [
      col('brinde_id', 'texto', false, 'Número interno (uuid).', 'g.id::text'),
      col('nome', 'texto', false, 'Nome do brinde.', 'g.name'),
      col('custo_unitario', 'moeda', false, 'Valor unitário atual (R$).', num('g."unitCost"')),
      col('estoque', 'inteiro', false, 'Estoque atual.', 'g.stock'),
      col('ativo', 'booleano', false, 'Ativo.', 'g.active'),
    ],
    relacoes: [],
    datas: [],
    sql: { key: 'g.id', keyType: 'uuid', from: 'gifts g', where: 'g."tenantId" = $1::uuid' },
  },
]

// ---------- Fatos ----------

const FATOS: BiTable[] = [
  {
    nome: 'fato_leads',
    tipo: 'fato',
    descricao: 'Base de leads (pessoas identificadas), sem nome, telefone nem e-mail.',
    grao: 'Um lead.',
    chave: 'lead_id',
    colunas: [
      col('lead_id', 'texto', false, 'Número interno do lead (uuid).', 'l.id::text'),
      col('criado_em', 'datahora', false, 'Quando entrou na base.', dt('l."createdAt"')),
      col('data_criacao', 'data', false, 'Dia em que entrou na base.', dia('l."createdAt"')),
      col('estagio', 'texto', false, 'LEAD, QUALIFICADO, OPORTUNIDADE ou CLIENTE.', txt('l.stage')),
      col('filial_id', 'texto', true, 'Unidade.', 'l."unitId"::text'),
      col('origem_id', 'texto', true, 'Origem (dim_origem).', 'l."originId"::text'),
      col('vendedor_id', 'texto', true, 'Responsável pelo lead.', 'l."ownerId"::text'),
      col('vendedor_carteira_id', 'texto', true, 'Vendedor da carteira do cliente.', 'l."clientSellerId"::text'),
      col('pais', 'texto', false, 'País (BR...).', 'l.country'),
      col('uf', 'texto', true, 'UF.', 'l.state'),
      col('cidade', 'texto', true, 'Cidade.', 'l.city'),
      col('nota', 'texto', true, 'Nota do lead scoring (A a D).', 'l."scoreGrade"'),
      col('pontos_perfil', 'inteiro', false, 'Pontos de perfil.', 'l."scoreProfile"'),
      col('pontos_interesse', 'inteiro', false, 'Pontos de interesse.', 'l."scoreInterest"'),
      col('fonte_primeira_conversao', 'texto', true, 'utm_source da 1ª conversão.', `l."firstConversion"->>'source'`),
      col('meio_primeira_conversao', 'texto', true, 'utm_medium da 1ª conversão.', `l."firstConversion"->>'medium'`),
      col('campanha_primeira_conversao', 'texto', true, 'utm_campaign da 1ª conversão.', `l."firstConversion"->>'campaign'`),
      col('passou_por_anuncio_google', 'booleano', false, 'Clicou num anúncio do Google Ads (campanha conhecida).', '(l."adsFirstCampaignId" IS NOT NULL)'),
      col('campanha_google_id', 'texto', true, 'Primeira campanha do Google Ads.', 'l."adsFirstCampaignId"'),
      col('campanha_google', 'texto', true, 'Nome da primeira campanha do Google Ads.', 'l."adsFirstCampaign"'),
      col('primeira_conversao_em', 'datahora', true, 'Primeira conversão (formulário, WhatsApp...).', dt('l."firstConversionAt"')),
      col('ultima_conversao_em', 'datahora', true, 'Última conversão.', dt('l."lastConversionAt"')),
      col('ultima_oportunidade_em', 'datahora', true, 'Última oportunidade (pré-venda).', dt('l."lastOpportunityAt"')),
      col('ultima_venda_em', 'datahora', true, 'Última venda.', dt('l."lastSaleAt"')),
      col('valor_ultima_venda', 'moeda', true, 'Valor da última venda (R$).', num('l."lastSaleValue"')),
      col('aceita_email', 'booleano', false, 'Permite e-mail marketing (LGPD) e não descadastrou.', '(l."emailOptIn" AND l."emailOptOutAt" IS NULL)'),
      col('cliente_loja', 'booleano', false, 'Tem cadastro na loja virtual.', '(l."ecommerceId" IS NOT NULL)'),
      col('anonimizado', 'booleano', false, 'Dados pessoais apagados a pedido (fica só para estatística).', '(l."anonymizedAt" IS NOT NULL)'),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('l."updatedAt"')),
    ],
    relacoes: [rel('filial_id', 'dim_filial', 'filial_id'), rel('origem_id', 'dim_origem', 'origem_id'), rel('vendedor_id', 'dim_vendedor', 'vendedor_id'), rel('vendedor_carteira_id', 'dim_vendedor', 'vendedor_id', false)],
    datas: ['data_criacao'],
    janela: JANELA + ' Data principal: criado_em.',
    desde: 'Leads criados ou alterados desde a data (atualizado_em).',
    sql: { key: 'l.id', keyType: 'uuid', from: 'leads l', where: 'l."tenantId" = $1::uuid AND l."deletedAt" IS NULL', janela: { expr: 'l."createdAt"', kind: 'ts' }, alterado: 'l."updatedAt"' },
  },
  {
    nome: 'fato_atendimentos',
    tipo: 'fato',
    descricao: 'Pré-vendas e pós-vendas: datas do lead, repasse, primeira ação, resultado e fechamento; venda, valor, perda, vendedor, origem e Google Ads.',
    grao: 'Um atendimento (pré-venda ou pós-venda).',
    chave: 'atendimento_id',
    colunas: [
      col('atendimento_id', 'texto', false, 'Número interno (uuid).', 'r.id::text'),
      col('tipo', 'texto', false, 'PRE_VENDAS ou POS_VENDAS.', txt('r.kind')),
      col('pre_venda_id', 'texto', true, 'Pós-venda: a pré-venda que o originou.', 'r."parentId"::text'),
      col('lead_id', 'texto', true, 'Lead ligado (fato_leads).', 'r."leadId"::text'),
      col('lead_em', 'datahora', false, 'Quando o contato chegou.', dt('r."leadAt"')),
      col('data_lead', 'data', false, 'Dia em que o contato chegou.', dia('r."leadAt"')),
      col('vendedor_id', 'texto', true, 'Vendedor.', 'r."sellerId"::text'),
      col('filial_id', 'texto', true, 'Unidade.', 'r."unitId"::text'),
      col('origem_id', 'texto', true, 'Origem (dim_origem).', 'r."originId"::text'),
      col('tipo_cliente_id', 'texto', true, 'Tipo de cliente.', 'r."customerTypeId"::text'),
      col('motivo_perda_id', 'texto', true, 'Motivo da perda.', 'r."lostReasonId"::text'),
      col('pais', 'texto', false, 'País.', 'r.country'),
      col('uf', 'texto', true, 'UF.', 'r.state'),
      col('cidade', 'texto', true, 'Cidade.', 'r.city'),
      col('repassado', 'booleano', false, 'Repassado ao vendedor.', 'r.forwarded'),
      col('repassado_em', 'datahora', true, 'Quando foi repassado.', dt('r."forwardedAt"')),
      col('retorno', 'texto', true, 'Retorno do vendedor: SIM, NAO ou PENDENTE.', txt('r."returnStatus"')),
      col('retorno_em', 'datahora', true, 'Quando o retorno foi marcado.', dt('r."returnedAt"')),
      col('primeira_acao_em', 'datahora', true, 'Pós-venda: primeiro contato.', dt('r."firstActionAt"')),
      col('chamou_cliente_em', 'datahora', true, 'Última vez que marcaram "Chamei o cliente".', dt('r."calledAt"')),
      col('situacao_venda', 'texto', false, 'SIM (vendeu), NAO (perdeu) ou NEGOCIACAO.', txt('r."saleStatus"')),
      col('venda', 'booleano', false, 'Vendeu (situacao_venda = SIM).', `(r."saleStatus" = 'SIM')`),
      col('valor_venda', 'moeda', true, 'Valor da venda (R$).', num('r."saleValue"')),
      col('resultado_em', 'datahora', true, 'Quando a venda ou a perda foi marcada.', dt('r."resultAt"')),
      col('data_resultado', 'data', true, 'Dia do resultado.', dia('r."resultAt"')),
      col('fechado_em', 'datahora', true, 'Atendimento encerrado.', dt('r."closedAt"')),
      col('acompanhamento', 'texto', true, 'Pós-venda: PENDENTE, CONTATADO, ANALISANDO, RESOLVIDO ou VOLTOU_AO_VENDEDOR.', txt('r."followStatus"')),
      col('prazo_acompanhamento_em', 'datahora', true, 'Pós-venda: prazo do primeiro contato.', dt('r."dueAt"')),
      col('veio_google_ads', 'booleano', false, 'Clicou num anúncio do Google Ads antes do contato (origem sozinha não conta).', `(r."adsVia" IS NOT DISTINCT FROM 'ANUNCIO')`),
      col('campanha_google_id', 'texto', true, 'Campanha do anúncio (quando veio do Google Ads).', `CASE WHEN r."adsVia" = 'ANUNCIO' THEN r."adsCampaignId" END`),
      col('campanha_google', 'texto', true, 'Nome da campanha do anúncio.', `CASE WHEN r."adsVia" = 'ANUNCIO' THEN r."adsCampaign" END`),
      col('palavra_chave_google', 'texto', true, 'Palavra-chave do anúncio (utm_term).', `CASE WHEN r."adsVia" = 'ANUNCIO' THEN r."adsTerm" END`),
      col('canal_entrada', 'texto', true, 'Por onde entrou no site (formulário, pop-up ou botão de WhatsApp).', 'r."entryChannel"'),
      col('pagina_entrada', 'texto', true, 'Página por onde chegou (sem parâmetros).', 'r."entryPage"'),
      col('minutos_ate_repasse', 'decimal', true, 'Minutos do contato até o repasse ao vendedor.', minBetween('r."leadAt"', 'r."forwardedAt"')),
      col('minutos_ate_primeira_acao', 'decimal', true, 'Pós-venda: minutos até o primeiro contato.', minBetween('r."leadAt"', 'r."firstActionAt"')),
      col('horas_ate_resultado', 'decimal', true, 'Horas do contato até a venda ou perda.', `round((extract(epoch from (r."resultAt" - r."leadAt")) / 3600.0)::numeric, 1)::float8`),
      col('criado_em', 'datahora', false, 'Registro criado.', dt('r."createdAt"')),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('r."updatedAt"')),
    ],
    relacoes: [
      rel('vendedor_id', 'dim_vendedor', 'vendedor_id'),
      rel('filial_id', 'dim_filial', 'filial_id'),
      rel('origem_id', 'dim_origem', 'origem_id'),
      rel('tipo_cliente_id', 'dim_tipo_cliente', 'tipo_cliente_id'),
      rel('motivo_perda_id', 'dim_motivo_perda', 'motivo_perda_id'),
    ],
    datas: ['data_lead', 'data_resultado'],
    janela: JANELA + ' Data principal: lead_em.',
    desde: 'Atendimentos criados ou alterados desde a data (atualizado_em). Excluídos não aparecem.',
    sql: { key: 'r.id', keyType: 'uuid', from: 'service_records r', where: 'r."tenantId" = $1::uuid AND r."deletedAt" IS NULL', janela: { expr: 'r."leadAt"', kind: 'ts' }, alterado: 'r."updatedAt"' },
  },
  {
    nome: 'fato_conversas_whatsapp',
    tipo: 'fato',
    descricao:
      'Atendimentos do WhatsApp (mesma regra do painel: começa depois de mais de 24 h sem mensagem na conversa). Tempos de resposta e contagem de mensagens, sem textos. Grupos ficam de fora.',
    grao: 'Um atendimento de uma conversa (número da empresa + contato).',
    chave: 'atendimento_wa_id',
    colunas: [
      col('atendimento_wa_id', 'texto', false, 'conversa_id + ":" + início (milissegundos). Estável entre leituras.'),
      col('conversa_id', 'texto', false, 'Conversa (uuid).'),
      col('numero_id', 'texto', false, 'Número de WhatsApp da empresa.'),
      col('setor_id', 'texto', true, 'Setor atual da conversa.'),
      col('atendente_id', 'texto', true, 'Atendente atual da conversa (dim_usuario).'),
      col('vendedor_id', 'texto', true, 'Vendedor ligado à conversa.'),
      col('lead_id', 'texto', true, 'Lead do contato.'),
      col('atendimento_id', 'texto', true, 'Pré-venda ligada à conversa (fato_atendimentos).'),
      col('categoria', 'texto', false, 'CLIENTE, COLEGA, FORNECEDOR ou OUTRO.'),
      col('iniciado_por', 'texto', false, 'cliente ou empresa.'),
      col('inicio_em', 'datahora', false, 'Primeira mensagem do atendimento.'),
      col('data_inicio', 'data', false, 'Dia do início.'),
      col('fim_em', 'datahora', false, 'Última mensagem do atendimento.'),
      col('primeira_mensagem_cliente_em', 'datahora', true, 'Primeira mensagem do cliente (quando ele escreveu antes da empresa).'),
      col('primeira_resposta_em', 'datahora', true, 'Primeira resposta da empresa a essa mensagem.'),
      col('minutos_primeira_resposta', 'decimal', true, 'Minutos até a primeira resposta (corridos).'),
      col('minutos_primeira_resposta_comercial', 'decimal', true, 'Minutos até a primeira resposta, só no horário comercial das regras do WhatsApp.'),
      col('respondido_por_id', 'texto', true, 'Quem deu a primeira resposta pelo CRM (dim_usuario); vazio se foi pelo celular ou sem resposta.'),
      col('respondido_pelo_celular', 'booleano', false, 'A primeira resposta saiu do celular (fora do CRM).'),
      col('mensagens_cliente', 'inteiro', false, 'Mensagens recebidas do cliente.'),
      col('mensagens_empresa', 'inteiro', false, 'Mensagens enviadas pela empresa (sem notas internas).'),
      col('vezes_cliente', 'inteiro', false, 'Vezes em que o cliente escreveu (mensagens seguidas contam uma).'),
      col('vezes_respondidas', 'inteiro', false, 'Vezes do cliente que tiveram resposta.'),
      col('minutos_resposta_media', 'decimal', true, 'Média dos tempos de resposta do atendimento (minutos corridos).'),
      col('aguardando_resposta', 'booleano', false, 'Último atendimento da conversa, cliente esperando resposta agora.'),
      col('minutos_aguardando', 'decimal', true, 'Há quantos minutos o cliente espera (quando aguardando_resposta).'),
    ],
    relacoes: [
      rel('numero_id', 'dim_numero_whatsapp', 'numero_id'),
      rel('setor_id', 'dim_setor', 'setor_id'),
      rel('atendente_id', 'dim_usuario', 'usuario_id'),
      rel('respondido_por_id', 'dim_usuario', 'usuario_id', false),
      rel('vendedor_id', 'dim_vendedor', 'vendedor_id'),
    ],
    datas: ['data_inicio'],
    janela: JANELA + ' Data principal: inicio_em (conversas com mensagem na janela).',
    desde: 'Todos os atendimentos (dentro da janela padrão) das conversas com mensagem desde a data. A página traz um lote de conversas, então o número de linhas por página varia.',
    custom: true,
  },
  {
    nome: 'fato_pedidos_loja',
    tipo: 'fato',
    descricao: 'Pedidos da loja virtual (Magazord). UF e cidade vêm do lead do pedido. O frete do pedido não é copiado da loja (não há coluna de frete).',
    grao: 'Um pedido.',
    chave: 'pedido_id',
    colunas: [
      col('pedido_id', 'texto', false, 'Número interno (uuid).', 'o.id::text'),
      col('codigo', 'texto', false, 'Código do pedido na loja.', 'o.code'),
      col('pedido_em', 'datahora', false, 'Data e hora do pedido.', dt('o."orderedAt"')),
      col('data_pedido', 'data', false, 'Dia do pedido.', dia('o."orderedAt"')),
      col('situacao_codigo', 'inteiro', false, 'Código da situação na Magazord.', 'o."statusCode"'),
      col('situacao', 'texto', false, 'Nome da situação.', 'o."statusName"'),
      col('grupo_situacao', 'texto', false, 'pago (aprovado, faturado, enviado, entregue), pendente ou cancelado.', 'o."statusGroup"'),
      col('pagamento', 'texto', true, 'Forma de pagamento.', 'o.payment'),
      col('canal', 'texto', true, 'Canal de venda: Site, marketplace, Manual ou PDV.', 'o.channel'),
      col('total', 'moeda', false, 'Total do pedido (R$).', num('o.total')),
      col('qtd_itens', 'inteiro', true, 'Soma das quantidades dos itens (vazio se os itens ainda não foram lidos).', `CASE WHEN o."itemsAt" IS NOT NULL THEN (SELECT coalesce(sum(i.quantity), 0)::int FROM ecommerce_order_items i WHERE i."orderId" = o.id) END`),
      col('qtd_produtos', 'inteiro', true, 'Linhas de produto do pedido.', `CASE WHEN o."itemsAt" IS NOT NULL THEN (SELECT count(*)::int FROM ecommerce_order_items i WHERE i."orderId" = o.id) END`),
      col('lead_id', 'texto', true, 'Lead do cliente.', 'o."leadId"::text'),
      col('uf', 'texto', true, 'UF do cliente (do lead).', 'l.state'),
      col('cidade', 'texto', true, 'Cidade do cliente (do lead).', 'l.city'),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('o."updatedAt"')),
    ],
    relacoes: [],
    datas: ['data_pedido'],
    janela: JANELA + ' Data principal: pedido_em.',
    desde: 'Pedidos criados ou alterados desde a data.',
    sql: { key: 'o.id', keyType: 'uuid', from: 'ecommerce_orders o LEFT JOIN leads l ON l.id = o."leadId"', where: 'o."tenantId" = $1::uuid', janela: { expr: 'o."orderedAt"', kind: 'ts' }, alterado: 'o."updatedAt"' },
  },
  {
    nome: 'fato_itens_pedido',
    tipo: 'fato',
    descricao: 'Produtos dos pedidos da loja virtual (lidos do detalhe do pedido).',
    grao: 'Um produto de um pedido.',
    chave: 'item_id',
    colunas: [
      col('item_id', 'texto', false, 'Número interno (uuid).', 'i.id::text'),
      col('pedido_id', 'texto', false, 'Pedido (fato_pedidos_loja).', 'i."orderId"::text'),
      col('data_pedido', 'data', false, 'Dia do pedido.', dia('o."orderedAt"')),
      col('grupo_situacao', 'texto', false, 'Situação do pedido: pago, pendente ou cancelado.', 'o."statusGroup"'),
      col('canal', 'texto', true, 'Canal de venda do pedido.', 'o.channel'),
      col('sku', 'texto', true, 'Código (SKU) da derivação.', 'i.sku'),
      col('produto_id', 'texto', true, 'Produto do catálogo com o mesmo SKU (dim_produto).', `(SELECT p.id::text FROM store_products p WHERE p."tenantId" = i."tenantId" AND p.code = i.sku ORDER BY p.active DESC, p."updatedAt" DESC LIMIT 1)`),
      col('nome', 'texto', false, 'Nome do produto no pedido.', 'i.name'),
      col('marca', 'texto', true, 'Marca.', 'i.brand'),
      col('quantidade', 'inteiro', false, 'Quantidade.', 'i.quantity'),
      col('total', 'moeda', false, 'Valor total do item, já com desconto (R$).', num('i.total')),
    ],
    relacoes: [rel('produto_id', 'dim_produto', 'produto_id')],
    datas: ['data_pedido'],
    janela: JANELA + ' Data principal: data do pedido.',
    desde: 'Itens dos pedidos alterados desde a data.',
    sql: { key: 'i.id', keyType: 'uuid', from: 'ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"', where: 'i."tenantId" = $1::uuid', janela: { expr: 'o."orderedAt"', kind: 'ts' }, alterado: 'o."updatedAt"' },
  },
  {
    nome: 'fato_carrinhos',
    tipo: 'fato',
    descricao: 'Carrinhos da loja virtual (aberto, abandonado ou comprado) e o contato de recuperação.',
    grao: 'Um carrinho.',
    chave: 'carrinho_id',
    colunas: [
      col('carrinho_id', 'texto', false, 'Número interno (uuid).', 'c.id::text'),
      col('situacao_codigo', 'inteiro', false, '1 aberto, 2 abandonado, 3 comprado.', 'c.status'),
      col('situacao', 'texto', false, 'aberto, abandonado ou comprado.', `CASE c.status WHEN 1 THEN 'aberto' WHEN 2 THEN 'abandonado' WHEN 3 THEN 'comprado' ELSE 'outro' END`),
      col('iniciado_em', 'datahora', false, 'Início do carrinho.', dt('coalesce(c."startedAt", c."createdAt")')),
      col('data_inicio', 'data', false, 'Dia do início.', dia('coalesce(c."startedAt", c."createdAt")')),
      col('ultima_atividade_em', 'datahora', true, 'Última atividade.', dt('c."lastActivityAt"')),
      col('chegou_checkout', 'booleano', false, 'Preencheu o endereço de entrega.', 'c."checkoutStarted"'),
      col('qtd_itens', 'inteiro', false, 'Itens no carrinho.', 'c."itemCount"'),
      col('valor', 'moeda', true, 'Valor do carrinho (R$).', num('c.value')),
      col('pedido_codigo', 'texto', true, 'Código do pedido, quando comprado.', 'c."orderCode"'),
      col('status_contato', 'texto', false, 'Recuperação: PENDENTE, CONTATADO...', 'c."contactStatus"'),
      col('contatado_em', 'datahora', true, 'Quando a equipe fez o contato.', dt('c."contactedAt"')),
      col('lead_id', 'texto', true, 'Lead do cliente.', 'c."leadId"::text'),
      col('uf', 'texto', true, 'UF do cliente (do lead).', 'l.state'),
      col('cidade', 'texto', true, 'Cidade do cliente (do lead).', 'l.city'),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('c."updatedAt"')),
    ],
    relacoes: [],
    datas: ['data_inicio'],
    janela: JANELA + ' Data principal: iniciado_em.',
    desde: 'Carrinhos criados ou alterados desde a data.',
    sql: { key: 'c.id', keyType: 'uuid', from: 'ecommerce_carts c LEFT JOIN leads l ON l.id = c."leadId"', where: 'c."tenantId" = $1::uuid', janela: { expr: 'coalesce(c."startedAt", c."createdAt")', kind: 'ts' }, alterado: 'c."updatedAt"' },
  },
  {
    nome: 'fato_ml_perguntas',
    tipo: 'fato',
    descricao: 'Perguntas do Mercado Livre no Assistente ML (sem o texto e sem o cliente).',
    grao: 'Uma pergunta.',
    chave: 'pergunta_id',
    colunas: [
      col('pergunta_id', 'inteiro', false, 'Número da pergunta no assistente.', 'q.id'),
      col('marketplace', 'texto', false, 'mercadolivre.', 'q.marketplace'),
      col('anuncio_ml_id', 'texto', true, 'Anúncio (MLB...).', 'q."mlItemId"'),
      col('recebida_em', 'datahora', false, 'Quando a pergunta chegou.', dt('q."receivedAt"')),
      col('data_recebida', 'data', false, 'Dia em que chegou.', dia('q."receivedAt"')),
      col('situacao', 'texto', false, 'nova, aguardando_analise, em_atendimento, respondida, resolvida, nao_aplicavel...', 'q.status'),
      col('motivo_pendencia', 'texto', true, 'Motivo da pendência (A a G).', 'q."pendingReason"'),
      col('marca_maquina', 'texto', true, 'Marca da máquina identificada.', 'q.brand'),
      col('modelo_maquina', 'texto', true, 'Modelo da máquina identificado.', 'q.model'),
      col('codigo_peca', 'texto', true, 'Código da peça identificado.', 'q."partCode"'),
      col('intencao_compra', 'booleano', false, 'A pergunta mostra intenção de compra.', 'q."purchaseIntent"'),
      col('relevancia', 'inteiro', false, 'Relevância calculada.', 'q.relevance'),
      col('atendente_id', 'texto', true, 'Pessoa responsável (dim_usuario).', 'q."assignedToId"::text'),
      col('confianca_ia', 'decimal', true, 'Confiança da sugestão da IA (0 a 1).', 'q.confidence'),
      col('respondida_em', 'datahora', true, 'Respondida pelo CRM.', dt('q."answeredAt"')),
      col('respondida_fora_em', 'datahora', true, 'Respondida fora do CRM (Magazord ou direto no Mercado Livre).', dt('q."externalAnsweredAt"')),
      col('resolvida_em', 'datahora', true, 'Resolvida.', dt('q."resolvedAt"')),
      col('respondida_pelo_crm', 'booleano', false, 'A resposta saiu pelo CRM.', '(q."answeredAt" IS NOT NULL)'),
      col('minutos_resposta', 'decimal', true, 'Minutos da chegada até a resposta (CRM ou fora).', minBetween('q."receivedAt"', 'coalesce(q."answeredAt", q."externalAnsweredAt")')),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('q."updatedAt"')),
    ],
    relacoes: [rel('atendente_id', 'dim_usuario', 'usuario_id')],
    datas: ['data_recebida'],
    janela: JANELA + ' Data principal: recebida_em.',
    desde: 'Perguntas criadas ou alteradas desde a data.',
    sql: { key: 'q.id', keyType: 'int', from: 'assist_questions q', where: 'q."tenantId" = $1::uuid', janela: { expr: 'q."receivedAt"', kind: 'ts' }, alterado: 'q."updatedAt"' },
  },
  {
    nome: 'fato_ml_vendas',
    tipo: 'fato',
    descricao: 'Vendas do Mercado Livre ligadas a uma pergunta respondida (Assistente ML), sem o comprador.',
    grao: 'Um produto de um pedido do Mercado Livre ligado a uma pergunta.',
    chave: 'venda_id',
    colunas: [
      col('venda_id', 'inteiro', false, 'Número interno.', 'v.id'),
      col('pergunta_id', 'inteiro', false, 'Pergunta que levou à venda (fato_ml_perguntas).', 'v."questionId"'),
      col('pedido_ml', 'texto', false, 'Número do pedido no Mercado Livre.', 'v."mlOrderId"'),
      col('anuncio_ml_id', 'texto', false, 'Anúncio vendido.', 'v."mlItemId"'),
      col('titulo_anuncio', 'texto', true, 'Título do anúncio.', 'v."itemTitle"'),
      col('pedido_em', 'datahora', false, 'Data e hora do pedido.', dt('v."orderDate"')),
      col('data_pedido', 'data', false, 'Dia do pedido.', dia('v."orderDate"')),
      col('situacao_pedido', 'texto', true, 'Situação do pedido no Mercado Livre.', 'v."orderStatus"'),
      col('situacao_pagamento', 'texto', true, 'Situação do pagamento.', 'v."paymentStatus"'),
      col('quantidade', 'inteiro', false, 'Quantidade.', 'v.quantity'),
      col('preco_unitario', 'moeda', true, 'Preço unitário.', num('v."unitPrice"')),
      col('total', 'moeda', true, 'Total.', num('v.total')),
      col('moeda', 'texto', true, 'Moeda (BRL).', 'v.currency'),
      col('tipo_vinculo', 'texto', false, 'mesmo_anuncio ou anuncio_indicado.', 'v."matchType"'),
      col('horas_apos_pergunta', 'decimal', true, 'Horas entre a pergunta e o pedido.', 'v."hoursAfterQuestion"'),
      col('pago_antes', 'booleano', false, 'Pedido pago antes da pergunta (não conta como venda do assistente).', 'v."paidBefore"'),
    ],
    relacoes: [],
    datas: ['data_pedido'],
    janela: JANELA + ' Data principal: pedido_em.',
    desde: 'Vendas criadas ou alteradas desde a data.',
    sql: { key: 'v.id', keyType: 'int', from: 'assist_sales v', where: 'v."tenantId" = $1::uuid', janela: { expr: 'v."orderDate"', kind: 'ts' }, alterado: 'v."updatedAt"' },
  },
  {
    nome: 'fato_ml_ads_diario',
    tipo: 'fato',
    descricao: 'Mercado Livre Ads por dia: investimento, receita atribuída, vendas e funil. Traz o nível campanha e o nível anúncio: some só um nível (filtre nivel).',
    grao: 'Um dia de uma campanha (nivel = campaign) ou de um anúncio (nivel = ad).',
    chave: 'linha_id',
    colunas: [
      col('linha_id', 'texto', false, 'Número interno (uuid).', 'a.id::text'),
      col('data', 'data', false, 'Dia.', dd('a.date')),
      col('marketplace', 'texto', false, 'mercadolivre.', 'a.marketplace'),
      col('produto', 'texto', false, 'product_ads ou display.', 'a.product'),
      col('nivel', 'texto', false, 'campaign ou ad.', 'a.level'),
      col('campanha_id', 'texto', false, 'Campanha.', 'a."campaignId"'),
      col('campanha', 'texto', true, 'Nome da campanha.', 'c.name'),
      col('anuncio_id', 'texto', true, 'Anúncio (nível ad).', `CASE WHEN a.level = 'ad' THEN a."entityId" END`),
      col('anuncio', 'texto', true, 'Título do anúncio (nível ad).', 'ad.title'),
      col('impressoes', 'inteiro', false, 'Impressões.', 'a.impressions'),
      col('cliques', 'inteiro', false, 'Cliques.', 'a.clicks'),
      col('investimento', 'moeda', false, 'Custo (R$).', num('a.cost')),
      col('receita', 'moeda', false, 'Receita atribuída (direta + indireta).', num('a.revenue')),
      col('receita_direta', 'moeda', false, 'Receita direta.', num('a."directRevenue"')),
      col('receita_indireta', 'moeda', false, 'Receita indireta.', num('a."indirectRevenue"')),
      col('unidades', 'inteiro', false, 'Unidades vendidas atribuídas.', 'a.units'),
      col('unidades_organicas', 'inteiro', false, 'Unidades orgânicas.', 'a."organicUnits"'),
      col('receita_organica', 'moeda', false, 'Receita orgânica.', num('a."organicRevenue"')),
      col('visualizacoes', 'inteiro', false, 'Visitas ao anúncio.', 'a."pageViews"'),
      col('adicoes_carrinho', 'inteiro', false, 'Adições ao carrinho.', 'a."addToCart"'),
      col('checkouts', 'inteiro', false, 'Checkouts.', 'a.checkouts'),
      col('fonte', 'texto', false, 'api (CRM) ou bi (histórico trazido do Usaparts BI).', 'a.source'),
    ],
    relacoes: [],
    datas: ['data'],
    janela: JANELA + ' Data principal: data.',
    desde: 'Dias atualizados desde a data (o Mercado Livre revisa os últimos dias).',
    sql: {
      key: 'a.id',
      keyType: 'uuid',
      from: `marketplace_ad_days a
        LEFT JOIN marketplace_campaigns c ON c."tenantId" = a."tenantId" AND c.marketplace = a.marketplace AND c.product = a.product AND c."campaignId" = a."campaignId"
        LEFT JOIN marketplace_ads ad ON a.level = 'ad' AND ad."tenantId" = a."tenantId" AND ad.marketplace = a.marketplace AND ad."adId" = a."entityId"`,
      where: 'a."tenantId" = $1::uuid',
      janela: { expr: 'a.date', kind: 'date' },
      alterado: 'a."updatedAt"',
    },
  },
  {
    nome: 'fato_anuncios_diario',
    tipo: 'fato',
    descricao: 'Mídia paga por dia e campanha: Google Ads, Meta Ads e TikTok Ads (só leitura das contas).',
    grao: 'Um dia de uma campanha de uma plataforma.',
    chave: 'linha_id',
    colunas: [
      col('linha_id', 'texto', false, 'plataforma|campanha|data.', 'a.k'),
      col('data', 'data', false, 'Dia.', dd('a.date')),
      col('plataforma', 'texto', false, 'google, meta ou tiktok.', 'a.platform'),
      col('campanha_id', 'texto', false, 'Campanha na plataforma.', 'a."campaignId"'),
      col('campanha', 'texto', false, 'Nome da campanha.', 'a."campaignName"'),
      col('investimento', 'moeda', false, 'Valor investido no dia (moeda da conta, R$).', num('a.spend')),
      col('impressoes', 'inteiro', false, 'Impressões.', 'a.impressions'),
      col('cliques', 'inteiro', false, 'Cliques.', 'a.clicks'),
      col('conversoes', 'decimal', false, 'Conversões contadas pela plataforma.', num('a.conversions')),
      col('leads', 'inteiro', true, 'Meta/TikTok: leads de formulário.', 'a.leads'),
      col('conversas', 'inteiro', true, 'Meta/TikTok: conversas iniciadas.', 'a.conversations'),
    ],
    relacoes: [],
    datas: ['data'],
    janela: JANELA + ' Data principal: data.',
    desde: 'Dias atualizados desde a data.',
    sql: {
      key: 'a.k',
      keyType: 'text',
      from: `(
        SELECT g."tenantId", 'google'::text AS platform, g.date, g."campaignId", g."campaignName", g.cost AS spend, g.impressions, g.clicks, g.conversions,
          NULL::int AS leads, NULL::int AS conversations, g."updatedAt", 'google|' || g."campaignId" || '|' || to_char(g.date, 'YYYY-MM-DD') AS k
        FROM google_ads_campaign_days g
        UNION ALL
        SELECT m."tenantId", m.platform, m.date, m."campaignId", m."campaignName", m.spend, m.impressions, m.clicks, m.conversions,
          m.leads, m.conversations, m."updatedAt", m.platform || '|' || m."campaignId" || '|' || to_char(m.date, 'YYYY-MM-DD') AS k
        FROM mkt_ad_days m WHERE m.level = 'campaign'
      ) a`,
      where: 'a."tenantId" = $1::uuid',
      janela: { expr: 'a.date', kind: 'date' },
      alterado: 'a."updatedAt"',
    },
  },
  {
    nome: 'fato_email_campanhas',
    tipo: 'fato',
    descricao: 'Campanhas de e-mail marketing (e modelos das automações, tipo MODELO) com os totais de envio, aberturas e cliques.',
    grao: 'Uma campanha (ou modelo de automação).',
    chave: 'campanha_id',
    colunas: [
      col('campanha_id', 'texto', false, 'Número interno (uuid).', 'e.id::text'),
      col('nome', 'texto', false, 'Nome da campanha.', 'e.name'),
      col('assunto', 'texto', false, 'Assunto do e-mail.', 'e.subject'),
      col('tipo', 'texto', false, 'CAMPANHA ou MODELO (enviado pelas automações).', 'e.kind'),
      col('situacao', 'texto', false, 'RASCUNHO, AGENDADA, ENVIANDO, PAUSADA, ENVIADA ou CANCELADA.', txt('e.status')),
      col('agendada_em', 'datahora', true, 'Agendamento.', dt('e."scheduledAt"')),
      col('iniciada_em', 'datahora', true, 'Início do envio.', dt('e."startedAt"')),
      col('finalizada_em', 'datahora', true, 'Fim do envio.', dt('e."finishedAt"')),
      col('data_envio', 'data', false, 'Dia do envio (ou da criação, se ainda não enviou).', dia('coalesce(e."startedAt", e."scheduledAt", e."createdAt")')),
      col('destinatarios', 'inteiro', false, 'Destinatários.', 'e.total'),
      col('enviados', 'inteiro', false, 'Enviados.', 'e.sent'),
      col('falhas', 'inteiro', false, 'Recusados.', 'e.failed'),
      col('aberturas', 'inteiro', false, 'Aberturas (todas).', 'e.opens'),
      col('cliques', 'inteiro', false, 'Cliques (todos).', 'e.clicks'),
      col('descadastros', 'inteiro', false, 'Descadastros.', 'e.unsubscribes'),
      col('abriram', 'inteiro', false, 'Destinatários que abriram (únicos).', `(SELECT count(*)::int FROM email_recipients x WHERE x."campaignId" = e.id AND x."openedAt" IS NOT NULL)`),
      col('clicaram', 'inteiro', false, 'Destinatários que clicaram (únicos).', `(SELECT count(*)::int FROM email_recipients x WHERE x."campaignId" = e.id AND x."clickedAt" IS NOT NULL)`),
      col('criada_em', 'datahora', false, 'Criação.', dt('e."createdAt"')),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('e."updatedAt"')),
    ],
    relacoes: [],
    datas: ['data_envio'],
    janela: JANELA + ' Data principal: início do envio (ou criação).',
    desde: 'Campanhas criadas ou alteradas desde a data.',
    sql: { key: 'e.id', keyType: 'uuid', from: 'email_campaigns e', where: 'e."tenantId" = $1::uuid', janela: { expr: 'coalesce(e."startedAt", e."createdAt")', kind: 'ts' }, alterado: 'e."updatedAt"' },
  },
  {
    nome: 'fato_webpush',
    tipo: 'fato',
    descricao: 'Campanhas de Web Push da loja virtual: disparos, entregas e cliques.',
    grao: 'Uma campanha de Web Push.',
    chave: 'campanha_id',
    colunas: [
      col('campanha_id', 'texto', false, 'Número interno (uuid).', 'w.id::text'),
      col('nome', 'texto', false, 'Nome interno.', 'w.name'),
      col('titulo', 'texto', false, 'Título da notificação.', 'w.title'),
      col('situacao', 'texto', false, 'RASCUNHO, AGENDADO, ENVIANDO, ENVIADO, CANCELADO ou ERRO.', txt('w.status')),
      col('agendado_em', 'datahora', true, 'Agendamento.', dt('w."scheduledAt"')),
      col('enviado_em', 'datahora', true, 'Início do envio.', dt('w."sentAt"')),
      col('finalizado_em', 'datahora', true, 'Fim do envio.', dt('w."finishedAt"')),
      col('data_envio', 'data', false, 'Dia do envio (ou da criação).', dia('coalesce(w."sentAt", w."scheduledAt", w."createdAt")')),
      col('alvos', 'inteiro', false, 'Inscritos alcançados.', 'w.targets'),
      col('enviados', 'inteiro', false, 'Enviados.', 'w.sent'),
      col('falhas', 'inteiro', false, 'Falhas.', 'w.failed'),
      col('entregues', 'inteiro', false, 'Mostrados no aparelho.', 'w.delivered'),
      col('cliques', 'inteiro', false, 'Cliques.', 'w.clicks'),
      col('criado_em', 'datahora', false, 'Criação.', dt('w."createdAt"')),
      col('atualizado_em', 'datahora', false, 'Última alteração.', dt('w."updatedAt"')),
    ],
    relacoes: [],
    datas: ['data_envio'],
    janela: JANELA + ' Data principal: criação.',
    desde: 'Campanhas criadas ou alteradas desde a data.',
    sql: { key: 'w.id', keyType: 'uuid', from: 'web_push_campaigns w', where: 'w."tenantId" = $1::uuid', janela: { expr: 'w."createdAt"', kind: 'ts' }, alterado: 'w."updatedAt"' },
  },
  {
    nome: 'fato_frete_cotacoes',
    tipo: 'fato',
    descricao: 'Cotações de frete: destino (cidade/UF), carga, melhor preço e a transportadora escolhida. Sem cliente e sem CEP.',
    grao: 'Uma cotação.',
    chave: 'cotacao_id',
    colunas: [
      col('cotacao_id', 'texto', false, 'Número interno (uuid).', 'q.id::text'),
      col('codigo', 'inteiro', false, 'Número da cotação.', 'q.code'),
      col('filial_id', 'texto', false, 'Filial de origem.', 'q."unitId"::text'),
      col('data_cotacao', 'data', false, 'Dia da cotação.', dd('q."quoteDate"')),
      col('criada_em', 'datahora', false, 'Quando foi calculada.', dt('q."createdAt"')),
      col('criado_por_id', 'texto', false, 'Quem cotou (dim_usuario).', 'q."createdById"::text'),
      col('tipo_pessoa', 'texto', false, 'PF ou PJ.', 'q."personType"'),
      col('documento_erp', 'texto', true, 'ORCAMENTO ou PRE_NOTA (Tcar).', 'q."erpDocType"'),
      col('uf_destino', 'texto', true, 'UF do destino.', 'q."destUf"'),
      col('cidade_destino', 'texto', true, 'Cidade do destino.', 'q."destCity"'),
      col('valor_carga', 'moeda', false, 'Valor da mercadoria (R$).', num('q."cargoValue"')),
      col('peso_kg', 'decimal', false, 'Peso real (kg).', num('q."realWeight"')),
      col('metros_cubicos', 'decimal', false, 'Volume (m³).', num('q."cubicMeters"')),
      col('melhor_total', 'moeda', true, 'Menor frete calculado (R$).', num('q."bestTotal"')),
      col('situacao', 'texto', false, 'CALCULADA, SELECIONADA ou CANCELADA.', 'q.status'),
      col('transportadora_id', 'texto', true, 'Transportadora escolhida.', 'q."selectedCarrierId"::text'),
      col('total_escolhido', 'moeda', true, 'Frete da transportadora escolhida (R$).', num('q."selectedTotal"')),
      col('escolhida_em', 'datahora', true, 'Quando a transportadora foi escolhida.', dt('q."selectedAt"')),
      col('tabela_vencida_liberada', 'booleano', false, 'Usou tabela vencida com autorização.', '(q."expiredAllowedReason" IS NOT NULL)'),
    ],
    relacoes: [rel('filial_id', 'dim_filial', 'filial_id'), rel('transportadora_id', 'dim_transportadora', 'transportadora_id'), rel('criado_por_id', 'dim_usuario', 'usuario_id')],
    datas: ['data_cotacao'],
    janela: JANELA + ' Data principal: data_cotacao.',
    desde: 'Cotações criadas ou escolhidas desde a data.',
    sql: { key: 'q.id', keyType: 'uuid', from: 'freight_quotes q', where: 'q."tenantId" = $1::uuid', janela: { expr: 'q."quoteDate"', kind: 'date' }, alterado: 'coalesce(q."selectedAt", q."createdAt")' },
  },
  {
    nome: 'fato_ctes',
    tipo: 'fato',
    descricao: 'CT-es de frete: transportadora, rota (UF/cidade), valor, peso e a conciliação com a cotação ou a tabela. Sem os documentos das partes.',
    grao: 'Um CT-e.',
    chave: 'cte_id',
    colunas: [
      col('cte_id', 'texto', false, 'Número interno (uuid).', 'c.id::text'),
      col('numero', 'texto', true, 'Número do CT-e.', 'c.number'),
      col('serie', 'texto', true, 'Série.', 'c.series'),
      col('emitido_em', 'datahora', true, 'Emissão.', dt('c."issuedAt"')),
      col('data_emissao', 'data', false, 'Dia da emissão (ou da importação, se não houver).', dia('coalesce(c."issuedAt", c."createdAt")')),
      col('transportadora_id', 'texto', true, 'Transportadora.', 'c."carrierId"::text'),
      col('filial_id', 'texto', true, 'Filial.', 'c."unitId"::text'),
      col('uf_inicio', 'texto', true, 'UF de início.', 'c."ufIni"'),
      col('uf_fim', 'texto', true, 'UF de destino.', 'c."ufFim"'),
      col('cidade_inicio', 'texto', true, 'Cidade de início.', 'c."cityIni"'),
      col('cidade_fim', 'texto', true, 'Cidade de destino.', 'c."cityFim"'),
      col('cfop', 'texto', true, 'CFOP.', 'c.cfop'),
      col('valor_frete', 'moeda', false, 'Valor total do CT-e (R$).', num('c.total')),
      col('valor_carga', 'moeda', true, 'Valor da carga (R$).', num('c."cargoValue"')),
      col('peso_kg', 'decimal', true, 'Peso (kg).', num('c.weight')),
      col('situacao_fiscal', 'texto', false, 'NAO_VERIFICADO ou CANCELADO.', 'c."fiscalStatus"'),
      col('origem', 'texto', false, 'MANUAL (XML enviado) ou SEFAZ (captura automática).', 'c.source'),
      col('papel_empresa', 'texto', true, 'Papel da empresa no CT-e (TOMADOR, REMETENTE...), separados por vírgula.', `nullif(array_to_string(c."companyRoles", ','), '')`),
      col('situacao_conciliacao', 'texto', false, 'PENDENTE, CONCILIADO, DIVERGENTE, SEM_REFERENCIA, COMPRA ou CANCELADO.', 'c."recStatus"'),
      col('base_esperado', 'texto', true, 'De onde veio o valor esperado: COTACAO ou TABELA.', 'c."recSource"'),
      col('valor_esperado', 'moeda', true, 'Frete esperado (R$).', num('c."expectedTotal"')),
      col('diferenca', 'moeda', true, 'Cobrado menos esperado (R$).', num('c.difference')),
      col('conciliado_em', 'datahora', true, 'Conciliação.', dt('c."recAt"')),
      col('decisao', 'texto', true, 'APROVADO, APROVADO_COTADO ou CONTESTADO.', 'c.decision'),
      col('valor_aprovado', 'moeda', true, 'Valor aprovado para pagar (R$).', num('c."approvedValue"')),
      col('decidido_em', 'datahora', true, 'Decisão.', dt('c."decidedAt"')),
      col('situacao_contestacao', 'texto', true, 'ABERTA, ACEITA ou RECUSADA.', 'c."contestStatus"'),
      col('valor_credito', 'moeda', true, 'Crédito obtido na contestação (R$).', num('c."creditValue"')),
      col('fatura_id', 'texto', true, 'Fatura da transportadora.', 'c."invoiceId"::text'),
      col('pedido_expedicao_id', 'texto', true, 'Pedido de expedição ligado.', 'c."shipmentId"::text'),
      col('importado_em', 'datahora', false, 'Quando entrou no CRM.', dt('c."createdAt"')),
    ],
    relacoes: [rel('transportadora_id', 'dim_transportadora', 'transportadora_id'), rel('filial_id', 'dim_filial', 'filial_id')],
    datas: ['data_emissao'],
    janela: JANELA + ' Data principal: emissão.',
    desde: 'CT-es importados, conciliados ou decididos desde a data.',
    sql: { key: 'c.id', keyType: 'uuid', from: 'freight_ctes c', where: 'c."tenantId" = $1::uuid', janela: { expr: 'coalesce(c."issuedAt", c."createdAt")', kind: 'ts' }, alterado: 'greatest(c."createdAt", c."recAt", c."decidedAt")' },
  },
  {
    nome: 'fato_brindes',
    tipo: 'fato',
    descricao: 'Brindes entregues (retiradas) pelo vendedor ou pela filial, sem o cliente.',
    grao: 'Uma retirada.',
    chave: 'retirada_id',
    colunas: [
      col('retirada_id', 'texto', false, 'Número interno (uuid).', 'g.id::text'),
      col('data', 'data', false, 'Dia da retirada.', dd('g.date')),
      col('brinde_id', 'texto', false, 'Brinde.', 'g."giftId"::text'),
      col('titular', 'texto', false, 'VENDEDOR ou FILIAL (quem entregou).', `CASE WHEN g."sellerId" IS NOT NULL THEN 'VENDEDOR' ELSE 'FILIAL' END`),
      col('vendedor_id', 'texto', true, 'Vendedor que entregou.', 'g."sellerId"::text'),
      col('filial_id', 'texto', true, 'Filial que entregou, ou a do vendedor.', 'coalesce(g."unitId", s."unitId")::text'),
      col('quantidade', 'inteiro', false, 'Quantidade.', 'g.quantity'),
      col('valor_unitario', 'moeda', false, 'Valor unitário no dia (R$).', num('g."unitCost"')),
      col('valor_total', 'moeda', false, 'Quantidade × valor unitário (R$).', num('g.quantity * g."unitCost"')),
      col('registrado_em', 'datahora', false, 'Quando foi registrado.', dt('g."createdAt"')),
    ],
    relacoes: [rel('brinde_id', 'dim_brinde', 'brinde_id'), rel('vendedor_id', 'dim_vendedor', 'vendedor_id'), rel('filial_id', 'dim_filial', 'filial_id')],
    datas: ['data'],
    janela: JANELA + ' Data principal: data.',
    desde: 'Retiradas registradas desde a data (retirada desfeita some da tabela).',
    sql: { key: 'g.id', keyType: 'uuid', from: 'gift_deliveries g LEFT JOIN sellers s ON s.id = g."sellerId"', where: 'g."tenantId" = $1::uuid', janela: { expr: 'g.date', kind: 'date' }, alterado: 'g."createdAt"' },
  },
]

export const TABLES: BiTable[] = [...DIMENSOES, ...FATOS]
export const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.nome, t]))

/** Pedidos que o banco não fez para o Power BI e o motivo (vai no contrato). */
export const SKIPPED: { nome: string; motivo: string }[] = [
  { nome: 'frete do pedido da loja', motivo: 'O CRM não copia o valor do frete dos pedidos da Magazord (só total, situação, canal e itens).' },
  { nome: 'categoria do produto', motivo: 'A Magazord não manda a categoria ao CRM; grupo e subgrupo vêm do ERP (Tcar) quando o SKU coincide.' },
  { nome: 'custo do produto', motivo: 'O CRM não guarda custo de produto.' },
]

const DATE_START = (p: string) => `(((${p})::date)::timestamp AT TIME ZONE '${TZ}') AT TIME ZONE 'UTC'`

/**
 * SQL de uma página. Parâmetros: $1 empresa, $2 linhas (+1, para saber se há próxima), $3 data do filtro (quando há),
 * e a última chave entregue (quando há). Só textos fixos daqui entram no SQL; os valores vão como parâmetros.
 */
export function pageSql(t: BiTable, filter: 'desde' | 'janela' | 'tudo', hasCursor: boolean): string {
  const s = t.sql
  if (!s) throw new Error(`Tabela ${t.nome} não é lida por SQL.`)
  const cols = t.colunas.map((c) => `${c.sql} AS "${c.nome}"`).join(',\n  ')
  const where = [s.where]
  let n = 3
  if (filter !== 'tudo') {
    const date = `$${n++}`
    if (filter === 'desde' && s.alterado) where.push(`${s.alterado} >= ${DATE_START(date)}`)
    else if (s.janela) where.push(s.janela.kind === 'date' ? `${s.janela.expr} >= ${date}::date` : `${s.janela.expr} >= ${DATE_START(date)}`)
  }
  if (hasCursor) where.push(`${s.key} > $${n++}::${s.keyType === 'int' ? 'int' : s.keyType}`)
  return `SELECT ${s.key} AS "_k",\n  ${cols}\nFROM ${s.from}\nWHERE ${where.join('\n  AND ')}\nORDER BY ${s.key}\nLIMIT $2`
}

/** Descrição pública das tabelas (GET /tabelas e o contrato): sem o SQL. */
export function describeTables() {
  return TABLES.map((t) => ({
    nome: t.nome,
    tipo: t.tipo,
    descricao: t.descricao,
    grao: t.grao,
    chave: t.chave,
    colunas: t.colunas.map((c) => ({ nome: c.nome, tipo: c.tipo, nulo: c.nulo, descricao: c.descricao })),
    relacoes: t.relacoes,
    datas: t.datas,
    ...(t.janela ? { janela: t.janela } : {}),
    ...(t.desde ? { desde: t.desde } : {}),
  }))
}
