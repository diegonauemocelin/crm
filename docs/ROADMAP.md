# Roteiro

O que já está em produção fica em [`releases.json`](../releases.json) (tela **Atualizações**). Aqui fica o que falta, na ordem combinada.

| Etapa | Conteúdo | Situação |
|---|---|---|
| — | Landing pages: hospedadas pela própria USA Parts em `teste.usaparts.com.br` (pasta na hospedagem, decidido em 07/10/2026), usando os códigos da Captura (formulário com script, pop-up e WhatsApp). O CRM não hospeda as LPs | Em uso |
| Fase 5 | Email marketing (SMTP Locaweb), editor visual de arrastar e soltar, imagens, catálogo de produtos da Magazord, botão de WhatsApp, relatório. Pendente: IA opcional (sem IA, Gemini gratuito ou paga) | Entregue (v0.6.0–v0.6.2) |
| Fase 6 | Automações: construtor de fluxos (gatilhos, esperas, condições Sim/Não, e-mail, tags, vendedor, etapa, Pré-Vendas, aviso para a equipe), inatividade, saída por compra e vendas por fluxo. Pendente: WhatsApp automático (Fase 9) | Entregue (v0.7.0) |
| Fase 7 | Dashboards e relatórios: visão geral, criador de relatórios com painel, exportação CSV e Google Analytics 4 | Entregue (v0.8.0) |
| Fase 8 | Segurança final: fail2ban, testes de intrusão e de carga, sessões por dispositivo | A fazer |
| Final | **Editor visual de pop-ups e formulários** (pedido em 07/10/2026): montar o layout arrastando e configurando blocos (imagem, título, texto, campos, botão, cores, fontes, tamanho, posição, cantos, sombra, versão celular), com pré-visualização ao vivo, e gerar o código pronto para colar na página | A fazer |
| Fase 9 | Chat WhatsApp (Evolution API, chip dedicado) — por último, a pedido; reavaliar RAM da VPS (4 GB) | A fazer |

## Editor visual de pop-ups e formulários (detalhe do pedido)

- Um lugar no painel (Captura) para **criar o layout** do pop-up e do formulário, sem código.
- Pré-visualização igual ao site, no computador e no celular.
- Ao salvar, **gera o código para colar na página** (o mesmo código com script que já existe desde a 0.5.1), e o pop-up continua aparecendo sozinho pelo rastreamento.
- Modelos prontos para começar (orçamento, cupom de desconto, newsletter, saída da página).
- O mesmo editor pode gerar uma landing page inteira em HTML para subir na pasta do `teste.usaparts.com.br`.
