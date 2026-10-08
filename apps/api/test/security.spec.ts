import { describe, expect, it } from 'vitest'
import { redact } from '../src/audit/audit.service'
import { lockDurationMinutes, MAX_FAILED_LOGINS } from '../src/auth/auth.service'
import { passwordProblems } from '../src/auth/password'
import { checkTotp } from '../src/auth/totp'
import { decrypt, encrypt, safeEqual, stableStringify } from '../src/common/crypto'
import { can, fullPermissions, type PermissionSet } from '../src/common/permissions'
import { detectImage } from '../src/files/files.service'
import { isPrivateAddress } from '../src/settings/mail.service'
import { compareSemver } from '../src/system/releases'
import { generate, generateSecret } from 'otplib'

describe('permissões (RBAC)', () => {
  const vendedor: PermissionSet = {
    leads: { view: true, create: false, edit: true, delete: false, export: false, scope: 'OWN' },
  }

  it('libera só as ações marcadas no perfil', () => {
    expect(can(vendedor, false, 'leads', 'view')).toBe(true)
    expect(can(vendedor, false, 'leads', 'edit')).toBe(true)
    expect(can(vendedor, false, 'leads', 'delete')).toBe(false)
    expect(can(vendedor, false, 'leads', 'export')).toBe(false)
  })

  it('nega módulos ausentes do perfil', () => {
    expect(can(vendedor, false, 'usuarios', 'view')).toBe(false)
    expect(can(vendedor, false, 'configuracoes', 'edit')).toBe(false)
    expect(can({}, false, 'auditoria', 'view')).toBe(false)
  })

  it('perfil de sistema (Administrador) tem acesso total', () => {
    expect(can({}, true, 'auditoria', 'delete')).toBe(true)
    expect(Object.values(fullPermissions()).every((p) => p.view && p.delete && p.scope === 'ALL')).toBe(true)
  })
})

describe('bloqueio por tentativas de login', () => {
  it('não bloqueia antes de 5 erros', () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) expect(lockDurationMinutes(i)).toBeNull()
  })

  it('bloqueia de forma progressiva: 15 min, 1 h e depois 4 h', () => {
    expect(lockDurationMinutes(5)).toBe(15)
    expect(lockDurationMinutes(10)).toBe(60)
    expect(lockDurationMinutes(15)).toBe(240)
    expect(lockDurationMinutes(50)).toBe(240)
  })
})

describe('política de senha', () => {
  it('exige ao menos 12 caracteres', () => {
    expect(passwordProblems('curta123')).toMatch(/12 caracteres/)
    expect(passwordProblems('uma frase longa e boa')).toBeNull()
  })

  it('recusa senha que contém o e-mail ou é comum', () => {
    expect(passwordProblems('maria.silva-2026!', 'maria.silva@empresa.com')).toMatch(/e-mail/)
    expect(passwordProblems('xx123456789012xx')).toMatch(/comum/)
    expect(passwordProblems('aaaaaaaaaaaaaaa')).toMatch(/repetido/)
  })
})

describe('2FA (TOTP)', () => {
  it('aceita o código atual e recusa reuso do mesmo período', async () => {
    const secret = generateSecret()
    const code = await generate({ secret })
    const ok = await checkTotp(secret, code, null)
    expect(ok).not.toBeNull()
    expect(await checkTotp(secret, code, ok!.step)).toBeNull()
  })

  it('aceita celular até 90 s adiantado ou atrasado e informa a diferença', async () => {
    const secret = generateSecret()
    const now = Math.floor(Date.now() / 1000)
    for (const offset of [-90, -60, -30, 30, 60, 90]) {
      const r = await checkTotp(secret, await generate({ secret, epoch: now + offset }), null)
      expect(r, `diferença de ${offset} s`).not.toBeNull()
      expect(Math.abs(r!.driftSeconds - offset)).toBeLessThanOrEqual(30)
    }
    expect(await checkTotp(secret, await generate({ secret, epoch: now + 150 }), null)).toBeNull()
  })

  it('recusa formato inválido e código errado', async () => {
    const secret = generateSecret()
    expect(await checkTotp(secret, 'abc123', null)).toBeNull()
    expect(await checkTotp(secret, '1234567', null)).toBeNull()
    const code = await generate({ secret })
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    expect(await checkTotp(secret, wrong, null)).toBeNull()
  })
})

