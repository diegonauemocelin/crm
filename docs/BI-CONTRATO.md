# Contrato de dados do Power BI (CRM)

> Gerado a partir do catálogo da API (`apps/api/src/bi/bi-tabelas.ts` e `bi-contrato.ts`). Não edite à mão:
> mude o catálogo e rode `ATUALIZAR_CONTRATO=1 npx vitest run --root apps/api test/bi.spec.ts`.

O CRM publica tabelas de BI **só de leitura** (esquema estrela: dimensões e fatos) por HTTPS, com uma chave de acesso.
O Power BI Desktop e o Power BI Service (atualização agendada, **sem gateway**) importam essas tabelas.

## 1. Endereço e chave

- **Endereço base:** `https://crm.suaempresa.com.br/api/bi/v1/` (o mesmo domínio do CRM + `/api/bi/v1/`).
- **Chave:** criada em **Configurações › Power BI** (permissão "Power BI" do perfil). Aparece uma vez só; o CRM guarda
  apenas o resumo (sha256). Revogar a chave corta o acesso na hora. Cada chave lê os dados da empresa dela.
- **Cabeçalho:** `X-BI-Key: crmbi_...` em todo pedido (exceto o endereço base, que responde `{"ok": true}` sem chave
  para o teste de conexão do Power BI Service).
- **Limite:** 120 pedidos por minuto por chave (acima disso, `429` com `Retry-After` em segundos).
- **Erros:** `401` chave ausente, inválida ou revogada; `400` parâmetro inválido; `404` tabela que não existe.

## 2. Pedidos

| Pedido | O que traz |
|---|---|
| `GET {base}` | `{ "ok": true }` (sem chave), para o teste de conexão. |
| `GET {base}tabelas` | Todas as tabelas, colunas, tipos, chaves, relações e datas (autodescritivo). |
| `GET {base}<tabela>` | Uma página de linhas da tabela. |

Parâmetros de `GET {base}<tabela>` (todos opcionais):

| Parâmetro | Exemplo | Efeito |
|---|---|---|
| `desde` | `2026-10-01` | Fatos: só linhas criadas ou alteradas desde a data (veja o "desde" de cada tabela). Dimensões ignoram. |
| `meses` | `36` | Fatos sem `desde`: tamanho da janela padrão em meses (1 a 120; padrão 24). |
| `limite` | `50000` | Linhas por página (1 a 50000; padrão 50000). |
| `cursor` | `eyJ2Ijox...` | Próxima página: o valor de `next` da resposta anterior. Leva o filtro da primeira página (os outros parâmetros são ignorados). |

Resposta:

```json
{
  "tabela": "fato_atendimentos",
  "colunas": ["atendimento_id", "tipo", "..."],
  "rows": [{ "atendimento_id": "5b1c...", "tipo": "PRE_VENDAS", "data_lead": "2026-11-03", "valor_venda": 1530.5 }],
  "next": "eyJ2IjoxLCJ0Ijoi..."
}
```

- **Paginação por chave:** as linhas vêm em ordem da chave; `next` é `null` na última página. Repita o pedido com
  `cursor=<next>` até `next` vir `null`. Linhas criadas durante a leitura podem entrar ou não; nenhuma se repete.
- `fato_conversas_whatsapp` é montada por lote de conversas: cada página tem um número variável de linhas.
- **Datas:** `AAAA-MM-DD`, no dia de Brasília.
- **Datas e horas:** `AAAA-MM-DDTHH:MM:SS` no **horário de Brasília (America/Sao_Paulo)**, sem fuso no texto.
- **Dinheiro e números:** números JSON (ponto decimal), em reais. Contagens são inteiros.
- **Vazio:** `null`. **Sim/não:** `true`/`false`.
- **Nomes de colunas:** fixos, em português, `snake_case`. Coluna nova pode entrar no fim; nome existente não muda
  nesta versão (`v1`). Mudança que quebra vira `v2`.

## 3. Power Query (M)

Crie dois parâmetros em **Página Inicial › Gerenciar parâmetros** (tipo Texto):

- `CRM_BaseUrl` = `https://crm.suaempresa.com.br/api/bi/v1/`
- `CRM_Chave` = a chave criada no CRM

Depois uma consulta em branco chamada `CRM_Tabela` com a função abaixo. Ela usa `Web.Contents` com endereço fixo +
`RelativePath` + `Query` + `Headers`, o formato que o Power BI Service aceita na atualização agendada sem gateway.

```m
(nome as text, optional desde as nullable text) as table =>
let
    Pagina = (cursor as nullable text) as record =>
        let
            Filtro = if desde = null or desde = "" then [] else [desde = desde],
            Consulta = if cursor = null then Filtro else Record.AddField(Filtro, "cursor", cursor),
            Resposta = Web.Contents(
                CRM_BaseUrl,
                [
                    RelativePath = nome,
                    Query = Consulta,
                    Headers = [#"X-BI-Key" = CRM_Chave, Accept = "application/json"],
                    ManualStatusHandling = {400, 401, 404, 429},
                    Timeout = #duration(0, 0, 10, 0)
                ]
            ),
            Status = Value.Metadata(Resposta)[Response.Status],
            Json = Json.Document(Resposta),
            Ok = if Status = 200 then Json else error Error.Record("CRM", "Erro " & Text.From(Status) & " em " & nome, Json[message]?)
        in
            Ok,
    Paginas = List.Generate(
        () => Pagina(null),
        each _ <> null,
        each if _[next] = null then null else Pagina(_[next])
    ),
    Colunas = Paginas{0}[colunas],
    Linhas = List.Combine(List.Transform(Paginas, each _[rows])),
    Tabela = Table.FromRecords(Linhas, Colunas, MissingField.UseNull)
in
    Tabela
```

Cada tabela do modelo é uma consulta como esta (exemplo de `fato_atendimentos`, com os tipos):

```m
let
    fato_atendimentos_bruto = CRM_Tabela("fato_atendimentos"),
    Tipada = Table.TransformColumnTypes(fato_atendimentos_bruto, {{"atendimento_id", type text}, {"tipo", type text}, {"pre_venda_id", type text}, {"lead_id", type text}, {"lead_em", type datetime}, {"data_lead", type date}, {"vendedor_id", type text}, {"filial_id", type text}, {"origem_id", type text}, {"tipo_cliente_id", type text}, {"motivo_perda_id", type text}, {"pais", type text}, {"uf", type text}, {"cidade", type text}, {"repassado", type logical}, {"repassado_em", type datetime}, {"retorno", type text}, {"retorno_em", type datetime}, {"primeira_acao_em", type datetime}, {"chamou_cliente_em", type datetime}, {"situacao_venda", type text}, {"venda", type logical}, {"valor_venda", Currency.Type}, {"resultado_em", type datetime}, {"data_resultado", type date}, {"fechado_em", type datetime}, {"acompanhamento", type text}, {"prazo_acompanhamento_em", type datetime}, {"veio_google_ads", type logical}, {"campanha_google_id", type text}, {"campanha_google", type text}, {"palavra_chave_google", type text}, {"canal_entrada", type text}, {"pagina_entrada", type text}, {"minutos_ate_repasse", type number}, {"minutos_ate_primeira_acao", type number}, {"horas_ate_resultado", type number}, {"criado_em", type datetime}, {"atualizado_em", type datetime}})
in
    Tipada
```

Mapa de tipos (coluna `tipo` do catálogo → Power BI):

| Tipo no catálogo | Power BI / M |
|---|---|
| texto | Texto (type text) |
| inteiro | Número inteiro (Int64.Type) |
| decimal | Número decimal (type number) |
| moeda | Número decimal fixo (Currency.Type) |
| data | Data (type date) |
| datahora | Data/hora (type datetime) |
| booleano | Verdadeiro/falso (type logical) |

