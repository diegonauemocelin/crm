import { describe, expect, it } from 'vitest'
import { emailHtml } from '../src/fidelidade/email'
import {
  cleanConfig,
  cleanLevels,
  cleanReview,
  consumeLots,
  DEFAULT_CONFIG,
  expiresAtFor,
  fill,
  generateCode,
  inviteBlock,
  inviteDueAt,
  isBirthday,
  isCode,
  isDelivered,
  isDetractor,
  isReversal,
  lastMonths,
  levelFor,
  levelRank,
  lotAfterDebt,
  maskEmail,
  maskPhone,
  monthlyFlow,
  normalizeCode,
  npsClass,
  npsOf,
  orderQualifies,
  parseContact,
  pointsFor,
  redemptionProblem,
  signToken,
  verifyToken,
} from '../src/fidelidade/regras'

const D = (s: string) => new Date(s)

describe('fidelidade: configuração', () => {
  it('limpa valores inválidos e mantém o padrão', () => {
    const c = cleanConfig({ pointsPerReal: -5, rounding: 'xx', expireMonths: 999, review: { gapMin: 30, gapMax: 5, googleReviewUrl: 'http://inseguro.com', alertEmails: ['a@b.com', 'ruim', 'A@B.com'] }, giftHolder: 'qualquer' })
    expect(c.pointsPerReal).toBe(0)
    expect(c.rounding).toBe('baixo')
    expect(c.expireMonths).toBe(120)
    expect(c.review.gapMin).toBe(5)
    expect(c.review.gapMax).toBe(30)
    expect(c.review.googleReviewUrl).toBe('')
    expect(c.review.alertEmails).toEqual(['a@b.com'])
    expect(c.giftHolder).toBe('vendedor')
    expect(cleanConfig(null)).toEqual(DEFAULT_CONFIG)
  })

  it('níveis em ordem, chaves únicas, o primeiro a partir de zero', () => {
    const l = cleanLevels([{ name: 'Ouro', min: 5000 }, { name: 'Bronze', min: 100 }, { name: 'Ouro', min: 9000 }])
    expect(l.map((x) => x.name)).toEqual(['Bronze', 'Ouro', 'Ouro'])
    expect(l[0]!.min).toBe(0)
    expect(new Set(l.map((x) => x.key)).size).toBe(3)
    expect(cleanLevels([]).length).toBe(4)
  })
})

