# Projeto do Power BI do CRM (CRM Usaparts.pbip)

Projeto pronto para o **Power BI Desktop**: modelo semântico (formato TMDL) ligado à API de BI do CRM e relatório
(formato PBIR) com 7 páginas. As tabelas, colunas e relações seguem o contrato de dados (`docs/BI-CONTRATO.md`, ou
o botão "Baixar o contrato de dados" em Configurações › Power BI).

> Os arquivos do modelo e do relatório são gerados pelo CRM a partir do catálogo da API
> (`apps/api/src/bi/powerbi*.ts`). Para mudar no repositório, mude o código e rode
> `ATUALIZAR_POWERBI=1 npx vitest run --root apps/api test/bi-powerbi.spec.ts`. Mudanças feitas no Power BI Desktop
> podem ser salvas normalmente no seu computador, mas não voltam para o CRM.

## 1. Abrir

1. Use o **Power BI Desktop** atualizado (de 2025 em diante; versão da Microsoft Store ou do instalador).
2. Descompacte o zip baixado em **Configurações › Power BI › Baixar projeto do Power BI** numa pasta do computador
   (não abra de dentro do zip). Mantenha juntos o arquivo `CRM Usaparts.pbip` e as pastas `CRM Usaparts.Report` e
   `CRM Usaparts.SemanticModel`.
3. Abra o `CRM Usaparts.pbip` (duplo clique ou Arquivo › Abrir).
   - Nas versões atuais, projetos (.pbip), TMDL e PBIR já vêm ligados. Numa versão antiga, se aparecer erro de
     formato, ligue em **Arquivo › Opções e configurações › Opções › Recursos de visualização** as opções
     **"Power BI Project (.pbip) save option"**, **"Store semantic model using TMDL format"** e **"Store reports
     using enhanced metadata format (PBIR)"**, reinicie o Power BI Desktop e abra de novo — ou, melhor, atualize o
     Power BI Desktop.
4. O projeto abre **sem dados** (o zip não leva dados). Antes de atualizar, preencha a chave (passo 2).

## 2. Endereço e chave

Em **Página Inicial › Transformar dados › Editar parâmetros**:

| Parâmetro | Valor |
|---|---|
| `CRM_BaseUrl` | Endereço da API de BI do CRM, terminado em `/api/bi/v1/`. O zip baixado do CRM já vem com o endereço certo (o do repositório é `https://crm.usaparts.com.br/api/bi/v1/`). |
| `CRM_Chave` | A chave criada em **Configurações › Power BI** no CRM (começa com `crmbi_`). Aparece uma vez só no CRM: copie e cole aqui. |

A chave fica só no arquivo do projeto no seu computador e no Power BI Service. Não mande o projeto com a chave por
WhatsApp ou e-mail; se vazar, revogue no CRM e crie outra.

## 3. Atualizar

1. Clique em **Atualizar** (Página Inicial). Na primeira vez o Power BI pede a credencial do endereço
   `https://crm.../api/bi/v1/`: escolha **Anônimo** (a chave vai no cabeçalho, pelo parâmetro) e **Conectar**. Se
   perguntar o nível de privacidade, escolha **Organizacional**.
2. Os fatos trazem os **últimos 24 meses** (janela padrão da API), em páginas de até 50 mil linhas. A primeira carga
   pode levar alguns minutos.
3. Erros comuns: `401` chave vazia, errada ou revogada (confira `CRM_Chave`); `429` limite de 120 pedidos por minuto
   (espere um minuto e atualize de novo); `404` endereço errado (confira `CRM_BaseUrl`).

## 4. Publicar no Power BI Service e agendar a atualização

1. **Página Inicial › Publicar** e escolha o workspace.
2. No Power BI Service, abra o workspace › modelo semântico **CRM Usaparts** › **Configurações**:
   - **Credenciais da fonte de dados › Editar credenciais**: método **Anônimo**, nível de privacidade
     **Organizacional** (o teste de conexão usa o endereço base, que responde sem chave).
   - **Parâmetros**: confira `CRM_BaseUrl` e `CRM_Chave` (ao trocar a chave no CRM, troque aqui).
   - **Atualização agendada**: ligue e escolha os horários (ex.: 6h, 12h e 18h).
   - Não precisa de gateway.
3. **Atualização incremental (opcional, para bases grandes):** crie os parâmetros `RangeStart` e `RangeEnd`
   (Data/Hora) e, na consulta do fato, troque `CRM_Tabela("fato_...")` por
   `CRM_Tabela("fato_...", Date.ToText(Date.From(RangeStart), "yyyy-MM-dd"))` e filtre a data principal entre
   `RangeStart` e `RangeEnd`. Depois, em **Exibição de modelo › tabela › Atualização incremental**, defina por exemplo
   "arquivar 24 meses" e "atualizar 10 dias". Linhas excluídas no CRM só somem numa atualização completa.

## 5. O que tem no modelo