No **Power BI Service**, em Configurações do modelo semântico › Credenciais da fonte de dados: autenticação
**Anônima**, nível de privacidade **Organizacional**. Não precisa de gateway. A chave vai no cabeçalho pelo parâmetro
`CRM_Chave` (troque o valor do parâmetro no Service ao trocar a chave).

**Atualização incremental (opcional):** para os fatos grandes, use `CRM_Tabela(nome, desde)` com `desde` vindo do
parâmetro `RangeStart` (`Date.ToText(Date.From(RangeStart), "yyyy-MM-dd")`) e filtre a data principal entre
`RangeStart` e `RangeEnd`. Linhas excluídas no CRM só somem na atualização completa.

## 4. Tabelas

| Tabela | Tipo | Grão |
|---|---|---|
| `dim_filial` | dimensão | Uma unidade. |
| `dim_vendedor` | dimensão | Um vendedor. |
| `dim_usuario` | dimensão | Um usuário. |
| `dim_origem` | dimensão | Um item da lista do atendimento (itens desativados continuam, para o histórico). |
| `dim_tipo_cliente` | dimensão | Um item da lista do atendimento (itens desativados continuam, para o histórico). |
| `dim_motivo_perda` | dimensão | Um item da lista do atendimento (itens desativados continuam, para o histórico). |
| `dim_numero_whatsapp` | dimensão | Um número. |
| `dim_setor` | dimensão | Um setor. |
| `dim_produto` | dimensão | Uma derivação (SKU) da loja. |
| `dim_transportadora` | dimensão | Uma transportadora. |
| `dim_brinde` | dimensão | Um brinde. |
| `fato_leads` | fato | Um lead. |
| `fato_atendimentos` | fato | Um atendimento (pré-venda ou pós-venda). |
| `fato_conversas_whatsapp` | fato | Um atendimento de uma conversa (número da empresa + contato). |
| `fato_pedidos_loja` | fato | Um pedido. |
| `fato_itens_pedido` | fato | Um produto de um pedido. |
| `fato_carrinhos` | fato | Um carrinho. |
| `fato_ml_perguntas` | fato | Uma pergunta. |
| `fato_ml_vendas` | fato | Um produto de um pedido do Mercado Livre ligado a uma pergunta. |
| `fato_ml_ads_diario` | fato | Um dia de uma campanha (nivel = campaign) ou de um anúncio (nivel = ad). |
| `fato_anuncios_diario` | fato | Um dia de uma campanha de uma plataforma. |
| `fato_email_campanhas` | fato | Uma campanha (ou modelo de automação). |
| `fato_webpush` | fato | Uma campanha de Web Push. |
| `fato_frete_cotacoes` | fato | Uma cotação. |
| `fato_ctes` | fato | Um CT-e. |
| `fato_brindes` | fato | Uma retirada. |

## 4.1 Dimensões

### dim_filial

Unidades da empresa (matriz e filiais).

- **Grão:** Uma unidade.
- **Chave primária:** `filial_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `filial_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome da unidade. |
| `cidade` | texto | pode | Cidade. |
| `uf` | texto | pode | UF (2 letras). |
| `matriz` | booleano | não | É a matriz. |
| `ativa` | booleano | não | Unidade ativa. |

### dim_vendedor

Vendedores do atendimento (com ou sem login).

- **Grão:** Um vendedor.
- **Chave primária:** `vendedor_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `vendedor_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do vendedor. |
| `filial_id` | texto | pode | Unidade do vendedor. |
| `usuario_id` | texto | pode | Login ligado ao vendedor (dim_usuario). |
| `ativo` | booleano | não | Vendedor ativo. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `dim_vendedor[filial_id]` → `dim_filial[filial_id]` (inativa: use USERELATIONSHIP)

### dim_usuario

Pessoas com login no CRM (atendentes, gestores). Excluídos continuam, para o histórico.

- **Grão:** Um usuário.
- **Chave primária:** `usuario_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `usuario_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome da pessoa. |
| `perfil` | texto | não | Perfil de acesso. |
| `filial_id` | texto | pode | Unidade da pessoa. |
| `vendedor_id` | texto | pode | Vendedor ligado ao login. |
| `ativo` | booleano | não | Pode entrar no sistema (ativo e não excluído). |
| `excluido` | booleano | não | Excluído (some das listas; o nome fica no histórico). |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `dim_usuario[filial_id]` → `dim_filial[filial_id]` (inativa: use USERELATIONSHIP)

### dim_origem

Origens do lead e do atendimento (lista Origens: Google, Indicação, WhatsApp - <número>...). A campanha do anúncio fica nos fatos.

- **Grão:** Um item da lista do atendimento (itens desativados continuam, para o histórico).
- **Chave primária:** `origem_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `origem_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do item. |
| `ativo` | booleano | não | Ainda aparece para escolher. |

### dim_tipo_cliente

Tipos de cliente do atendimento.

- **Grão:** Um item da lista do atendimento (itens desativados continuam, para o histórico).
- **Chave primária:** `tipo_cliente_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `tipo_cliente_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do item. |
| `ativo` | booleano | não | Ainda aparece para escolher. |

### dim_motivo_perda

Motivos de perda da pré-venda.

- **Grão:** Um item da lista do atendimento (itens desativados continuam, para o histórico).
- **Chave primária:** `motivo_perda_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `motivo_perda_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do item. |
| `ativo` | booleano | não | Ainda aparece para escolher. |

### dim_numero_whatsapp

Números de WhatsApp da empresa ligados ao CRM (sem o telefone).

- **Grão:** Um número.
- **Chave primária:** `numero_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `numero_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome dado ao número no CRM. |
| `filial_id` | texto | pode | Unidade do número. |
| `finalidade` | texto | não | ATENDIMENTO ou MONITORAMENTO. |
| `situacao` | texto | não | CONECTADO, CONECTANDO ou DESCONECTADO. |
| `abre_pre_venda` | booleano | não | Conversa nova abre pré-venda. |
| `atendimento_dividido` | booleano | não | Cada conversa tem um atendente. |
| `excluido` | booleano | não | Número removido do CRM. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `dim_numero_whatsapp[filial_id]` → `dim_filial[filial_id]` (inativa: use USERELATIONSHIP)

### dim_setor

Setores de atendimento do WhatsApp (Vendas, Pós-venda, Financeiro...).

- **Grão:** Um setor.
- **Chave primária:** `setor_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `setor_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do setor. |
| `ativo` | booleano | não | Setor ativo. |

### dim_produto

Catálogo da loja virtual (Magazord). Grupo e subgrupo vêm do ERP (Tcar) quando o SKU é o mesmo código de lá. Sem custo.

- **Grão:** Uma derivação (SKU) da loja.
- **Chave primária:** `produto_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `produto_id` | texto | não | Número interno (uuid). |
| `sku` | texto | não | Código (SKU) da derivação na loja. |
| `derivacao_id` | texto | não | Id da derivação na Magazord. |
| `nome` | texto | não | Nome do produto. |
| `marca` | texto | pode | Marca. |
| `grupo` | texto | pode | Grupo do produto no ERP (Tcar). |
| `subgrupo` | texto | pode | Subgrupo do produto no ERP (Tcar). |
| `preco` | moeda | pode | Preço de venda atual na loja (R$). |
| `preco_de` | moeda | pode | Preço "de" (antes do desconto), R$. |
| `estoque` | inteiro | pode | Estoque informado pela loja. |
| `ativo` | booleano | não | Apareceu na última sincronização da loja. |

### dim_transportadora

Transportadoras e prestadores do módulo de fretes (fornecedores da empresa).

- **Grão:** Uma transportadora.
- **Chave primária:** `transportadora_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `transportadora_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome da transportadora. |
| `tipo` | texto | não | TRANSPORTADORA ou PRESTADOR. |
| `cidade` | texto | pode | Cidade. |
| `uf` | texto | pode | UF. |
| `ativa` | booleano | não | Ativa. |

### dim_brinde

Brindes cadastrados no Controle de brindes.

- **Grão:** Um brinde.
- **Chave primária:** `brinde_id` (única)
- **Leitura:** sempre completa (ignora `desde` e `meses`).

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `brinde_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome do brinde. |
| `custo_unitario` | moeda | não | Valor unitário atual (R$). |
| `estoque` | inteiro | não | Estoque atual. |
| `ativo` | booleano | não | Ativo. |

