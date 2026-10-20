# Plano: módulo Marketing Inteligente (Fases 1 e 2 — auditoria e planejamento)

Situação: **aguardando aprovação**. Nenhuma linha de código, tabela ou tela foi criada ainda.
Levantamento feito em 20/10/2026 sobre a versão 0.72.0.

> **Regra confirmada pelo usuário (20/10/2026): não mexer no CRM que já está rodando.** Nenhuma tabela, coluna,
> tela, regra, endpoint ou job atual é alterado. O módulo só **lê** os dados existentes e grava em tabelas `mkt_*`
> próprias. Os únicos arquivos atuais tocados são os pontos de registro listados na seção 2 (importar o módulo,
> acrescentar permissões, item de menu e rotas). São linhas acrescentadas, sem mudar nenhuma linha que já existe.

Objetivo: uma aba nova **Marketing Inteligente** que liga investimento em mídia, redes sociais, site, leads,
atendimento e venda. O módulo **lê** o que o CRM já tem e grava só em tabelas próprias. Nenhuma tela, tabela,
permissão ou fluxo atual muda.

---

## 1. Arquitetura atual identificada

| Camada | O que existe hoje |
|---|---|
| Infra | VPS com Docker Compose: `web` (Nginx + React), `api` (NestJS 12, Node 24), `db` (PostgreSQL 18), `backup` (pg_dump cifrado com age). VPS de 2–4 GB de RAM. |
| Backend | NestJS + Prisma 7. Um módulo por pasta (`*.module/controller/service.ts`), regras puras em `.ts` homônimo e testadas com Vitest (`apps/api/test/*.spec.ts`, sem banco). |
| Frontend | React 19, Vite 8, Tailwind 4, shadcn/ui, TanStack Query, React Router 8, gráficos recharts (`components/ui/chart.tsx`). Dois layouts (Moderno e Clássico) consomem o mesmo `NAVIGATION` em `apps/web/src/lib/navigation.tsx`. |
| Autenticação | JWT em cookie HttpOnly, refresh rotativo, CSRF, 2FA TOTP, Argon2id. Guard global (`auth/auth.guard.ts`) confere a permissão de cada rota. |
| Permissões | Catálogo único em `apps/api/src/common/permissions.ts` (`MODULES`), por perfil em `role_permissions` (ver/criar/editar/excluir/exportar + escopo próprio/unidade/todos). Rotas usam `@RequirePermission('modulo', 'acao')`; telas usam `<RequirePermission>` e `<Can>`. |
| Auditoria | `AuditService.byUser(...)` com cadeia de hash e remoção automática de segredos. |
| Segredos | `tenant_settings` (JSON por chave) com campos `*Enc` cifrados em AES-256-GCM (`common/crypto.ts`, `APP_ENCRYPTION_KEY`). Telas nunca recebem o segredo, só `hasKey`. |
| Jobs | Cada serviço tem `setInterval(...).unref()` com trava `running` e estado salvo em `tenant_settings`. Não há fila nem `@nestjs/schedule`. |
| CI | `release:check` → `typecheck` → `test` → `lint` → `build` → testes de deploy → `npm audit`; depois build Docker, migração, seed, teste de fumaça e backup/restauração. |
| Versões | Cada entrega muda `releases.json` e os três `package.json` (SemVer). |

### Dados comerciais e de marketing que já existem (fonte de verdade)

