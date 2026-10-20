# Marketing Inteligente: levantamento técnico (Fases 1 e 2)

Data: 20/10/2026. Base: versão 0.73.1 do CRM Usaparts.
Situação: **proposta para aprovação**. Nada foi programado nem alterado no sistema.

---

## 1. Resumo para a decisão

- **Boa parte do que o projeto pede já existe no CRM.** O módulo novo vai ler e juntar esses dados. Já existem:
  - leads com origem, UTM e campanha (primeiro e último toque);
  - Pré-Vendas com marca, tipo de peça, estado, vendedor, filial, valor vendido e motivo de perda;
  - e-mail marketing próprio, com envios, aberturas, cliques, descadastros e vendas de quem clicou;
  - rastreamento do site, pedidos e carrinhos da loja (Magazord) e GA4;
  - investimento do Google Ads por campanha e palavra-chave, e conversões devolvidas ao Google.
- **O que falta são as fontes externas:**
  - Meta Ads (investimento e anúncios);
  - TikTok Ads;
  - redes orgânicas;
  - Search Console;
  - dados mais finos do Google Ads (termos de pesquisa, dispositivo, região, anúncios).
  - Cada fonte depende de **acesso que só a Usaparts pode liberar** (ver seção 7).
- **O sistema atual fica intacto.** Tudo entra como um grupo novo no menu ("Marketing Inteligente"), com permissões novas, tabelas novas e serviços próprios. Nenhuma tela, campo, tabela ou regra atual muda, e todas as migrações são só de acréscimo.
- **O servidor tem limite.** São 1,9 GB de RAM, com uso apertado no raio-x de 20/10, e a orientação é não mudar a VPS agora. Por isso:
  - o projeto não instala nada novo: nem Redis, nem filas, nem banco analítico, nem Metabase;
  - roda dentro da API atual, com sincronização incremental e tabelas diárias resumidas.
  - Para PDF agendado e várias contas sincronizando ao mesmo tempo, a recomendação é **subir para 4 GB quando chegar a Fase 7**.
- **Três decisões de negócio travam números importantes:**
  - o que é "lead qualificado";
  - de onde vem o faturamento real (Pré-Vendas, Magazord ou nota fiscal da Tcar);
  - se haverá margem/custo. Hoje o custo da Tcar **não é copiado, por decisão de segurança**, e sem custo não há ROI real, só ROAS.
- **Ordem recomendada (detalhe na seção 9):**
  1. Começar pelo que **não depende de ninguém de fora**: menu, dashboard executivo, funil, comercial, e-mail, Google Ads atual, metas e orçamento, alertas, saúde dos dados.
  2. Pedir **em paralelo** os acessos de Meta, Search Console, Google Ads e TikTok.

---

## 2. Arquitetura atual identificada (Fase 1: auditoria)

### 2.1 Tecnologia

| Camada | O que é | Observação para o projeto |
|---|---|---|
| API | NestJS 12 + Prisma 7 (PostgreSQL) | 57 tabelas, 60 migrações versionadas. Novas tabelas entram do mesmo jeito. |
| Web | React 19 + Vite + Tailwind + shadcn/ui + Recharts | Gráficos já usam Recharts: o módulo novo usa o mesmo, no mesmo visual. |
| Banco | PostgreSQL 18 (container) | Sem banco analítico. Agregações por dia em tabelas próprias. |
| Integrações WhatsApp | Evolution API v2 (container) | Não é tocada pelo projeto. |
| Rotinas | 13 rotinas internas na própria API (timers), sem fila | As sincronizações novas seguem o mesmo padrão, com horários espaçados. |
| Testes | vitest (355 testes, regras puras e serviços) | Fórmulas e atribuição terão testes próprios. |
| Publicação | Tag no GitHub → Action "Publicar versão" → `deploy/deploy.sh` na VPS | Cada fase sai como uma versão, com volta à anterior pela tag. |
| Servidor | VPS 1,9 GB RAM, 3 sistemas (CRM, BI, painel), ~32 GB livres | Ver 1.º resumo: limite de memória. |

### 2.2 Segurança e acesso (reutilizados sem mudança)