## 4.2 Fatos

### fato_leads

Base de leads (pessoas identificadas), sem nome, telefone nem e-mail.

- **Grão:** Um lead.
- **Chave primária:** `lead_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: criado_em.
- **desde:** Leads criados ou alterados desde a data (atualizado_em).
- **Datas para o calendário:** `data_criacao` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `lead_id` | texto | não | Número interno do lead (uuid). |
| `criado_em` | datahora | não | Quando entrou na base. |
| `data_criacao` | data | não | Dia em que entrou na base. |
| `estagio` | texto | não | LEAD, QUALIFICADO, OPORTUNIDADE ou CLIENTE. |
| `filial_id` | texto | pode | Unidade. |
| `origem_id` | texto | pode | Origem (dim_origem). |
| `vendedor_id` | texto | pode | Responsável pelo lead. |
| `vendedor_carteira_id` | texto | pode | Vendedor da carteira do cliente. |
| `pais` | texto | não | País (BR...). |
| `uf` | texto | pode | UF. |
| `cidade` | texto | pode | Cidade. |
| `nota` | texto | pode | Nota do lead scoring (A a D). |
| `pontos_perfil` | inteiro | não | Pontos de perfil. |
| `pontos_interesse` | inteiro | não | Pontos de interesse. |
| `fonte_primeira_conversao` | texto | pode | utm_source da 1ª conversão. |
| `meio_primeira_conversao` | texto | pode | utm_medium da 1ª conversão. |
| `campanha_primeira_conversao` | texto | pode | utm_campaign da 1ª conversão. |
| `passou_por_anuncio_google` | booleano | não | Clicou num anúncio do Google Ads (campanha conhecida). |
| `campanha_google_id` | texto | pode | Primeira campanha do Google Ads. |
| `campanha_google` | texto | pode | Nome da primeira campanha do Google Ads. |
| `primeira_conversao_em` | datahora | pode | Primeira conversão (formulário, WhatsApp...). |
| `ultima_conversao_em` | datahora | pode | Última conversão. |
| `ultima_oportunidade_em` | datahora | pode | Última oportunidade (pré-venda). |
| `ultima_venda_em` | datahora | pode | Última venda. |
| `valor_ultima_venda` | moeda | pode | Valor da última venda (R$). |
| `aceita_email` | booleano | não | Permite e-mail marketing (LGPD) e não descadastrou. |
| `cliente_loja` | booleano | não | Tem cadastro na loja virtual. |
| `anonimizado` | booleano | não | Dados pessoais apagados a pedido (fica só para estatística). |
| `atualizado_em` | datahora | não | Última alteração. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_leads[filial_id]` → `dim_filial[filial_id]`
- `fato_leads[origem_id]` → `dim_origem[origem_id]`
- `fato_leads[vendedor_id]` → `dim_vendedor[vendedor_id]`
- `fato_leads[vendedor_carteira_id]` → `dim_vendedor[vendedor_id]` (inativa: use USERELATIONSHIP)

### fato_atendimentos

Pré-vendas e pós-vendas: datas do lead, repasse, primeira ação, resultado e fechamento; venda, valor, perda, vendedor, origem e Google Ads.

- **Grão:** Um atendimento (pré-venda ou pós-venda).
- **Chave primária:** `atendimento_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: lead_em.
- **desde:** Atendimentos criados ou alterados desde a data (atualizado_em). Excluídos não aparecem.
- **Datas para o calendário:** `data_lead` (ativa), `data_resultado` (inativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `atendimento_id` | texto | não | Número interno (uuid). |
| `tipo` | texto | não | PRE_VENDAS ou POS_VENDAS. |
| `pre_venda_id` | texto | pode | Pós-venda: a pré-venda que o originou. |
| `lead_id` | texto | pode | Lead ligado (fato_leads). |
| `lead_em` | datahora | não | Quando o contato chegou. |
| `data_lead` | data | não | Dia em que o contato chegou. |
| `vendedor_id` | texto | pode | Vendedor. |
| `filial_id` | texto | pode | Unidade. |
| `origem_id` | texto | pode | Origem (dim_origem). |
| `tipo_cliente_id` | texto | pode | Tipo de cliente. |
| `motivo_perda_id` | texto | pode | Motivo da perda. |
| `pais` | texto | não | País. |
| `uf` | texto | pode | UF. |
| `cidade` | texto | pode | Cidade. |
| `repassado` | booleano | não | Repassado ao vendedor. |
| `repassado_em` | datahora | pode | Quando foi repassado. |
| `retorno` | texto | pode | Retorno do vendedor: SIM, NAO ou PENDENTE. |
| `retorno_em` | datahora | pode | Quando o retorno foi marcado. |
| `primeira_acao_em` | datahora | pode | Pós-venda: primeiro contato. |
| `chamou_cliente_em` | datahora | pode | Última vez que marcaram "Chamei o cliente". |
| `situacao_venda` | texto | não | SIM (vendeu), NAO (perdeu) ou NEGOCIACAO. |
| `venda` | booleano | não | Vendeu (situacao_venda = SIM). |
| `valor_venda` | moeda | pode | Valor da venda (R$). |
| `resultado_em` | datahora | pode | Quando a venda ou a perda foi marcada. |
| `data_resultado` | data | pode | Dia do resultado. |
| `fechado_em` | datahora | pode | Atendimento encerrado. |
| `acompanhamento` | texto | pode | Pós-venda: PENDENTE, CONTATADO, ANALISANDO, RESOLVIDO ou VOLTOU_AO_VENDEDOR. |
| `prazo_acompanhamento_em` | datahora | pode | Pós-venda: prazo do primeiro contato. |
| `veio_google_ads` | booleano | não | Clicou num anúncio do Google Ads antes do contato (origem sozinha não conta). |
| `campanha_google_id` | texto | pode | Campanha do anúncio (quando veio do Google Ads). |
| `campanha_google` | texto | pode | Nome da campanha do anúncio. |
| `palavra_chave_google` | texto | pode | Palavra-chave do anúncio (utm_term). |
| `canal_entrada` | texto | pode | Por onde entrou no site (formulário, pop-up ou botão de WhatsApp). |
| `pagina_entrada` | texto | pode | Página por onde chegou (sem parâmetros). |
| `minutos_ate_repasse` | decimal | pode | Minutos do contato até o repasse ao vendedor. |
| `minutos_ate_primeira_acao` | decimal | pode | Pós-venda: minutos até o primeiro contato. |
| `horas_ate_resultado` | decimal | pode | Horas do contato até a venda ou perda. |
| `criado_em` | datahora | não | Registro criado. |
| `atualizado_em` | datahora | não | Última alteração. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_atendimentos[vendedor_id]` → `dim_vendedor[vendedor_id]`
- `fato_atendimentos[filial_id]` → `dim_filial[filial_id]`
- `fato_atendimentos[origem_id]` → `dim_origem[origem_id]`
- `fato_atendimentos[tipo_cliente_id]` → `dim_tipo_cliente[tipo_cliente_id]`
- `fato_atendimentos[motivo_perda_id]` → `dim_motivo_perda[motivo_perda_id]`

### fato_conversas_whatsapp

Atendimentos do WhatsApp (mesma regra do painel: começa depois de mais de 24 h sem mensagem na conversa). Tempos de resposta e contagem de mensagens, sem textos. Grupos ficam de fora.

