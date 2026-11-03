import { describe, expect, it } from 'vitest'
import { allowedUnits, assertUnit, assertUnitList, unitListWhere } from '../src/fretes/acesso'
import { DEFAULT_COMPONENTS } from '../src/fretes/catalogo'
import { validateComponents, validateSettings, validity } from '../src/fretes/tabelas.service'

const perm = (scope: string) => ({ view: true, create: true, edit: true, delete: false, export: false, scope })
const who = (scope: string, unitId: string | null, extra: string[] = [], isSystem = false) =>
  ({ id: 'u', tenantId: 't', unitId, extraUnitIds: extra, role: { isSystem }, permissions: { fretes_tabelas: perm(scope), fretes_cotacao: perm(scope) } }) as never

describe('fretes: acesso por filial', () => {
  it('escopo "todos" vê todas; "da unidade" vê a própria e as extras', () => {
    expect(allowedUnits(who('ALL', 'a'), 'fretes_cotacao')).toBeNull()
    expect(allowedUnits(who('UNIT', 'a', ['b', 'a']), 'fretes_cotacao')).toEqual(['a', 'b'])
    expect(allowedUnits(who('OWN', null), 'fretes_cotacao')).toEqual([])
    expect(allowedUnits(who('UNIT', 'a', [], true), 'fretes_cotacao')).toBeNull()
    expect(() => assertUnit(who('UNIT', 'a'), 'fretes_cotacao', 'c')).toThrow(/filial/)
    expect(unitListWhere(['a'])).toEqual({ OR: [{ unitIds: { isEmpty: true } }, { unitIds: { hasSome: ['a'] } }] })
  })

  it('tabela de todas as filiais só muda com visão global', () => {
    expect(() => assertUnitList(who('UNIT', 'a'), 'fretes_tabelas', [])).toThrow(/todas/)
    expect(() => assertUnitList(who('UNIT', 'a'), 'fretes_tabelas', ['a', 'b'])).toThrow(/não estão liberadas/)
    expect(() => assertUnitList(who('UNIT', 'a', ['b']), 'fretes_tabelas', ['a', 'b'])).not.toThrow()
    expect(() => assertUnitList(who('ALL', null), 'fretes_tabelas', [])).not.toThrow()
  })
})

describe('fretes: componentes e parâmetros', () => {
  it('aceita os componentes padrão e recusa fórmula inválida ou código repetido', () => {
    expect(validateComponents(DEFAULT_COMPONENTS)).toHaveLength(DEFAULT_COMPONENTS.length)
    expect(() => validateComponents([{ ...DEFAULT_COMPONENTS[0]!, formula: 'process.exit()' }])).toThrow(/Fórmula de Frete peso/)
    expect(() => validateComponents([DEFAULT_COMPONENTS[0]!, DEFAULT_COMPONENTS[0]!])).toThrow(/repetido/)
    expect(() => validateComponents([{ ...DEFAULT_COMPONENTS[0]!, code: 'minúsculo' }])).toThrow(/código/)
    expect(() => validateSettings({ icmsRate: 100 })).toThrow(/Alíquota/)
    expect(validateSettings({ cubageFactor: 167 })).toMatchObject({ cubageFactor: 167, icmsMode: 'SOMADO', useCubage: true })
  })

  it('vigência: vigente, vencida e futura', () => {
    const today = new Date('2026-10-26T00:00:00Z')
    expect(validity(new Date('2026-01-01T00:00:00Z'), new Date('2026-11-05T00:00:00Z'), today)).toEqual({ state: 'VIGENTE', days: 10 })
    expect(validity(new Date('2026-01-01T00:00:00Z'), new Date('2026-10-25T00:00:00Z'), today)).toEqual({ state: 'VENCIDA', days: 1 })
    expect(validity(new Date('2026-11-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'), today).state).toBe('FUTURA')
  })
})