- Login próprio com 2FA, perfis de acesso por módulo (ver, criar, editar, excluir, exportar e escopo próprio/unidade/todos) e auditoria (`AuditLog`).
- Segredos (chaves de API, tokens) ficam criptografados no banco (`APP_ENCRYPTION_KEY`), nunca no navegador. As integrações novas usam o mesmo cofre (`TenantSetting`).
- **Permissões novas:** os módulos são uma lista em `common/permissions.ts`, e acrescentar itens não altera os perfis atuais. Os perfis atuais começam **sem acesso** ao módulo novo, e o administrador libera.

### 2.3 Dados que já existem e serão reutilizados

| Necessidade do projeto | Onde já está | Situação |
|---|---|---|
| Lead único, origem, UTM, campanha | `leads` (origem, 1.º e último toque do Google Ads, conversões, tags, nota A/B/C, opt-in) | Pronto |
| Atendimento, vendedor, filial, estado, marca, tipo de peça | `service_records` (Pré e Pós-Vendas): `sellerId`, `unitId`, `state`, `brandIds`, `partTypeIds`, `originId`, `customerTypeId` | Pronto |
| Datas do funil | `leadAt`, `forwardedAt` (repassou), `returnedAt` (vendedor retornou), `firstActionAt`, `calledAt` | Pronto: dá para medir tempo até atendimento e fechamento |
| Venda, valor, motivo da perda | `saleStatus`, `saleValue`, `invoiceNumber`, `lostReasonId` | Valor **digitado** no Pré-Vendas (ver 7.2) |
| Campanha no atendimento | `adsCampaignId`, `adsCampaign`, `adsVia` (gclid/origem), `adsTerm`, `entryPage`, `entryChannel` | Pronto (Google). Meta/TikTok precisam de UTM padronizada |
| Investimento Google Ads | `google_ads_campaign_days`, `google_ads_keyword_days` (script do Google Ads, de hora em hora) | Pronto |
| Conversões enviadas ao Google | `google_ads_conversions` (Data Manager API) | Pronto |
| Site | `site_visitors`, `site_pageviews`, `site_events` (rastreamento próprio) + GA4 Data API (conta de serviço) | Pronto |
| E-commerce | `ecommerce_orders`, `ecommerce_carts`, `store_products` (Magazord) | Pronto |
| E-mail marketing | `email_campaigns`, `email_recipients`, `email_clicks`, consentimento (`lead_consents`) | Pronto (sistema próprio, não é ferramenta externa) |
| WhatsApp | `whatsapp_conversations` e `whatsapp_messages` (tempo de 1.ª resposta já medido no painel do WhatsApp) | Pronto |
| Leads do Facebook/Instagram | Meta Lead Ads por webhook (só os formulários, **sem investimento**) | Parcial |
| IA | Chave do Google Gemini já usada no assistente de e-mail | Reutilizável |
| Envio de e-mail | SMTP próprio configurado (`MailService`) | Reutilizável para relatórios e alertas |
| Relatórios montáveis | `saved_reports` + tela Relatórios | Continua igual; o módulo novo tem os seus |

### 2.4 O que não existe hoje

1. **Meta Ads:** investimento, campanhas, conjuntos, anúncios, criativos, alcance e frequência.
2. **TikTok Ads** e **TikTok orgânico**.
3. **Instagram e Facebook orgânicos:** seguidores, alcance, posts, engajamento.
4. **Google Search Console:** consultas, posição, CTR orgânico.
5. **Google Ads detalhado:** grupos, anúncios, termos de pesquisa, dispositivo, região, rede, página de destino, parcela de impressões, tipo de campanha.
6. **Orçamento, metas, cenários.**
7. **Alertas configuráveis de marketing.** Hoje só há o aviso de saldo do Google Ads e o de script parado.
8. **Relatórios agendados em PDF/Excel.** Hoje há exportação CSV.
9. **Faturamento real e margem** (ver 7.2).
10. **Regra explícita de lead qualificado e cliente novo/recorrente.** Dá para derivar, mas precisa de decisão (ver 7.3).

---

## 3. Plano de integração sem substituir nada