- **Grão:** Um atendimento de uma conversa (número da empresa + contato).
- **Chave primária:** `atendimento_wa_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: inicio_em (conversas com mensagem na janela).
- **desde:** Todos os atendimentos (dentro da janela padrão) das conversas com mensagem desde a data. A página traz um lote de conversas, então o número de linhas por página varia.
- **Datas para o calendário:** `data_inicio` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `atendimento_wa_id` | texto | não | conversa_id + ":" + início (milissegundos). Estável entre leituras. |
| `conversa_id` | texto | não | Conversa (uuid). |
| `numero_id` | texto | não | Número de WhatsApp da empresa. |
| `setor_id` | texto | pode | Setor atual da conversa. |
| `atendente_id` | texto | pode | Atendente atual da conversa (dim_usuario). |
| `vendedor_id` | texto | pode | Vendedor ligado à conversa. |
| `lead_id` | texto | pode | Lead do contato. |
| `atendimento_id` | texto | pode | Pré-venda ligada à conversa (fato_atendimentos). |
| `categoria` | texto | não | CLIENTE, COLEGA, FORNECEDOR ou OUTRO. |
| `iniciado_por` | texto | não | cliente ou empresa. |
| `inicio_em` | datahora | não | Primeira mensagem do atendimento. |
| `data_inicio` | data | não | Dia do início. |
| `fim_em` | datahora | não | Última mensagem do atendimento. |
| `primeira_mensagem_cliente_em` | datahora | pode | Primeira mensagem do cliente (quando ele escreveu antes da empresa). |
| `primeira_resposta_em` | datahora | pode | Primeira resposta da empresa a essa mensagem. |
| `minutos_primeira_resposta` | decimal | pode | Minutos até a primeira resposta (corridos). |
| `minutos_primeira_resposta_comercial` | decimal | pode | Minutos até a primeira resposta, só no horário comercial das regras do WhatsApp. |
| `respondido_por_id` | texto | pode | Quem deu a primeira resposta pelo CRM (dim_usuario); vazio se foi pelo celular ou sem resposta. |
| `respondido_pelo_celular` | booleano | não | A primeira resposta saiu do celular (fora do CRM). |
| `mensagens_cliente` | inteiro | não | Mensagens recebidas do cliente. |
| `mensagens_empresa` | inteiro | não | Mensagens enviadas pela empresa (sem notas internas). |
| `vezes_cliente` | inteiro | não | Vezes em que o cliente escreveu (mensagens seguidas contam uma). |
| `vezes_respondidas` | inteiro | não | Vezes do cliente que tiveram resposta. |
| `minutos_resposta_media` | decimal | pode | Média dos tempos de resposta do atendimento (minutos corridos). |
| `aguardando_resposta` | booleano | não | Último atendimento da conversa, cliente esperando resposta agora. |
| `minutos_aguardando` | decimal | pode | Há quantos minutos o cliente espera (quando aguardando_resposta). |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_conversas_whatsapp[numero_id]` → `dim_numero_whatsapp[numero_id]`
- `fato_conversas_whatsapp[setor_id]` → `dim_setor[setor_id]`
- `fato_conversas_whatsapp[atendente_id]` → `dim_usuario[usuario_id]`
- `fato_conversas_whatsapp[respondido_por_id]` → `dim_usuario[usuario_id]` (inativa: use USERELATIONSHIP)
- `fato_conversas_whatsapp[vendedor_id]` → `dim_vendedor[vendedor_id]`

### fato_pedidos_loja

Pedidos da loja virtual (Magazord). UF e cidade vêm do lead do pedido. O frete do pedido não é copiado da loja (não há coluna de frete).

- **Grão:** Um pedido.
- **Chave primária:** `pedido_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: pedido_em.
- **desde:** Pedidos criados ou alterados desde a data.
- **Datas para o calendário:** `data_pedido` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `pedido_id` | texto | não | Número interno (uuid). |
| `codigo` | texto | não | Código do pedido na loja. |
| `pedido_em` | datahora | não | Data e hora do pedido. |
| `data_pedido` | data | não | Dia do pedido. |
| `situacao_codigo` | inteiro | não | Código da situação na Magazord. |
| `situacao` | texto | não | Nome da situação. |
| `grupo_situacao` | texto | não | pago (aprovado, faturado, enviado, entregue), pendente ou cancelado. |
| `pagamento` | texto | pode | Forma de pagamento. |
| `canal` | texto | pode | Canal de venda: Site, marketplace, Manual ou PDV. |
| `total` | moeda | não | Total do pedido (R$). |
| `qtd_itens` | inteiro | pode | Soma das quantidades dos itens (vazio se os itens ainda não foram lidos). |
| `qtd_produtos` | inteiro | pode | Linhas de produto do pedido. |
| `lead_id` | texto | pode | Lead do cliente. |
| `uf` | texto | pode | UF do cliente (do lead). |
| `cidade` | texto | pode | Cidade do cliente (do lead). |
| `atualizado_em` | datahora | não | Última alteração. |

### fato_itens_pedido

Produtos dos pedidos da loja virtual (lidos do detalhe do pedido).

- **Grão:** Um produto de um pedido.
- **Chave primária:** `item_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: data do pedido.
- **desde:** Itens dos pedidos alterados desde a data.
- **Datas para o calendário:** `data_pedido` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `item_id` | texto | não | Número interno (uuid). |
| `pedido_id` | texto | não | Pedido (fato_pedidos_loja). |
| `data_pedido` | data | não | Dia do pedido. |
| `grupo_situacao` | texto | não | Situação do pedido: pago, pendente ou cancelado. |
| `canal` | texto | pode | Canal de venda do pedido. |
| `sku` | texto | pode | Código (SKU) da derivação. |
| `produto_id` | texto | pode | Produto do catálogo com o mesmo SKU (dim_produto). |
| `nome` | texto | não | Nome do produto no pedido. |
| `marca` | texto | pode | Marca. |
| `quantidade` | inteiro | não | Quantidade. |
| `total` | moeda | não | Valor total do item, já com desconto (R$). |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_itens_pedido[produto_id]` → `dim_produto[produto_id]`

### fato_carrinhos

Carrinhos da loja virtual (aberto, abandonado ou comprado) e o contato de recuperação.

- **Grão:** Um carrinho.
- **Chave primária:** `carrinho_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: iniciado_em.
- **desde:** Carrinhos criados ou alterados desde a data.
- **Datas para o calendário:** `data_inicio` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `carrinho_id` | texto | não | Número interno (uuid). |
| `situacao_codigo` | inteiro | não | 1 aberto, 2 abandonado, 3 comprado. |
| `situacao` | texto | não | aberto, abandonado ou comprado. |
| `iniciado_em` | datahora | não | Início do carrinho. |
| `data_inicio` | data | não | Dia do início. |
| `ultima_atividade_em` | datahora | pode | Última atividade. |
| `chegou_checkout` | booleano | não | Preencheu o endereço de entrega. |
| `qtd_itens` | inteiro | não | Itens no carrinho. |
| `valor` | moeda | pode | Valor do carrinho (R$). |
| `pedido_codigo` | texto | pode | Código do pedido, quando comprado. |
| `status_contato` | texto | não | Recuperação: PENDENTE, CONTATADO... |
| `contatado_em` | datahora | pode | Quando a equipe fez o contato. |
| `lead_id` | texto | pode | Lead do cliente. |
| `uf` | texto | pode | UF do cliente (do lead). |
| `cidade` | texto | pode | Cidade do cliente (do lead). |
| `atualizado_em` | datahora | não | Última alteração. |

### fato_ml_perguntas

Perguntas do Mercado Livre no Assistente ML (sem o texto e sem o cliente).