| Assunto | Onde está | Observação para o módulo |
|---|---|---|
| Lead | `leads` (estágio LEAD/QUALIFICADO/OPORTUNIDADE/CLIENTE, dono, unidade, origem, UF, 1ª e última conversão com UTMs, 1ª e última campanha do Google Ads) | Deduplicado por e-mail (único) e por telefone (regra no código). Não tem marca, categoria nem tipo de cliente. |
| Oportunidade e venda | `service_records` (pré-venda = oportunidade; `saleStatus = SIM` = venda; `saleValue`, `invoiceNumber`, motivo de perda, vendedor, unidade, UF, marcas e tipos de peça, tempos de repasse e retorno, campanha do Google Ads, página e canal de entrada) | **Não existe data da venda**: hoje os painéis usam `leadAt`. O envio ao Google Ads já tira a data do histórico (`service_record_history`). |
| Loja virtual | `ecommerce_orders`, `ecommerce_carts`, `store_products` (Magazord) | O pedido não tem campanha. Ela é deduzida pelo lead e pelo rastreamento. |
| Site | `site_visitors`, `site_pageviews`, `site_events` (script próprio, com UTMs e gclid na URL limpa) | Base para a atribuição por clique e por página de entrada. |
| Captura | `capture_submissions` (formulário, pop-up, WhatsApp, com origem e página) | Cada conversão é guardada à parte do lead. |
| Meta | Somente **Lead Ads por webhook** (`integracoes/meta.service.ts`) | Não há custo, alcance nem criativos da Meta. |
| Google Ads | `google_ads_campaign_days` e `google_ads_keyword_days`, enviados por **script do Google Ads**. Conversões off-line devolvidas pela Data Manager API (`google_ads_conversions`). | Não usa a Google Ads API (não há developer token). Já calcula CPL, custo por venda e ROAS por campanha e palavra-chave. |
| GA4 | Data API sob demanda, conta de serviço só leitura, cache de 15 min, nada gravado | Reaproveitável para Search Console (mesma conta de serviço). |
| E-mail marketing | Ferramenta **interna** (SMTP Locaweb): `email_campaigns`, `email_recipients`, `email_clicks` | A venda atribuída ao e-mail é calculada na hora (último clique, janela de 1 a 30 dias). |
| Relatórios | Construtor com fontes em SQL controlado, exportação **só CSV**, sem agendamento | Não há biblioteca de PDF nem de Excel. |
| IA | Google Gemini (chave do e-mail marketing), usado no texto do e-mail e na transcrição de áudio | Não há outro provedor. |
| TikTok, Search Console, redes orgânicas, Meta Ads Insights | **Não existem** | Integrações novas. |

---

## 2. Plano de integração sem substituição

Princípios:

1. **Módulo novo e separado.** No backend fica em `apps/api/src/marketing/` (submódulos `conectores/`, `metricas/`, `atribuicao/`, `ia/`, `orcamento/`, `alertas/`, `relatorios/`). No frontend fica em `apps/web/src/pages/marketing/` e `components/marketing/`.
2. **Só leitura do que já existe.** Leads, atendimentos, pedidos, e-mails, rastreamento e Google Ads são lidos por consultas próprias do módulo. O módulo não grava em nenhuma tabela atual.
3. **Tabelas novas com prefixo `mkt_`**, criadas em migrações só aditivas (`CREATE TABLE` e `CREATE INDEX`). Cada migração tem o SQL de reversão guardado em `apps/api/prisma/rollback/`.
4. **Os painéis atuais continuam como estão** (Google Ads, e-mail, WhatsApp e atendimento). O módulo novo reutiliza as mesmas regras de cálculo, importando as funções puras que já existem, para os números baterem.
5. **Liga e desliga.** A configuração `marketing.enabled` (em `tenant_settings`) controla o menu e os jobs. Com ela desligada, o sistema fica idêntico ao atual.
6. **Plataformas de anúncio só leitura.** Os escopos pedidos são só de leitura (`ads_read`, `analytics.readonly`, `webmasters.readonly` e equivalentes). Nada é alterado nas contas. Sugestões (palavras negativas, orçamento) ficam como recomendação para alguém aprovar e aplicar na própria plataforma.

### Mudanças mínimas em arquivos atuais (aditivas)

