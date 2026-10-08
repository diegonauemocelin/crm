import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildQuery, cleanConfig, fillTime, type ReportConfig, resolvePeriod, shapeRows, SOURCES, timeBuckets, todaySP } from '../src/relatorios/fontes'
import { cleanPropertyId, gaBody, gaError, gaRows, parseKeyFile, signJwt } from '../src/relatorios/ga4'

const T = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'
const ok = (raw: unknown) => {
  const r = cleanConfig(raw)
  if ('error' in r) throw new Error(r.error)
  return r.config
}
const sqlText = (c: ReportConfig, scope: 'ALL' | 'OWN' | 'UNIT' = 'ALL') => {
  const q = buildQuery(c, { tenantId: T, scope, userId: U, unitId: scope === 'UNIT' ? U : null }, { from: '2026-10-01', to: '2026-10-07' })
  return { text: q.sql.sql, values: q.sql.values }
}

describe('configuração do relatório', () => {
  it('só aceita fonte, campos e métricas conhecidos', () => {
    expect(cleanConfig({ source: 'usuarios' })).toMatchObject({ error: expect.stringMatching(/fonte/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], dimensions: ['senha'] })).toMatchObject({ error: expect.stringMatching(/agrupamento/) })
    expect(cleanConfig({ source: 'leads', metrics: ['receita'] })).toMatchObject({ error: expect.stringMatching(/Métrica/) })
    expect(cleanConfig({ source: 'leads', metrics: [] })).toMatchObject({ error: expect.stringMatching(/métrica/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], dimensions: ['a', 'b', 'c'] })).toMatchObject({ error: expect.stringMatching(/2 campos/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], filters: [{ field: 'dia', values: ['x'] }] })).toMatchObject({ error: expect.stringMatching(/período/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], filters: [{ field: 'estado', values: [] }] })).toMatchObject({ error: expect.stringMatching(/valor/) })
  })

  it('gráfico precisa de agrupamento; número não usa', () => {
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], chart: 'barras' })).toMatchObject({ error: expect.stringMatching(/Gráficos/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], dimensions: ['estado'], chart: 'numero' })).toMatchObject({ error: expect.stringMatching(/número/) })
    expect(ok({ source: 'leads', metrics: ['leads'], chart: 'numero' })).toMatchObject({ chart: 'numero', limit: 20, compare: true, period: { preset: '30' } })
  })

  it('período personalizado confere as datas', () => {
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], period: { preset: 'personalizado', from: '2026-10-07', to: '2026-10-01' } })).toMatchObject({ error: expect.stringMatching(/depois/) })
    expect(cleanConfig({ source: 'leads', metrics: ['leads'], period: { preset: 'personalizado', from: '2026-13-01', to: '2026-10-01' } })).toMatchObject({ error: expect.any(String) })
    expect(ok({ source: 'leads', metrics: ['leads'], period: { preset: 'personalizado', from: '2026-01-01', to: '2026-01-31' } }).period).toEqual({ preset: 'personalizado', from: '2026-01-01', to: '2026-01-31' })
  })
})