| Regra do projeto | Como será cumprida |
|---|---|
| Não reconstruir nem mudar o CRM | Código novo em `apps/api/src/marketing/` (módulo NestJS separado) e `apps/web/src/pages/marketing/`. Os módulos atuais não são editados, só lidos pelo banco. |
| Só uma aba nova | Grupo "Marketing Inteligente" no menu, com os 15 submenus. Os itens atuais (inclusive o painel Google Ads de "Dashboards") continuam onde estão. |
| Não duplicar cadastros | Lead, vendedor, filial, marca, tipo de peça e origem vêm das tabelas atuais por ID. As tabelas novas só guardam dados de plataforma (campanha, anúncio, post) e resumos diários. |
| Migrações reversíveis | Só `CREATE TABLE` e `CREATE INDEX`. Nada de `ALTER`/`DROP` em tabela existente. Cada migração tem o SQL de volta documentado (`DROP TABLE` das tabelas novas). |
| Não interromper integrações | As sincronizações novas usam contas e chaves próprias. O script do Google Ads e o envio de conversões continuam como estão; a versão nova do script só **acrescenta** dados. |
| Somente leitura nas plataformas | Escopos de leitura: `ads_read`, `read_insights`, `analytics.readonly`, `webmasters.readonly`, relatórios do TikTok. Nenhuma tela altera campanha, lance, orçamento ou palavra-chave. A sugestão de palavra negativa é só uma lista para a pessoa revisar e aplicar no Google Ads. |
| Se algo exigir mudança incompatível | A etapa para e vira proposta. Itens já identificados: faturamento pela Tcar (7.2), custo/margem (7.2) e escrita nas plataformas (fora do escopo). |

---

## 4. Mapa de telas

Menu novo: **Marketing Inteligente**. Cada tela tem filtros globais, data da última atualização, fonte dos dados e "Não disponível" quando a fonte não traz a métrica.

| # | Tela | O que mostra | Fontes | Depende de acesso externo? |
|---|---|---|---|---|
| 1 | Visão geral | Resumo do período, saúde das fontes, alertas abertos, principais recomendações | Todas | Não |
| 2 | Dashboard executivo | Os 21 KPIs pedidos, comparação com o período anterior, tendência, visão dia/semana/mês/trimestre/ano | CRM + mídia | Não (Google já tem; Meta e TikTok entram quando conectados) |
| 3 | Google Ads | Campanhas por tipo (Pesquisa, PMax, Display, Vídeo), palavras-chave, termos de pesquisa, sugestão de negativas, dispositivo, região, página de destino | Script do Google Ads (ampliado) | Não para o script; sim para a API oficial (opcional) |
| 4 | Meta Ads | Campanhas, conjuntos, anúncios, criativos, posicionamento, público, frequência, fadiga | Meta Marketing API | **Sim** |
| 5 | TikTok Ads | Campanhas, grupos, anúncios, vídeos, custo por resultado | TikTok Business API | **Sim** |
| 6 | Redes sociais orgânicas | Seguidores, alcance, engajamento, ranking de posts, temas, calendário editorial | Graph API (Instagram/Facebook), TikTok | **Sim** (o calendário editorial não depende) |
| 7 | SEO e tráfego do site | Sessões, origem/mídia, páginas de entrada, consultas, posição, CTR, páginas de marca/categoria, receita da loja | GA4 (já), Search Console, Magazord (já), rastreamento (já) | Só o Search Console |
| 8 | CRM e leads de marketing | Leads por origem/campanha, atendidos, sem atendimento, tempo até 1.º atendimento, por vendedor/região | CRM | Não |
| 9 | E-mail marketing | Por campanha, segmento, assunto, CTA, período; abertura registrada x cliques; vendas de quem clicou | E-mail do CRM | Não |
| 10 | Funil e atribuição | Impressões → cliques → leads → qualificados → atendidos → oportunidades → vendas → faturamento, por plataforma/campanha/região/vendedor/marca/categoria; modelo e janela de atribuição | Todas | Não (etapas de mídia completas com Meta/TikTok) |
| 11 | Análise de campanhas | Ficha da campanha, comparação de 2 ou mais campanhas, tabela com ordenação, exportação e ligação ao registro de origem | Todas | Não |
| 12 | IA e recomendações | Diagnósticos com evidência, prioridade, confiança, ação e como medir; aprovar/descartar | Regras + Gemini | Não |
| 13 | Planejamento e orçamento | Orçamento por mês/plataforma/campanha, consumido, projeção, metas (leads, CPL, vendas, faturamento), cenários | CRM + mídia | Não |
| 14 | Relatórios automatizados | 9 modelos, escolha de indicadores e filtros, agendamento por e-mail, CSV/Excel/PDF | Todas | Não |
| 15 | Integrações e saúde dos dados | Contas conectadas, última sincronização, erros, métricas indisponíveis, duplicidades, % de leads com origem | Todas | Não |

