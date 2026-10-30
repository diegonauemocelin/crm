import { describe, expect, it } from 'vitest'
import { authorizeUrl, cleanCode, IG_GRAPH, igLoginAccounts, InstagramLogin, needsRenewal } from '../src/postagens/instagram-login'
import { MetaPublisher } from '../src/postagens/meta'
import { cleanAccounts } from '../src/postagens/postagens'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Postagens: contas conectadas pelo login do Instagram', () => {
  it('login do Instagram pede usuário e senha de novo e só as permissões de publicar e métricas', () => {
    const u = new URL(authorizeUrl('123456', 'https://crm.exemplo.com/postagens/instagram/retorno', 'abc'))
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(u.searchParams.get('force_authentication')).toBe('1')
    expect(u.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights')
    expect(u.searchParams.get('redirect_uri')).toBe('https://crm.exemplo.com/postagens/instagram/retorno')
    expect(cleanCode('AQBx#_')).toBe('AQBx')
  })

  it('troca o code pelo token de 60 dias e lê o id profissional e o @', async () => {
    const calls: string[] = []
    const login = new InstagramLogin(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).split('?')[0]}`)
      if (String(url).startsWith('https://api.instagram.com')) {
        expect(String(init?.body)).toMatch(/code=AQBx$/)
        return json({ data: [{ access_token: 'curto', user_id: '1', permissions: 'instagram_business_basic' }] })
      }
      if (String(url).includes('/access_token?')) return json({ access_token: 'longo', token_type: 'bearer', expires_in: 5_184_000 })
      expect(String(url)).toContain('access_token=longo')
      return json({ user_id: '17841400000000001', username: 'usaparts', account_type: 'BUSINESS' })
    })
    const r = await login.connect({ appId: '123456', secret: 's' }, 'AQBx#_', 'https://crm/retorno')
    expect(r).toMatchObject({ userId: '17841400000000001', username: 'usaparts', accountType: 'BUSINESS', token: 'longo' })
    expect(Date.parse(r.expiresAt) - Date.now()).toBeGreaterThan(59 * 86_400_000)
    expect(calls).toEqual(['POST https://api.instagram.com/oauth/access_token', 'GET https://graph.instagram.com/access_token', `GET ${IG_GRAPH}/me`])
  })

  it('erro do Instagram vira mensagem para refazer a conexão', async () => {
    const login = new InstagramLogin(async () => json({ error: { message: 'Error validating access token: Session has expired', code: 190 } }, 400))
    await expect(login.refresh('x')).rejects.toThrow(/conecte a conta de novo/)
  })

  it('renova só perto de vencer e depois de 24 h de criado', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    const day = 86_400_000
    expect(needsRenewal({ expiresAt: new Date(now + 10 * day).toISOString(), issuedAt: new Date(now - 50 * day).toISOString() }, now)).toBe(true)
    expect(needsRenewal({ expiresAt: new Date(now + 40 * day).toISOString(), issuedAt: new Date(now - 20 * day).toISOString() }, now)).toBe(false)
    expect(needsRenewal({ expiresAt: new Date(now + 10 * day).toISOString(), issuedAt: new Date(now - 3_600_000).toISOString() }, now)).toBe(false)
  })

  it('publica pela API do Instagram com o token da conta', async () => {
    const urls: string[] = []
    const meta = new MetaPublisher(
      'tok-ig',
      async (url, init) => {
        urls.push(`${init?.method} ${String(url).split('?')[0]}`)
        if (init?.method === 'POST') expect(String(init.body)).toContain('access_token=tok-ig')
        else expect(String(url)).toContain('access_token=tok-ig')
        if (String(url).includes('/media_publish')) return json({ id: 'M1' })
        if (String(url).includes('/media')) return json({ id: 'C1' })
        if (String(url).includes('/C1')) return json({ status_code: 'FINISHED' })
        return json({ permalink: 'https://www.instagram.com/p/x' })
      },
      1,
      IG_GRAPH,
    )
    const r = await meta.instagram('178', { format: 'REELS', caption: 'Novo', media: [{ kind: 'video', url: 'https://crm/v.mp4' }] })
    expect(r).toMatchObject({ id: 'M1', permalink: 'https://www.instagram.com/p/x' })
    expect(urls[0]).toBe(`POST ${IG_GRAPH}/178/media`)
  })

  it('lista de contas guarda a marca de conectada pelo Instagram (só no Instagram)', () => {
    const r = cleanAccounts([
      { network: 'instagram', externalId: '17841400000000001', name: '@usaparts', group: 'Oficial', via: 'instagram' },
      { network: 'facebook', externalId: '1234567', name: 'Página', via: 'instagram' },
    ])
    expect(Array.isArray(r) && r.map((a) => a.via)).toEqual(['instagram', undefined])
  })

  it('Marketing Inteligente analisa as contas conectadas pelo login com acesso válido', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    const tok = (exp: string) => ({ tokenEnc: 'x', username: 'loja', expiresAt: exp, issuedAt: '2026-10-01T00:00:00Z', connectedBy: 'Ana', lastError: null })
    const list = igLoginAccounts(
      [
        { network: 'instagram', externalId: '1', name: '@loja', via: 'instagram' },
        { network: 'instagram', externalId: '2', name: '@vencida', via: 'instagram' },
        { network: 'instagram', externalId: '3', name: 'Instagram' },
      ],
      { '1': tok('2026-12-01T00:00:00Z'), '2': tok('2026-10-01T00:00:00Z'), '3': tok('2026-12-01T00:00:00Z') },
      now,
    )
    expect(list).toEqual([{ id: '1', username: 'loja', tokenEnc: 'x' }])
  })
})