describe('períodos', () => {
  it('relativos a hoje em São Paulo, com o anterior do mesmo tamanho', () => {
    expect(todaySP(new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07')
    expect(resolvePeriod({ preset: '7' }, '2026-10-07')).toEqual({ from: '2026-10-01', to: '2026-10-07', days: 7, previous: { from: '2026-09-24', to: '2026-09-30' } })
    expect(resolvePeriod({ preset: 'mes_anterior' }, '2026-03-15')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', days: 28 })
    expect(resolvePeriod({ preset: 'ontem' }, '2026-01-01')).toMatchObject({ from: '2025-12-31', to: '2025-12-31' })
    expect(resolvePeriod({ preset: 'ano' }, '2026-10-07')).toMatchObject({ from: '2026-01-01', days: 280 })
  })
})

describe('SQL montado', () => {
  it('valores do usuário vão como parâmetro, nunca no texto', () => {
    const evil = "SP'); DROP TABLE leads; --"
    const { text, values } = sqlText(ok({ source: 'leads', metrics: ['leads'], dimensions: ['estado'], filters: [{ field: 'estado', values: [evil] }] }))
    expect(text).not.toContain('DROP')
    expect(values).toContain(evil)
    expect(values).toContain(T)
  })

  it('aplica empresa, período em horário de Brasília e escopo', () => {
    const c = ok({ source: 'pedidos', metrics: ['receita'], dimensions: ['situacao'] })
    const all = sqlText(c)
    expect(all.text).toContain('t."tenantId" =')
    expect(all.values).toContainEqual(new Date('2026-10-01T03:00:00.000Z'))
    expect(all.values).toContainEqual(new Date('2026-10-08T03:00:00.000Z'))
    expect(all.text).not.toContain('ownerId')
    const own = sqlText(c, 'OWN')
    expect(own.text).toContain('LEFT JOIN leads l')
    expect(own.text).toContain('l."ownerId" IN (SELECT id FROM sellers WHERE "userId" =')
    expect(own.values).toContain(U)
    expect(sqlText(ok({ source: 'atendimentos', metrics: ['vendas'] }), 'UNIT').text).toContain('t."unitId" =')
    expect(sqlText(ok({ source: 'visitas', metrics: ['visitas'] }), 'OWN').text).toContain('AND false')
  })

  it('"diferente" mantém os vazios; "não informado" vira IS NULL', () => {
    const diff = sqlText(ok({ source: 'leads', metrics: ['leads'], filters: [{ field: 'estado', op: 'diferente', values: ['SP'] }] })).text
    expect(diff).toContain('OR (t.state) IS NULL')
    const empty = sqlText(ok({ source: 'leads', metrics: ['leads'], filters: [{ field: 'estado', values: [null] }] })).text
    expect(empty).toContain('(t.state) IS NULL')
    const tag = sqlText(ok({ source: 'leads', metrics: ['leads'], filters: [{ field: 'tag', values: ['vip', null] }] })).text
    expect(tag).toContain('= ANY(t.tags)')
    expect(tag).toContain('cardinality(t.tags) = 0')
    expect(tag).not.toContain('unnest')
  })

  it('total não usa a junção de lista (cada registro conta uma vez)', () => {
    const c = ok({ source: 'leads', metrics: ['leads'], dimensions: ['tag'] })
    expect(sqlText(c).text).toContain('unnest(t.tags)')
    const total = buildQuery(c, { tenantId: T, scope: 'ALL', userId: U, unitId: null }, { from: '2026-10-01', to: '2026-10-07' }, false)
    expect(total.sql.sql).not.toContain('unnest')
    expect(total.sql.sql).not.toContain('GROUP BY')
  })

  it('agrupamento por data ordena pela data; os outros, pela métrica', () => {
    expect(sqlText(ok({ source: 'leads', metrics: ['leads'], dimensions: ['dia'] })).text).toContain('ORDER BY d0 ASC')
    expect(sqlText(ok({ source: 'leads', metrics: ['leads'], dimensions: ['estado'] })).text).toContain('ORDER BY m0 DESC')
  })

  it('toda fonte tem campos e métricas com chaves únicas', () => {
    for (const s of SOURCES) {
      expect(new Set(s.dimensions.map((d) => d.key)).size).toBe(s.dimensions.length)
      expect(new Set(s.metrics.map((m) => m.key)).size).toBe(s.metrics.length)
      for (const d of s.dimensions) for (const j of [...(d.joins ?? []), ...(d.array ? [d.array.join] : [])]) expect(s.joins[j], `${s.key}.${d.key} -> ${j}`).toBeDefined()
    }
  })

  it('com dois agrupamentos, limita os valores do primeiro campo', () => {
    const raw = [
      { d0: 'SP', d1: 'a', m0: 5 },
      { d0: 'SP', d1: 'b', m0: 4 },
      { d0: 'PR', d1: 'a', m0: 3 },
      { d0: 'SC', d1: 'a', m0: 2 },
    ]
    expect(shapeRows(raw, 2, 1, 2).map((r) => r.dims)).toEqual([['SP', 'a'], ['SP', 'b'], ['PR', 'a']])
    expect(shapeRows([{ d0: null, m0: '7.5' }], 1, 1, 10)).toEqual([{ dims: [null], values: [7.5] }])
  })
})

describe('gráfico por data', () => {
  it('gera todos os dias, semanas (segunda-feira) e meses do período', () => {
    expect(timeBuckets('dia', '2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(timeBuckets('semana', '2026-10-07', '2026-10-19')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    expect(timeBuckets('mes', '2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(timeBuckets('hora', '2026-10-01', '2026-10-02')).toBeNull()
  })

  it('período vazio: 0 em contagem e soma, vazio em média e taxa', () => {
    const leads = SOURCES.find((s) => s.key === 'atendimentos')!
    const metrics = ['atendimentos', 'valor_vendido', 'ticket', 'conversao'].map((k) => leads.metrics.find((m) => m.key === k)!)
    const rows = fillTime([{ dims: ['2026-10-02'], values: [3, 100, 50, 0.5] }], 'dia', metrics, '2026-10-01', '2026-10-02')
    expect(rows).toEqual([
      { dims: ['2026-10-01'], values: [0, 0, null, null] },
      { dims: ['2026-10-02'], values: [3, 100, 50, 0.5] },
    ])
  })

  it('agrupado por data não corta o período pelo limite de linhas', () => {
    const text = sqlText(ok({ source: 'leads', metrics: ['leads'], dimensions: ['dia'], limit: 10 })).values
    expect(text).toContain(1100)
  })
})

describe('Google Analytics 4', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const keyFile = JSON.stringify({ type: 'service_account', client_email: 'crm@projeto.iam.gserviceaccount.com', private_key: pem, project_id: 'x' })

  it('lê o arquivo da conta de serviço e recusa outros', () => {
    expect(parseKeyFile(keyFile)).toEqual({ clientEmail: 'crm@projeto.iam.gserviceaccount.com', privateKey: pem })
    expect(parseKeyFile('{')).toMatchObject({ error: expect.stringMatching(/JSON/) })
    expect(parseKeyFile(JSON.stringify({ type: 'authorized_user' }))).toMatchObject({ error: expect.stringMatching(/conta de serviço/) })
    expect(parseKeyFile(JSON.stringify({ type: 'service_account', client_email: 'crm@projeto.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----' }))).toMatchObject({ error: expect.stringMatching(/corrompida/) })
  })

  it('JWT assinado com a chave, escopo só de leitura', () => {
    const jwt = signJwt('crm@projeto.iam.gserviceaccount.com', pem, Date.UTC(2026, 9, 7))
    const [h, c, s] = jwt.split('.')
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'crm@projeto.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token' })
    expect(claims.exp - claims.iat).toBe(3600)
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true)
  })

  it('propriedade, corpo da consulta e leitura das linhas', () => {
    expect(cleanPropertyId('properties/123456789')).toBe('123456789')
    expect(cleanPropertyId('G-ABC123')).toBeNull()
    expect(gaBody({ from: '2026-10-01', to: '2026-10-07' }, { dimensions: ['date'], metrics: ['sessions'], orderBy: { dimension: 'date' } }, { from: '2026-09-24', to: '2026-09-30' })).toEqual({
      dateRanges: [{ startDate: '2026-10-01', endDate: '2026-10-07' }, { startDate: '2026-09-24', endDate: '2026-09-30' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    })
    expect(gaRows({ dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'sessions' }], rows: [{ dimensionValues: [{ value: '20261007' }], metricValues: [{ value: '42' }] }] })).toEqual([{ date: '2026-10-07', sessions: 42 }])
  })

  it('explica os erros comuns', () => {
    expect(gaError(403, { error: { status: 'PERMISSION_DENIED', message: 'User does not have sufficient permissions' } }, 'crm@x.iam.gserviceaccount.com')).toContain('crm@x.iam.gserviceaccount.com como Leitor')
    expect(gaError(403, { error: { status: 'PERMISSION_DENIED', message: 'Google Analytics Data API has not been used in project' } }, '')).toMatch(/não está ativada/)
    expect(gaError(400, { error: 'invalid_grant' }, '')).toMatch(/recusou a chave/)
  })
})

describe('Google Analytics 4 no serviço (Google simulado)', () => {
  it('pega o token, consulta em lote, separa período atual e anterior e guarda em cache', async () => {
    const { RelatoriosService } = await import('../src/relatorios/relatorios.service')
    const { encrypt } = await import('../src/common/crypto')
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const ga = { enabled: true, propertyId: '123456789', clientEmail: 'crm@p.iam.gserviceaccount.com', privateKeyEnc: encrypt(pem), updatedAt: null }
    const settings = { get: async () => ga, set: async () => ga }
    const service = new RelatoriosService({} as never, settings as never, {} as never)
    const user = { id: U, tenantId: T, role: { isSystem: true }, permissions: {}, unitId: null } as never

    const calls: string[] = []
    const report = (dims: string[], mets: string[], rows: [string[], number[]][]) => ({
      dimensionHeaders: dims.map((name) => ({ name })),
      metricHeaders: mets.map((name) => ({ name })),
      rows: rows.map(([d, m]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((v) => ({ value: String(v) })) })),
    })
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push(String(url))
      if (String(url).includes('oauth2')) {
        expect(String(init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
      }
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      const body = JSON.parse(String(init.body)) as { requests: { dimensions: { name: string }[] }[] }
      const totals = ['activeUsers', 'newUsers', 'sessions', 'engagementRate', 'averageSessionDuration', 'screenPageViews', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue']
      const reports = body.requests.map((r) => {
        const dim = r.dimensions[0]?.name
        if (!dim) return report(['dateRange'], totals, [[['date_range_0'], [100, 40, 150, 0.6, 95, 900, 12, 3, 1500.5]], [['date_range_1'], [80, 30, 120, 0.5, 90, 700, 10, 2, 900]]])
        if (dim === 'date') return report(['date'], ['sessions', 'activeUsers', 'keyEvents', 'purchaseRevenue'], [[['20261007'], [10, 8, 1, 0]]])
        return report([dim], ['sessions'], [[['x'], [1]]])
      })
      return new Response(JSON.stringify({ reports }))
    }) as typeof fetch
    try {
      const r = (await service.ga4Report(user, '2026-10-01', '2026-10-07')) as { configured: true; totals: Record<string, { value: number; previous: number | null }>; daily: unknown[] }
      expect(r.totals.sessions).toEqual({ value: 150, previous: 120 })
      expect(r.totals.purchaseRevenue).toEqual({ value: 1500.5, previous: 900 })
      expect(r.daily).toEqual([{ date: '2026-10-07', sessions: 10, activeUsers: 8, keyEvents: 1, purchaseRevenue: 0 }])
      expect(calls.filter((u) => u.includes('oauth2'))).toHaveLength(1)
      expect(calls.filter((u) => u.endsWith('properties/123456789:batchRunReports'))).toHaveLength(2)
      // Segunda consulta igual vem do cache (sem chamar o Google de novo).
      await service.ga4Report(user, '2026-10-01', '2026-10-07')
      expect(calls).toHaveLength(3)
    } finally {
      globalThis.fetch = original
    }
  })
})