| Arquivo | Mudança | Risco |
|---|---|---|
| `apps/api/src/app.module.ts` | Importar `MarketingModule` | Nenhum |
| `apps/api/src/common/permissions.ts` | Acrescentar as chaves novas em `MODULES` | Nenhum: os perfis atuais não ganham acesso sozinhos |
| `apps/api/prisma/seed.ts` | Acrescentar as chaves na lista do seed | Nenhum |
| `apps/api/prisma/schema.prisma` | Acrescentar os modelos `mkt_*` | Nenhum: os modelos atuais não mudam |
| `apps/web/src/lib/navigation.tsx` | Acrescentar o grupo "Marketing Inteligente" | Nenhum |
| `apps/web/src/App.tsx` | Acrescentar as rotas `/marketing-inteligente/*` | Nenhum |
| `releases.json` e `package.json` | Versão de cada entrega | Nenhum |

O layout Clássico **não precisa mudar**: o menu suspenso do shadcn (`components/ui/dropdown-menu.tsx`) já tem rolagem
quando a lista passa da altura da tela.

**Não serão alterados:** os módulos `googleads`, `email`, `leads`, `atendimento`, `rastreamento`, `integracoes`,
`relatorios` e `whatsapp`, os painéis atuais e o script do Google Ads que já roda. Os dados novos do Google Ads chegam
por um **segundo script** e um **endpoint novo do módulo** (`/api/webhooks/marketing/google-ads/:token`). O script e o
endpoint atuais continuam iguais.

---

## 3. Mapa de telas

Rota base: `/marketing-inteligente`. Todas as telas têm a mesma barra de filtros globais (seção 3.1), a data da
última atualização de cada fonte e um aviso de **"Não disponível"** quando a fonte não está conectada. Nunca há zero
inventado.

| # | Tela | Conteúdo principal | Fontes |
|---|---|---|---|
| 1 | Visão Geral de Marketing | Resumo por canal (pago, orgânico, e-mail, site), saúde das integrações, alertas abertos | Todas |
| 2 | Dashboard Executivo | KPIs da seção 4 do pedido com período anterior, variação, histórico e tendência; metas | Mídia + CRM + loja |
| 3 | Google Ads | Campanhas por tipo (Pesquisa, Display, Vídeo, PMax), grupos, anúncios, palavras-chave, termos de pesquisa, dispositivo, região, rede, páginas de destino; candidatas a palavra negativa para revisão | Segundo script ou Google Ads API |
| 4 | Meta Ads | Contas, campanhas, conjuntos, anúncios, criativos; comparador de criativos, públicos e posicionamentos; fadiga (frequência, custo subindo); resultado Meta × venda no CRM | Meta Marketing API (Insights) |
| 5 | TikTok Ads | Campanhas, grupos, anúncios, vídeo, custo por resultado; comparação com Google e Meta | TikTok Marketing API |
| 6 | Redes Sociais Orgânicas | Seguidores, alcance, engajamento, ranking de publicações, formato e tema, orgânico × pago, **calendário editorial** | Instagram/Facebook Graph API, TikTok |
| 7 | SEO e Tráfego do Site | GA4 (sessões, origem/mídia, entrada, engajamento), Search Console (consultas, páginas, CTR, posição), páginas de marca/máquina/categoria | GA4, Search Console, rastreamento próprio |
| 8 | CRM e Leads de Marketing | Leads por origem/campanha, atendidos × sem atendimento, tempos (lead → 1º atendimento → oportunidade → venda), vendedor, região | CRM (só leitura) |
| 9 | E-mail Marketing | Campanhas, entregas, rejeições, aberturas registradas (com aviso da limitação), cliques, descadastros, vendas atribuídas | E-mail interno |
| 10 | Funil e Atribuição | Funil de 8 etapas com taxa de passagem, custo acumulado, tempo médio; comparação por plataforma/campanha/região/vendedor/marca/categoria; modelo e janela de atribuição visíveis | Todas |
| 11 | Análise de Campanhas | Lista com ordenação, filtros, paginação e exportação; ficha da campanha (seção 13 do pedido); comparação de 2 ou mais campanhas | Todas |
| 12 | IA e Recomendações | Diagnósticos com problema, evidências (números e fonte), período, impacto, ação, prioridade, confiança, indicador e validação; aceitar, descartar e medir depois | Motor de regras + texto opcional por IA |
| 13 | Planejamento e Orçamento | Orçamento por mês/plataforma/campanha, realizado, saldo, projeção, metas e simulador de cenários com premissas | Tabelas novas + mídia |
| 14 | Relatórios Automatizados | Modelos (diário, semanal, mensal executivo, campanhas, região, vendedor, redes, e-mail, IA), PDF/CSV/Excel, agendamento por e-mail | Tabelas novas + SMTP atual |
| 15 | Integrações e Configurações | Conexões, saúde (última sincronização, erros, métricas indisponíveis, duplicados, % de leads com origem), atribuição, custos fora de mídia, mapeamento campanha → marca/categoria, alertas, dados de demonstração | Tabelas novas |

