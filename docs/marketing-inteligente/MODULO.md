# Marketing Inteligente: documentação técnica

Primeira entrega: versão 0.74.0 (etapas E1 e E2 do [levantamento](LEVANTAMENTO.md), com recomendações, relatórios automáticos e a tela de integrações).

## O que não muda

O módulo **só lê** o CRM. Não altera telas, menus, tabelas, permissões nem regras dos módulos atuais, e não tem migração de banco.

As configurações ficam em `tenant_settings`, em chaves próprias:

| Chave | Conteúdo |
|---|---|
| `mkt_config` | Regras das análises |
| `mkt_integracoes` | Contas de Meta, TikTok e Search Console, com os tokens criptografados |
| `mkt_relatorios` | Agendamentos e histórico de envios |

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
| Testes | `apps/api/test/marketing.spec.ts` |

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

## Relatórios automáticos

- **O que se configura:** nome, e-mails (até 20), frequência (diária, semanal ou mensal), dia, hora de Brasília, período, filtros e conteúdo (12 partes à escolha).
- **Envio:** a rotina confere a cada 5 minutos o que está na hora e envia pelo SMTP configurado. Se o servidor ficar fora, o horário perdido é enviado até 2 horas depois. Um relatório criado depois do horário do dia só sai no próximo.
- **Prévia e Enviar agora:** usam o mesmo e-mail do envio agendado.
- **Histórico:** ficam os últimos 50 envios, com o erro de cada um.

## Integrações (só leitura)

- **Meta Ads e orgânico:** token do usuário do sistema e contas `act_…`; o teste lê o nome de cada conta (Graph API v23.0).
- **TikTok:** token e anunciante; o teste lê `advertiser/info`.
- **Search Console:** a conta de serviço do GA4; o teste lê `sites.get`.
- **Segurança:** os tokens ficam criptografados (`APP_ENCRYPTION_KEY`), nunca voltam para a tela e a auditoria registra as mudanças.
- **Sincronização** dos dados dessas plataformas: na próxima etapa.

## Plano de reversão

1. Voltar para a versão anterior (tag `v0.73.1`) com o deploy normal. O módulo some do menu e nada dos módulos atuais é afetado.
2. Opcional, para apagar as configurações do módulo:
   ```sql
   DELETE FROM tenant_settings WHERE key IN ('mkt_config', 'mkt_integracoes', 'mkt_relatorios')
   ```
3. Não há tabela nova nesta versão. As próximas etapas que criarem tabelas trarão o `DROP TABLE` correspondente neste documento.

## Próximas etapas

1. Script ampliado do Google Ads: termos de pesquisa com sugestão de negativas, dispositivo, região, anúncios e páginas de destino.
2. Search Console e SEO.
3. Planejamento: orçamento, metas, projeção e cenários; alertas configuráveis.
4. Sincronização de Meta Ads, Instagram e Facebook.
5. TikTok.
6. Relatórios em PDF e Excel, e o texto das recomendações pela IA (Gemini, só com números agregados).
