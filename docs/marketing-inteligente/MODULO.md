# Marketing Inteligente: documentação técnica

Primeira entrega: versão 0.74.0 (etapas E1 e E2 do [levantamento](LEVANTAMENTO.md)). Versão 0.75.0: o restante do projeto (Google Ads detalhado, Meta, TikTok, redes sociais, SEO, planejamento, alertas, PDF/Excel e resumo pela IA). Versão 0.76.0: tela Instagram (perfis da empresa e dos vendedores, stories, público, melhores horários, tráfego, leads de formulário e concorrentes).

## O que não muda

O módulo **só lê** o CRM. Não altera telas, menus, tabelas, permissões nem regras dos módulos atuais. A 0.75.0 tem uma migração que **só cria** 8 tabelas novas, sem ligação com as tabelas atuais (`20261021100000_marketing_inteligente`).

| Tabela | Conteúdo | Origem |
|---|---|---|
| `google_ads_detail_days` | Google Ads por tipo de campanha, dispositivo, rede, região, página de destino, anúncio e grupo | Script do Google Ads |
| `google_ads_search_term_days` | Termos de pesquisa | Script do Google Ads |
| `mkt_ad_days` | Meta e TikTok por campanha, conjunto e anúncio (com o criativo) | Sincronização |
| `mkt_ad_breakdown_days` | Meta por idade, gênero, região e posicionamento | Sincronização |
| `mkt_social_profile_days` | Seguidores, alcance e visitas do Instagram e Facebook por dia | Sincronização |
| `mkt_social_posts` | Publicações com alcance, interações e salvamentos | Sincronização |
| `mkt_seo_days` | Search Console: total, consultas e páginas por dia | Sincronização |
| `mkt_editorial_items` | Calendário editorial | Tela Redes sociais |

A 0.76.0 (`20261021200000_instagram_concorrentes`) também **só acrescenta**: colunas que aceitam vazio em `mkt_social_profile_days` (novos seguidores, deixaram de seguir, contas com interação, interações, toques nos links, visualizações) e em `mkt_social_posts` (`extra` e `profileId`), e 3 tabelas:

| Tabela | Conteúdo | Origem |
|---|---|---|
| `mkt_competitor_days` | Seguidores e total de publicações de concorrentes e de perfis só públicos, por dia | Business Discovery (dados públicos) |
| `mkt_competitor_posts` | Publicações públicas (feed e reels) com curtidas e comentários | Business Discovery |
| `mkt_competitor_notes` | Stories vistos e anúncio ativo registrados pela equipe | Tela Instagram › Concorrentes |

As configurações ficam em `tenant_settings`, em chaves próprias:

| Chave | Conteúdo |
|---|---|
| `mkt_config` | Regras das análises |
| `mkt_integracoes` | Contas de Meta, TikTok e Search Console, com os tokens criptografados |
| `mkt_relatorios` | Agendamentos e histórico de envios |
| `mkt_planejamento` | Orçamento e metas por mês |
| `mkt_alertas` | Regras de alerta e último aviso |
| `mkt_termos` | Decisão sobre termos de pesquisa (negativar ou manter) |
| `mkt_sync` | Situação da última sincronização de cada integração |
| `google_ads_detalhes` | Data do último envio do detalhamento pelo script |
| `mkt_ig_contas` | Perfis do Instagram além do oficial (conectados pelo id ou só pelo @), com o vendedor |
| `mkt_ig_publico:<id>` | Público de cada perfil conectado: horas online, cidade, idade, gênero e país (só totais) |
| `mkt_concorrentes` / `mkt_concorrentes_status` | Concorrentes cadastrados e o resultado da última leitura |

## Código

