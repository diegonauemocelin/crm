import type { ModuleKey, Scope } from '../common/permissions'

type Grant = { module: ModuleKey; actions: ('view' | 'create' | 'edit' | 'delete' | 'export')[] }

export interface FreightRoleTemplate {
  name: string
  description: string
  /** UNIT: só as filiais da pessoa (unidade + "outras unidades que acessa"). ALL: visão global. */
  scope: Scope
  grants: Grant[]
}

const all: Grant['actions'] = ['view', 'create', 'edit', 'export']

/** Perfis prontos do módulo de fretes. Só são criados quando não existe perfil com o mesmo nome; os existentes não mudam. */
export const FREIGHT_ROLES: FreightRoleTemplate[] = [
  {
    name: 'Gestor de logística',
    description: 'Fretes completo em todas as filiais: tabelas, transportadoras, cotações, pedidos, CT-e, conciliação, faturas e relatórios.',
    scope: 'ALL',
    grants: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'fretes_painel', actions: ['view'] },
      { module: 'fretes_cotacao', actions: all },
      { module: 'fretes_pedidos', actions: all },
      { module: 'fretes_cte', actions: all },
      { module: 'fretes_financeiro', actions: all },
      { module: 'fretes_tabelas', actions: [...all, 'delete'] },
      { module: 'fretes_transportadoras', actions: all },
      { module: 'fretes_filiais', actions: ['view', 'edit'] },
    ],
  },
  {
    name: 'Operador de expedição',
    description: 'Cota, escolhe a transportadora, cadastra e acompanha os pedidos e importa CT-es, só nas filiais da pessoa.',
    scope: 'UNIT',
    grants: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'fretes_painel', actions: ['view'] },
      { module: 'fretes_cotacao', actions: ['view', 'create', 'edit'] },
      { module: 'fretes_pedidos', actions: ['view', 'create', 'edit'] },
      { module: 'fretes_cte', actions: ['view', 'create'] },
      { module: 'fretes_tabelas', actions: ['view'] },
      { module: 'fretes_transportadoras', actions: ['view'] },
      { module: 'fretes_filiais', actions: ['view'] },
    ],
  },
  {
    name: 'Financeiro de fretes',
    description: 'Decide a conciliação dos CT-es, lança e paga as faturas das transportadoras e tira os relatórios, em todas as filiais.',
    scope: 'ALL',
    grants: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'fretes_painel', actions: ['view'] },
      { module: 'fretes_cotacao', actions: ['view'] },
      { module: 'fretes_pedidos', actions: ['view'] },
      { module: 'fretes_cte', actions: ['view', 'edit', 'export'] },
      { module: 'fretes_financeiro', actions: all },
      { module: 'fretes_tabelas', actions: ['view'] },
      { module: 'fretes_transportadoras', actions: ['view'] },
    ],
  },
]

/** Linhas de permissão do perfil (o escopo por filial só vale nos módulos de fretes). */
export function roleRows(t: FreightRoleTemplate) {
  return t.grants.map((g) => ({
    module: g.module,
    canView: true,
    canCreate: g.actions.includes('create'),
    canEdit: g.actions.includes('edit'),
    canDelete: g.actions.includes('delete'),
    canExport: g.actions.includes('export'),
    scope: g.module.startsWith('fretes_') ? t.scope : ('ALL' as Scope),
  }))
}
