import { describe, expect, it } from 'vitest'
import { auditPosts, median, planInsights } from '../src/marketing/ig-analise'
import { beatSheet, checkCaption, hookScore, parseReels } from '../src/postagens/conteudo-ig'

const post = (id: string, reach: number | null, o: Partial<{ format: string; profileId: string | null; day: string; shares: number; saves: number; caption: string }> = {}) => ({
  postId: id,
  profileId: o.profileId === undefined ? 'p1' : o.profileId,
  publishedAt: new Date(`${o.day ?? '2026-10-20'}T15:00:00Z`),
  format: o.format ?? 'Imagem',
  caption: o.caption ?? `Post ${id}`,
  permalink: null,
  reach,
  likes: 1,
  comments: 0,
  shares: o.shares ?? 0,
  saves: o.saves ?? 0,
})

describe('Análise dos posts (contra o normal do próprio perfil)', () => {
  it('mediana', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('múltiplo sobre a mediana dos 90 dias, por perfil: o perfil pequeno não fica sempre embaixo', () => {
    const history = [post('h1', 1000), post('h2', 1000), post('h3', 1000), post('v1', 100, { profileId: 'p2' }), post('v2', 100, { profileId: 'p2' }), post('v3', 100, { profileId: 'p2' })]
    const a = auditPosts([post('a', 2000, { format: 'Reels' }), post('b', 500), post('c', 300, { profileId: 'p2' }), post('s', 9999, { format: 'Story' })], history)
    expect(a.posts.map((p) => [p.postId, p.multiple, p.verdict])).toEqual([
      ['c', 3, 'acima'],
      ['a', 2, 'acima'],
      ['b', 0.5, 'abaixo'],
    ])
    expect(a.posts.some((p) => p.postId === 's')).toBe(false)
    expect(a.byFormat.map((f) => [f.label, f.posts, f.medianMultiple])).toEqual([
      ['Reels', 1, 2],
      ['Imagem', 2, 1.75],
    ])
  })

  it('sem histórico: usa o próprio período; envios e salvamentos por mil alcançados', () => {
    const a = auditPosts([post('a', 1000, { shares: 5, saves: 10 }), post('b', 1000), post('c', 4000, { format: 'Reels', caption: 'Filtro da JS200\nmais texto' })], [])
    expect(a.posts[0]).toMatchObject({ postId: 'c', multiple: 4, verdict: 'acima' })
    expect(a.posts.find((p) => p.postId === 'a')).toMatchObject({ sharesPer1k: 5, savesPer1k: 10 })
    expect(a.findings.join('\n')).toContain('Filtro da JS200')
    expect(planInsights(a, ['Terça, 09h–12h'])).toContain('Horários com mais alcance: Terça, 09h–12h.')
  })

  it('poucos posts: avisa em vez de tirar conclusão', () => {
    const a = auditPosts([post('a', 100)], [])
    expect(a.findings[0]).toMatch(/Poucos posts/)
    expect(planInsights(a, [])).toBe('')
  })
})

describe('Legenda: prévia do feed e conferência', () => {
  it('mostra os 125 caracteres do feed e aponta primeira linha longa, sem gancho e muitas hashtags', () => {
    const long = 'Uma legenda que fala de manutenção de um jeito bem genérico e vai muito além do que o feed mostra antes do mais aparecer na tela'
    const r = checkCaption(`${long}\nChame no WhatsApp e acesse o site.\n#a #b #c #d #e #f`)
    expect(r.truncated).toBe(true)
    expect(r.preview).toHaveLength(125)
    const by = Object.fromEntries(r.checks.map((c) => [c.label, c]))
    expect(by['Primeira linha']!.status).toBe('atencao')
    expect(by['Gancho concreto']!.status).toBe('atencao')
    expect(by['Hashtags']!.detail).toMatch(/6 hashtags/)
    expect(by['Um pedido']!.detail).toMatch(/2 pedidos/)
  })

  it('legenda boa: gancho concreto, 3 hashtags, um pedido e as palavras de busca', () => {
    const r = checkCaption('Filtro de ar da JCB 3C: troque a cada 500 horas.\nVem com o código original.\nChame no WhatsApp.\n#jcb #filtro #retro', ['filtro de ar', 'JCB 3C'])
    expect(r.checks.every((c) => c.status === 'ok')).toBe(true)
  })

  it('cumprimento na abertura e palavra de busca faltando (hashtag não conta)', () => {
    const r = checkCaption('Olá pessoal! Hoje tem novidade. #materialrodante', ['material rodante'])
    const by = Object.fromEntries(r.checks.map((c) => [c.label, c]))
    expect(by['Abertura']!.status).toBe('atencao')
    expect(by['Palavras de busca']!.detail).toMatch(/Faltam: material rodante/)
  })
})

describe('Reels: nota do gancho e tempo das falas', () => {
  it('gancho concreto e curto ganha de cumprimento genérico', () => {
    const good = hookScore('Você está trocando o filtro da JS200 cedo demais?')
    const bad = hookScore('Olá pessoal, hoje eu quero falar um pouco sobre manutenção')
    expect(good.label).toBe('FORTE')
    expect(bad.label).toBe('FRACO')
    expect(bad.dealbreaker).toMatch(/cumprimento/)
    expect(good.score).toBeGreaterThan(bad.score)
  })

  it('tempo de cada fala, abertura longa, fala longa e volta ao começo', () => {
    const s = beatSheet(
      [
        { text: 'Esse filtro da JS200 custou uma máquina parada por três dias inteiros na obra' },
        { text: 'O problema foi uma peça paralela que não vedava direito e deixou passar poeira para o motor durante semanas sem ninguém perceber nada' },
        { text: 'Chame no WhatsApp e peça o filtro certo da JS200' },
      ],
      30,
    )
    expect(s.beats.map((b) => b.tag)).toEqual(['GANCHO', 'MEIO', 'CHAMADA'])
    expect(s.beats[1]!.start).toBe(s.beats[0]!.seconds)
    expect(s.notes.join('\n')).toMatch(/abertura leva/)
    expect(s.notes.join('\n')).toMatch(/Fala 2 leva/)
    expect(s.notes.join('\n')).toMatch(/Volta ao começo/)
  })

  it('lê o JSON da IA', () => {
    const r = parseReels('ok {"ganchos":["A","B","C","D"],"falas":[{"fala":"Um","tela":"1"},"Dois"],"legenda":"L"}')
    expect(r).toEqual({ hooks: ['A', 'B', 'C'], lines: [{ text: 'Um', screen: '1' }, { text: 'Dois', screen: '' }], caption: 'L' })
    expect(parseReels('sem json')).toBeNull()
  })
})