| Parte | Arquivos |
|---|---|
| Contas (funções puras) | `apps/api/src/marketing/metricas.ts` |
| Regras, integrações e agendamento | `apps/api/src/marketing/config.ts` |
| Recomendações | `apps/api/src/marketing/recomendacoes.ts` |
| E-mail do relatório | `apps/api/src/marketing/relatorio-email.ts` |
| Leitura dos dados e integrações | `marketing.service.ts` |
| Envio dos relatórios | `relatorios.service.ts` (rotina a cada 5 min) |
| Rotas | `marketing.controller.ts` (`/api/marketing/...`) |
| Telas | `apps/web/src/pages/marketing/` e `apps/web/src/components/marketing/ui.tsx` |
| Configurações | `apps/web/src/pages/settings/marketing-tab.tsx` (Configurações › Marketing Inteligente) |
| Google Ads detalhado | `apps/api/src/googleads/detalhes.ts` (limpeza e sugestão de negativas) e o script em `googleads/painel.ts` |
| Sincronização | `sync.ts` (leitura das respostas, funções puras) e `sync.service.ts` (rotina a cada 30 min) |
| Plataformas, SEO e redes | `plataformas.ts` e `plataformas.service.ts` |
| Planejamento e alertas | `planejamento.ts` e `gestao.service.ts` (alertas de hora em hora) |
| PDF e Excel | `arquivos.ts` |
| IA | `ia.ts` |
| Instagram | `instagram.ts` (horários, perfis, concorrentes, leads de formulário) e `instagram.service.ts` |
| Testes | `apps/api/test/marketing.spec.ts` e `marketing-plataformas.spec.ts` |

## Permissões (Configurações › Perfis de acesso › grupo Marketing Inteligente)

Os perfis existentes começam **sem acesso**: só vê quem tiver o módulo liberado no perfil. O administrador do sistema vê tudo.

| Módulo | Telas | Ações |
|---|---|---|
| `mi_executivo` | Visão geral, Dashboard executivo, Funil e atribuição, Análise de campanhas | Exportar: CSV |
| `mi_midia` | Google Ads, Meta Ads, TikTok Ads | Exportar: CSV |
| `mi_social` | Redes sociais | — |
| `mi_seo` | SEO e site | — |
| `mi_comercial` | CRM e leads, E-mail marketing | Exportar: CSV |
| `mi_ia` | Recomendações | — |
| `mi_orcamento` | Planejamento | Editar: orçamento e metas (próxima etapa) |
| `mi_relatorios` | Relatórios automáticos | Criar, Editar (inclui enviar agora), Excluir |
| `mi_config` | Integrações; Configurações › Marketing Inteligente | Editar: regras e contas |

## Fonte dos dados

- **Comercial:** os atendimentos do Pré-Vendas (`service_records`, tipo `PRE_VENDAS`, sem os apagados), pela data do contato (`leadAt`, horário de Brasília).
- **Faturamento:** o valor da venda do Pré-Vendas (`saleValue`, quando "Venda realizada = Sim"). A integração com o ERP fica para depois.
- **Investimento:**
  - Google Ads: `google_ads_campaign_days`, enviado pelo script do Google Ads;
  - Meta e TikTok: entram quando conectados, na próxima etapa.
- **Plataforma do lead:**
  - Google, quando o atendimento veio de anúncio (`adsVia` = `ANUNCIO` ou `ORIGEM`);
  - Meta ou TikTok, pela origem ou pelo `utm_source` do lead;
  - o resto conta como "Outros canais".

## Definições

| Etapa | Regra |
|---|---|
| Lead | Atendimento do Pré-Vendas no período, **um por lead**. A chave é o lead; sem lead, o telefone; sem telefone, o atendimento. |
| Atendido | Tem primeira ação, foi repassado ao vendedor ou já tem a venda decidida (Sim/Não). |
| Oportunidade | Repassado ao vendedor. |
| Qualificado | Repassado ao vendedor **e** "Vendedor retornou? Sim" (padrão). Configurável para "só repassado". |
| Venda | "Venda realizada = Sim". Cada atendimento com venda conta como um pedido. |
| Marketing | Plataforma paga (Google, Meta, TikTok) ou origem marcada como marketing nas configurações. |
| Cliente recorrente | Já tinha venda no Pré-Vendas ou pedido na loja antes do início do período. |
| Região | Estado → Norte, Nordeste, Centro-Oeste, Sudeste, Sul; outro país conta como "Exterior". |