**Os 8 modelos de dashboard (A a H) estão dentro dessas telas:**
- **A**, diretoria: tela 2;
- **B**, tráfego pago: telas 3, 4 e 5 com a comparação da tela 11;
- **C**, redes sociais: tela 6;
- **D**, comercial: tela 8;
- **E**, e-mail: tela 9;
- **F**, e-commerce: aba da tela 7;
- **G**, SEO: tela 7;
- **H**, rentabilidade: tela 2, completa só com custo/margem (7.2).

---

## 5. Modelo de dados complementar (tabelas novas)

Todas com `tenantId`, prefixo `mkt_`, índices por empresa e data. **Nenhuma tabela atual muda.**

| Tabela | Para quê | Chave de deduplicação |
|---|---|---|
| `mkt_connections` | Conta conectada por plataforma (Meta, TikTok, Search Console, Instagram, Facebook), situação, última sincronização. Segredos criptografados (mesmo cofre) | empresa + plataforma + conta |
| `mkt_sync_runs` | Histórico de cada sincronização: período, linhas, erros, duração (saúde dos dados) | id |
| `mkt_ad_entities` | Campanhas, conjuntos/grupos, anúncios e criativos de Meta e TikTok (e Google, além do que já existe): nome, objetivo, tipo, status, pai | plataforma + id externo |
| `mkt_ad_days` | Métricas por dia e por entidade: investimento, impressões, alcance, cliques, vídeo, leads, conversas, conversões, valor | plataforma + entidade + dia |
| `mkt_ad_breakdowns` | Métricas por dia em recortes (dispositivo, região, posicionamento, rede, idade/gênero quando houver) | plataforma + entidade + dia + recorte + valor |
| `mkt_search_terms` | Termos de pesquisa do Google por dia/campanha, com marca de "sugestão de negativa" e situação da revisão | campanha + grupo + termo + dia |
| `mkt_landing_pages` | Página de destino por dia e campanha (Google) | campanha + url + dia |
| `mkt_social_profiles` / `mkt_social_profile_days` | Perfis e números diários (seguidores, alcance, impressões, visitas) | perfil + dia |
| `mkt_social_posts` / `mkt_social_post_stats` | Publicações (formato, tema, data) e métricas (curtidas, comentários, salvamentos, retenção) | plataforma + id do post |
| `mkt_seo_days` | Search Console por dia: consulta, página, cliques, impressões, posição | dia + consulta + página |
| `mkt_editorial_items` | Calendário editorial: tema, formato, responsável (usuário atual), data, status, post publicado | id |
| `mkt_budgets` / `mkt_goals` | Orçamento e metas por mês, plataforma e campanha (leads, CPL, vendas, faturamento) | mês + plataforma + campanha |
| `mkt_alert_rules` / `mkt_alert_events` | Regras de alerta configuráveis e alertas disparados (com amostra e limitação) | regra + período |
| `mkt_recommendations` | Recomendações: problema, evidência (números e fontes em JSON), período, impacto, prioridade, confiança, métrica, situação (nova/aprovada/descartada/medida) | regra + entidade + período |
| `mkt_report_schedules` / `mkt_report_runs` | Relatórios agendados (modelo, filtros, destinatários, frequência) e execuções | id |
| `mkt_settings` (em `TenantSetting`, sem tabela) | Modelo e janela de atribuição, regra de lead qualificado, mapa de estados → regiões, custos fixos de marketing | — |

**Sem dado pessoal nas tabelas de mídia e redes:** só números agregados e ids das plataformas. O dado pessoal continua só no CRM, como hoje.
**Volume estimado:** milhares de linhas por mês, sem impacto relevante no banco atual.

---

## 6. Fórmulas, atribuição e deduplicação

Ficam num arquivo único de regras puras, com testes e usado por API, telas e relatórios (como já é feito em `googleads/painel.ts`).