describe('fidelidade: pontos', () => {
  const cfg = { pointsPerReal: 1, rounding: 'baixo' as const, minOrderValue: 0 }
  it('pontos por real com arredondamento', () => {
    expect(pointsFor(199.99, cfg)).toBe(199)
    expect(pointsFor(199.5, { ...cfg, rounding: 'proximo' })).toBe(200)
    expect(pointsFor(199.01, { ...cfg, rounding: 'cima' })).toBe(200)
    expect(pointsFor(200, { ...cfg, rounding: 'cima' })).toBe(200)
    expect(pointsFor(0.3, { ...cfg, pointsPerReal: 10 })).toBe(3)
    expect(pointsFor(50, { ...cfg, minOrderValue: 100 })).toBe(0)
    expect(pointsFor(-10, cfg)).toBe(0)
    expect(pointsFor(1000, { ...cfg, pointsPerReal: 0.5 })).toBe(500)
  })

  it('só pedidos pagos, depois do início, do site e acima do mínimo', () => {
    const c = { since: '2026-11-01', minOrderValue: 50, onlySite: true }
    const o = { statusGroup: 'pago', total: 100, orderedAt: D('2026-11-05T12:00:00Z'), channel: 'Site' }
    expect(orderQualifies(o, c)).toBe(true)
    expect(orderQualifies({ ...o, channel: null }, c)).toBe(true)
    expect(orderQualifies({ ...o, channel: 'Mercado Livre' }, c)).toBe(false)
    expect(orderQualifies({ ...o, channel: 'Mercado Livre' }, { ...c, onlySite: false })).toBe(true)
    expect(orderQualifies({ ...o, statusGroup: 'pendente' }, c)).toBe(false)
    expect(orderQualifies({ ...o, orderedAt: D('2026-10-31T12:00:00Z') }, c)).toBe(false)
    expect(orderQualifies({ ...o, total: 49.9 }, c)).toBe(false)
    expect(orderQualifies(o, { ...c, since: null })).toBe(false)
  })

  it('validade em meses (fim do mês não pula)', () => {
    expect(expiresAtFor(D('2026-01-31T10:00:00Z'), 1)!.toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(expiresAtFor(D('2026-11-10T10:00:00Z'), 12)!.toISOString()).toBe('2027-11-10T10:00:00.000Z')
    expect(expiresAtFor(D('2026-11-10T10:00:00Z'), 0)).toBeNull()
  })

  it('consome primeiro os lotes que vencem antes; estorno começa pelo lote do pedido', () => {
    const lots = [
      { id: 'a', remaining: 100, expiresAt: D('2027-05-01') },
      { id: 'b', remaining: 50, expiresAt: D('2027-01-01') },
      { id: 'c', remaining: 30, expiresAt: null },
      { id: 'z', remaining: 0, expiresAt: D('2026-12-01') },
    ]
    expect(consumeLots(lots, 120)).toEqual({ takes: [{ id: 'b', take: 50 }, { id: 'a', take: 70 }], shortfall: 0 })
    expect(consumeLots(lots, 200)).toEqual({ takes: [{ id: 'b', take: 50 }, { id: 'a', take: 100 }, { id: 'c', take: 30 }], shortfall: 20 })
    expect(consumeLots(lots, 40, 'a').takes).toEqual([{ id: 'a', take: 40 }])
  })

  it('estorno com pontos já usados deixa dívida, e o próximo ganho paga primeiro', () => {
    expect(lotAfterDebt(100, -30)).toBe(70)
    expect(lotAfterDebt(100, -300)).toBe(0)
    expect(lotAfterDebt(100, 50)).toBe(100)
  })

  it('cancelado/devolvido estorna; entregue marca a entrega', () => {
    expect(isReversal({ statusGroup: 'cancelado', statusName: 'Cancelado' })).toBe(true)
    expect(isReversal({ statusGroup: 'outro', statusName: 'Devolvido' })).toBe(true)
    expect(isReversal({ statusGroup: 'pago', statusName: 'Entregue' })).toBe(false)
    expect(isDelivered('Entregue')).toBe(true)
    expect(isDelivered('Pedido entregue ao cliente')).toBe(true)
    expect(isDelivered('Não entregue')).toBe(false)
    expect(isDelivered('Entregue à transportadora')).toBe(false)
    expect(isDelivered('Faturado')).toBe(false)
  })
})

describe('fidelidade: níveis e resgates', () => {
  const levels = cleanLevels([{ name: 'Bronze', min: 0 }, { name: 'Prata', min: 1000 }, { name: 'Ouro', min: 5000 }])
  it('nível atual, próximo e quanto falta', () => {
    expect(levelFor(0, levels)).toMatchObject({ current: { key: 'bronze' }, next: { key: 'prata' }, missing: 1000, rank: 0 })
    expect(levelFor(1200, levels)).toMatchObject({ current: { key: 'prata' }, missing: 3800, rank: 1 })
    expect(levelFor(9999, levels)).toMatchObject({ current: { key: 'ouro' }, next: null, missing: 0, rank: 2 })
    expect(levelRank('ouro', levels)).toBe(2)
    expect(levelRank(null, levels)).toBe(-1)
  })

  it('confere nível, estoque, limite e saldo', () => {
    const base = { active: true, kind: 'DESCONTO', pointsCost: 500, balance: 600, stock: null, perCustomer: null, usedByCustomer: 0, minRank: -1, customerRank: 0 }
    expect(redemptionProblem(base)).toBeNull()
    expect(redemptionProblem({ ...base, balance: 100 })).toBe('Saldo insuficiente: faltam 400 pontos.')
    expect(redemptionProblem({ ...base, stock: 0 })).toMatch(/esgotou/)
    expect(redemptionProblem({ ...base, perCustomer: 1, usedByCustomer: 1 })).toMatch(/Limite/)
    expect(redemptionProblem({ ...base, minRank: 2 })).toMatch(/nível acima/)
    expect(redemptionProblem({ ...base, kind: 'BENEFICIO' })).toMatch(/não precisa resgatar/)
    expect(redemptionProblem({ ...base, active: false })).toMatch(/não está disponível/)
    expect(redemptionProblem({ ...base, optedOut: true })).toMatch(/saiu/)
  })

  it('código de resgate: formato, sem caracteres confusos e normalização', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()))
    expect(codes.size).toBe(500)
    for (const c of codes) {
      expect(isCode(c)).toBe(true)
      expect(c.slice(4)).not.toMatch(/[01OIL5SZ2]/)
    }
    const c = [...codes][0]!
    expect(normalizeCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c)
    expect(normalizeCode('FID-ABC')).toBeNull()
    expect(isCode('FID-AAAAA-AAAA0')).toBe(false)
  })
})