## Fórmulas (`formulas()` e `indicators()` em `metricas.ts`)

Denominador zero, ou sem custo, vira `null` e a tela mostra "—".

| Indicador | Fórmula |
|---|---|
| Investimento em mídia | Soma do custo das plataformas no período |
| Custo total | Mídia + custos fixos mensais × dias do período ÷ 30 |
| CTR | Cliques ÷ impressões × 100 |
| CPC | Mídia ÷ cliques |
| CPM | Mídia ÷ impressões × 1.000 |
| CPL | Mídia ÷ leads únicos |
| Custo por lead qualificado | Mídia ÷ qualificados únicos |
| CAC | Custo total ÷ clientes novos (com venda e de marketing) |
| Conversão | Vendas ÷ leads únicos × 100 |
| ROAS | Faturamento atribuído ao marketing ÷ mídia |
| ROI estimado | (Faturamento atribuído × margem − custo total) ÷ custo total × 100 (margem padrão 30%, configurável) |
| Ticket médio | Faturamento ÷ vendas |
| Atendidos | Atendidos ÷ leads × 100; sem atendimento = 100 − atendidos |
| Oportunidades perdidas | Perdidas ÷ (vendidas + perdidas) × 100 |
| Variação | (atual − anterior) ÷ anterior × 100, contra o período anterior do mesmo tamanho |

- **Conversões das plataformas** ("Conversões no Google") ficam separadas: nunca são somadas às vendas do CRM.
- **Filtros só do CRM** (marca, tipo de peça, estado, região, filial, vendedor, origem, tipo de cliente, situação, cliente novo/recorrente): as plataformas não informam custo por esses recortes. Com eles, o investimento fica fora das contas e a tela avisa.
- **Recortes com vários itens** (um atendimento com duas marcas): o atendimento entra em cada item, e a tabela avisa que a soma das linhas pode passar do total.

## Atribuição

- **Último toque (padrão):** a campanha gravada no atendimento.
- **Primeiro toque:** a primeira campanha do lead (`leads.adsFirstCampaignId`).
- **Janela** (padrão 90 dias): um clique mais antigo que isso, antes do contato, não é atribuído à campanha.
- O modelo usado aparece em todas as telas e nos relatórios.

## Recomendações

As regras ficam em `recomendacoes.ts`. Cada uma tem amostra mínima (10 leads) e confiança pelo tamanho da amostra: alta com 50 ou mais, média com 20 ou mais. Cada recomendação traz o problema, a evidência com os números, o impacto, a ação, a métrica e como validar, e a fonte.

| Regra | Dispara quando |
|---|---|
| CPL subiu | Alta de 25% ou mais |
| Campanha sem leads | Investiu e não gerou nenhum lead |
| Campanha sem vendas | 15 leads ou mais e nenhuma venda |
| Leads sem atendimento | 10% ou mais sem atendimento |
| Demora para repassar | Mediana acima de 24 h até o repasse |
| Estado acima da média | Converte 1,5× a média |
| Vendedor abaixo da média | Converte metade da média ou menos |
| Leads de anúncio sem campanha | 20% ou mais dos leads de anúncio |
| Queda de faturamento | Queda de 30% ou mais |
| Investimento desatualizado | Sem atualização há mais de 36 h |

Nada é aplicado nas plataformas.

## Relatórios e alertas