- **Indicadores:**
  - investimento, CPL, custo por lead qualificado, CTR, CPC, CPM;
  - taxa de conversão, CAC, ROAS, ROI, ticket médio;
  - taxas de atendimento, de qualificação, de abertura e de clique.
  - Todos seguem exatamente as fórmulas da seção 16 do pedido, e denominador zero mostra "—", nunca erro.
- **ROAS e ROI separados.** O ROI só aparece quando os custos de marketing do escopo estiverem cadastrados (mídia, agência, ferramentas, equipe, se quiserem); antes disso a tela mostra "ROI: falta cadastrar os custos". Margem de contribuição só com custo (7.2).
- **Lead único:** é o `leads.id` do CRM, que já junta por e-mail e telefone. A métrica de leads conta **atendimentos de Pré-Vendas únicos por lead no período**, regra configurável.
- **Venda única:**
  - Pré-Vendas com `saleStatus = SIM` (um por atendimento);
  - pedido da loja Magazord pelo número do pedido;
  - os dois nunca são somados quando forem o mesmo cliente no mesmo dia e com o mesmo valor (regra de deduplicação, mostrada na saúde dos dados).
- **Atribuição:**
  - **Modelos:** primeiro toque, último toque (padrão, que é o que o Google já usa) e linear entre campanhas registradas no lead.
  - **Janela configurável:** padrão de 90 dias, que é o limite do Google.
  - Todo relatório mostra o modelo usado.
- **Conversões das plataformas ficam separadas das vendas do CRM.** "Conversões no Google/Meta/TikTok" são o que a plataforma conta; "Vendas atribuídas" são o que o CRM confirmou. As duas nunca são somadas.
- **Tipos de conversão diferentes não se misturam:** clique, conversa iniciada no WhatsApp, formulário, lead, oportunidade e venda são etapas diferentes do funil.
- **Campanha de Meta e TikTok no lead:** vem da UTM (`utm_source`, `utm_campaign` com o id da campanha) que o rastreamento já grava. É preciso padronizar as UTMs nos anúncios (ver 7.4).

---

## 7. Dependências, acessos e decisões pendentes

### 7.1 Acessos que a Usaparts precisa providenciar

| Fonte | O que é preciso | Quem faz | Prazo típico |
|---|---|---|---|
| **Google Ads (detalhes)** — caminho rápido | Nada novo: ampliar o script que já roda de hora em hora para mandar também termos de pesquisa, grupos, anúncios, dispositivo, região, rede, página de destino e parcela de impressões | CRM gera o código novo; quem administra o Google Ads cola | No mesmo dia |
| Google Ads API oficial (opcional) | Conta de administrador (MCC) + **developer token** aprovado pelo Google (acesso Básico) + OAuth | Administrador da conta Google Ads | Dias a semanas (análise do Google) |
| **Meta Ads** | Business Manager da Usaparts, app da Meta (tipo Empresa), usuário do sistema com permissão `ads_read` e `read_insights` nas contas de anúncio | Administrador do Business Manager | 1 a 3 dias; pode pedir verificação da empresa |
| **Instagram/Facebook orgânico** | Mesmo app, com `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`; Instagram profissional ligado à página | Administrador do Business Manager | Junto com Meta Ads |
| **TikTok Ads** | Conta TikTok for Business, app no TikTok for Developers aprovado (acesso à Marketing API), autorização do anunciante | Dono da conta TikTok Ads | Dias a semanas (aprovação do TikTok) |
| TikTok orgânico | API de exibição/insights do TikTok (acesso mais limitado) | Idem | Pode não estar disponível; nesse caso a tela mostra "Não disponível" |
| **Search Console** | Adicionar a conta de serviço que já existe (do GA4) como usuário da propriedade | Quem administra o Search Console | No mesmo dia |
| GA4, Magazord, Gemini, SMTP | Já conectados | — | — |

**Publicar e agendar posts pelas APIs:** a Meta permite para Instagram e Facebook com permissões extras (`instagram_content_publish`, `pages_manage_posts`). Fica **fora da primeira entrega**: é escrita na plataforma e pede aprovação à parte. O calendário editorial funciona sem isso.

### 7.2 Faturamento, custo e margem (precisa de decisão)