describe('fidelidade: avaliações', () => {
  it('NPS e classes', () => {
    expect(npsOf([10, 9, 8, 7, 6, 0])).toEqual({ total: 6, promoters: 2, passives: 2, detractors: 2, nps: 0 })
    expect(npsOf([10, 10, 9, 3])).toMatchObject({ nps: 50 })
    expect(npsOf([]).nps).toBeNull()
    expect(npsClass(9)).toBe('promotor')
    expect(npsClass(7)).toBe('neutro')
    expect(npsClass(6)).toBe('detrator')
  })

  it('detrator por nota ou por estrelas (configurável)', () => {
    const c = { detractorNps: 6, detractorStars: 2 }
    expect(isDetractor({ stars: 5, nps: 6 }, c)).toBe(true)
    expect(isDetractor({ stars: 2, nps: 10 }, c)).toBe(true)
    expect(isDetractor({ stars: 4, nps: 8 }, c)).toBe(false)
  })

  it('valida a avaliação enviada', () => {
    expect(cleanReview({ stars: 6, nps: 5 })).toEqual({ error: 'Escolha de 1 a 5 estrelas.' })
    expect(cleanReview({ stars: 5, nps: 11 })).toEqual({ error: 'Escolha uma nota de 0 a 10.' })
    expect(cleanReview({ stars: 4, nps: 9, comment: '  ótimo  ', aspects: { produto: 5, entrega: 9, outro: 3 } })).toEqual({ stars: 4, nps: 9, comment: 'ótimo', aspects: { produto: 5 } })
  })
})

describe('fidelidade: convite para avaliar', () => {
  const cfg = cleanConfig({ review: { enabled: true, daysAfterDelivery: 1, daysAfterPayment: 10, maxAgeDays: 60 } }).review
  const o = { orderedAt: D('2026-11-01T12:00:00Z'), deliveredAt: null, reversedAt: null, reviewed: false, optedOut: false, hasEmail: true, hasPhone: false }
  it('sai X dias depois da entrega ou, sem entrega, depois do pagamento', () => {
    expect(inviteDueAt(o, cfg).toISOString()).toBe('2026-11-11T12:00:00.000Z')
    expect(inviteDueAt({ ...o, deliveredAt: D('2026-11-04T09:00:00Z') }, cfg).toISOString()).toBe('2026-11-05T09:00:00.000Z')
  })

  it('espera, pula ou libera', () => {
    expect(inviteBlock(o, cfg, D('2026-11-05T00:00:00Z'))).toBe('esperar')
    expect(inviteBlock(o, cfg, D('2026-11-12T00:00:00Z'))).toBeNull()
    expect(inviteBlock({ ...o, deliveredAt: D('2026-11-03T00:00:00Z') }, cfg, D('2026-11-05T00:00:00Z'))).toBeNull()
    expect(inviteBlock({ ...o, reviewed: true }, cfg, D('2026-11-12T00:00:00Z'))).toBe('já avaliado')
    expect(inviteBlock({ ...o, reversedAt: D('2026-11-02') }, cfg, D('2026-11-12T00:00:00Z'))).toBe('pedido cancelado')
    expect(inviteBlock({ ...o, optedOut: true }, cfg, D('2026-11-12T00:00:00Z'))).toMatch(/saiu/)
    expect(inviteBlock(o, cfg, D('2027-02-01T00:00:00Z'))).toBe('pedido antigo')
    expect(inviteBlock({ ...o, hasEmail: false }, cfg, D('2026-11-12T00:00:00Z'))).toMatch(/sem e-mail/)
  })

  it('troca as variáveis da mensagem', () => {
    expect(fill('Olá, {nome}! Pedido {pedido}, {bonus} pontos. {x}', { nome: 'Ana', pedido: '123', bonus: 50 })).toBe('Olá, Ana! Pedido 123, 50 pontos. {x}')
  })

  it('aniversário pelo campo personalizado (horário de São Paulo)', () => {
    expect(isBirthday('1990-11-10', D('2026-11-10T15:00:00Z'))).toBe(true)
    expect(isBirthday('10/11/1990', D('2026-11-10T15:00:00Z'))).toBe(true)
    expect(isBirthday('1990-11-10', D('2026-11-11T01:00:00Z'))).toBe(true)
    expect(isBirthday('1990-11-10', D('2026-11-11T04:00:00Z'))).toBe(false)
    expect(isBirthday('2000-02-29', D('2027-02-28T15:00:00Z'))).toBe(true)
    expect(isBirthday(null, D('2026-11-10T15:00:00Z'))).toBe(false)
  })
})