- **O que se configura:** nome, e-mails (até 20), frequência (diária, semanal ou mensal), dia, hora de Brasília, período, filtros, conteúdo (13 partes à escolha, com o resumo da IA) e anexo (nenhum, PDF ou Excel).
- **Envio:** a rotina confere a cada 5 minutos o que está na hora e envia pelo SMTP configurado. Se o servidor ficar fora, o horário perdido é enviado até 2 horas depois. Um relatório criado depois do horário do dia só sai no próximo.
- **Prévia e Enviar agora:** usam o mesmo e-mail do envio agendado.
- **Histórico:** ficam os últimos 50 envios, com o erro de cada um.
- **Baixar agora:** PDF ou Excel (`GET /api/marketing/exportar?formato=pdf|xlsx&secoes=...`) com os filtros da tela. Precisa de Exportar no Dashboard executivo ou de Ver em Relatórios.
- **Alertas:** 9 tipos (gasto perto do limite do orçamento, campanha com investimento e sem leads, aumento do CPL, queda de leads, queda do faturamento, leads sem atendimento, meta abaixo do ritmo, leads de anúncio sem UTM, dados desatualizados ou falha de integração). A rotina confere de hora em hora e avisa no máximo uma vez a cada 20 h por alerta, na tela e, se houver e-mails, por e-mail. Os de variação não disparam com menos de 10 leads. **Testar agora** avalia sem enviar.

## Google Ads detalhado

O script do Google Ads (Configurações › Google Ads) passa a mandar também o detalhamento e os termos de pesquisa, em partes de até 3.000 linhas. Cada consulta extra roda isolada: se uma falhar, as outras seguem. **É preciso colar o script novo** no Google Ads.

Sugestão de negativas: termo com palavra de alerta (lista padrão em `DEFAULT_ALERT_WORDS`, editável em Configurações › Marketing Inteligente) ou com gasto e cliques sem nenhuma conversão. A decisão (negativar ou manter) fica no CRM e a lista aprovada sai em arquivo para colar no Google Ads. O CRM não altera a conta.

## Integrações (só leitura)

- **Meta Ads e orgânico:** token do usuário do sistema e contas `act_…`; o teste lê o nome de cada conta (Graph API v23.0).
- **TikTok:** token e anunciante; o teste lê `advertiser/info`.
- **Search Console:** a conta de serviço do GA4; o teste lê `sites.get`.
- **Segurança:** os tokens ficam criptografados (`APP_ENCRYPTION_KEY`), nunca voltam para a tela e a auditoria registra as mudanças.
- **Sincronização:** rotina a cada 30 min; Meta Ads e TikTok a cada 3 h, Instagram/Facebook e Search Console a cada 6 h. O histórico de até 90 dias é buscado aos poucos; depois relê só os dias recentes (o Search Console tem 2 a 3 dias de atraso). **Sincronizar agora** em Configurações. Os custos de Meta e TikTok entram no investimento; o lead entra na campanha pelo `utm_campaign`.

## Planejamento

Orçamento do mês (total, por plataforma e por campanha) e metas (leads, CPL, vendas, faturamento). Projeção pelo ritmo médio por dia, com faixa pela variação diária (≈80%). Cenários de ±15% e ±30%: o otimista mantém o CPL; o conservador supõe retorno decrescente (leads ∝ investimento^0,6). Conversão e ticket ficam iguais. São estimativas, não promessas.

## Instagram

