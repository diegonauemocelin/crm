/** Módulos do sistema que podem ser liberados por perfil de acesso. Novos módulos entram aqui. */
export const MODULES = [
  { key: 'dashboard', label: 'Início', group: 'Geral', help: 'Ver: tela inicial com os números do dia.' },
  { key: 'leads', label: 'Base de leads', group: 'CRM', help: 'Ver: lista e ficha do lead. Criar/Editar: cadastrar e alterar. Excluir: apagar e anonimizar (LGPD). Exportar: baixar a base.' },
  { key: 'carrinhos', label: 'Carrinhos e checkout (loja virtual)', group: 'CRM', help: 'Ver: carrinhos abandonados. Editar: marcar o contato feito. Exportar: baixar a lista.' },
  { key: 'pre_vendas', label: 'Pré-Vendas', group: 'Atendimento', help: 'Ver: atendimentos e dashboard. Criar/Editar: registrar e atualizar. Excluir: apagar e limpar a base. Exportar: baixar a planilha.' },
  { key: 'pos_vendas', label: 'Pós-Vendas', group: 'Atendimento', help: 'Ver: acompanhamentos e dashboard. Criar/Editar: registrar e atualizar. Excluir: apagar. Exportar: baixar a planilha.' },
  { key: 'consulta_produtos', label: 'Consulta de produtos (Tcar)', group: 'Atendimento', help: 'Ver: buscar peças da Tcar por SKU, referência, código de integração, código de fábrica, título e “utilizado em”, com estoque e preço (o custo não aparece).' },
  { key: 'cadastros', label: 'Cadastros de atendimento (vendedores e listas)', group: 'Atendimento', help: 'Vendedores, unidades, origens, marcas, tipos de peça e motivos de perda.' },
  { key: 'chat', label: 'Chat WhatsApp', group: 'Atendimento', help: 'Ver: conversas (próprios = só os números ligados ao usuário ou ao vendedor dele, mais as conversas passadas para ele; unidade = números da unidade). Criar: responder e iniciar conversa. Editar: transferir, arquivar, marcar o tipo de contato e corrigir ou apagar mensagens enviadas por outras pessoas (as próprias, quem tem Criar já pode).' },
  { key: 'monitoramento', label: 'Monitorar conversas do WhatsApp', group: 'Atendimento', help: 'Ver: ler as conversas de todos os números e vendedores, só leitura e sem marcar como lidas (o vendedor continua vendo as mensagens novas). Cada conversa aberta fica registrada na auditoria. Criar: escrever nota interna na conversa (liberação de desconto, orientação), que só aparece no CRM: o cliente nunca recebe.' },
  { key: 'whatsapp', label: 'Números de WhatsApp', group: 'Atendimento', help: 'Ver: números, regras e contatos da empresa. Criar: cadastrar número. Editar: conectar (QR Code), desconectar, regras, contatos da empresa e respostas rápidas. Excluir: remover o número.' },
  { key: 'captura', label: 'Formulários, LPs e pop-ups', group: 'Marketing', help: 'Formulários, pop-ups, botões de WhatsApp e o editor visual.' },
  { key: 'email_marketing', label: 'Email marketing', group: 'Marketing', help: 'Segmentos e campanhas. Criar/Editar inclui enviar.' },
  { key: 'automacoes', label: 'Automações', group: 'Marketing', help: 'Fluxos automáticos. Editar inclui ligar e desligar.' },
  { key: 'catalogo', label: 'Catálogo de produtos', group: 'Marketing', help: 'Produtos da loja virtual e seus números.' },
  { key: 'relatorios', label: 'Dashboards e relatórios', group: 'Análise', help: 'Ver: dashboards e relatórios. Criar/Editar/Excluir: relatórios salvos. Exportar: baixar.' },
  { key: 'google_ads', label: 'Painel do Google Ads', group: 'Análise', help: 'Ver: investimento, leads, vendas e custo por campanha e palavra-chave. Editar: saldo, recargas e aviso de saldo.' },
  { key: 'mkt_paineis', label: 'Marketing Inteligente: painéis', group: 'Marketing Inteligente', help: 'Ver: visão geral, dashboard executivo, leads de marketing, e-mail, funil e análise de campanhas. O escopo (próprios/unidade) vale para os atendimentos; com escopo restrito, investimento e pedidos da loja não aparecem. Exportar: baixar as tabelas.' },
  { key: 'mkt_integracoes', label: 'Marketing Inteligente: integrações e regras', group: 'Marketing Inteligente', help: 'Ver: saúde das integrações e qualidade dos dados. Editar: modelo e janela de atribuição e a regra de lead qualificado.' },
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
