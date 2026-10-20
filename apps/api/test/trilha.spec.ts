import { describe, expect, it } from 'vitest'
import { MODULE_KEYS } from '../src/common/permissions'
import { ALL_LESSONS, TRAIL, trailFor, trailForRoute } from '../../web/src/lib/trilha'

describe('trilha de conhecimento', () => {
  it('ids das lições únicos e aceitos pelo servidor (o progresso é guardado por id)', () => {
    const ids = ALL_LESSONS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9_.-]{1,59}$/)
    for (const l of ALL_LESSONS) expect(l.steps.length).toBeGreaterThan(0)
  })

  it('cada tela da trilha segue uma permissão que existe', () => {
    for (const m of TRAIL) if (m.module) expect(MODULE_KEYS as readonly string[]).toContain(m.module)
  })

  it('mostra só o que o perfil usa e acha a ajuda da tela aberta', () => {
    const vendedor = (mod: string) => ['chat', 'pre_vendas', 'consulta_produtos'].includes(mod)
    const keys = trailFor(vendedor).map((m) => m.key)
    expect(keys).toContain('chat')
    expect(keys).not.toContain('admin')
    expect(keys).toContain('primeiros-passos')
    expect(trailForRoute('/chat', '', vendedor)?.key).toBe('chat')
    expect(trailForRoute('/chat', '?monitorar=1', () => true)?.key).toBe('monitoramento')
    expect(trailForRoute('/leads/123', '', () => true)?.key).toBe('leads')
    expect(trailForRoute('/whatsapp/dashboard', '', () => true)?.key).toBe('whatsapp-dash')
    expect(trailForRoute('/nada', '', () => true)).toBeNull()
  })
})

describe('trilha completa e com as imagens', () => {
  it('toda tela do sistema tem ajuda na trilha', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(new URL('../../web/src/App.tsx', import.meta.url), 'utf8')
    // Telas públicas (login, descadastro) e a própria trilha não precisam de lição.
    const fora = new Set(['*', 'trilha'])
    const rotas = [...app.matchAll(/path: '([^']+)'/g)].map((m) => m[1]!).filter((r) => !r.startsWith('/') && !fora.has(r))
    const semAjuda = rotas.filter((r) => !trailForRoute(`/${r.replace(/:[a-z]+/g, 'x')}`, '', () => true))
    // Endereços antigos que só redirecionam para Configurações.
    const redirecionam = [...app.matchAll(/path: '([^']+)', element: <Navigate/g)].map((m) => m[1])
    expect(semAjuda.filter((r) => !redirecionam.includes(r))).toEqual([])
  })

  it('cada seção de Configurações tem lição', async () => {
    const { readFileSync } = await import('node:fs')
    const cfg = readFileSync(new URL('../../web/src/pages/configuracoes-page.tsx', import.meta.url), 'utf8')
    const secoes = [...cfg.matchAll(/^\s+(?:\{ )?id: '([a-z0-9-]+)'/gm)].map((m) => m[1]!)
    expect(secoes.length).toBeGreaterThan(10)
    // Cada seção cai num módulo da trilha (o mais específico ou a Administração).
    for (const s of secoes) expect(trailForRoute('/configuracoes', `?secao=${s}`, () => true)).not.toBeNull()
  })

  it('as imagens e vídeos citados existem', async () => {
    const { existsSync } = await import('node:fs')
    const medias = [...TRAIL.flatMap((m) => (m.media ? [m.media] : [])), ...ALL_LESSONS.flatMap((l) => (l.media ? [l.media] : []))]
    expect(medias.length).toBeGreaterThan(15)
    for (const md of medias) expect(existsSync(new URL(`../../web/public${md.src}`, import.meta.url)), md.src).toBe(true)
  })
})
