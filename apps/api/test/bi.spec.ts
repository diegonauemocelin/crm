import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, filterOf, hashKey, KEY_RE, keyFits, keyPrefix, localDateTime, newKey, parseDate, RateLimiter, sameHash, whatsappSessions, windowStart } from '../src/bi/bi'
import { contratoMarkdown } from '../src/bi/bi-contrato'
import { describeTables, pageSql, TABLE_BY_NAME, TABLES } from '../src/bi/bi-tabelas'
import { MODULE_KEYS } from '../src/common/permissions'

describe('Power BI: chave de acesso', () => {
  it('gera chave com prefixo, guarda só o resumo e compara em tempo constante', () => {
    const k = newKey()
    expect(k).toMatch(KEY_RE)
    expect(newKey()).not.toBe(k)
    const h = hashKey(k)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(sameHash(h, hashKey(k))).toBe(true)
    expect(sameHash(h, hashKey(`${k}x`))).toBe(false)
    expect(sameHash(h, 'curto')).toBe(false)
    expect(keyPrefix(k)).toBe(k.slice(0, 10))
    expect(KEY_RE.test('crmbi_curta')).toBe(false)
  })

  it('módulo de permissão "bi" existe', () => {
    expect(MODULE_KEYS as readonly string[]).toContain('bi')
  })
})

describe('Power BI: datas e filtro', () => {
  it('valida datas de calendário', () => {
    expect(parseDate('2026-02-28')).toBe('2026-02-28')
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate('26-02-01')).toBeNull()
    expect(parseDate(undefined)).toBeNull()
  })

  it('janela padrão volta N meses, ajustando o fim do mês', () => {
    expect(windowStart('2026-11-09', 24)).toBe('2024-11-09')
    expect(windowStart('2026-03-31', 1)).toBe('2026-02-28')
    expect(windowStart('2024-03-31', 1)).toBe('2024-02-29')
    expect(windowStart('2026-01-15', 13)).toBe('2024-12-15')
  })

  it('fatos: desde > janela; dimensões: sempre tudo', () => {
    expect(filterOf({ desde: '2026-10-01' }, true, '2026-11-09')).toEqual({ f: 'desde', d: '2026-10-01' })
    expect(filterOf({}, true, '2026-11-09')).toEqual({ f: 'janela', d: '2024-11-09' })
    expect(filterOf({ meses: 6 }, true, '2026-11-09')).toEqual({ f: 'janela', d: '2026-05-09' })
    expect(filterOf({ desde: '2026-10-01' }, false, '2026-11-09')).toEqual({ f: 'tudo', d: null })
    expect(filterOf({ desde: '2026-13-01' }, true, '2026-11-09')).toHaveProperty('error')
    expect(filterOf({ meses: 0 }, true, '2026-11-09')).toHaveProperty('error')
  })

  it('data e hora no horário de Brasília, sem fuso', () => {
    expect(localDateTime(new Date('2026-11-09T15:04:05Z'))).toBe('2026-11-09T12:04:05')
    expect(localDateTime(new Date('2026-11-10T02:00:00Z'))).toBe('2026-11-09T23:00:00')
    expect(localDateTime(null)).toBeNull()
  })
})

describe('Power BI: cursor da paginação', () => {
  it('vai e volta, preso à tabela e ao filtro da primeira página', () => {
    const c = encodeCursor({ t: 'fato_leads', k: '0b6a0f8e-2f0b-4b8e-9d0a-0d3f2c1b5a77', f: 'janela', d: '2024-11-09' })
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(c, 'fato_leads')).toEqual({ t: 'fato_leads', k: '0b6a0f8e-2f0b-4b8e-9d0a-0d3f2c1b5a77', f: 'janela', d: '2024-11-09' })
    expect(decodeCursor(c, 'fato_atendimentos')).toBeNull()
    expect(decodeCursor('lixo', 'fato_leads')).toBeNull()
    expect(decodeCursor('', 'fato_leads')).toBeNull()
    const tudo = encodeCursor({ t: 'dim_filial', k: 'x', f: 'tudo', d: null })
    expect(decodeCursor(tudo, 'dim_filial')).toEqual({ t: 'dim_filial', k: 'x', f: 'tudo', d: null })
  })

  it('a chave do cursor precisa ter o formato da chave da tabela', () => {
    expect(keyFits('0b6a0f8e-2f0b-4b8e-9d0a-0d3f2c1b5a77', 'uuid')).toBe(true)
    expect(keyFits("1' OR 1=1", 'uuid')).toBe(false)
    expect(keyFits('123', 'int')).toBe(true)
    expect(keyFits('12a', 'int')).toBe(false)
    expect(keyFits('google|123|2026-01-01', 'text')).toBe(true)
  })
})

describe('Power BI: limite por chave', () => {
  it('libera até o limite na janela e diz quando tentar de novo', () => {
    const r = new RateLimiter(3, 60_000)
    expect(r.hit('a', 0).ok).toBe(true)
    expect(r.hit('a', 1000).ok).toBe(true)
    expect(r.hit('a', 2000).ok).toBe(true)
    const no = r.hit('a', 3000)
    expect(no.ok).toBe(false)
    expect(no.retryAfter).toBe(57)
    expect(r.hit('b', 3000).ok).toBe(true)
    expect(r.hit('a', 60_001).ok).toBe(true)
  })
})

