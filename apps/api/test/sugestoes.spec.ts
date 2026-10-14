import { describe, expect, it } from 'vitest'
import { cleanText } from '../src/sugestoes/sugestoes'
import { SugestoesService } from '../src/sugestoes/sugestoes.service'

const perm = { view: true, create: true, edit: true, delete: false, export: false, scope: 'ALL' }
const who = (id: string, permissions: Record<string, unknown> = {}, isSystem = false) => ({ id, name: `Pessoa ${id}`, tenantId: 't', role: { isSystem }, permissions }) as never

function setup() {
  const rows: Record<string, unknown>[] = []
  const mails: string[] = []
  const prisma = {
    suggestion: {
      count: async () => 0,
      create: async (a: { data: Record<string, unknown> }) => {
        const r = { id: `s${rows.length + 1}`, status: 'NOVA', reply: null, repliedByName: null, repliedAt: null, unreadByAuthor: false, imageFileId: null, createdAt: new Date(), updatedAt: new Date(), ...a.data }
        rows.push(r)
        return r
      },
      findFirst: async (a: { where: { id: string } }) => rows.find((r) => r.id === a.where.id) ?? null,
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === a.where.id)!, a.data),
    },
    user: { findUnique: async () => ({ email: 'autor@exemplo.com', name: 'Autor', active: true }) },
  }
  const mail = { send: async (_t: string, m: { to: string }) => void mails.push(m.to), simpleTemplate: () => '' }
  const svc = new SugestoesService(prisma as never, {} as never, { byUser: async () => undefined } as never, mail as never, { branding: async () => ({ appName: 'CRM' }) } as never)
  return { svc, rows, mails }
}

describe('sugestões de melhoria', () => {
  it('limpa o texto e exige título e descrição', async () => {
    expect(cleanText('  Olá\u0000 mundo  ', 100)).toBe('Olá  mundo')
    expect(cleanText('a\n\n\n\nb', 100, true)).toBe('a\n\nb')
    const { svc } = setup()
    await expect(svc.create(who('u1'), { title: 'x', description: 'texto longo' }, undefined, {} as never)).rejects.toThrow(/título/)
    await expect(svc.create(who('u1'), { title: 'Filtro por marca', description: 'oi' }, undefined, {} as never)).rejects.toThrow(/Descreva/)
  })

  it('qualquer um envia; só quem tem a permissão responde, e quem enviou é avisado', async () => {
    const { svc, rows, mails } = setup()
    const s = await svc.create(who('u1'), { title: 'Filtro por marca', description: 'Na lista de leads, filtrar por marca da máquina.', area: 'leads' }, undefined, {} as never)
    expect(s.status).toBe('NOVA')
    expect(rows[0]).toMatchObject({ area: 'leads', userId: 'u1' })
    await expect(svc.answer(who('u2', { sugestoes: { ...perm, edit: false } }), s.id, { status: 'ANALISE' }, {} as never)).rejects.toThrow(/permissão/)
    await expect(svc.list(who('u2'), { all: true })).rejects.toThrow(/permissão/)
    const r = await svc.answer(who('adm', {}, true), s.id, { status: 'PLANEJADA', reply: 'Vai entrar no próximo mês.' }, {} as never)
    expect(r).toMatchObject({ status: 'PLANEJADA', reply: 'Vai entrar no próximo mês.', repliedByName: 'Pessoa adm', unread: true })
    await new Promise((res) => setTimeout(res, 10))
    expect(mails).toEqual(['autor@exemplo.com'])
  })
})
