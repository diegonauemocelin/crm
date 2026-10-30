import { describe, expect, it } from 'vitest'
import { MODULE_KEYS } from '../src/common/permissions'
import { FREIGHT_ROLES, roleRows } from '../src/fretes/perfis'

describe('perfis prontos de fretes', () => {
  it('usam só módulos que existem e nomes diferentes', () => {
    const names = FREIGHT_ROLES.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    for (const r of FREIGHT_ROLES) for (const g of r.grants) expect(MODULE_KEYS as readonly string[]).toContain(g.module)
  })

  it('operador fica nas filiais dele e não decide conciliação nem paga fatura', () => {
    const op = roleRows(FREIGHT_ROLES.find((r) => r.name === 'Operador de expedição')!)
    expect(op.filter((p) => p.module.startsWith('fretes_')).every((p) => p.scope === 'UNIT')).toBe(true)
    expect(op.find((p) => p.module === 'fretes_cte')).toMatchObject({ canCreate: true, canEdit: false })
    expect(op.find((p) => p.module === 'fretes_financeiro')).toBeUndefined()
    expect(op.find((p) => p.module === 'dashboard')?.scope).toBe('ALL')
  })

  it('financeiro decide CT-e e paga fatura em todas as filiais, sem mexer em tabelas', () => {
    const fin = roleRows(FREIGHT_ROLES.find((r) => r.name === 'Financeiro de fretes')!)
    expect(fin.find((p) => p.module === 'fretes_cte')).toMatchObject({ canEdit: true, scope: 'ALL' })
    expect(fin.find((p) => p.module === 'fretes_financeiro')).toMatchObject({ canCreate: true, canEdit: true })
    expect(fin.find((p) => p.module === 'fretes_tabelas')).toMatchObject({ canView: true, canEdit: false })
  })
})