describe('Power BI: atendimentos do WhatsApp', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 9, 12) + h * 3_600_000)
  const m = (conv: string, h: number, fromMe: boolean, by: string | null = null) => ({ conversationId: conv, sentAt: t(h), fromMe, sentById: by })

  it('separa atendimentos depois de 24 h e mede a primeira resposta', () => {
    const s = whatsappSessions(
      [
        m('c1', 0, false),
        m('c1', 0.1, false),
        m('c1', 0.5, true, 'u1'),
        m('c1', 1, false),
        m('c1', 2, true, null),
        m('c1', 30, true, 'u2'),
        m('c1', 31, false),
        m('c2', 0, false),
      ],
      (a, b) => b.getTime() - a.getTime(),
    )
    expect(s).toHaveLength(3)
    const [a, b, c] = s
    expect(a).toMatchObject({ conversationId: 'c1', startedBy: 'cliente', inbound: 3, outbound: 2, turns: 2, answered: 2, firstMs: 1_800_000, firstResponder: 'u1', pending: false })
    expect(a!.responseMsSum).toBe(1_800_000 + 3_600_000)
    // A empresa começou: a vez do cliente depois não é "primeira resposta".
    expect(b).toMatchObject({ startedBy: 'empresa', inbound: 1, outbound: 1, firstMs: null, firstAt: null, pending: true })
    expect(c).toMatchObject({ conversationId: 'c2', inbound: 1, outbound: 0, firstRespondedAt: null, pending: true })
  })
})

describe('Power BI: catálogo das tabelas', () => {
  const FORBIDDEN = /"(phone|email|customerName|customerEmail|customerPhone|customerDoc|customerCode|customerNickname|customerId|recipientName|recipientDoc|tomadorDoc|senderDoc|emitCnpj|emitName|buyerId|destZip|text|cnpj|legalName|company|jid|lastPreview|notes|contactNote|reference)"|\b(l|r|o|q|v)\.(name|phone|email|company)\b/

  it('nomes únicos, snake_case, chave entre as colunas e SQL em todas as colunas', () => {
    expect(new Set(TABLES.map((t) => t.nome)).size).toBe(TABLES.length)
    for (const t of TABLES) {
      expect(t.nome).toMatch(t.tipo === 'fato' ? /^fato_[a-z_]+$/ : /^dim_[a-z_]+$/)
      const names = t.colunas.map((c) => c.nome)
      expect(new Set(names).size, t.nome).toBe(names.length)
      for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(names, t.nome).toContain(t.chave)
      if (!t.custom) for (const c of t.colunas) expect(c.sql, `${t.nome}.${c.nome}`).toBeTruthy()
      for (const d of t.datas) expect(t.colunas.find((c) => c.nome === d)?.tipo, `${t.nome}.${d}`).toBe('data')
      if (t.tipo === 'fato') expect(t.datas.length, t.nome).toBeGreaterThan(0)
    }
  })

  it('relações apontam para a chave de uma dimensão', () => {
    for (const t of TABLES)
      for (const r of t.relacoes) {
        const dim = TABLE_BY_NAME.get(r.tabela)
        expect(dim?.tipo, `${t.nome}.${r.coluna}`).toBe('dimensao')
        expect(dim?.chave).toBe(r.chave)
        expect(t.colunas.map((c) => c.nome)).toContain(r.coluna)
      }
  })

  it('LGPD: nenhum SQL lê dado pessoal de cliente nem texto de mensagem', () => {
    for (const t of TABLES) {
      if (!t.sql) continue
      const all = [t.sql.from, t.sql.where, ...t.colunas.map((c) => c.sql ?? '')].join('\n')
      expect(FORBIDDEN.test(all), t.nome).toBe(false)
    }
  })

  it('SQL da página: empresa, filtro, cursor e limite como parâmetros', () => {
    const t = TABLE_BY_NAME.get('fato_atendimentos')!
    const first = pageSql(t, 'janela', false)
    expect(first).toContain('r."tenantId" = $1::uuid')
    expect(first).toContain(`r."leadAt" >= ((($3)::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'`)
    expect(first).toContain('LIMIT $2')
    expect(first).not.toContain('$4')
    const next = pageSql(t, 'desde', true)
    expect(next).toContain('r."updatedAt" >= ')
    expect(next).toContain('r.id > $4::uuid')
    const dim = pageSql(TABLE_BY_NAME.get('dim_filial')!, 'tudo', true)
    expect(dim).toContain('u.id > $3::uuid')
    expect(pageSql(TABLE_BY_NAME.get('fato_ml_perguntas')!, 'tudo', true)).toContain('q.id > $3::int')
    expect(pageSql(TABLE_BY_NAME.get('fato_brindes')!, 'janela', false)).toContain('g.date >= $3::date')
  })

  it('descrição pública não expõe o SQL', () => {
    expect(JSON.stringify(describeTables())).not.toContain('tenantId')
  })
})

describe('Power BI: contrato', () => {
  it('cobre todas as tabelas e colunas, com a função M e o endereço', () => {
    const md = contratoMarkdown('https://crm.exemplo.com.br/api/bi/v1/')
    expect(md).toContain('`CRM_BaseUrl` = `https://crm.exemplo.com.br/api/bi/v1/`')
    expect(md).toContain('RelativePath = nome')
    expect(md).toContain('#"X-BI-Key"')
    for (const t of TABLES) {
      expect(md).toContain(`### ${t.nome}`)
      for (const c of t.colunas) expect(md).toContain(`| \`${c.nome}\` |`)
    }
  })

  it('docs/BI-CONTRATO.md está em dia com o catálogo', () => {
    const file = new URL('../../../docs/BI-CONTRATO.md', import.meta.url)
    const md = contratoMarkdown()
    if (process.env.ATUALIZAR_CONTRATO === '1') writeFileSync(file, md)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(md)
  })
})
