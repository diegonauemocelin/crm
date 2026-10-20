/**
 * Vários atendentes no mesmo número ("atendimento dividido"): cada conversa de cliente tem um atendente (login).
 * Quem atende vê as conversas dele e a fila (sem atendente) dos seus setores; conversas com colegas, fornecedores e
 * outros contatos da empresa ficam visíveis para todos os atendentes do número.
 * Setores são da empresa (Configurações › Setores e equipes): atendem em alguns ou em todos os números, têm
 * atendentes e gestores, e dizem se cada um vê só as próprias conversas ou todas as do setor.
 */
import type { Prisma } from '../generated/prisma/client'

export type SectorVisibility = 'PROPRIAS' | 'SETOR'

export interface Sector {
  id: string
  name: string
  /** Vazio = atende em todos os números. */
  numberIds: string[]
  userIds: string[]
  managerIds: string[]
  visibility: SectorVisibility
}

/** O setor atende neste número? */
export const servesNumber = (s: Pick<Sector, 'numberIds'>, numberId: string) => !s.numberIds.length || s.numberIds.includes(numberId)

/** Setor salvo pela tela, limpo: nome obrigatório (até 40 letras), listas sem repetição, visibilidade conhecida. */
export function cleanSector(raw: { name?: unknown; description?: unknown; numberIds?: unknown; userIds?: unknown; managerIds?: unknown; visibility?: unknown }) {
  const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 200)
  const name = String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const description = String(raw.description ?? '').trim().slice(0, 200) || null
  return { name, description, numberIds: ids(raw.numberIds), userIds: ids(raw.userIds), managerIds: ids(raw.managerIds), visibility: (raw.visibility === 'SETOR' ? 'SETOR' : 'PROPRIAS') as SectorVisibility }
}

/**
 * Filtro das conversas de um atendente nos números com atendimento dividido:
 * - as dele, as em que é participante e as dos contatos da empresa;
 * - a fila: sem setor (todos do número veem) ou dos setores dele naquele número;
 * - setor com visibilidade "SETOR": todas as conversas do setor, de qualquer atendente.
 */
export function splitWhere(userId: string, numbers: { id: string }[], sectors: Sector[]): Prisma.WhatsappConversationWhereInput[] {
  return numbers.map((n) => {
    const mine = sectors.filter((s) => servesNumber(s, n.id) && s.userIds.includes(userId))
    const queue = mine.map((s) => s.id)
    const shared = mine.filter((s) => s.visibility === 'SETOR').map((s) => s.id)
    return {
      numberId: n.id,
      OR: [
        { assignedUserId: userId },
        // Participante: outro atendente me colocou na conversa.
        { helperUserIds: { has: userId } },
        { category: { not: 'CLIENTE' } },
        { assignedUserId: null, OR: [{ sectorId: null }, ...(queue.length ? [{ sectorId: { in: queue } }] : [])] },
        ...(shared.length ? [{ sectorId: { in: shared } }] : []),
      ],
    }
  })
}

/**
 * Equipe de um gestor: as pessoas que o têm como gestor e os atendentes dos setores que ele gerencia.
 * O gestor acompanha (só leitura) as conversas delas e as dos setores dele.
 */
export function teamOf(managerId: string, users: { id: string; managerIds: string[] }[], sectors: Sector[]) {
  const managed = sectors.filter((s) => s.managerIds.includes(managerId))
  const members = new Set([...users.filter((u) => u.managerIds.includes(managerId)).map((u) => u.id), ...managed.flatMap((s) => s.userIds)])
  members.delete(managerId)
  return { userIds: [...members], sectorIds: managed.map((s) => s.id) }
}

/** Conversas que o gestor acompanha (null = não é gestor de ninguém). */
export function teamWhere(team: { userIds: string[]; sectorIds: string[] }): Prisma.WhatsappConversationWhereInput | null {
  if (!team.userIds.length && !team.sectorIds.length) return null
  return { OR: [...(team.userIds.length ? [{ assignedUserId: { in: team.userIds } }, { helperUserIds: { hasSome: team.userIds } }] : []), ...(team.sectorIds.length ? [{ sectorId: { in: team.sectorIds } }] : [])] }
}
