/** Módulos do sistema que podem ser liberados por perfil de acesso. Novos módulos entram aqui. */
export const MODULES = [
  { key: 'dashboard', label: 'Início', group: 'Geral', help: 'Ver: tela inicial com os números do dia.' },
  { key: 'leads', label: 'Base de leads', group: 'CRM', help: 'Ver: lista e ficha do lead. Criar/Editar: cadastrar e alterar. Excluir: apagar e anonimizar (LGPD). Exportar: baixar a base.' },
  { key: 'carrinhos', label: 'Carrinhos e checkout (loja virtual)', group: 'E-commerce', help: 'Ver: carrinhos abandonados. Editar: marcar o contato feito. Exportar: baixar a lista.' },
  { key: 'pre_vendas', label: 'Pré-Vendas', group: 'Atendimento', help: 'Ver: atendimentos e dashboard. Criar/Editar: registrar e atualizar. Excluir: apagar e limpar a base. Exportar: baixar a planilha.' },
  { key: 'pos_vendas', label: 'Pós-Vendas', group: 'Atendimento', help: 'Ver: acompanhamentos e dashboard. Criar/Editar: registrar e atualizar. Excluir: apagar. Exportar: baixar a planilha.' },
  { key: 'consulta_produtos', label: 'Consulta de produtos (Tcar)', group: 'Atendimento', help: 'Ver: buscar peças da Tcar por SKU, referência, código de integração, código de fábrica, título e “utilizado em”, com estoque e preço (o custo não aparece).' },
  { key: 'cadastros', label: 'Cadastros de atendimento (vendedores e listas)', group: 'Atendimento', help: 'Vendedores, unidades, origens, marcas, tipos de peça e motivos de perda.' },
  { key: 'chat', label: 'Chat WhatsApp', group: 'Atendimento', help: 'Ver: conversas (próprios = só os números ligados ao usuário ou ao vendedor dele, mais as conversas passadas para ele; unidade = números da unidade). Criar: responder e iniciar conversa. Editar: transferir, arquivar, marcar o tipo de contato e corrigir ou apagar mensagens enviadas por outras pessoas (as próprias, quem tem Criar já pode).' },
  { key: 'monitoramento', label: 'Monitorar conversas do WhatsApp', group: 'Atendimento', help: 'Ver: ler as conversas de todos os números e vendedores, só leitura e sem marcar como lidas (o vendedor continua vendo as mensagens novas). Cada conversa aberta fica registrada na auditoria. Criar: escrever nota interna na conversa (liberação de desconto, orientação), que só aparece no CRM: o cliente nunca recebe.' },
  { key: 'whatsapp', label: 'Números de WhatsApp', group: 'Atendimento', help: 'Ver: números, regras e contatos da empresa. Criar: cadastrar número. Editar: conectar (QR Code), desconectar, regras, contatos da empresa e respostas rápidas. Excluir: remover o número.' },
  { key: 'captura', label: 'Formulários, LPs e pop-ups', group: 'Marketing', help: 'Formulários, pop-ups, botões de WhatsApp e o editor visual.' },
  { key: 'postagens', label: 'Postagens (Instagram e Facebook)', group: 'Marketing', help: 'Ver: calendário e biblioteca. Criar: montar postagens, mídias e textos com IA, e mandar para aprovação. Editar: aprovar, devolver, publicar e cancelar. Excluir: apagar postagens e mídias.' },
  { key: 'email_marketing', label: 'Email marketing', group: 'Marketing', help: 'Segmentos e campanhas. Criar/Editar inclui enviar.' },
  { key: 'automacoes', label: 'Automações', group: 'Marketing', help: 'Fluxos automáticos. Editar inclui ligar e desligar.' },
  { key: 'catalogo', label: 'Catálogo de produtos', group: 'E-commerce', help: 'Produtos da loja virtual e seus números.' },
  { key: 'seo_ecommerce', label: 'SEO do e-commerce', group: 'E-commerce', help: 'Ver: produtos da loja virtual com a nota de SEO. Criar: gerar sugestões com IA e editar textos. Editar: enviar as alterações para a loja (Magazord) e desfazer.' },
  { key: 'relatorios', label: 'Dashboards e relatórios', group: 'Análise', help: 'Ver: dashboards e relatórios. Criar/Editar/Excluir: relatórios salvos. Exportar: baixar.' },
  { key: 'google_ads', label: 'Painel do Google Ads', group: 'Análise', help: 'Ver: investimento, leads, vendas e custo por campanha e palavra-chave. Editar: saldo, recargas e aviso de saldo.' },
  { key: 'mi_executivo', label: 'Visão geral, dashboard executivo, funil e análise de campanhas', group: 'Marketing Inteligente', help: 'Ver: indicadores consolidados de marketing e vendas, funil, atribuição e comparação de campanhas. Exportar: baixar as tabelas.' },
  { key: 'mi_midia', label: 'Mídia paga (Google, Meta e TikTok Ads)', group: 'Marketing Inteligente', help: 'Ver: investimento e resultado das campanhas pagas, cruzados com os leads e as vendas do CRM.' },
  { key: 'mi_social', label: 'Redes sociais orgânicas', group: 'Marketing Inteligente', help: 'Ver: resultados do Instagram, Facebook e TikTok orgânicos, quando conectados.' },
  { key: 'mi_seo', label: 'SEO e tráfego do site', group: 'Marketing Inteligente', help: 'Ver: tráfego do site, Search Console e loja virtual.' },
  { key: 'mi_comercial', label: 'CRM, leads de marketing e e-mail', group: 'Marketing Inteligente', help: 'Ver: leads de marketing, atendimento, vendedores, regiões e resultados do e-mail marketing.' },
  { key: 'mi_ia', label: 'Recomendações', group: 'Marketing Inteligente', help: 'Ver: diagnósticos com os números que os sustentam. Nada é alterado nas plataformas.' },
  { key: 'mi_orcamento', label: 'Planejamento e orçamento', group: 'Marketing Inteligente', help: 'Ver: orçamento, metas e projeções. Editar: cadastrar orçamento e metas.' },
  { key: 'mi_relatorios', label: 'Relatórios automatizados', group: 'Marketing Inteligente', help: 'Ver: relatórios e envios. Criar/Editar/Excluir: agendar relatórios por e-mail (destinatários, horário e conteúdo).' },
  { key: 'mi_config', label: 'Integrações e configurações do Marketing Inteligente', group: 'Marketing Inteligente', help: 'Ver: saúde das integrações. Editar: regras (lead qualificado, margem, atribuição) e contas de Meta, TikTok e Search Console.' },
  { key: 'marketplaces', label: 'Marketplaces (Mercado Livre Ads; depois Shopee)', group: 'Marketplaces', help: 'Ver: painéis de publicidade e vendas dos marketplaces (investimento, receita atribuída, ROAS, ACOS, campanhas e anúncios). Editar: conectar e desconectar o Mercado Livre, escolher o anunciante, sincronizar e responder as perguntas de frete (e ligar a resposta automática). Exportar: baixar as tabelas.' },
  { key: 'assist_atendimento', label: 'Assistente do Mercado Livre: perguntas e respostas', group: 'Marketplaces', help: 'Ver: painel do assistente, perguntas, fila de pendentes e respostas enviadas. Criar: responder e aprovar sugestões (a resposta vai para o cliente no Mercado Livre). Editar: encaminhar, mudar a situação, reanalisar, descartar sugestão, marcar para revisão e observações. Exportar: baixar as listas.' },
  { key: 'assist_conhecimento', label: 'Assistente do Mercado Livre: base de conhecimento', group: 'Marketplaces', help: 'Ver: base de conhecimento e versões. Criar: cadastrar e importar planilha Excel. Editar: alterar, aprovar, ativar e inativar (o que está ativo a IA usa nas respostas). Excluir: tirar da base (o histórico fica).' },
  { key: 'assist_aplicacoes', label: 'Assistente do Mercado Livre: produtos e aplicações', group: 'Marketplaces', help: 'Ver: aplicações peça × máquina, ficha do produto e anúncios da loja. Criar: cadastrar aplicação. Editar: alterar e validar a compatibilidade (só a confirmada a IA afirma ao cliente).' },
  { key: 'assist_config', label: 'Assistente do Mercado Livre: configurações e integração', group: 'Marketplaces', help: 'Ver: configurações da IA e situação da integração. Editar: motor de respostas (Sem IA, Gemini ou Claude) e chaves, resposta automática, frete pela Magazord, loja oficial, sincronizações e assumir o atendimento no lugar do painel antigo.' },
  { key: 'usuarios', label: 'Usuários', group: 'Administração', help: 'Cadastrar, bloquear e desconectar usuários e aparelhos.' },
  { key: 'perfis', label: 'Perfis de acesso', group: 'Administração', help: 'Criar e alterar os perfis e estas permissões.' },
  { key: 'configuracoes', label: 'Configurações', group: 'Administração', help: 'Marca, e-mail, rastreamento, loja, Meta, GA4 e Google Ads (chaves e conversões).' },
  { key: 'sugestoes', label: 'Sugestões de melhoria (analisar)', group: 'Administração', help: 'Todos enviam e acompanham as próprias sugestões. Ver: ler as sugestões de todos. Editar: mudar a situação e responder (quem enviou é avisado).' },
  { key: 'auditoria', label: 'Auditoria', group: 'Administração', help: 'Ver o registro de quem fez o quê.' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']
export const MODULE_KEYS = MODULES.map((m) => m.key) as readonly ModuleKey[]

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const
export type Action = (typeof ACTIONS)[number]

/** OWN: só os próprios registros; UNIT: só os da unidade do usuário; ALL: todos. */
export type Scope = 'OWN' | 'UNIT' | 'ALL'

export type PermissionSet = Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; scope: Scope }>

export function emptyPermission() {
  return { view: false, create: false, edit: false, delete: false, export: false, scope: 'ALL' as const }
}

export function fullPermissions(): PermissionSet {
  return Object.fromEntries(
    MODULE_KEYS.map((k) => [k, { view: true, create: true, edit: true, delete: true, export: true, scope: 'ALL' as const }]),
  )
}

export function can(perms: PermissionSet, isSystemRole: boolean, module: string, action: Action): boolean {
  if (isSystemRole) return true
  return perms[module]?.[action] === true
}