- **Tabelas do CRM**: as dimensões (`dim_...`) e fatos (`fato_...`) do contrato, com os mesmos nomes de colunas.
  Colunas `_id` ficam ocultas (servem às relações).
- **Calendario**: dias de 5 anos atrás até o fim do ano atual, marcada como tabela de datas. Colunas Ano, Trimestre,
  Mês (nome em português), Mês/Ano, Semana (ISO), Dia, Dia da semana. Cada fato liga pela data principal; as outras
  datas (ex.: `data_resultado` do atendimento) ficam em relações inativas, usadas nas medidas com `USERELATIONSHIP`
  (ex.: "Vendas pela data do resultado").
- **_Medidas**: todas as medidas, em pastas: Comercial, WhatsApp, Loja, Mercado Livre, Marketing, Fretes, Brindes e
  Cenários. Cada área tem a subpasta **Comparações** (ano anterior, mês anterior e variação em %).
- **Hierarquias (drill-down)**: Calendário (Ano › Trimestre › Mês › Dia), Comercial em `dim_vendedor`
  (Filial › Vendedor), Geografia (UF › Cidade) nos leads, atendimentos, pedidos e carrinhos, Destino (UF › Cidade)
  nos CT-es e cotações, Produto (Marca › Produto) e Grupo do ERP em `dim_produto`, Origem em `fato_atendimentos`
  (Canal › Origem › Campanha do Google), Campanha nos diários de anúncios.

## 6. Páginas do relatório

| Página | O que mostra |
|---|---|
| Visão geral | Receita, vendas, conversão, ticket, comparação com o ano anterior, tendência por data, receita por filial e vendas por origem. |
| Comercial | Funil de leads, conversão por filial e vendedor, perdas por motivo e matriz filial › vendedor. |
| WhatsApp | Tempo da primeira resposta, % respondidos em 15 min, volume por número, setor, atendente e dia da semana. |
| Loja e Mercado Livre | Receita, pedidos, ticket e carrinhos da loja; marca › produto; UF › cidade; Mercado Livre Ads e perguntas. |
| Marketing | Investimento, CTR, CPC, CPL, CPA e ROAS por plataforma e campanha; resultado por origem; e-mails. |
| Fretes | Frete pago (CT-e), frete sobre a venda e sobre a carga, por transportadora e destino; cotações. |
| Cenários | Simulação (what-if) com controles deslizantes e o projetado contra o real. |

As segmentações do topo (período, filial, vendedor, origem...) filtram a página. A filial e o vendedor filtram o que
tem filial ou vendedor no próprio fato (atendimentos, leads, fretes...): a receita da loja, por exemplo, não tem filial.

## 7. Como usar o drill-down

Nos gráficos com hierarquia (ex.: "Receita das pré-vendas e da loja" e "Vendas por origem"):

- Ligue a **seta para baixo** (Fazer drill down) no canto do visual e clique numa barra ou ponto para descer um nível
  (ano → trimestre → mês → dia).
- **Seta dupla para baixo** mostra o próximo nível de tudo; **forquilha** expande todos os níveis de uma vez.
- **Seta para cima** volta um nível.
- Na matriz (filial › vendedor, canal › origem › campanha), use o **+** ao lado de cada linha.

## 8. Como usar os cenários (what-if)

Na página **Cenários**, mova os controles:

| Controle | O que muda |
|---|---|
| Variação da taxa de conversão (%) | A taxa de conversão das pré-vendas (de -50% a +100%). |
| Variação do investimento em anúncios (%) | O investimento (de -50% a +200%). As pré-vendas que vieram do Google Ads crescem na mesma proporção. |
| Variação do ticket médio (%) | O ticket médio das vendas (de -30% a +50%). |
| Variação do frete (%) | O frete pago nos CT-es (de -30% a +50%). |

Os cartões e gráficos mostram o real, o projetado e a diferença: **Receita projetada** = pré-vendas projetadas ×
conversão projetada × ticket projetado; **ROAS projetado** = receita do Google Ads projetada ÷ investimento do Google
projetado; **Frete projetado** e **Frete sobre a venda projetado**. Com todos os controles em 0%, o projetado é igual
ao real. São estimativas lineares (simplificações), não previsões: servem para comparar hipóteses.

Para usar os cenários em outras páginas, copie os controles (Ctrl+C / Ctrl+V) e use as medidas da pasta
**Cenários** em `_Medidas`.

## 9. Observações

- Medidas e textos seguem o contrato. "Veio do Google Ads" é só quem clicou num anúncio antes do contato.
- "Frete sobre a venda" compara o frete dos CT-es com a receita das pré-vendas e da loja no mesmo período (o CT-e não
  está ligado a uma venda específica).
- A comparação "ano anterior" só aparece quando há dados do ano anterior (a janela padrão é de 24 meses).
- Ao abrir pela primeira vez, o Power BI Desktop pode reorganizar e completar arquivos do projeto ao salvar (é normal).