Os 8 modelos de dashboard da seção 17 do pedido (diretoria, tráfego pago, redes, comercial, e-mail, e-commerce, SEO e
rentabilidade) são **visões salvas** do Dashboard Executivo e das telas 3 a 10. Isso evita oito telas duplicadas.

### 3.1 Filtros globais

Período (dia/semana/mês/trimestre/ano), plataforma, campanha, objetivo, marca, categoria de peça, UF/região, filial,
vendedor, origem, tipo de cliente, status comercial e cliente novo/recorrente.

Os filtros ficam na URL, então dá para salvar a visão e compartilhar o link. Os filtros que dependem do CRM (marca,
categoria, tipo de cliente, vendedor) valem para leads e vendas. Nos dados de mídia, a marca e a categoria vêm do
**mapeamento campanha → marca/categoria** (tela 15), porque as plataformas não sabem disso.

---

## 4. Modelo de dados complementar (tabelas novas)

Todas as tabelas têm `tenant_id`, `created_at` e `updated_at`, e os índices por `(tenant_id, date)`.

| Tabela | Para quê |
|---|---|
| `mkt_connections` | Conta conectada por plataforma: provedor, id da conta, escopos, credencial cifrada (`*Enc`), status, última sincronização, último período importado, último erro, `readonly` (sempre `true` nesta versão). |
| `mkt_sync_runs` | Histórico de cada sincronização: período, linhas lidas e gravadas, duração, erro. Alimenta a saúde das integrações. |
| `mkt_ad_entities` | Campanha, conjunto/grupo, anúncio e criativo de qualquer plataforma: id externo, pai, nome, objetivo, tipo (Pesquisa/PMax/…), status, dados do criativo (texto, CTA, miniatura). |
| `mkt_ad_metrics_daily` | Métricas por dia, entidade e recorte (`nenhum`, dispositivo, região, posicionamento, público, rede): investimento, impressões, alcance, cliques, conversões **da plataforma**, valor, leads, conversas, vídeo. Métricas sem retorno da API ficam `NULL` ("Não disponível"), nunca zero. Chave única por (provedor, entidade, data, recorte, valor). |
| `mkt_search_terms_daily` | Termos de pesquisa do Google Ads por dia e grupo. |
| `mkt_negative_suggestions` | Candidatas a palavra negativa com evidências, situação (nova/aprovada/descartada) e quem decidiu. Nada é enviado ao Google. |
| `mkt_social_accounts`, `mkt_social_daily`, `mkt_social_posts`, `mkt_social_post_metrics` | Perfis orgânicos, números diários do perfil, publicações (formato, tema, link) e métricas por publicação. |
| `mkt_editorial_items` | Calendário editorial: título, canal, formato, tema, responsável (usuário atual), data, status, publicação ligada. |
| `mkt_seo_daily` | Search Console por dia, consulta e página. |
| `mkt_web_daily` | Recorte diário do GA4 (origem/mídia/página de entrada/campanha), para histórico e para não depender do cache de 15 min. |
| `mkt_attributions` | Resultado da atribuição: lead, atendimento ou pedido → plataforma, campanha, anúncio, clique e data do toque, **modelo e regra usados**, versão da regra. Recalculável sem tocar nos dados de origem. |
| `mkt_campaign_tags` | Mapeamento manual campanha → marca, categoria de peça, objetivo e região. |
| `mkt_other_costs` | Custos fora de mídia (agência, ferramentas, produção, LPs) por mês, para o ROI. |
| `mkt_budgets`, `mkt_goals` | Orçamento e metas por mês, plataforma e campanha (leads, CPL, vendas, faturamento). |
| `mkt_scenarios` | Simulações salvas, com premissas. |
| `mkt_recommendations` | Recomendações (campos da seção 14 do pedido), evidências em JSON com fonte e período, situação e resultado medido. |
| `mkt_alert_rules`, `mkt_alert_events` | Alertas configuráveis (limite, período, destinatários, canal) e disparos, com nível de confiança da amostra. |
| `mkt_report_schedules`, `mkt_report_runs` | Relatórios agendados e o histórico de envio (arquivo gerado, destinatários, erro). |

