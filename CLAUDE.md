# CRM Usaparts

CRM da Usaparts (vendido como SG Multiconecta): atendimento WhatsApp, pré e pós-venda, leads, marketing, e-mail,
marketplaces (Mercado Livre e Assistente ML), integrações Magazord, Google Ads e Meta. Usuário e textos em português do Brasil.

O trabalho é feito em mais de um PC e em sessões diferentes: antes de começar, `git fetch` + `git status -sb` e
`git pull --ff-only` quando estiver limpo. Tudo que vale está no GitHub (diegonauemocelin/crm); nada depende deste ou
daquele computador.

## Estrutura e comandos

- Monorepo npm: `apps/api` (NestJS, Prisma 7 + Postgres, testes vitest em `apps/api/test`) e `apps/web` (React, React Query, shadcn).
- Instalar: `npm install`; depois `cd apps/api && npx prisma generate`.
- Testes: `npx vitest run --root apps/api`. Tipos: `cd apps/api && npx tsc --noEmit -p tsconfig.json` e `cd apps/web && npx tsc --noEmit -p tsconfig.app.json`.
- Banco local: `node scripts/dev-db.mjs` (Postgres embutido, porta 54329, banco `crm_f4`). `.claude/launch.json` tem "api" (porta 3000; roda `node dist/main.js`, então faça `npm run build -w @crm/api` antes) e "web" (porta 5173).
- Login local: `apps/api/storage/dev-admin.json` (não vai para o Git; em outro PC crie um admin novo no banco local).
- Migrações: pasta nova em `apps/api/prisma/migrations/<AAAAMMDDhhmmss>_<nome>/migration.sql` + campo no `schema.prisma`.
- Em edições de código com `\n`, `\b`, `\d` ou crases, use o editor, não heredoc/`node -e` no shell (já quebrou arquivos).

## Entrega (toda mudança que vai para o usuário)

Uma versão por dia, às 17h (decisão de 28/10/2026). Durante o dia, cada pedido pronto (testado) vai em commits
`dia: <resumo>` num branch `dia/AAAA-MM-DD`, com push (para não depender do PC). Às 17h junta tudo do dia numa versão só
(passos abaixo, no main, uma entrada no releases.json com todas as mudanças) e depois leva ao SaaS. Se o usuário pedir
antes ("publica agora"), publica na hora.

**Pausa (pedido de 29/10/2026, depois da v1.0.3):** novas versões só na terça-feira, 03/11/2026. Até lá, o que ficar
pronto vai só em commits `dia:` no branch do dia (com push), sem versão, sem deploy e sem levar ao SaaS; na terça junta
tudo numa versão (v1.0.4) e leva ao SaaS (1.0.27).
A versão com o módulo de fretes é a v2.0.0 (item 2 abaixo; PR #1, branch `claude/tender-brown-6n5q8f`): as notas estão em
`docs/fretes/NOTAS-VERSAO.md`.

1. Entrada nova no topo de `releases.json` (tipos: `novo`, `melhoria`, `correcao`, `seguranca`, `infra`; texto simples, para quem usa o sistema).
2. Versão nos 3 `package.json` (raiz, `apps/api`, `apps/web`) e no `package-lock.json` (as entradas dos 3 pacotes). Numeração (decisão de 28/10/2026, para o número não crescer): depois da v0.104.1 a próxima entrega é a **v1.0.0**, e cada entrega seguinte soma 1 no último número (v1.0.1, v1.0.2...), novidade ou correção.
   A versão que trouxer o módulo de fretes é a **v2.0.0** (decisão de 30/10/2026), e as seguintes somam 1 no último
   número (v2.0.1, v2.0.2...). Se os fretes entrarem na versão de terça (03/11), ela é a v2.0.0 em vez da v1.0.4.
   O SaaS continua na sua numeração (1.0.N).
3. `node scripts/check-release.mjs`.
4. Commit `vX.Y.Z: <resumo em português>`, tag `vX.Y.Z` no próprio commit, `git push origin main --tags`.
   Commits que não são versão: `docs:`, `deps:`, `deploy:`. Detalhes em `docs/RELEASES.md`.
5. Na VPS o usuário roda `cd /opt/usaparts-crm && sudo bash deploy/deploy.sh` (ver `docs/DEPLOY.md`).

## Replicar no SG Multiconecta (SaaS)

Toda versão entregue aqui (novidades, correções, tudo) também vai para o CRM da SG Multiconecta: repositório
`diegonauemocelin/saascrm` (pasta `APP IA/Saas SG`), que nasceu de uma cópia deste na 0.97.0 e é **multiempresa**.
Depois de publicar a vX.Y.Z aqui, leve a mudança para lá como a próxima 1.0.N, adaptada: empresa pelo endereço
(`requireFromHost`, nunca `defaultId()` em rota pública), permissões filtradas pelo plano, textos genéricos (sem o ramo
da Usaparts). Siga o CLAUDE.md e o docs/HISTORICO.md de lá. O pedido do usuário já vale como permissão para enviar.
Coisas só da Usaparts (dados, scripts da VPS dela, importação do painel antigo) não vão.

## Decisões do usuário (não desfazer sem ele pedir)

- Chat sem botão de ligar pelo WhatsApp (foi retirado a pedido).
- Números de WhatsApp não se misturam: transferir e adicionar participantes só para quem está ligado ao mesmo número
  (usuário do número, vendedor do número ou setor que escolheu o número).
- "Veio do Google Ads" só quando o lead clicou num anúncio antes do contato. Origem da pré-venda ou contato direto
  (inclusive WhatsApp) não marca. As origens de Configurações › Google Ads servem só para o envio de conversões.
- Cupom do e-mail de carrinho abandonado é um código só, criado à mão na Magazord e digitado no e-mail. O CRM não cria cupons.
- SEO do e-commerce nunca lê nem envia o Subtítulo (tituloComplemento) da Magazord.
- Tempo de espera do WhatsApp: resposta de verdade para; frase de espera ("vou verificar e lhe retorno") e figurinha não param.
- Envios automáticos pelo WhatsApp em lote (ex.: resumo semanal do vendedor) com intervalo aleatório entre mensagens (padrão 2–10 min), para não parecer spam.
- Resumo semanal do vendedor fica em Marketing › Relatórios e alertas (ciclo sexta a quinta, envio na sexta).
- Excluir usuário é exclusão lógica (`users.deletedAt`): some das listas e de números, setores e conversas, mas o nome fica no histórico.
- App no celular (PWA, /app, apps/web/src/pages/app): chat com layout do WhatsApp, painéis por permissão e conta; notificações Web Push (apps/api/src/app-movel). Horário de acesso por perfil (roles.loginHours), Administrador sem limite.
- Integrações de anúncios (Google, Meta, TikTok) são só leitura: o CRM não altera as contas de anúncio.
- O BI antigo foi descartado (só o painel de Mercado Livre Ads ficou, em Marketplaces). O painel.usaparts virou o
  Assistente ML (`apps/api/src/assistente`); a VPS só deve ter o CRM (`deploy/enxugar-servidor.sh`).

## Pendências conhecidas

- Edição de mensagem criptografada no chat às vezes não abre ("a chave da mensagem original não abriu"); falta o log da VPS para achar a causa.
- VPS: `deploy/enxugar-servidor.sh apagar` ainda não foi rodado (o `desligar` já foi).

## Projeto separado

O Motion Studio (vídeos e posts da SG Multiconecta) não fica aqui: é outro repositório/pasta (`APP IA/Motion Studio`),
publicado em https://claude.ai/artifact/SNnetMQZYDygeAYmPbJa97.