- **Grão:** Uma pergunta.
- **Chave primária:** `pergunta_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: recebida_em.
- **desde:** Perguntas criadas ou alteradas desde a data.
- **Datas para o calendário:** `data_recebida` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `pergunta_id` | inteiro | não | Número da pergunta no assistente. |
| `marketplace` | texto | não | mercadolivre. |
| `anuncio_ml_id` | texto | pode | Anúncio (MLB...). |
| `recebida_em` | datahora | não | Quando a pergunta chegou. |
| `data_recebida` | data | não | Dia em que chegou. |
| `situacao` | texto | não | nova, aguardando_analise, em_atendimento, respondida, resolvida, nao_aplicavel... |
| `motivo_pendencia` | texto | pode | Motivo da pendência (A a G). |
| `marca_maquina` | texto | pode | Marca da máquina identificada. |
| `modelo_maquina` | texto | pode | Modelo da máquina identificado. |
| `codigo_peca` | texto | pode | Código da peça identificado. |
| `intencao_compra` | booleano | não | A pergunta mostra intenção de compra. |
| `relevancia` | inteiro | não | Relevância calculada. |
| `atendente_id` | texto | pode | Pessoa responsável (dim_usuario). |
| `confianca_ia` | decimal | pode | Confiança da sugestão da IA (0 a 1). |
| `respondida_em` | datahora | pode | Respondida pelo CRM. |
| `respondida_fora_em` | datahora | pode | Respondida fora do CRM (Magazord ou direto no Mercado Livre). |
| `resolvida_em` | datahora | pode | Resolvida. |
| `respondida_pelo_crm` | booleano | não | A resposta saiu pelo CRM. |
| `minutos_resposta` | decimal | pode | Minutos da chegada até a resposta (CRM ou fora). |
| `atualizado_em` | datahora | não | Última alteração. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_ml_perguntas[atendente_id]` → `dim_usuario[usuario_id]`

### fato_ml_vendas

Vendas do Mercado Livre ligadas a uma pergunta respondida (Assistente ML), sem o comprador.

- **Grão:** Um produto de um pedido do Mercado Livre ligado a uma pergunta.
- **Chave primária:** `venda_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: pedido_em.
- **desde:** Vendas criadas ou alteradas desde a data.
- **Datas para o calendário:** `data_pedido` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `venda_id` | inteiro | não | Número interno. |
| `pergunta_id` | inteiro | não | Pergunta que levou à venda (fato_ml_perguntas). |
| `pedido_ml` | texto | não | Número do pedido no Mercado Livre. |
| `anuncio_ml_id` | texto | não | Anúncio vendido. |
| `titulo_anuncio` | texto | pode | Título do anúncio. |
| `pedido_em` | datahora | não | Data e hora do pedido. |
| `data_pedido` | data | não | Dia do pedido. |
| `situacao_pedido` | texto | pode | Situação do pedido no Mercado Livre. |
| `situacao_pagamento` | texto | pode | Situação do pagamento. |
| `quantidade` | inteiro | não | Quantidade. |
| `preco_unitario` | moeda | pode | Preço unitário. |
| `total` | moeda | pode | Total. |
| `moeda` | texto | pode | Moeda (BRL). |
| `tipo_vinculo` | texto | não | mesmo_anuncio ou anuncio_indicado. |
| `horas_apos_pergunta` | decimal | pode | Horas entre a pergunta e o pedido. |
| `pago_antes` | booleano | não | Pedido pago antes da pergunta (não conta como venda do assistente). |

### fato_ml_ads_diario

Mercado Livre Ads por dia: investimento, receita atribuída, vendas e funil. Traz o nível campanha e o nível anúncio: some só um nível (filtre nivel).

- **Grão:** Um dia de uma campanha (nivel = campaign) ou de um anúncio (nivel = ad).
- **Chave primária:** `linha_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: data.
- **desde:** Dias atualizados desde a data (o Mercado Livre revisa os últimos dias).
- **Datas para o calendário:** `data` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `linha_id` | texto | não | Número interno (uuid). |
| `data` | data | não | Dia. |
| `marketplace` | texto | não | mercadolivre. |
| `produto` | texto | não | product_ads ou display. |
| `nivel` | texto | não | campaign ou ad. |
| `campanha_id` | texto | não | Campanha. |
| `campanha` | texto | pode | Nome da campanha. |
| `anuncio_id` | texto | pode | Anúncio (nível ad). |
| `anuncio` | texto | pode | Título do anúncio (nível ad). |
| `impressoes` | inteiro | não | Impressões. |
| `cliques` | inteiro | não | Cliques. |
| `investimento` | moeda | não | Custo (R$). |
| `receita` | moeda | não | Receita atribuída (direta + indireta). |
| `receita_direta` | moeda | não | Receita direta. |
| `receita_indireta` | moeda | não | Receita indireta. |
| `unidades` | inteiro | não | Unidades vendidas atribuídas. |
| `unidades_organicas` | inteiro | não | Unidades orgânicas. |
| `receita_organica` | moeda | não | Receita orgânica. |
| `visualizacoes` | inteiro | não | Visitas ao anúncio. |
| `adicoes_carrinho` | inteiro | não | Adições ao carrinho. |
| `checkouts` | inteiro | não | Checkouts. |
| `fonte` | texto | não | api (CRM) ou bi (histórico trazido do Usaparts BI). |

### fato_anuncios_diario

Mídia paga por dia e campanha: Google Ads, Meta Ads e TikTok Ads (só leitura das contas).

- **Grão:** Um dia de uma campanha de uma plataforma.
- **Chave primária:** `linha_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: data.
- **desde:** Dias atualizados desde a data.
- **Datas para o calendário:** `data` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `linha_id` | texto | não | plataforma\|campanha\|data. |
| `data` | data | não | Dia. |
| `plataforma` | texto | não | google, meta ou tiktok. |
| `campanha_id` | texto | não | Campanha na plataforma. |
| `campanha` | texto | não | Nome da campanha. |
| `investimento` | moeda | não | Valor investido no dia (moeda da conta, R$). |
| `impressoes` | inteiro | não | Impressões. |
| `cliques` | inteiro | não | Cliques. |
| `conversoes` | decimal | não | Conversões contadas pela plataforma. |
| `leads` | inteiro | pode | Meta/TikTok: leads de formulário. |
| `conversas` | inteiro | pode | Meta/TikTok: conversas iniciadas. |

### fato_email_campanhas

Campanhas de e-mail marketing (e modelos das automações, tipo MODELO) com os totais de envio, aberturas e cliques.

- **Grão:** Uma campanha (ou modelo de automação).
- **Chave primária:** `campanha_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: início do envio (ou criação).
- **desde:** Campanhas criadas ou alteradas desde a data.
- **Datas para o calendário:** `data_envio` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `campanha_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome da campanha. |
| `assunto` | texto | não | Assunto do e-mail. |
| `tipo` | texto | não | CAMPANHA ou MODELO (enviado pelas automações). |
| `situacao` | texto | não | RASCUNHO, AGENDADA, ENVIANDO, PAUSADA, ENVIADA ou CANCELADA. |
| `agendada_em` | datahora | pode | Agendamento. |
| `iniciada_em` | datahora | pode | Início do envio. |
| `finalizada_em` | datahora | pode | Fim do envio. |
| `data_envio` | data | não | Dia do envio (ou da criação, se ainda não enviou). |
| `destinatarios` | inteiro | não | Destinatários. |
| `enviados` | inteiro | não | Enviados. |
| `falhas` | inteiro | não | Recusados. |
| `aberturas` | inteiro | não | Aberturas (todas). |
| `cliques` | inteiro | não | Cliques (todos). |
| `descadastros` | inteiro | não | Descadastros. |
| `abriram` | inteiro | não | Destinatários que abriram (únicos). |
| `clicaram` | inteiro | não | Destinatários que clicaram (únicos). |
| `criada_em` | datahora | não | Criação. |
| `atualizado_em` | datahora | não | Última alteração. |

### fato_webpush

Campanhas de Web Push da loja virtual: disparos, entregas e cliques.

- **Grão:** Uma campanha de Web Push.
- **Chave primária:** `campanha_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: criação.
- **desde:** Campanhas criadas ou alteradas desde a data.
- **Datas para o calendário:** `data_envio` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `campanha_id` | texto | não | Número interno (uuid). |
| `nome` | texto | não | Nome interno. |
| `titulo` | texto | não | Título da notificação. |
| `situacao` | texto | não | RASCUNHO, AGENDADO, ENVIANDO, ENVIADO, CANCELADO ou ERRO. |
| `agendado_em` | datahora | pode | Agendamento. |
| `enviado_em` | datahora | pode | Início do envio. |
| `finalizado_em` | datahora | pode | Fim do envio. |
| `data_envio` | data | não | Dia do envio (ou da criação). |
| `alvos` | inteiro | não | Inscritos alcançados. |
| `enviados` | inteiro | não | Enviados. |
| `falhas` | inteiro | não | Falhas. |
| `entregues` | inteiro | não | Mostrados no aparelho. |
| `cliques` | inteiro | não | Cliques. |
| `criado_em` | datahora | não | Criação. |
| `atualizado_em` | datahora | não | Última alteração. |

