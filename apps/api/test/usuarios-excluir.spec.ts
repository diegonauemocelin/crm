import { describe, expect, it } from 'vitest'
import { UsersService } from '../src/users/users.service'

const actor = { id: 'admin', tenantId: 't1', name: 'Admin' }
function make(target: Record<string, unknown> | null, otherAdmins = 1) {
  const calls: string[] = []
  let userUpdate: Record<string, unknown> | null = null
  const prisma = {
    user: {
      findFirst: async () => target,
      count: async () => otherAdmins,
      update: ({ data }: { data: Record<string, unknown> }) => {
        userUpdate = data
        return 'user.update'
      },
    },
    refreshToken: { updateMany: () => 'tokens' },
    seller: { updateMany: () => 'seller' },
    $executeRaw: (s: TemplateStringsArray) => s.join('?').match(/UPDATE (\w+)/)?.[1] ?? 'raw',
    $transaction: async (ops: string[]) => {
      calls.push(...ops)
      return ops
    },
  }
  const svc = new UsersService(prisma as never, { byUser: async () => undefined } as never, {} as never)
  return { svc, calls, update: () => userUpdate }
}

describe('Excluir usuário', () => {
  it('some das listas, perde o acesso e sai de números, setores, gestores e conversas', async () => {
    const { svc, calls, update } = make({ id: 'u1', name: 'Fulano', email: 'fulano@empresa.com', active: true, role: { isSystem: false } })
    await svc.remove(actor as never, 'u1', {} as never)
    expect(update()).toMatchObject({ active: false, totpEnabled: false, email: 'excluido-u1@usuario-excluido.invalid' })
    expect(update()?.deletedAt).toBeInstanceOf(Date)
    expect(calls).toEqual(['user.update', 'tokens', 'seller', 'whatsapp_numbers', 'whatsapp_sectors', 'users', 'whatsapp_conversations'])
  })

  it('não exclui a si mesmo', async () => {
    const { svc } = make({ id: 'admin', name: 'Admin', email: 'a@x.com', active: true, role: { isSystem: true } })
    await expect(svc.remove(actor as never, 'admin', {} as never)).rejects.toThrow(/próprio usuário/)
  })

  it('não exclui o último administrador', async () => {
    const { svc, calls } = make({ id: 'u2', name: 'Chefe', email: 'c@x.com', active: true, role: { isSystem: true } }, 0)
    await expect(svc.remove(actor as never, 'u2', {} as never)).rejects.toThrow(/administrador/)
    expect(calls).toEqual([])
  })

  it('usuário já excluído ou de outra empresa: não encontrado', async () => {
    const { svc } = make(null)
    await expect(svc.remove(actor as never, 'u3', {} as never)).rejects.toThrow(/não encontrado/)
  })
})
