# Roteiro do projeto (próximas entregas)

Ordem definida em 14/10/2026. Cada item vira uma versão (ou mais), publicada e testada antes do próximo.

| # | Ordem | Entrega | Observações |
|---|---|---|---|
| 17 | 1 | **Redes sociais no e-mail marketing** (feito na v0.22.0) | Bloco com Facebook, Instagram, YouTube e TikTok; os endereços são cadastrados uma vez; cada ícone abre a rede em nova aba. |
| 18 | 2 | **Editor de e-mail: 2 colunas, texto justificado, IA gratuita e cores mais usadas** (feito na v0.23.0) | IA gratuita (Gemini, plano gratuito) para sugerir/reescrever textos; paleta com as cores da marca e as últimas usadas. |
| 15 | 3 | **Dashboard de e-mail marketing** (feito na v0.24.0) | Enviados, entregues, abertos, clicados, descadastros, devolvidos, vendas convertidas e valor; desempenho de cada fluxo de automação. A abertura é aproximada (alguns programas de e-mail abrem as imagens sozinhos). |
| 16 | 4 | **Produtos visualizados na loja virtual** (feito na v0.25.0) | Pelo rastreamento do site: produtos mais vistos, por lead, e vistos sem compra. |
| 1 | 5 | **Sincronizar produtos da Magazord 1 vez por dia** (feito na v0.26.0) | Automático, de madrugada, com aviso se falhar. |
| 13 | 6 | **Menus reorganizados** (feito na v0.27.0; "Sugestões" entra com o item 11) | Dashboards · Análise · Atendimento Comercial · CRM · Marketing · Sugestões · Administração · Sistema. |
| 4 | 7 | **Monitorar conversas** (feito na v0.28.0) | Administrador lê as conversas; perfil novo **Gestor comercial** acompanha todos os vendedores, incluindo as conversas com clientes. |
| 5 | 8 | **Nota interna no chat** (feito na v0.29.0) | Administrador e gestor comercial escrevem na conversa uma mensagem que só aparece no CRM (o cliente não recebe): liberação de desconto, orientação, advertência. |
| 7 | 9 | **Cada login vê só o seu chat** | Só os números ligados ao usuário (administrador e gestor comercial veem todos). |
| 8 | 10 | **Nome do atendente nas mensagens** | Cada usuário escolhe como seu nome aparece para o cliente (ex.: *Diego - Vendas:*). |
| 11 | 11 | **Sugestões de melhoria** | Usuários enviam sugestões; o administrador analisa, aplica e responde a quem pediu. |
| 3 | 12 | **Vários atendentes no mesmo número** | Por setor; atendentes não leem as conversas de clientes um do outro; conversas com colegas de trabalho são visíveis a todos do número. |
| 2 | 13 | **Integração com a Tcar: consulta de produtos** | Pesquisa por código SKU, código de referência, código de integração, "utilizado em" (aplicação), título, estoque e código de fábrica. Falta saber como a Tcar entrega os dados (API, banco ou arquivo). |
| 14 | 14 | **Plano: melhoria do catálogo da loja virtual** | Primeiro um plano. Título, descrição, título e descrição de SEO e palavras-chave de cada produto, melhorados por IA (paga ou gratuita) ou à mão, e enviados de volta para a Magazord. |
| 10 | 15 | **Trilha de conhecimento** | Por perfil e por módulo, com "o que fazer e como fazer" de cada tela. |
| 12 | — | **Um só sistema (Assistente de vendas Usaparts = usaparts-bi)** | Só quando o usuário liberar. Tela de escolha do sistema conforme o login e troca rápida; um login e um endereço. As telas do usaparts-bi passam para dentro do CRM, e depois ele pode sair da VPS. |

## Pendências fora desta lista

- Backup fora da VPS (Google Drive), login SSH por chave, atualizações e reinício da VPS: comandos já passados.
- Aumentar a VPS para 4 GB e liberar 5 números conectados no WhatsApp.
- WhatsApp: confirmação de entrega/leitura, mensagem de ausência, horário comercial configurável, prazo de guarda das conversas (LGPD).
- LPs do Paraná e da Hyundai ainda com formulário do RD Station.
