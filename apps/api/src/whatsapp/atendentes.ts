/**
 * Vários atendentes no mesmo número ("atendimento dividido"): cada conversa de cliente tem um atendente (login).
 * Quem atende vê as conversas dele e a fila (sem atendente) do seu setor; conversas com colegas, fornecedores e
 * outros contatos da empresa ficam visíveis para todos os atendentes do número.
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client'

export interface Sector {
  id: string
  name: string
  userIds: string[]
}

/** Setores gravados no número (JSON), limpos: nome obrigatório, até 20 setores, usuários só do número. */
export function cleanSectors(raw: unknown, numberUserIds: string[]): Sector[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(numberUserIds)
  const seen = new Set<string>()
  const out: Sector[] = []
  for (const r of raw.slice(0, 20) as Partial<Sector>[]) {
    const name = String(r?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const id = typeof r?.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id) ? r.id : randomUUID()
    const userIds = [...new Set((Array.isArray(r?.userIds) ? r.userIds : []).filter((u): u is string => typeof u === 'string' && allowed.has(u)))]
    out.push({ id, name, userIds })
  }
  return out
}

export function sectorsOf(raw: unknown): Sector[] {
  return Array.isArray(raw) ? (raw as Sector[]).filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string') : []
}

/**
 * Filtro das conversas de um atendente nos números com atendimento dividido.
 * Fila: sem atendente e sem setor (todos do número veem) ou no setor da pessoa.
 */
export function splitWhere(userId: string, numbers: { id: string; sectors: unknown }[]): Prisma.WhatsappConversationWhereInput[] {
  return numbers.map((n) => {
    const mine = sectorsOf(n.sectors)
      .filter((s) => s.userIds.includes(userId))
      .map((s) => s.id)
    return {
      numberId: n.id,
      OR: [
        { assignedUserId: userId },
        // Participante: outro atendente me colocou na conversa.
        { helperUserIds: { has: userId } },
        { category: { not: 'CLIENTE' } },
        { assignedUserId: null, OR: [{ sectorId: null }, ...(mine.length ? [{ sectorId: { in: mine } }] : [])] },
      ],
    }
  })
}