### fato_frete_cotacoes

Cotações de frete: destino (cidade/UF), carga, melhor preço e a transportadora escolhida. Sem cliente e sem CEP.

- **Grão:** Uma cotação.
- **Chave primária:** `cotacao_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: data_cotacao.
- **desde:** Cotações criadas ou escolhidas desde a data.
- **Datas para o calendário:** `data_cotacao` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `cotacao_id` | texto | não | Número interno (uuid). |
| `codigo` | inteiro | não | Número da cotação. |
| `filial_id` | texto | não | Filial de origem. |
| `data_cotacao` | data | não | Dia da cotação. |
| `criada_em` | datahora | não | Quando foi calculada. |
| `criado_por_id` | texto | não | Quem cotou (dim_usuario). |
| `tipo_pessoa` | texto | não | PF ou PJ. |
| `documento_erp` | texto | pode | ORCAMENTO ou PRE_NOTA (Tcar). |
| `uf_destino` | texto | pode | UF do destino. |
| `cidade_destino` | texto | pode | Cidade do destino. |
| `valor_carga` | moeda | não | Valor da mercadoria (R$). |
| `peso_kg` | decimal | não | Peso real (kg). |
| `metros_cubicos` | decimal | não | Volume (m³). |
| `melhor_total` | moeda | pode | Menor frete calculado (R$). |
| `situacao` | texto | não | CALCULADA, SELECIONADA ou CANCELADA. |
| `transportadora_id` | texto | pode | Transportadora escolhida. |
| `total_escolhido` | moeda | pode | Frete da transportadora escolhida (R$). |
| `escolhida_em` | datahora | pode | Quando a transportadora foi escolhida. |
| `tabela_vencida_liberada` | booleano | não | Usou tabela vencida com autorização. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_frete_cotacoes[filial_id]` → `dim_filial[filial_id]`
- `fato_frete_cotacoes[transportadora_id]` → `dim_transportadora[transportadora_id]`
- `fato_frete_cotacoes[criado_por_id]` → `dim_usuario[usuario_id]`

### fato_ctes

CT-es de frete: transportadora, rota (UF/cidade), valor, peso e a conciliação com a cotação ou a tabela. Sem os documentos das partes.

- **Grão:** Um CT-e.
- **Chave primária:** `cte_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: emissão.
- **desde:** CT-es importados, conciliados ou decididos desde a data.
- **Datas para o calendário:** `data_emissao` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `cte_id` | texto | não | Número interno (uuid). |
| `numero` | texto | pode | Número do CT-e. |
| `serie` | texto | pode | Série. |
| `emitido_em` | datahora | pode | Emissão. |
| `data_emissao` | data | não | Dia da emissão (ou da importação, se não houver). |
| `transportadora_id` | texto | pode | Transportadora. |
| `filial_id` | texto | pode | Filial. |
| `uf_inicio` | texto | pode | UF de início. |
| `uf_fim` | texto | pode | UF de destino. |
| `cidade_inicio` | texto | pode | Cidade de início. |
| `cidade_fim` | texto | pode | Cidade de destino. |
| `cfop` | texto | pode | CFOP. |
| `valor_frete` | moeda | não | Valor total do CT-e (R$). |
| `valor_carga` | moeda | pode | Valor da carga (R$). |
| `peso_kg` | decimal | pode | Peso (kg). |
| `situacao_fiscal` | texto | não | NAO_VERIFICADO ou CANCELADO. |
| `origem` | texto | não | MANUAL (XML enviado) ou SEFAZ (captura automática). |
| `papel_empresa` | texto | pode | Papel da empresa no CT-e (TOMADOR, REMETENTE...), separados por vírgula. |
| `situacao_conciliacao` | texto | não | PENDENTE, CONCILIADO, DIVERGENTE, SEM_REFERENCIA, COMPRA ou CANCELADO. |
| `base_esperado` | texto | pode | De onde veio o valor esperado: COTACAO ou TABELA. |
| `valor_esperado` | moeda | pode | Frete esperado (R$). |
| `diferenca` | moeda | pode | Cobrado menos esperado (R$). |
| `conciliado_em` | datahora | pode | Conciliação. |
| `decisao` | texto | pode | APROVADO, APROVADO_COTADO ou CONTESTADO. |
| `valor_aprovado` | moeda | pode | Valor aprovado para pagar (R$). |
| `decidido_em` | datahora | pode | Decisão. |
| `situacao_contestacao` | texto | pode | ABERTA, ACEITA ou RECUSADA. |
| `valor_credito` | moeda | pode | Crédito obtido na contestação (R$). |
| `fatura_id` | texto | pode | Fatura da transportadora. |
| `pedido_expedicao_id` | texto | pode | Pedido de expedição ligado. |
| `importado_em` | datahora | não | Quando entrou no CRM. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_ctes[transportadora_id]` → `dim_transportadora[transportadora_id]`
- `fato_ctes[filial_id]` → `dim_filial[filial_id]`

### fato_brindes

Brindes entregues (retiradas) pelo vendedor ou pela filial, sem o cliente.

- **Grão:** Uma retirada.
- **Chave primária:** `retirada_id` (única)
- **Janela padrão:** Sem "desde": as linhas dos últimos 24 meses (ou "meses") pela data principal. Data principal: data.
- **desde:** Retiradas registradas desde a data (retirada desfeita some da tabela).
- **Datas para o calendário:** `data` (ativa)

| Coluna | Tipo | Vazia? | Significado |
|---|---|---|---|
| `retirada_id` | texto | não | Número interno (uuid). |
| `data` | data | não | Dia da retirada. |
| `brinde_id` | texto | não | Brinde. |
| `titular` | texto | não | VENDEDOR ou FILIAL (quem entregou). |
| `vendedor_id` | texto | pode | Vendedor que entregou. |
| `filial_id` | texto | pode | Filial que entregou, ou a do vendedor. |
| `quantidade` | inteiro | não | Quantidade. |
| `valor_unitario` | moeda | não | Valor unitário no dia (R$). |
| `valor_total` | moeda | não | Quantidade × valor unitário (R$). |
| `registrado_em` | datahora | não | Quando foi registrado. |

Relações (muitos para um, filtro em direção única, da dimensão para esta tabela):

- `fato_brindes[brinde_id]` → `dim_brinde[brinde_id]`
- `fato_brindes[vendedor_id]` → `dim_vendedor[vendedor_id]`
- `fato_brindes[filial_id]` → `dim_filial[filial_id]`

## 5. Modelo (relações)

Esquema estrela: cada relação é **muitos para um** (fato → dimensão), **filtro em direção única** (a dimensão filtra
o fato). Relações entre dimensões (ex.: `dim_vendedor[filial_id]` → `dim_filial`) ficam **inativas** para não
criar dois caminhos até a mesma tabela; use a filial do próprio fato.

