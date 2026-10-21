import { describe, expect, it } from 'vitest'
import { accountKey, adLibraryUrl, cleanCompetitors, cleanIgAccounts, cleanUsername, formLeads, instagramPaid, onlinePeaks, postTimes, profileStats, recommendTimes } from '../src/marketing/instagram'
import { metaThumb, parseCompetitor, parseDemographics, parseFbPost, parseIgMedia, parseOnlineFollowers, parseTotalValues } from '../src/marketing/sync'

describe('Instagram: leitura da API', () => {
  it('totais do dia, com quebra (seguir/deixar de seguir e navegação dos stories)', () => {
    const r = parseTotalValues([
      { name: 'accounts_engaged', total_value: { value: 120 } },
      { name: 'total_interactions', total_value: { value: '340' } },
      { name: 'follows_and_unfollows', total_value: { breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 12 }, { dimension_values: ['NON_FOLLOWER'], value: 3 }] }] } },
    ])
    expect(r).toMatchObject({ accounts_engaged: 120, total_interactions: 340, follower: 12, non_follower: 3 })
    const story = parseIgMedia({ id: '9001', timestamp: '2026-10-20T13:00:00+0000', media_type: 'IMAGE', media_product_type: 'STORY' }, { reach: 500, replies: 4, ...parseTotalValues([{ name: 'navigation', total_value: { value: 600, breakdowns: [{ results: [{ dimension_values: ['tap_forward'], value: 300 }, { dimension_values: ['tap_exit'], value: 50 }] }] } }]) })
    expect(story).toMatchObject({ format: 'Story', reach: 500, extra: { replies: 4, tapsForward: 300, exits: 50 } })
  })

  it('público por cidade e horas online em horário de Brasília', () => {
    expect(parseDemographics([{ total_value: { breakdowns: [{ results: [{ dimension_values: ['Chapecó, Santa Catarina'], value: 80 }, { dimension_values: ['Cascavel, Paraná'], value: 120 }] }] } }])).toEqual([
      { key: 'Cascavel, Paraná', value: 120 },
      { key: 'Chapecó, Santa Catarina', value: 80 },
    ])
    // Dia que termina 2026-10-20T07:00Z (meia-noite no Pacífico, PDT): hora 0 do Pacífico = 04h de Brasília de 19/10 (segunda).
    const hours = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h === 15 ? 900 : 100]))
    const m = parseOnlineFollowers([{ values: [{ end_time: '2026-10-20T07:00:00+0000', value: hours }] }])!
    expect(m[1]![4]).toBe(100)
    // 15h no Pacífico (PDT, UTC-7) = 22h UTC = 19h de Brasília.
    expect(m[1]![19]).toBe(900)
    expect(parseOnlineFollowers([])).toBeNull()
  })

  it('concorrente: perfil público e publicações (curtida oculta fica nula)', () => {
    const c = parseCompetitor({
      business_discovery: {
        username: 'Concorrente.Pecas',
        name: 'Concorrente Peças',
        followers_count: 5000,
        media_count: 800,
        media: { data: [{ id: '1', timestamp: '2026-10-19T12:00:00+0000', media_type: 'IMAGE', like_count: 50, comments_count: 5, permalink: 'https://www.instagram.com/p/x/' }, { id: '2', timestamp: '2026-10-18T12:00:00+0000', media_type: 'VIDEO', media_product_type: 'REELS', comments_count: 2 }] },
      },
    })!
    expect(c).toMatchObject({ username: 'concorrente.pecas', followers: 5000, mediaCount: 800 })
    expect(c.posts.map((p) => [p.format, p.likes])).toEqual([['Imagem', 50], ['Reels', null]])
    expect(parseCompetitor({ error: {} })).toBeNull()
  })
})