Os dados do Google Ads que já chegam hoje (`google_ads_campaign_days` e `google_ads_keyword_days`) não são
copiados. Uma **view** `mkt_v_ad_metrics_daily` junta essas tabelas com `mkt_ad_metrics_daily`, então o painel atual e
o módulo novo leem o mesmo número.

### Configurações (em `tenant_settings`, chaves `marketing.*`)

`marketing.enabled`, `marketing.attribution` (modelo e janela), `marketing.qualified_rule` (o que é lead qualificado),
`marketing.demo` (dados de demonstração) e as credenciais de cada conector, cifradas.

### Atribuição e deduplicação (regras explícitas)

- **Unidade de contagem:** lead único é o id de `leads`, já deduplicado por e-mail e telefone. Venda única é o
  atendimento com `saleStatus = SIM` e, separadamente, o pedido pago da loja. Os dois não se somam quando são o mesmo
  cliente no mesmo dia com o mesmo valor (a regra fica documentada e visível no relatório).
- **Tipos de conversão separados:** clique, conversa iniciada, formulário, lead, oportunidade, venda e pedido nunca se
  misturam.
- **Conversão da plataforma × venda do CRM:** sempre em colunas diferentes ("Conversões Meta", "Vendas CRM
  atribuídas").
- **Modelos:** último toque não direto (padrão), primeiro toque e linear, com janela configurável (padrão 30 dias). O
  modelo e a janela aparecem em cada tela e relatório.
- **Ligação:** gclid/gbraid/wbraid e UTMs das visitas → lead (`site_visitors.lead_id`), toque da conversão
  (`capture_submissions`), lead da Meta (id do anúncio no webhook) e campanha do Google Ads já gravada no atendimento.

---

## 5. APIs necessárias

| Plataforma | API | Autenticação | Escopo (só leitura) | O que depende de vocês |
|---|---|---|---|---|
| Google Ads | **Opção A (recomendada para começar):** segundo script do Google Ads, separado do atual (grupos, anúncios, termos de pesquisa, dispositivo, região, rede, página de destino, tipo de campanha). **Opção B:** Google Ads API v2x. | A: token próprio do módulo. B: OAuth + developer token | B: `adwords` (leitura no uso) | B: developer token aprovado pelo Google (dias a semanas) |
| Meta Ads | Marketing API (Insights) | Token de **usuário do sistema** do Business Manager | `ads_read`, `read_insights` | Criar o usuário do sistema e liberar as contas de anúncio |
| Instagram / Facebook orgânico | Graph API | Mesmo usuário do sistema ou token de página | `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list` | Conta profissional do Instagram ligada à página |
| TikTok Ads | TikTok API for Business | App de desenvolvedor + OAuth do anunciante | Relatórios e gestão de anúncios (leitura) | Cadastro e aprovação do app no TikTok |
| TikTok orgânico | Display API / Business API | OAuth | Leitura de vídeos e métricas | Depende do tipo de conta; ver na conexão |
| GA4 | Data API (já usada) | Conta de serviço atual | `analytics.readonly` | Nada novo |
| Search Console | Search Console API | **Mesma conta de serviço** do GA4 | `webmasters.readonly` | Adicionar a conta de serviço como usuário da propriedade |
| E-mail marketing | Interno | — | — | Nada |
| Magazord | Já integrada | — | — | Nada |

Todas as chamadas seguem o padrão atual: endereço fixo da plataforma, `fetch` com timeout e `redirect: 'error'`,
paginação, nova tentativa com espera em 429/5xx, sincronização incremental (últimos N dias reprocessados para pegar
conversões atrasadas) e trava de execução.

---

## 6. Dependências e permissões

### Permissões novas (perfis de acesso)

Grupo "Marketing Inteligente" em `MODULES`:

| Chave | Ver | Criar/Editar | Exportar |
|---|---|---|---|
| `mkt_paineis` | Telas 1, 2, 8, 9, 10 e 11 | — | Exportar tabelas |
| `mkt_midia` | Telas 3, 4 e 5 | Aprovar ou descartar palavras negativas sugeridas | Sim |
| `mkt_social` | Tela 6 | Calendário editorial | Sim |
| `mkt_seo` | Tela 7 | — | Sim |
| `mkt_ia` | Tela 12 | Aceitar, descartar e marcar resultado | Sim |
| `mkt_orcamento` | Tela 13 | Orçamento, metas, custos fora de mídia, cenários | Sim |
| `mkt_relatorios` | Tela 14 | Criar e agendar | Gerar arquivos |
| `mkt_integracoes` | Tela 15 | Conectar contas, regras de atribuição e alertas | — |

- O escopo **próprio/unidade/todos** vale para os dados do CRM (o vendedor vê só os leads dele, por exemplo). Os
  dados de mídia não têm dono e seguem o "Ver".
- **Os perfis atuais não recebem acesso automático.** Só o Administrador vê o módulo até alguém liberar em **Perfis
  de acesso**.

### Bibliotecas novas (a confirmar no momento da fase)

- **Excel:** `exceljs`.
- **PDF:** `pdfkit` (gera no servidor sem navegador). Não uso Puppeteer/Chromium por causa da RAM da VPS.

Nenhuma troca de linguagem, framework, banco ou infraestrutura.

---

## 7. Pontos que exigem decisão antes de programar

1. **Data da venda — decidido: ler do histórico, sem mexer no CRM.** `service_records` não tem data da venda, e os
   painéis atuais contam a venda no dia do lead. O módulo usa a data em que o atendimento passou para "Venda: Sim" no
   histórico (`service_record_history`), como já faz o envio ao Google Ads. Sem histórico (importação de planilha),
   usa `leadAt` e marca o registro como "data estimada". Os painéis atuais continuam como estão. Por isso, o
   faturamento por período no módulo pode diferir do painel de atendimento, e a tela explica o motivo.
2. **Lead qualificado.** Proposta: o lead está no estágio QUALIFICADO ou acima, **ou** tem pré-venda repassada ao
   vendedor. A regra fica configurável na tela 15.
3. **Primeiro atendimento.** `firstActionAt` mistura chat, "chamei o cliente" e qualquer edição, e na importação vale
   o próprio `leadAt`. Proposta: usar o primeiro destes eventos — primeira resposta no WhatsApp, "Chamei o cliente"
   ou repasse —, ignorar os importados e mostrar o percentual de registros sem esse dado.
4. **Google Ads: segundo script (A) ou API oficial (B).** Recomendo A agora, com um script novo e separado (o atual não
   é alterado), porque funciona sem esperar aprovação. B fica para depois, quando houver developer token.
5. **Cliente novo × recorrente.** Não existe hoje. Proposta: é recorrente quem já tinha venda (atendimento ou pedido
   pago) antes da data da venda analisada, pelo mesmo lead. Sem CNPJ, a precisão depende da deduplicação por
   e-mail/telefone. Isso aparece como limitação.
6. **IA.** O motor de recomendações é **por regras estatísticas** (comparação com histórico, tamanho mínimo de amostra,
   intervalo de confiança), então os números são sempre reproduzíveis. O Gemini que já existe pode, se vocês quiserem,
   só redigir o texto a partir das evidências, sem inventar números. Enviar dados agregados de campanha ao Google
   Gemini precisa da sua aprovação; nenhum dado pessoal é enviado.
7. **Menu do layout Clássico — resolvido sem mudança:** o menu suspenso já tem rolagem.

---

## 8. Plano de testes

- **Fórmulas** (`marketing/metricas/formulas.ts`, funções puras): todos os indicadores da seção 16 do pedido, com
  divisão por zero (resultado `null`, "Não disponível"), arredondamento, ROAS ≠ ROI e ROI só com custos definidos.
  Testes no Vitest com casos conhecidos.
- **Atribuição:** cenários de toque único, múltiplos toques, fora da janela, lead sem origem, mesma venda em atendimento
  e na loja (não duplica), reprocessamento idempotente.
- **Conectores:** respostas gravadas (fixtures) de cada API: paginação, 429, token vencido, métrica ausente (`NULL`),
  reimportação do mesmo dia (não duplica).
- **Permissões:** cada rota nova sem permissão → 403; escopo próprio/unidade aplicado aos dados do CRM; perfis atuais
  sem acesso após a migração.
- **Não regressão:** a suíte atual (cerca de 37 arquivos) roda sem alteração, e nenhum arquivo de teste atual é
  editado. O CI confere que o diff não toca em arquivos fora da lista da seção 2. Teste novo confere que os números do
  painel atual do Google Ads e do módulo novo batem para o mesmo período.
- **Migrações:** aplicar → reverter (`prisma/rollback/*.sql`) → aplicar de novo no job Docker do CI.
- **Segurança:** credencial nunca aparece na resposta da API nem no log; auditoria de cada conexão, alteração de
  regra e exportação.
- **Desempenho:** consultas do Dashboard Executivo abaixo de 1 s com 12 meses de dados (`scripts/teste-carga.mjs`).

---

## 9. Etapas de implantação

Cada etapa sai como uma versão própria (`0.73.0` em diante), com `marketing.enabled` desligado até a validação.

| Etapa | Entrega | Depende de credenciais novas? |
|---|---|---|
| 3 — Estrutura | Permissões, menu, tela 15 (saúde e configurações), tabelas `mkt_*`, fórmulas centralizadas, Visão Geral, Dashboard Executivo, CRM e Leads, E-mail, Funil e Análise de Campanhas usando **só os dados que já existem** (Google Ads por script, CRM, loja, e-mail, rastreamento) | Não |
| 4 — Integrações | Segundo script do Google Ads; Meta Ads Insights; GA4 gravado + Search Console; redes orgânicas; TikTok | Sim (seção 5) |
| 5 — CRM e e-mail | Atribuição multi-plataforma gravada em `mkt_attributions`, deduplicação, tempos de atendimento | Não |
| 6 — BI | Orçamento, metas, cenários, comparação de campanhas, relatórios PDF/Excel e agendamento | Não |
| 7 — IA | Motor de recomendações, palavras negativas para revisão, alertas | Opcional (Gemini) |
| 8 — Testes | Validação dos números com a equipe (amostra de campanhas conferida à mão) | — |
| 9 — Implantação | Liga para o Administrador → um perfil piloto → todos; acompanhamento dos jobs | — |

### Plano de reversão

1. **Imediato:** desligar `marketing.enabled`. O menu some e os jobs param, sem deploy.
2. **Versão:** `deploy/rollback.sh` volta à versão anterior. As tabelas `mkt_*` ficam no banco sem uso, e nada do CRM
   depende delas.
3. **Banco (se for preciso):** `prisma/rollback/<migração>.sql` apaga só as tabelas e a view `mkt_*`. Antes disso,
   o backup diário existente garante a recuperação.

---

## 10. Dados de demonstração

Enquanto as contas não estiverem conectadas, a tela 15 pode ligar **dados simulados**. Eles ficam em tabelas marcadas
`is_demo = true`, aparecem com a faixa "DADOS SIMULADOS" em todas as telas e relatórios, nunca se misturam a dados reais
e são apagados com um botão. Em produção, essa opção começa desligada.