| De (muitos) | Para (um) | Ativa |
|---|---|---|
| `dim_vendedor[filial_id]` | `dim_filial[filial_id]` | não |
| `dim_usuario[filial_id]` | `dim_filial[filial_id]` | não |
| `dim_numero_whatsapp[filial_id]` | `dim_filial[filial_id]` | não |
| `fato_leads[filial_id]` | `dim_filial[filial_id]` | sim |
| `fato_leads[origem_id]` | `dim_origem[origem_id]` | sim |
| `fato_leads[vendedor_id]` | `dim_vendedor[vendedor_id]` | sim |
| `fato_leads[vendedor_carteira_id]` | `dim_vendedor[vendedor_id]` | não |
| `fato_atendimentos[vendedor_id]` | `dim_vendedor[vendedor_id]` | sim |
| `fato_atendimentos[filial_id]` | `dim_filial[filial_id]` | sim |
| `fato_atendimentos[origem_id]` | `dim_origem[origem_id]` | sim |
| `fato_atendimentos[tipo_cliente_id]` | `dim_tipo_cliente[tipo_cliente_id]` | sim |
| `fato_atendimentos[motivo_perda_id]` | `dim_motivo_perda[motivo_perda_id]` | sim |
| `fato_conversas_whatsapp[numero_id]` | `dim_numero_whatsapp[numero_id]` | sim |
| `fato_conversas_whatsapp[setor_id]` | `dim_setor[setor_id]` | sim |
| `fato_conversas_whatsapp[atendente_id]` | `dim_usuario[usuario_id]` | sim |
| `fato_conversas_whatsapp[respondido_por_id]` | `dim_usuario[usuario_id]` | não |
| `fato_conversas_whatsapp[vendedor_id]` | `dim_vendedor[vendedor_id]` | sim |
| `fato_itens_pedido[produto_id]` | `dim_produto[produto_id]` | sim |
| `fato_ml_perguntas[atendente_id]` | `dim_usuario[usuario_id]` | sim |
| `fato_frete_cotacoes[filial_id]` | `dim_filial[filial_id]` | sim |
| `fato_frete_cotacoes[transportadora_id]` | `dim_transportadora[transportadora_id]` | sim |
| `fato_frete_cotacoes[criado_por_id]` | `dim_usuario[usuario_id]` | sim |
| `fato_ctes[transportadora_id]` | `dim_transportadora[transportadora_id]` | sim |
| `fato_ctes[filial_id]` | `dim_filial[filial_id]` | sim |
| `fato_brindes[brinde_id]` | `dim_brinde[brinde_id]` | sim |
| `fato_brindes[vendedor_id]` | `dim_vendedor[vendedor_id]` | sim |
| `fato_brindes[filial_id]` | `dim_filial[filial_id]` | sim |

Chaves para cruzar fatos (sem relação no modelo; use em medidas ou mesclagens): `lead_id` (leads, atendimentos,
conversas, pedidos, carrinhos), `fato_conversas_whatsapp[atendimento_id]` → `fato_atendimentos[atendimento_id]`,
`fato_itens_pedido[pedido_id]` → `fato_pedidos_loja[pedido_id]`, `fato_ml_vendas[pergunta_id]` →
`fato_ml_perguntas[pergunta_id]`.

### Calendário

Crie a tabela de datas no próprio Power BI e marque como tabela de datas:

```dax
dim_calendario =
ADDCOLUMNS (
    CALENDAR ( DATE ( YEAR ( TODAY () ) - 3, 1, 1 ), DATE ( YEAR ( TODAY () ), 12, 31 ) ),
    "ano", YEAR ( [Date] ),
    "mes", MONTH ( [Date] ),
    "ano_mes", FORMAT ( [Date], "yyyy-mm" ),
    "nome_mes", FORMAT ( [Date], "mmm/yy" ),
    "dia_semana", WEEKDAY ( [Date], 2 )
)
```

Ligue `dim_calendario[Date]` (um) às datas de cada fato (muitos). A primeira data de cada fato é a relação ativa;
as outras ficam inativas e entram nas medidas com `USERELATIONSHIP`:

| Fato | Ativa | Inativas |
|---|---|---|
| `fato_leads` | `data_criacao` | - |
| `fato_atendimentos` | `data_lead` | `data_resultado` |
| `fato_conversas_whatsapp` | `data_inicio` | - |
| `fato_pedidos_loja` | `data_pedido` | - |
| `fato_itens_pedido` | `data_pedido` | - |
| `fato_carrinhos` | `data_inicio` | - |
| `fato_ml_perguntas` | `data_recebida` | - |
| `fato_ml_vendas` | `data_pedido` | - |
| `fato_ml_ads_diario` | `data` | - |
| `fato_anuncios_diario` | `data` | - |
| `fato_email_campanhas` | `data_envio` | - |
| `fato_webpush` | `data_envio` | - |
| `fato_frete_cotacoes` | `data_cotacao` | - |
| `fato_ctes` | `data_emissao` | - |
| `fato_brindes` | `data` | - |

## 6. Medidas DAX sugeridas

### Pré-venda e vendas (fato_atendimentos)

```dax
Pré-vendas = CALCULATE ( COUNTROWS ( fato_atendimentos ), fato_atendimentos[tipo] = "PRE_VENDAS" )
Vendas = CALCULATE ( [Pré-vendas], fato_atendimentos[venda] = TRUE () )
Perdas = CALCULATE ( [Pré-vendas], fato_atendimentos[situacao_venda] = "NAO" )
Em negociação = CALCULATE ( [Pré-vendas], fato_atendimentos[situacao_venda] = "NEGOCIACAO" )
Taxa de conversão = DIVIDE ( [Vendas], [Pré-vendas] )
Receita das pré-vendas = CALCULATE ( SUM ( fato_atendimentos[valor_venda] ), fato_atendimentos[tipo] = "PRE_VENDAS", fato_atendimentos[venda] = TRUE () )
Ticket médio = DIVIDE ( [Receita das pré-vendas], [Vendas] )
Vendas pela data do resultado = CALCULATE ( [Vendas], USERELATIONSHIP ( fato_atendimentos[data_resultado], dim_calendario[Date] ) )
Tempo até o repasse (min, mediana) = MEDIAN ( fato_atendimentos[minutos_ate_repasse] )
Horas até o resultado (média) = AVERAGE ( fato_atendimentos[horas_ate_resultado] )
Pós-vendas pendentes = CALCULATE ( COUNTROWS ( fato_atendimentos ), fato_atendimentos[tipo] = "POS_VENDAS", fato_atendimentos[acompanhamento] = "PENDENTE" )
```

### WhatsApp (fato_conversas_whatsapp)

```dax
Atendimentos WhatsApp = COUNTROWS ( fato_conversas_whatsapp )
Atendimentos recebidos = CALCULATE ( [Atendimentos WhatsApp], fato_conversas_whatsapp[iniciado_por] = "cliente" )
Primeira resposta (min, mediana) = MEDIAN ( fato_conversas_whatsapp[minutos_primeira_resposta] )
Primeira resposta comercial (min, mediana) = MEDIAN ( fato_conversas_whatsapp[minutos_primeira_resposta_comercial] )
% respondidos em 15 min = DIVIDE ( CALCULATE ( [Atendimentos recebidos], fato_conversas_whatsapp[minutos_primeira_resposta_comercial] <= 15 ), CALCULATE ( [Atendimentos recebidos], NOT ISBLANK ( fato_conversas_whatsapp[minutos_primeira_resposta] ) ) )
Sem resposta = CALCULATE ( [Atendimentos recebidos], ISBLANK ( fato_conversas_whatsapp[primeira_resposta_em] ) )
Aguardando agora = CALCULATE ( [Atendimentos WhatsApp], fato_conversas_whatsapp[aguardando_resposta] = TRUE () )
Mensagens recebidas = SUM ( fato_conversas_whatsapp[mensagens_cliente] )
Mensagens enviadas = SUM ( fato_conversas_whatsapp[mensagens_empresa] )
```

### Mídia paga (fato_anuncios_diario + fato_atendimentos)