describe('Instagram: perfis da empresa', () => {
  it('conectado (id) ou só público (@), sem repetir nem o oficial; vendedor só com id válido', () => {
    const list = cleanIgAccounts(
      [
        { id: '17841400000555', username: '@joao', label: 'João', owner: 'vendedor', sellerId: '2295fa4d-ae06-40e9-aea2-f8a169dcbf5b' },
        { username: 'https://instagram.com/maria.pecas', owner: 'vendedor', sellerId: 'x' },
        { id: '333' }, // curto demais: nem id nem @
        { id: '17841400000999' }, // é o oficial
        { username: '@MARIA.pecas' }, // repetido
      ],
      '17841400000999',
    )
    expect(list).toEqual([
      { id: '17841400000555', username: 'joao', label: 'João', owner: 'vendedor', sellerId: '2295fa4d-ae06-40e9-aea2-f8a169dcbf5b' },
      { id: '', username: 'maria.pecas', label: '@maria.pecas', owner: 'vendedor', sellerId: null },
    ])
    expect(list.map(accountKey)).toEqual(['17841400000555', '@maria.pecas'])
  })
})

describe('Miniaturas das publicações', () => {
  it('só imagens da Meta; vídeo usa a capa (thumbnail_url)', () => {
    const cdn = 'https://scontent.cdninstagram.com/v/t51/abc.jpg?x=1'
    expect(metaThumb(cdn)).toBe(cdn)
    expect(metaThumb('https://example.com/a.jpg')).toBeNull()
    expect(metaThumb('http://scontent.cdninstagram.com/a.jpg')).toBeNull()
    const img = parseIgMedia({ id: '1', timestamp: '2026-10-20T12:00:00+0000', media_type: 'IMAGE', media_url: cdn }, {})!
    expect(img.extra).toEqual({ thumb: cdn })
    const reel = parseIgMedia({ id: '2', timestamp: '2026-10-20T12:00:00+0000', media_type: 'VIDEO', media_product_type: 'REELS', media_url: 'https://video.cdninstagram.com/v.mp4', thumbnail_url: cdn }, { total_interactions: 9 })!
    expect(reel.extra).toEqual({ interactions: 9, thumb: cdn })
    const fb = parseFbPost({ id: '222_1', created_time: '2026-10-20T12:00:00+0000', full_picture: 'https://scontent.xx.fbcdn.net/p.jpg' })!
    expect(fb.extra).toEqual({ thumb: 'https://scontent.xx.fbcdn.net/p.jpg' })
  })
})

describe('Instagram: concorrentes', () => {
  it('limpa @, link e nome; até 10, sem repetir', () => {
    expect(cleanUsername('@Usaparts')).toBe('usaparts')
    expect(cleanUsername('https://www.instagram.com/concorrente_1/?hl=pt')).toBe('concorrente_1')
    expect(cleanUsername('nome com espaço')).toBeNull()
    expect(cleanCompetitors([{ username: '@a' }, { username: 'A' }, { username: 'b', label: ' Loja B ' }])).toEqual([{ username: 'a', label: '' }, { username: 'b', label: 'Loja B' }])
    expect(cleanCompetitors(Array.from({ length: 15 }, (_, i) => ({ username: `c${i}` })))).toHaveLength(10)
    expect(adLibraryUrl({ username: 'b', label: 'Loja B' })).toContain('q=Loja%20B')
  })

  it('mesmo cálculo para todos: engajamento por publicação, feed x reels e o que a equipe registrou', () => {
    const d = (s: string) => new Date(`${s}T15:00:00Z`)
    const s = profileStats({
      username: 'b',
      name: 'Loja B',
      own: false,
      days: [{ username: 'b', date: d('2026-10-01'), name: 'Loja B', followers: 1000, mediaCount: 10 }, { username: 'b', date: d('2026-10-14'), name: 'Loja B', followers: 1100, mediaCount: 14 }],
      posts: [
        { username: 'b', publishedAt: d('2026-10-02'), format: 'Imagem', likes: 40, comments: 10, permalink: null, caption: 'a' },
        { username: 'b', publishedAt: d('2026-10-05'), format: 'Reels', likes: 100, comments: 10, permalink: null, caption: 'b' },
        { username: 'b', publishedAt: d('2026-10-06'), format: 'Carrossel', likes: null, comments: 3, permalink: null, caption: 'c' },
      ],
      notes: [
        { username: 'b', date: d('2026-10-03'), storiesSeen: 4, adsActive: null },
        { username: 'b', date: d('2026-10-04'), storiesSeen: 0, adsActive: true },
      ],
      from: '2026-10-01',
      to: '2026-10-14',
      periodDays: 14,
    })
    expect(s).toMatchObject({ followers: 1100, followersGrowth: 100, feedPosts: 2, reels: 1, postsPerWeek: 1.5, avgLikes: 70, hiddenLikes: 1, storiesDaysSeen: 1, storiesAvg: 2, adsActive: true })
    // (40+10 + 100+10) / 2 publicações com curtida = 80 ÷ 1.100 seguidores
    expect(s.engagementRate).toBe(7.27)
  })
})

