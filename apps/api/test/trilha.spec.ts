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