describe('fidelidade: acesso do cliente', () => {
  const key = 'chave-de-teste'
  const p = { t: '11111111-1111-4111-8111-111111111111', l: '22222222-2222-4222-8222-222222222222', v: 0, k: 'link' as const, e: Math.floor(D('2026-11-17T00:00:00Z').getTime() / 1000) }
  it('assina e confere o link, com validade', () => {
    const t = signToken(p, key)
    expect(verifyToken(t, key, D('2026-11-10T00:00:00Z'))).toEqual(p)
    expect(verifyToken(t, key, D('2026-11-18T00:00:00Z'))).toBeNull()
    expect(verifyToken(t, 'outra-chave', D('2026-11-10T00:00:00Z'))).toBeNull()
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...p, l: '33333333-3333-4333-8333-333333333333' })).toString('base64url')
    expect(verifyToken(`${forged}.${sig}`, key, D('2026-11-10T00:00:00Z'))).toBeNull()
    expect(verifyToken(`${body}.${sig}.x`, key, D('2026-11-10T00:00:00Z'))).toBeNull()
    expect(verifyToken('lixo', key)).toBeNull()
  })

  it('contato digitado e dados mascarados', () => {
    expect(parseContact(' Ana@Exemplo.com ')).toEqual({ email: 'ana@exemplo.com' })
    expect(parseContact('(49) 98863-2548')).toEqual({ phone: '49988632548' })
    expect(parseContact('abc')).toBeNull()
    expect(maskEmail('fulano@exemplo.com')).toBe('fu•••@exemplo.com')
    expect(maskPhone('+5549988632548')).toBe('(••) •••••-2548')
  })
})

describe('fidelidade: painel e e-mail', () => {
  it('meses e fluxo de pontos', () => {
    expect(lastMonths(3, D('2026-11-10T12:00:00Z'))).toEqual(['2026-09', '2026-10', '2026-11'])
    const f = monthlyFlow(
      [
        { month: '2026-11', kind: 'GANHO', points: 500 },
        { month: '2026-11', kind: 'BONUS', points: 50 },
        { month: '2026-11', kind: 'RESGATE', points: -300 },
        { month: '2026-11', kind: 'EXPIRADO', points: -20 },
        { month: '2026-11', kind: 'ESTORNO', points: -100 },
        { month: '2026-01', kind: 'GANHO', points: 999 },
      ],
      ['2026-10', '2026-11'],
    )
    expect(f).toEqual([
      { month: '2026-10', emitidos: 0, resgatados: 0, expirados: 0, estornados: 0 },
      { month: '2026-11', emitidos: 550, resgatados: 300, expirados: 20, estornados: 100 },
    ])
  })

  it('e-mail escapa o texto e monta os parágrafos', () => {
    const html = emailHtml({ appName: 'CRM', shortName: 'Loja', primaryColor: '#123456' }, { title: 'Oi <b>', body: 'Linha 1\n\nLinha <2>', buttonLabel: 'Ver', buttonUrl: 'https://x.com/?a=1&b=2' })
    expect(html).toContain('Oi &lt;b&gt;')
    expect(html).toContain('Linha &lt;2&gt;')
    expect(html).toContain('https://x.com/?a=1&amp;b=2')
    expect(html).toContain('#123456')
  })
})