describe('Instagram: horários, tráfego pago e leads', () => {
  it('melhor faixa pelas publicações e pico do público online', () => {
    const at = (iso: string, reach: number) => ({ publishedAt: new Date(iso), format: 'Imagem', reach, likes: 10, comments: 1, shares: 0, saves: 0 })
    // 21h UTC = 18h de Brasília (terça, 2026-10-20)
    const t = postTimes([at('2026-10-20T21:00:00Z', 900), at('2026-10-13T21:30:00Z', 1100), at('2026-10-14T12:00:00Z', 300), at('2026-10-21T12:00:00Z', 200), { ...at('2026-10-20T21:00:00Z', 5000), format: 'Story' }])
    expect(t.best[0]).toMatchObject({ label: 'Terça, 18h–21h', posts: 2, avgReach: 1000 })
    const online = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, h) => (h === 19 ? 500 : h === 12 ? 400 : h === 8 ? 300 : 10)))
    const peaks = onlinePeaks(online)!
    expect(peaks.peaks.map((p) => p.hour)).toEqual([8, 12, 19])
    expect(recommendTimes(peaks, t.best)[0]).toContain('07h–08h')
    expect(onlinePeaks(null)).toBeNull()
  })

  it('só o que a Meta entregou no Instagram, por posicionamento', () => {
    const r = instagramPaid(
      [
        { key: 'instagram · instagram_reels', spend: 100, impressions: 10000, clicks: 200, leads: 4 },
        { key: 'instagram · feed', spend: 50, impressions: 5000, clicks: 50, leads: 1 },
        { key: 'facebook · feed', spend: 150, impressions: 9000, clicks: 90, leads: 3 },
      ],
      300,
    )
    expect(r.positions.map((p) => p.label)).toEqual(['Reels', 'Feed'])
    expect(r.totals).toMatchObject({ spend: 150, leads: 5, cpl: 30, shareOfMeta: 50 })
  })

  it('lead só de formulário: pago x orgânico e venda do mesmo lead depois da conversão', () => {
    const at = new Date('2026-10-10T12:00:00Z')
    const r = formLeads(
      [
        { leadId: 'a', at, medium: 'cpc', form: 'Lead Ads' },
        { leadId: 'a', at: new Date('2026-10-11T12:00:00Z'), medium: 'social', form: 'Formulário do site' },
        { leadId: 'b', at, medium: 'social', form: 'Formulário do site' },
      ],
      [
        { leadId: 'a', leadAt: new Date('2026-10-10T12:05:00Z'), forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 1500 },
        // venda antes da conversão não conta
        { leadId: 'b', leadAt: new Date('2026-09-01T12:00:00Z'), forwarded: true, returnStatus: 'SIM', saleStatus: 'SIM', saleValue: 900 },
      ],
      'repassado_retorno',
    )
    expect(r).toMatchObject({ leads: 2, paid: 1, organic: 1, qualified: 1, sales: 1, revenue: 1500, conversionRate: 50 })
  })
})