- **Hoje o faturamento vem de duas fontes:** o valor de venda **digitado no Pré-Vendas** (`saleValue`, com o número da nota) e os pedidos da loja virtual (Magazord).
- **Faturamento real (nota fiscal emitida):** está na Tcar, que hoje só responde consultas de produto, e por leitura. Trazer notas ou pedidos da Tcar seria uma **extensão da integração PingAlive** e depende da Tcar. Proposta: começar com o valor do Pré-Vendas + Magazord, rotulado como "Valor vendido (CRM)", e avaliar a Tcar depois.
- **Margem de contribuição:** o custo das peças **não é copiado da Tcar, por decisão de segurança**. Opções:
  - **a)** sem margem: o módulo mostra ROAS e o "ROI sobre faturamento", rotulado;
  - **b)** cadastrar uma margem média por categoria de peça (um percentual, sem custo por item);
  - **c)** trazer custo da Tcar, o que muda uma regra atual e exige aprovação da diretoria.
  - **Recomendação: b.**

### 7.3 Definições de negócio

| Item | Proposta (configurável) |
|---|---|
| Lead qualificado | Pré-Venda repassada ao vendedor (`forwarded`) **e** com retorno do vendedor (`returnStatus = SIM`) **ou** nota A/B. A diretoria confirma. |
| Lead atendido | Tem primeira ação registrada (`firstActionAt`) ou resposta no WhatsApp. |
| Oportunidade | Pré-Venda em negociação ou com venda Sim/Não decidida. |
| Cliente novo x recorrente | Recorrente: lead com venda (Pré-Vendas ou loja) antes do período analisado. |
| Região | Estado → região (Sul, Sudeste etc.), mapa configurável; filial vem de `unitId`. |
| Marca e categoria | As listas atuais do Pré-Vendas (`brandIds`, `partTypeIds`). Para campanhas, um mapa campanha → marca/categoria (cadastro novo do módulo). |

### 7.4 Padronização de UTMs

Para Meta e TikTok entrarem no funil, todo anúncio precisa da URL com:
- `utm_source=facebook|instagram|tiktok`;
- `utm_medium=cpc`;
- `utm_campaign={{campaign.id}}`.

O módulo terá um **gerador de UTM** e um **alerta de perda de UTM** (leads de anúncio sem campanha). Hoje, 59 de 104 leads do período no painel do Google Ads estão "sem campanha identificada": esse é o primeiro ponto de melhoria de dados.

### 7.5 Servidor

- Cabe na VPS atual, com 3 cuidados:
  1. sincronizações espaçadas e incrementais (só os últimos dias, com o histórico pedido uma vez);
  2. telas lendo tabelas diárias resumidas;
  3. PDF montado no servidor por biblioteca leve, sem navegador.
- Exportação Excel por biblioteca nova (a definir na Fase 6).
- **Recomendação:** 4 GB de RAM antes da Fase 7 (relatórios em PDF agendados e IA), sem mudar mais nada.

---

## 8. IA e recomendações (como vai funcionar)

1. **As regras calculam primeiro.** Um motor de regras com números reais decide se existe o problema. Exemplos:
   - CPC subiu e conversão caiu;
   - termo de pesquisa com gasto e sem lead;
   - anúncio com leads e sem venda;
   - frequência alta no Meta;
   - estado com conversão acima da média;
   - atraso no 1.º atendimento.
   Cada achado guarda os números, o período, a fonte e o tamanho da amostra.
2. **A IA (Gemini) só escreve a explicação** a partir desses números: problema, evidência, ação, prioridade, como medir. Ela recebe **apenas números agregados**, nunca dados de clientes.
3. **Abaixo de uma amostra mínima, não há recomendação.** Quando o número de cliques, leads ou vendas é pequeno, a recomendação não é gerada, ou sai marcada como "confiança baixa".
4. **Nada é aplicado sozinho.** A pessoa aprova ou descarta. "Aprovar" registra a decisão e cria a medição antes/depois; quem altera a campanha é a pessoa, na plataforma.
5. **Correlação aparece como correlação** ("os estados X e Y convertem mais"), nunca como causa, e nenhuma promessa de aumento de faturamento.

---

## 9. Etapas de implantação

Cada etapa sai como uma versão do CRM (tag e deploy, como hoje), testada antes. A volta é a versão anterior; as tabelas novas ficam vazias, sem afetar nada.