```dax
Investimento = SUM ( fato_anuncios_diario[investimento] )
Investimento Google = CALCULATE ( [Investimento], fato_anuncios_diario[plataforma] = "google" )
Cliques = SUM ( fato_anuncios_diario[cliques] )
Impressões = SUM ( fato_anuncios_diario[impressoes] )
CTR = DIVIDE ( [Cliques], [Impressões] )
CPC = DIVIDE ( [Investimento], [Cliques] )
Leads Google Ads = CALCULATE ( [Pré-vendas], fato_atendimentos[veio_google_ads] = TRUE () )
Vendas Google Ads = CALCULATE ( [Vendas], fato_atendimentos[veio_google_ads] = TRUE () )
Receita Google Ads = CALCULATE ( [Receita das pré-vendas], fato_atendimentos[veio_google_ads] = TRUE () )
CPL Google = DIVIDE ( [Investimento Google], [Leads Google Ads] )
CPA Google = DIVIDE ( [Investimento Google], [Vendas Google Ads] )
ROAS Google = DIVIDE ( [Receita Google Ads], [Investimento Google] )
```

"Veio do Google Ads" é só quem clicou num anúncio antes do contato (`veio_google_ads`); a origem sozinha não conta.
Para comparar por campanha, use `campanha_google_id` do atendimento com `campanha_id` do diário (sem relação no
modelo: crie uma dimensão de campanhas no Power BI se precisar).

### Loja virtual (fato_pedidos_loja, fato_itens_pedido, fato_carrinhos)

```dax
Pedidos pagos = CALCULATE ( COUNTROWS ( fato_pedidos_loja ), fato_pedidos_loja[grupo_situacao] = "pago" )
Receita da loja = CALCULATE ( SUM ( fato_pedidos_loja[total] ), fato_pedidos_loja[grupo_situacao] = "pago" )
Ticket médio da loja = DIVIDE ( [Receita da loja], [Pedidos pagos] )
Itens vendidos = CALCULATE ( SUM ( fato_itens_pedido[quantidade] ), fato_itens_pedido[grupo_situacao] = "pago" )
Carrinhos abandonados = CALCULATE ( COUNTROWS ( fato_carrinhos ), fato_carrinhos[situacao] = "abandonado" )
Taxa de compra dos carrinhos = DIVIDE ( CALCULATE ( COUNTROWS ( fato_carrinhos ), fato_carrinhos[situacao] = "comprado" ), COUNTROWS ( fato_carrinhos ) )
Valor em carrinhos abandonados = CALCULATE ( SUM ( fato_carrinhos[valor] ), fato_carrinhos[situacao] = "abandonado" )
```

### Mercado Livre (fato_ml_ads_diario, fato_ml_perguntas, fato_ml_vendas)

```dax
Investimento ML Ads = CALCULATE ( SUM ( fato_ml_ads_diario[investimento] ), fato_ml_ads_diario[nivel] = "campaign" )
Receita ML Ads = CALCULATE ( SUM ( fato_ml_ads_diario[receita] ), fato_ml_ads_diario[nivel] = "campaign" )
ROAS ML = DIVIDE ( [Receita ML Ads], [Investimento ML Ads] )
ACOS ML = DIVIDE ( [Investimento ML Ads], [Receita ML Ads] )
Perguntas = COUNTROWS ( fato_ml_perguntas )
% respondidas pelo CRM = DIVIDE ( CALCULATE ( [Perguntas], fato_ml_perguntas[respondida_pelo_crm] = TRUE () ), [Perguntas] )
Tempo de resposta ML (min, mediana) = MEDIAN ( fato_ml_perguntas[minutos_resposta] )
Vendas do assistente = CALCULATE ( SUM ( fato_ml_vendas[quantidade] ), fato_ml_vendas[pago_antes] = FALSE () )
Receita do assistente = CALCULATE ( SUM ( fato_ml_vendas[total] ), fato_ml_vendas[pago_antes] = FALSE () )
```

### E-mail e Web Push (fato_email_campanhas, fato_webpush)

```dax
E-mails enviados = SUM ( fato_email_campanhas[enviados] )
Taxa de abertura = DIVIDE ( SUM ( fato_email_campanhas[abriram] ), [E-mails enviados] )
Taxa de clique (e-mail) = DIVIDE ( SUM ( fato_email_campanhas[clicaram] ), [E-mails enviados] )
CTOR = DIVIDE ( SUM ( fato_email_campanhas[clicaram] ), SUM ( fato_email_campanhas[abriram] ) )
Descadastro = DIVIDE ( SUM ( fato_email_campanhas[descadastros] ), [E-mails enviados] )
Taxa de clique (Web Push) = DIVIDE ( SUM ( fato_webpush[cliques] ), SUM ( fato_webpush[entregues] ) )
```

### Fretes (fato_frete_cotacoes, fato_ctes)

```dax
Frete pago (CT-e) = CALCULATE ( SUM ( fato_ctes[valor_frete] ), fato_ctes[situacao_fiscal] <> "CANCELADO" )
Frete sobre a carga = DIVIDE ( [Frete pago (CT-e)], CALCULATE ( SUM ( fato_ctes[valor_carga] ), fato_ctes[situacao_fiscal] <> "CANCELADO" ) )
Frete sobre a venda = DIVIDE ( [Frete pago (CT-e)], [Receita das pré-vendas] + [Receita da loja] )
Frete por kg = DIVIDE ( [Frete pago (CT-e)], SUM ( fato_ctes[peso_kg] ) )
Divergência cobrada = CALCULATE ( SUM ( fato_ctes[diferenca] ), fato_ctes[situacao_conciliacao] = "DIVERGENTE" )
Crédito das contestações = SUM ( fato_ctes[valor_credito] )
% CT-es conciliados = DIVIDE ( CALCULATE ( COUNTROWS ( fato_ctes ), fato_ctes[situacao_conciliacao] = "CONCILIADO" ), COUNTROWS ( fato_ctes ) )
Cotações = COUNTROWS ( fato_frete_cotacoes )
% cotações escolhidas = DIVIDE ( CALCULATE ( [Cotações], fato_frete_cotacoes[situacao] = "SELECIONADA" ), [Cotações] )
Frete cotado sobre a carga = DIVIDE ( SUM ( fato_frete_cotacoes[total_escolhido] ), CALCULATE ( SUM ( fato_frete_cotacoes[valor_carga] ), fato_frete_cotacoes[situacao] = "SELECIONADA" ) )
```

"Frete sobre a venda" compara o frete dos CT-es com a receita das pré-vendas e da loja no mesmo período: é uma visão
geral (o CT-e não está ligado a uma venda específica).

### Leads e brindes (fato_leads, fato_brindes)

```dax
Leads = COUNTROWS ( fato_leads )
Leads clientes = CALCULATE ( [Leads], fato_leads[estagio] = "CLIENTE" )
% leads que viraram clientes = DIVIDE ( [Leads clientes], [Leads] )
Brindes entregues = SUM ( fato_brindes[quantidade] )
Valor em brindes = SUM ( fato_brindes[valor_total] )
Brindes por venda = DIVIDE ( [Brindes entregues], [Vendas] )
```

## 7. O que não está publicado

- **frete do pedido da loja:** O CRM não copia o valor do frete dos pedidos da Magazord (só total, situação, canal e itens).
- **categoria do produto:** A Magazord não manda a categoria ao CRM; grupo e subgrupo vêm do ERP (Tcar) quando o SKU coincide.
- **custo do produto:** O CRM não guarda custo de produto.

## 8. LGPD

Nenhuma tabela traz nome, telefone, e-mail, CPF/CNPJ ou endereço (nem CEP) de cliente, nome de empresa cliente, texto
de mensagem ou de pergunta. O cliente aparece só pelo número interno (`lead_id`). Aparecem nomes da equipe
(vendedores, usuários, filiais), de fornecedores (transportadoras), cidade e UF. A chave dá acesso a todas as tabelas
da empresa: crie só para quem monta os relatórios e revogue quando não for mais usada (fica na auditoria).
