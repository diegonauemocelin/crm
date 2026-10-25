import { describe, expect, it } from 'vitest'
import { MetaPublisher, metaMessage } from '../src/postagens/meta'
import { type Account, cleanAccounts, cleanPost, detectPostFile, engagementRate, groupTotals, jpegSize, missingForApproval, parsePlan, pendingAccounts } from '../src/postagens/postagens'

const img = (id: string, w = 1080, h = 1080) => ({ id, kind: 'imagem' as const, width: w, height: h })
const vid = (id: string) => ({ id, kind: 'video' as const, width: null, height: null })
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const ACC: Account[] = [
  { id: 'ig-1', network: 'instagram', externalId: '17841400001', name: '@usaparts', group: 'Oficial' },
  { id: 'ig-2', network: 'instagram', externalId: '17841400002', name: '@vendedor.joao', group: 'Vendedores' },
  { id: 'fb-1', network: 'facebook', externalId: '1000001', name: 'Usaparts', group: 'Oficial' },
]

describe('postagens: regras', () => {
  it('limpa o rascunho e confere o que falta para aprovação', () => {
    const c = cleanPost({ caption: 'Filtros Komatsu em estoque #filtros', accountIds: ['ig-1', 'ig-2', 'outra'], format: 'FEED', mediaIds: [U1, 'lixo'] }, ACC)
    if ('error' in c) throw new Error(c.error)
    expect(c.accountIds).toEqual(['ig-1', 'ig-2'])
    expect(c.networks).toEqual(['instagram'])
    expect(c.mediaIds).toEqual([U1])
    expect(c.title).toBe('Filtros Komatsu em estoque #filtros')
    expect(missingForApproval(c, [img(U1)])).toEqual([])
    expect(missingForApproval({ ...c, accountIds: [], networks: [] }, [])).toEqual(expect.arrayContaining(['Escolha em quais contas publicar.', 'Escolha a imagem ou o vídeo.']))
  })

  it('formatos: Reels só com vídeo, Stories com uma mídia, feed do Instagram entre 4:5 e 1,91:1', () => {
    const base = { title: 't', caption: 'Legenda', accountIds: ['ig-1'], networks: ['instagram' as const], scheduledAt: null, mediaIds: [] }
    expect(missingForApproval({ ...base, format: 'REELS' }, [img(U1)])).toContain('Reels: escolha um vídeo (só um).')
    expect(missingForApproval({ ...base, format: 'STORIES' }, [img(U1), img(U2)])).toContain('Stories: uma imagem ou um vídeo por postagem.')
    expect(missingForApproval({ ...base, format: 'FEED' }, [img(U1, 1080, 1920)])[0]).toMatch(/4:5/)
    expect(missingForApproval({ ...base, format: 'FEED' }, [img(U1, 1080, 1350)])).toEqual([])
    expect(missingForApproval({ ...base, format: 'FEED' }, [vid(U1), img(U2)])).toContain('Feed: vídeo vai sozinho (o carrossel é só de imagens).')
    expect(missingForApproval({ ...base, format: 'STORIES', caption: '' }, [vid(U1)])).toEqual([])
  })

  it('data que já passou e legenda longa são recusadas', () => {
    expect(cleanPost({ caption: 'x'.repeat(2201) }, ACC)).toEqual({ error: expect.stringMatching(/2200/) })
    const c = cleanPost({ caption: 'Oi', accountIds: ['fb-1'], scheduledAt: '2020-01-01T10:00:00Z', mediaIds: [U1] }, ACC)
    if ('error' in c) throw new Error(c.error)
    expect(missingForApproval(c, [img(U1)]).join()).toMatch(/já passou/)
  })

  it('nova tentativa só nas contas que faltaram', () => {
    expect(pendingAccounts(['ig-1', 'ig-2', 'fb-1'], { 'ig-1': { id: '1' }, 'ig-2': { error: 'x' } })).toEqual(['ig-2', 'fb-1'])
  })

  it('contas: limpa a lista, cria o código e põe no grupo', () => {
    expect(cleanAccounts([{ network: 'instagram', externalId: '17841400009', name: '@vendedora', group: 'Vendedores' }, { network: 'instagram', externalId: '17841400009', name: 'repetida' }])).toEqual([
      { id: 'ig-17841400009', network: 'instagram', externalId: '17841400009', name: '@vendedora', group: 'Vendedores' },
    ])
    expect(cleanAccounts([{ network: 'tiktok', externalId: '123456', name: 'x' }])).toEqual({ error: expect.stringMatching(/Instagram ou Facebook/) })
    expect(cleanAccounts([{ network: 'facebook', externalId: 'abc', name: 'x' }])).toEqual({ error: expect.stringMatching(/ID inválido/) })
  })

  it('métricas: engajamento e soma por grupo', () => {
    expect(engagementRate({ followers: 1000, reach: 2000, interactions: 50 })).toBe(2.5)
    expect(engagementRate({ followers: 1000, reach: null, interactions: 30 })).toBe(3)
    const g = groupTotals([
      { group: 'Vendedores', followers: 300, reach: 1000, interactions: 50 },
      { group: 'Oficial', followers: 5000, reach: 20000, interactions: 400 },
      { group: 'Vendedores', followers: 200, reach: null, interactions: 10 },
    ])
    expect(g).toEqual([
      { group: 'Oficial', accounts: 1, followers: 5000, reach: 20000, interactions: 400, engagement: 2 },
      { group: 'Vendedores', accounts: 2, followers: 500, reach: 1000, interactions: 60, engagement: 6 },
    ])
  })

  it('lê o calendário da IA: só dentro do período e nos formatos pedidos', () => {
    const raw = 'Claro! {"posts":[{"date":"2026-11-03","time":"09:00","format":"FEED","title":"Filtros","caption":"Legenda 1 #filtros","imageIdea":"filtro"},{"date":"2026-12-25","time":"09:00","format":"FEED","title":"Fora","caption":"x"},{"date":"2026-11-04","time":"25:00","format":"STORIES","title":"S","caption":"Story"},{"date":"2026-11-05","time":"10:00","format":"REELS","title":"R","caption":"Reel"}]}'
    const items = parsePlan(raw, { from: '2026-11-01', to: '2026-11-30', perWeek: 3, themes: '', networks: ['instagram'], formats: ['FEED', 'STORIES'], times: ['12:00'] })
    expect(items.map((i) => [i.date, i.time, i.format])).toEqual([
      ['2026-11-03', '09:00', 'FEED'],
      ['2026-11-04', '12:00', 'STORIES'],
    ])
  })

  it('confere o arquivo pelos bytes e lê o tamanho do JPEG', () => {
    // JPEG mínimo: SOI + SOF0 com altura 1350 e largura 1080.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x04, 0x38, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
    expect(detectPostFile(jpeg)?.kind).toBe('imagem')
    expect(jpegSize(jpeg)).toEqual({ width: 1080, height: 1350 })
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)])
    expect(detectPostFile(mp4)).toEqual({ kind: 'video', mime: 'video/mp4', ext: 'mp4' })
    expect(detectPostFile(Buffer.from('\x89PNG\r\n\x1a\n'))).toBeNull()
  })
})