describe('criptografia em repouso', () => {
  it('ida e volta, com IV aleatório a cada chamada', () => {
    const a = encrypt('senha-smtp')
    const b = encrypt('senha-smtp')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('senha-smtp')
  })

  it('detecta adulteração (GCM)', () => {
    const parts = encrypt('segredo').split(':')
    const data = Buffer.from(parts[3]!, 'base64')
    data[0] = data[0]! ^ 0xff
    parts[3] = data.toString('base64')
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('auditoria', () => {
  it('nunca grava senhas, tokens ou segredos', () => {
    const out = redact({ email: 'a@b.com', password: 'x', nested: { refreshToken: 'y', apiKey: 'z', nome: 'ok' }, list: [{ secret: 1 }] }) as Record<string, any>
    expect(out.email).toBe('a@b.com')
    expect(out.password).toBe('[omitido]')
    expect(out.nested.refreshToken).toBe('[omitido]')
    expect(out.nested.apiKey).toBe('[omitido]')
    expect(out.nested.nome).toBe('ok')
    expect(out.list[0].secret).toBe('[omitido]')
  })

  it('serialização estável independe da ordem das chaves (base do hash encadeado)', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  })
})

describe('upload de imagens', () => {
  it('identifica o tipo pelo conteúdo, não pela extensão', () => {
    expect(detectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png')
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg')
  })

  it('recusa SVG e HTML disfarçados de imagem', () => {
    expect(detectImage(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull()
    expect(detectImage(Buffer.from('<html><script>alert(1)</script>'))).toBeNull()
  })
})

describe('proteção contra SSRF no SMTP', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.0.10', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'])(
    'bloqueia endereço interno %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  )

  it.each(['187.45.193.10', '8.8.8.8', '2804:14c::1'])('permite endereço público %s', (ip) => expect(isPrivateAddress(ip)).toBe(false))
})

describe('versões', () => {
  it('compara SemVer corretamente', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0)
  })
})

describe('aparelhos e limite por usuário (Fase 8)', () => {
  it('reconhece navegador e sistema, sem versão', async () => {
    const { deviceOf, maskIp } = await import('../src/auth/dispositivo')
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    const edge = `${chromeWin} Edg/141.0.0.0`
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const android = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'
    expect(deviceOf(chromeWin).label).toBe('Chrome no Windows')
    expect(deviceOf(edge).label).toBe('Edge no Windows')
    expect(deviceOf(iphone).label).toBe('Safari no iPhone')
    expect(deviceOf(android).label).toBe('Samsung Internet no Android')
    // Atualizar o navegador não conta como aparelho novo.
    expect(deviceOf(chromeWin).key).toBe(deviceOf(chromeWin.replace('141.0.0.0', '142.0.0.0')).key)
    expect(deviceOf(null).label).toBe('Aparelho não identificado')
    expect(deviceOf('node').label).toBe('Aparelho não identificado')
    expect(maskIp('::ffff:189.4.77.10')).toBe('189.4.x.x')
    expect(maskIp(null)).toBe('desconhecido')
  })

  it('limite de requisições: usuário de token válido; token falso cai no IP', async () => {
    const { JwtService } = await import('@nestjs/jwt')
    const { UserThrottlerGuard } = await import('../src/common/throttle.guard')
    const jwt = new JwtService({ secret: 'segredo-de-teste-com-mais-de-32-caracteres!!' })
    const guard = Object.create(UserThrottlerGuard.prototype) as InstanceType<typeof UserThrottlerGuard>
    Object.assign(guard, { jwt })
    const tracker = (cookie?: string) => (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker({ ip: '200.1.1.1', cookies: cookie ? { crm_at: cookie } : {} })
    const valid = await jwt.signAsync({ sub: 'u1' }, { algorithm: 'HS256' })
    const forged = await new JwtService({ secret: 'outro-segredo-qualquer-com-mais-de-32-caracteres' }).signAsync({ sub: 'u2' })
    expect(await tracker(valid)).toBe('u:u1')
    expect(await tracker(forged)).toBe('200.1.1.1')
    expect(await tracker()).toBe('200.1.1.1')
  })
})

describe('avisos de segurança por e-mail (Fase 8)', () => {
  const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

  async function make(previousAgents: string[], total = previousAgents.length) {
    const { SecurityService } = await import('../src/auth/security.service')
    const sent: { to: string; subject: string; text: string }[] = []
    const prisma = {
      refreshToken: { findMany: async () => previousAgents.map((userAgent) => ({ userAgent })), count: async () => total },
      user: { findUnique: async () => ({ tenantId: 't', email: 'ana@usaparts.com.br', name: 'Ana', active: true }) },
    }
    const mail = { send: async (_t: string, m: { to: string; subject: string; text: string }) => void sent.push(m), simpleTemplate: () => '<html></html>' }
    const settings = { branding: async () => ({ appName: 'CRM USA Parts', primaryColor: '#1d4ed8' }) }
    return { service: new SecurityService(prisma as never, mail as never, settings as never, {} as never), sent }
  }

  it('aparelho novo só quando o navegador/sistema nunca foi usado (e nunca no primeiro acesso)', async () => {
    expect(await (await make([chrome])).service.isNewDevice('u', ua)).toBe(true)
    expect(await (await make([chrome, ua.replace('131.0', '132.0')])).service.isNewDevice('u', ua)).toBe(false)
    expect(await (await make([], 0)).service.isNewDevice('u', ua)).toBe(false)
    // Último uso há mais de 180 dias: volta a avisar.
    expect(await (await make([], 3)).service.isNewDevice('u', ua)).toBe(true)
  })

  it('e-mail diz o que aconteceu, o aparelho e o IP parcial, e orienta o que fazer', async () => {
    const { service, sent } = await make([chrome])
    service.alert('u', 'novo_dispositivo', { ip: '189.4.77.10', userAgent: ua })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('ana@usaparts.com.br')
    expect(sent[0]!.subject).toBe('Novo acesso à sua conta - CRM USA Parts')
    expect(sent[0]!.text).toContain('Firefox no Linux · IP 189.4.x.x')
    expect(sent[0]!.text).not.toContain('77.10')
    expect(sent[0]!.text).toMatch(/troque a senha/)
  })
})