- **Perfis:** o oficial vem da integração (Instagram/Facebook). Outros perfis (empresa ou vendedores) entram em Instagram › Perfis: com o **id** (conta no Gerenciador de Negócios da empresa, achada por “Buscar contas do Gerenciador” em `me/accounts`) os dados são completos; só com o **@** (conta comercial ou de criador fora do Gerenciador) só os públicos, lidos pela conta oficial (Business Discovery).
- **Sincronização** (junto da Instagram/Facebook, a cada 6 h): alcance e novos seguidores por dia; contas com interação, interações, toques nos links, visualizações, visitas e seguir/deixar de seguir como total do dia (28 dias na 1ª vez, depois os 3 últimos); publicações com interações e tempo médio dos reels; stories (ficam 24 h na API) com respostas e navegação; público (`online_followers`, `follower_demographics`); perfis públicos e concorrentes. Erro em uma conta não derruba as outras: aparece como “Parte não sincronizou”.
- **Melhores horários:** horas com mais seguidores online (convertidas para Brasília) e alcance médio das publicações por dia da semana e faixa de 3 h (últimos 90 dias, faixa com 2 publicações ou mais). Stories ficam de fora.
- **Leads:** só quem preencheu formulário com origem no Instagram (`lead_events` de conversão com `formulario` do Lead Ads ou `canal` form/pop-up/landing). Seguidor, curtida, comentário, mensagem e clique no WhatsApp do site não contam. Venda = atendimento do Pré-Vendas do lead, aberto depois da conversão, marcado como vendido.
- **Tráfego:** pago = posicionamentos `instagram · …` da Meta Ads; site = visitas do rastreamento do CRM com origem Instagram.
- **Concorrentes:** até 10, mesmo cálculo para todos (engajamento por publicação = curtidas + comentários ÷ seguidores). Stories e anúncio ativo não vêm da API: a equipe registra o que viu (link pronto para a Biblioteca de Anúncios).
- **LGPD:** seguidores e público são só números somados; nada disso cria ou altera lead.

## IA (Gemini)

Resumo em Recomendações e, se marcado, no relatório por e-mail. A IA recebe só números agregados (plataformas, campanhas, regiões, marcas, tipos de peça, funil e diagnósticos), nunca nomes, telefones, e-mails ou vendedores. Usa a chave do Gemini já cadastrada no E-mail marketing; sem chave, a tela avisa. Nada é aplicado automaticamente.

## Plano de reversão

1. Voltar para a versão anterior com o deploy normal (tag `v0.75.1` desfaz só a 0.76.0; `v0.74.0` desfaz a 0.75.0; `v0.73.1` tira o módulo inteiro). Nada dos módulos atuais é afetado.
2. As tabelas novas não atrapalham a versão anterior e podem ficar. Para apagá-las:
   ```sql
   -- só a 0.76.0:
   DROP TABLE IF EXISTS mkt_competitor_days, mkt_competitor_posts, mkt_competitor_notes;
   ALTER TABLE mkt_social_posts DROP COLUMN IF EXISTS extra, DROP COLUMN IF EXISTS "profileId";
   ALTER TABLE mkt_social_profile_days DROP COLUMN IF EXISTS follows, DROP COLUMN IF EXISTS unfollows, DROP COLUMN IF EXISTS "accountsEngaged", DROP COLUMN IF EXISTS interactions, DROP COLUMN IF EXISTS "linkTaps", DROP COLUMN IF EXISTS views;
   DELETE FROM _prisma_migrations WHERE migration_name = '20261021200000_instagram_concorrentes';
   -- e a 0.75.0:
   DROP TABLE IF EXISTS google_ads_detail_days, google_ads_search_term_days, mkt_ad_days, mkt_ad_breakdown_days, mkt_social_profile_days, mkt_social_posts, mkt_seo_days, mkt_editorial_items;
   DELETE FROM _prisma_migrations WHERE migration_name = '20261021100000_marketing_inteligente';
   ```
3. Opcional, para apagar as configurações do módulo:
   ```sql
   DELETE FROM tenant_settings WHERE key IN ('mkt_config', 'mkt_integracoes', 'mkt_relatorios', 'mkt_planejamento', 'mkt_alertas', 'mkt_termos', 'mkt_sync', 'google_ads_detalhes', 'mkt_ig_contas', 'mkt_concorrentes', 'mkt_concorrentes_status') OR key LIKE 'mkt_ig_publico:%'
   ```

## Etapas

Todas as etapas do levantamento foram entregues (0.74.0 e 0.75.0). Fica para o futuro a integração do faturamento com o ERP (hoje a fonte é a Pré-Vendas).