/** Graph API de mentira: responde pela rota e guarda as chamadas. */
function fakeGraph(routes: Record<string, (params: URLSearchParams) => unknown>) {
  const calls: string[] = []
  const fetcher = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const params = init?.method === 'POST' ? new URLSearchParams(String(init.body ?? '')) : u.searchParams
    const path = u.pathname.replace(/^\/v[\d.]+\//, '')
    calls.push(`${init?.method ?? 'GET'} ${path}${params.get('media_type') ? ` ${params.get('media_type')}` : ''}`)
    const key = Object.keys(routes).find((k) => k === `${init?.method ?? 'GET'} ${path}`)
    const body = key ? routes[key]!(params) : { error: { message: `rota ${path}`, code: 100 } }
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 })
  }
  return { calls, fetcher }
}

describe('postagens: publicação na Meta', () => {
  it('Instagram: carrossel cria os itens, o álbum e publica', async () => {
    let n = 0
    const g = fakeGraph({
      'POST ig/media': (p) => ({ id: p.get('media_type') === 'CAROUSEL' ? 'album' : `item${++n}` }),
      'GET album': () => ({ status_code: 'FINISHED' }),
      'POST ig/media_publish': (p) => ({ id: `pub-${p.get('creation_id')}` }),
      'GET pub-album': () => ({ permalink: 'https://instagram.com/p/x' }),
    })
    const r = await new MetaPublisher('tk', g.fetcher, 1).instagram('ig', { format: 'FEED', caption: 'Oi', media: [{ kind: 'imagem', url: 'https://crm/a' }, { kind: 'imagem', url: 'https://crm/b' }] })
    expect(r).toMatchObject({ id: 'pub-album', permalink: 'https://instagram.com/p/x' })
    expect(g.calls).toEqual(['POST ig/media', 'POST ig/media', 'POST ig/media CAROUSEL', 'GET album', 'POST ig/media_publish', 'GET pub-album'])
  })

  it('Instagram: Reels espera o vídeo ficar pronto', async () => {
    let polls = 0
    const g = fakeGraph({
      'POST ig/media': () => ({ id: 'c1' }),
      'GET c1': () => ({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' }),
      'POST ig/media_publish': () => ({ id: 'm1' }),
      'GET m1': () => ({ permalink: null }),
    })
    await new MetaPublisher('tk', g.fetcher, 1).instagram('ig', { format: 'REELS', caption: 'Vídeo', media: [{ kind: 'video', url: 'https://crm/v' }] })
    expect(polls).toBe(3)
    expect(g.calls[0]).toBe('POST ig/media REELS')
  })

  it('Facebook: Stories de foto sobe a foto sem publicar e cria o story', async () => {
    const g = fakeGraph({
      'GET page': () => ({ access_token: 'pt' }),
      'POST page/photos': (p) => ({ id: p.get('published') === 'false' ? 'ph1' : 'x' }),
      'POST page/photo_stories': () => ({ post_id: 'st1' }),
      'GET st1': () => ({ permalink_url: 'https://facebook.com/st1' }),
    })
    const r = await new MetaPublisher('tk', g.fetcher, 1).facebook('page', { format: 'STORIES', caption: '', media: [{ kind: 'imagem', url: 'https://crm/a' }] })
    expect(r.id).toBe('st1')
    expect(g.calls).toEqual(['GET page', 'POST page/photos', 'POST page/photo_stories', 'GET st1'])
  })

  it('Instagram: métricas da conta e perfil dos seguidores', async () => {
    const g = fakeGraph({
      'GET ig': () => ({ followers_count: 1200, media_count: 80 }),
      'GET ig/insights': () => ({}),
    })
    // A rota de insights responde conforme a métrica pedida.
    const fetcher = async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      if (u.pathname.endsWith('/ig/insights')) {
        if (u.searchParams.get('metric') === 'follower_demographics') {
          const b = u.searchParams.get('breakdown')
          const results = b === 'gender' ? [{ dimension_values: ['M'], value: 900 }, { dimension_values: ['F'], value: 300 }] : [{ dimension_values: [b === 'age' ? '25-34' : 'Maravilha'], value: 400 }]
          return new Response(JSON.stringify({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ results }] } }] }))
        }
        return new Response(JSON.stringify({ data: [{ name: 'reach', total_value: { value: 5000 } }, { name: 'total_interactions', total_value: { value: 150 } }] }))
      }
      return g.fetcher(url, init)
    }
    const m = await new MetaPublisher('tk', fetcher, 1).instagramMetrics('ig')
    expect(m).toMatchObject({ followers: 1200, posts: 80, reach: 5000, interactions: 150, likes: null })
    expect(m.demographics?.gender).toEqual([{ key: 'M', value: 900 }, { key: 'F', value: 300 }])
    expect(m.demographics?.city).toEqual([{ key: 'Maravilha', value: 400 }])
  })

  it('erro de permissão vira mensagem com a dica', () => {
    expect(metaMessage(403, { error: { message: '(#10) Application does not have permission', code: 10 } })).toMatch(/instagram_content_publish/)
  })
})