| Etapa | Entrega | Depende de acesso externo | Tamanho |
|---|---|---|---|
| **E1. Base** | Menu e permissões novas, filtros globais, fórmulas centralizadas com testes, saúde dos dados, configurações (atribuição, lead qualificado, regiões) | Não | Médio |
| **E2. Executivo, comercial e funil** | Dashboard executivo (KPIs com o Google atual), CRM e leads de marketing, funil e atribuição, análise de campanhas e comparação | Não | Grande |
| **E3. Google Ads detalhado** | Script ampliado: termos de pesquisa, negativas para revisão, anúncios, dispositivo, região, páginas de destino, tipos de campanha | Só colar o script novo | Médio |
| **E4. E-mail e SEO** | Dashboard de e-mail (dados próprios) e SEO/site (GA4 + Search Console + loja) | Search Console | Médio |
| **E5. Orçamento, metas e alertas** | Planejamento, projeção, cenários com premissas, alertas configuráveis por e-mail e no sino do CRM | Não | Médio |
| **E6. Meta Ads + Instagram/Facebook** | Mídia paga e orgânico da Meta, criativos, fadiga, calendário editorial | **Meta** | Grande |
| **E7. Relatórios automáticos e IA** | 9 relatórios, agendamento, CSV/Excel/PDF; motor de recomendações + Gemini | Não (recomendado 4 GB de RAM) | Grande |
| **E8. TikTok** | TikTok Ads (e orgânico se a API liberar) | **TikTok** | Médio |
| **E9. Validação final** | Conferência dos números com as plataformas, desempenho, permissões, documentação técnica e de reversão | — | Pequeno |

E1 a E5 não dependem de ninguém de fora. As etapas E6 e E8 começam quando os acessos estiverem liberados; até lá, as telas ficam com "Conecte a conta" e **nunca com dados inventados**. Para demonstração, há um modo com dados simulados, rotulados como simulados em toda a tela, e só fora da produção.

---

## 10. Plano de testes

- **Fórmulas:** testes unitários de cada indicador, inclusive denominador zero, períodos sem dado e moeda.
- **Atribuição e deduplicação:** casos com o mesmo lead em várias campanhas, venda no Pré-Vendas e na loja, lead sem UTM e janela vencida.
- **Sincronizações:** respostas gravadas de cada API (sucesso, paginação, limite de chamadas, token vencido, métrica ausente → "Não disponível").
- **Permissões:** cada tela com perfil sem acesso, só ver e escopo de unidade/próprio.
- **Não regressão:** a bateria atual (355 testes) continua passando a cada etapa, e os módulos atuais são abertos no navegador antes de cada versão.
- **Conferência com a plataforma:** o investimento do período bate com o mostrado no Google Ads/Meta/TikTok (tolerância por fuso e arredondamento, documentada).
- **Desempenho:** o tempo de resposta das telas com 12 meses de dados e o consumo de memória da API medido na VPS.

---

## 11. Riscos e como tratar

| Risco | Tratamento |
|---|---|
| Memória da VPS | Sincronização espaçada, resumos diários, sem serviços novos; 4 GB antes da E7 |
| Aprovação de APIs (Google, Meta, TikTok) demorar | E1–E5 não dependem; telas mostram "Conecte a conta" |
| Leads sem campanha (UTM perdida) | Gerador de UTM, alerta de perda e indicador "% de leads com origem identificada" |
| Faturamento digitado diferente do faturado | Rótulo "Valor vendido (CRM)"; avaliar notas da Tcar depois |
| Somar conversões de plataformas como vendas | Conversões das plataformas e vendas do CRM sempre separadas |
| Mudanças de API das plataformas | Versão da API fixada por integração, testes com respostas gravadas, saúde dos dados avisa falhas |
| LGPD | Só números agregados das plataformas; IA sem dado pessoal; e-mail só para quem autorizou (regra atual) |

---

## 12. O que precisamos da Usaparts para começar

1. **Aprovar** este plano e a ordem das etapas (ou ajustar).
2. **Definir** lead qualificado, a fonte do faturamento e a opção de margem (7.2 e 7.3).
3. **Pedir os acessos** da seção 7.1, começando por Search Console (rápido) e Meta.
4. **Dizer se existe conta TikTok Ads** ativa e se há MCC/developer token do Google Ads (senão usamos o script, que já funciona).
5. **Indicar quem recebe** os relatórios automáticos e os alertas.
