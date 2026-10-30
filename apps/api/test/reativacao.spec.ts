import { describe, expect, it, vi } from 'vitest'
import { cleanReactivation, reactivationText } from '../src/atendimento/regras'
import { applyVariables } from '../src/whatsapp/envio'
import { ReativacaoService } from '../src/whatsapp/reativacao.service'

const now = new Date('2026-10-28T15:00:00Z')
const DAY = 86_400_000

function setup(opts: { newer?: number; replied?: number; records?: Record<string, unknown>[] } = {}) {
  const updates: unknown[] = []
  const records = opts.records ?? [{ id: 'r1', name: 'Maria Souza', phone: '+5547999990000', leadId: null, resultAt: new Date(now.getTime() - 31 * DAY), reactivationAt: null, brandIds: ['b1'], seller: { name: 'João Lima' } }]
  const prisma = {
    serviceRecord: {
      findMany: vi.fn(async (a: { where: { saleStatus: string; reactivationStep: { lte: number } } }) => (a.where.saleStatus === 'NAO' && a.where.reactivationStep.lte === 0 ? records : [])),
      count: vi.fn(async () => opts.newer ?? 0),
      updateMany: vi.fn(async (a: unknown) => (updates.push(a), { count: 1 })),
      update: vi.fn(async (a: unknown) => (updates.push(a), {})),
    },
    whatsappNumber: { findFirst: vi.fn(async () => ({ id: 'n1', name: 'Vendas', status: 'CONECTADO' })) },
    whatsappMessage: { findFirst: vi.fn(async () => null), count: vi.fn(async () => opts.replied ?? 0) },
    lookupItem: { findMany: vi.fn(async () => [{ name: 'Hyundai' }]) },
  }
  const chat = { rules: vi.fn(async () => ({ businessHours: { enabled: false, days: [] } })), sendAutomatic: vi.fn(async () => true) }
  const svc = new ReativacaoService(prisma as never, chat as never)
  return { svc, prisma, chat, updates }
}

const config = () => cleanReactivation({ enabled: true, numberId: 'n1', since: '2026-09-01T00:00:00Z' })

describe('Chamar o cliente de novo depois que a pré-venda fechou', () => {
  it('padrão: 3 mensagens sem venda (30, 90, 180 dias) e 3 de recompra, intervalo de 2 a 10 minutos', () => {
    const c = cleanReactivation(null)
    expect(c.enabled).toBe(false)
    expect(c.lost.map((s) => s.days)).toEqual([30, 90, 180])
    expect(c.sold.map((s) => s.days)).toEqual([60, 120, 180])
    expect(c).toMatchObject({ gapMin: 2, gapMax: 10 })
    expect(c.lost[0]!.text).toMatch(/filtros/i)
  })

  it('limpa os dias, mantém a ordem e o texto padrão quando vem vazio', () => {
    const c = cleanReactivation({ lost: [{ enabled: true, days: 200, text: ' ' }, { enabled: false, days: 0, text: 'B' }, { enabled: true, days: 10, text: 'C' }] })
    expect(c.lost.map((s) => s.days)).toEqual([10, 90, 200])
    expect(c.lost[2]!.text).toMatch(/\{nome\}/)
    expect(c.lost[1]).toMatchObject({ enabled: false, text: 'B' })
  })

  it('{marca} vira as marcas da máquina; sem marca, não sobra espaço', () => {
    const t = 'Como está a sua máquina {marca}?'
    expect(reactivationText(t, { marcas: ['Hyundai', 'JCB', 'Volvo'] })).toBe('Como está a sua máquina Hyundai, JCB e Volvo?')
    expect(applyVariables(reactivationText(t, { marcas: [] }), {})).toBe('Como está a sua máquina?')
  })

  it('envia a 1ª mensagem pelo número escolhido e avança a sequência', async () => {
    const { svc, chat, updates } = setup()
    await svc.runTenant('t1', config(), now)
    expect(chat.sendAutomatic).toHaveBeenCalledTimes(1)
    expect(chat.sendAutomatic).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), '+5547999990000', expect.stringMatching(/^Olá, Maria!.*máquina Hyundai/), 'Mensagem automática (chamar o cliente de novo)', expect.anything())
    expect(JSON.stringify(updates)).toContain('"reactivationStep":1')
    expect(JSON.stringify(updates)).toContain('"reactivationStatus":"ENVIADA"')
  })

  it('só o que vence depois de ligada: a consulta corta pelo since', async () => {
    const { svc, prisma } = setup({ records: [] })
    await svc.runTenant('t1', config(), now)
    const calls = prisma.serviceRecord.findMany.mock.calls as unknown as [{ where: { saleStatus: string; reactivationStep: { lte: number }; resultAt: { lte: Date; gte: Date } } }][]
    const first = calls.find((c) => c[0].where.saleStatus === 'NAO' && c[0].where.reactivationStep.lte === 0)![0].where
    expect(first.resultAt.lte).toEqual(new Date(now.getTime() - 30 * DAY))
    expect(first.resultAt.gte).toEqual(new Date(Date.parse('2026-09-01T00:00:00Z') - 30 * DAY))
    // Da última para a primeira, nos dois grupos.
    expect(calls.map((c) => `${c[0].where.saleStatus}${c[0].where.reactivationStep.lte}`)).toEqual(['NAO2', 'NAO1', 'NAO0', 'SIM2', 'SIM1', 'SIM0'])
  })

  it('para quando o cliente respondeu ou voltou com uma pré-venda nova', async () => {
    for (const opts of [{ newer: 1 }, { replied: 1 }]) {
      const recs = [{ id: 'r1', name: 'Maria', phone: '+5547999990000', leadId: 'l1', resultAt: new Date(now.getTime() - 31 * DAY), reactivationAt: new Date(now.getTime() - 5 * DAY), brandIds: [], seller: null }]
      const { svc, chat, updates } = setup({ ...opts, records: recs })
      await svc.runTenant('t1', config(), now)
      expect(chat.sendAutomatic).not.toHaveBeenCalled()
      expect(JSON.stringify(updates)).toMatch(/"reactivationStep":3,"reactivationStatus":"PAROU: /)
    }
  })

  it('número desconectado ou fora do horário: espera, sem marcar nada', async () => {
    const { svc, prisma, chat } = setup()
    prisma.whatsappNumber.findFirst.mockResolvedValueOnce({ id: 'n1', name: 'Vendas', status: 'DESCONECTADO' })
    await svc.runTenant('t1', config(), now)
    expect(prisma.serviceRecord.findMany).not.toHaveBeenCalled()
    expect(chat.sendAutomatic).not.toHaveBeenCalled()
  })
})
