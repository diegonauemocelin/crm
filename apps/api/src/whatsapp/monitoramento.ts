/**
 * Monitorar conversas: regras puras de quem vê o quê (sem Nest, para os testes).
 *
 * - Com a permissão "Monitorar conversas": números = lista própria do usuário (se tiver) dentro do que o perfil permite;
 *   pessoas = todas ("Todas as pessoas") ou só as que têm o usuário como gestor (users.managerIds) e os atendentes dos
 *   setores que ele gerencia.
 * - Sem a permissão: gestor de equipe acompanha só a equipe (regra antiga, em qualquer número).
 * Uma conversa é sempre de um número só: o filtro de números vale sempre, junto com o de pessoas.
 */
import type { Prisma } from '../generated/prisma/client'
import { teamWhere } from './atendentes'

/**
 * Números que a pessoa monitora. null = todos; [] = nenhum.
 * - roleIds: os do perfil (vazio ou null = todos; Administrador = todos).
 * - userIds: os escolhidos no cadastro do usuário (vazio = segue o perfil).
 * Lista própria nunca passa do perfil: com perfil restrito vale a interseção.
 */
export function effectiveMonitorNumbers(roleIds: string[] | null | undefined, userIds: string[] | null | undefined): string[] | null {
  const role = roleIds?.length ? [...new Set(roleIds)] : null
  const own = userIds?.length ? [...new Set(userIds)] : null
  if (!own) return role
  if (!role) return own
  return own.filter((id) => role.includes(id))
}

/** Pessoas que o monitor acompanha (quando não é "Todas as pessoas"). */
export interface MonitoredPeople {
  /** Usuários monitorados (managerIds deles têm o monitor) e atendentes dos setores que ele gerencia. */
  userIds: string[]
  /** Setores que o monitor gerencia (a fila e as conversas do setor). */
  sectorIds: string[]
  /** Vendedores ligados aos usuários monitorados (conversas passadas para o vendedor). */
  sellerIds: string[]
  /** Números sem atendimento dividido em que os monitorados atendem (conversas ainda sem atendente/vendedor). */
  sharedNumberIds: string[]
}

/** Conversas atendidas pelas pessoas monitoradas (null = ninguém). */
export function peopleWhere(p: MonitoredPeople): Prisma.WhatsappConversationWhereInput | null {
  const or: Prisma.WhatsappConversationWhereInput[] = []
  if (p.userIds.length) or.push({ assignedUserId: { in: p.userIds } }, { helperUserIds: { hasSome: p.userIds } })
  if (p.sellerIds.length) or.push({ assignedSellerId: { in: p.sellerIds } })
  if (p.sharedNumberIds.length) or.push({ assignedUserId: null, assignedSellerId: null, numberId: { in: p.sharedNumberIds } })
  if (p.sectorIds.length) or.push({ sectorId: { in: p.sectorIds } })
  return or.length ? { OR: or } : null
}

export interface MonitorInput {
  tenantId: string
  /** Tem a permissão "Monitorar conversas" (ver). */
  canMonitor: boolean
  /** Monitora todas as pessoas (true) ou só as escolhidas. */
  everyone: boolean
  /** Números efetivos (effectiveMonitorNumbers): null = todos. */
  numbers: string[] | null
  people: MonitoredPeople
}

/** Filtro das conversas do monitoramento (null = não pode monitorar nada). */
export function monitorWhere(i: MonitorInput): Prisma.WhatsappConversationWhereInput | null {
  if (!i.canMonitor) {
    // Gestor sem a permissão: a equipe dele (pessoas que o têm como gestor e setores que gerencia).
    const team = teamWhere({ userIds: i.people.userIds, sectorIds: i.people.sectorIds })
    return team ? { tenantId: i.tenantId, ...team } : null
  }
  if (i.numbers && !i.numbers.length) return null
  const and: Prisma.WhatsappConversationWhereInput[] = []
  if (i.numbers) and.push({ numberId: { in: i.numbers } })
  if (!i.everyone) {
    const people = peopleWhere(i.people)
    if (!people) return null
    and.push(people)
  }
  return and.length ? { tenantId: i.tenantId, AND: and } : { tenantId: i.tenantId }
}

/** Para a tela: o que a pessoa monitora. */
export function monitorAccessOf(i: Pick<MonitorInput, 'canMonitor' | 'everyone' | 'numbers'>, hasScope: boolean) {
  if (!hasScope) return { scope: null, limitedNumbers: false }
  if (!i.canMonitor) return { scope: 'EQUIPE' as const, limitedNumbers: false }
  if (!i.everyone) return { scope: 'PESSOAS' as const, limitedNumbers: !!i.numbers }
  return { scope: i.numbers ? ('NUMEROS' as const) : ('TODOS' as const), limitedNumbers: !!i.numbers }
}

/**
 * Vínculos "quem este usuário monitora" guardados em managerIds de cada monitorado (fonte única):
 * quem ganha o monitor e quem perde. Ninguém monitora a si mesmo.
 */
export function monitorLinkChanges(monitorId: string, current: string[], wanted: string[]) {
  const want = new Set(wanted.filter((id) => id !== monitorId))
  const now = new Set(current)
  return { add: [...want].filter((id) => !now.has(id)), remove: [...now].filter((id) => !want.has(id)) }
}
