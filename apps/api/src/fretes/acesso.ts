import { ForbiddenException } from '@nestjs/common'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'

export type FreightModule = 'fretes_painel' | 'fretes_cotacao' | 'fretes_tabelas' | 'fretes_transportadoras' | 'fretes_filiais' | 'fretes_pedidos' | 'fretes_cte' | 'fretes_financeiro'

/**
 * Filiais que a pessoa enxerga no módulo: null = todas (visão global, escopo "Todos"); senão a unidade dela mais as
 * outras unidades liberadas no cadastro do usuário. "Somente os próprios" vale como "da unidade" aqui.
 */
export function allowedUnits(user: AuthUser, module: FreightModule): string[] | null {
  if (user.role.isSystem) return null
  const scope = user.permissions[module]?.scope ?? 'ALL'
  if (scope === 'ALL') return null
  return [...new Set([user.unitId, ...(user.extraUnitIds ?? [])].filter((x): x is string => !!x))]
}

export function assertCan(user: AuthUser, module: FreightModule, action: Action, message = 'Você não tem permissão para esta ação.') {
  if (!can(user.permissions, user.role.isSystem, module, action)) throw new ForbiddenException(message)
}

/** A pessoa pode trabalhar com esta filial? */
export function assertUnit(user: AuthUser, module: FreightModule, unitId: string) {
  const units = allowedUnits(user, module)
  if (units && !units.includes(unitId)) throw new ForbiddenException('Esta filial não está liberada para o seu usuário.')
}

/**
 * Registro que vale para filiais (tabela ou transportadora; vazio = todas): quem tem escopo de filial só altera o que
 * vale apenas para as suas filiais. "Todas as filiais" exige a visão global.
 */
export function assertUnitList(user: AuthUser, module: FreightModule, unitIds: string[]) {
  const units = allowedUnits(user, module)
  if (!units) return
  if (!unitIds.length) throw new ForbiddenException('Só quem tem acesso a todas as filiais altera registros que valem para todas.')
  const outside = unitIds.filter((u) => !units.includes(u))
  if (outside.length) throw new ForbiddenException('O registro inclui filiais que não estão liberadas para o seu usuário.')
}

/** Filtro de listas: registro sem filiais (vale para todas) ou com alguma das filiais da pessoa. */
export function unitListWhere(units: string[] | null) {
  return units ? { OR: [{ unitIds: { isEmpty: true } }, { unitIds: { hasSome: units } }] } : {}
}
