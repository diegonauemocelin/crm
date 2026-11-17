import { describe, expect, it } from 'vitest'
import { cleanFiliais, dddOf, DEFAULT_FILIAIS, filialOf } from '../src/whatsapp/filiais'

describe('filial sugerida pelo DDD', () => {
  it('acha o DDD do telefone brasileiro', () => {
    expect(dddOf('+5545999887766')).toBe('45')
    expect(dddOf('554532221100')).toBe('45')
    expect(dddOf('+14155550100')).toBeNull()
    expect(dddOf(null)).toBeNull()
  })

  it('regras iniciais: PR Cascavel, RS Cachoeirinha, 47/48 Itajaí, 49 Matriz', () => {
    expect(filialOf('+5541988887777', DEFAULT_FILIAIS)?.name).toBe('Filial Cascavel')
    expect(filialOf('+5546988887777', DEFAULT_FILIAIS)?.name).toBe('Filial Cascavel')
    expect(filialOf('+5551988887777', DEFAULT_FILIAIS)?.name).toBe('Filial Cachoeirinha')
    expect(filialOf('+5547988887777', DEFAULT_FILIAIS)?.name).toBe('Filial Itajaí')
    expect(filialOf('+5548988887777', DEFAULT_FILIAIS)?.name).toBe('Filial Itajaí')
    expect(filialOf('+5549988887777', DEFAULT_FILIAIS)?.name).toBe('Matriz Maravilha')
    expect(filialOf('+5511988887777', DEFAULT_FILIAIS)).toBeNull()
  })

  it('limpa as regras: nome obrigatório, DDD válido, sem repetir entre filiais', () => {
    const r = cleanFiliais([
      { name: ' Cascavel ', ddds: '41, 42 ,99x, 10, 4', color: 'verde' },
      { name: 'Outra', ddds: ['42', '43'], color: 'nada' },
      { name: '', ddds: ['44'] },
    ])
    expect(r).toEqual([
      { name: 'Cascavel', ddds: ['41', '42', '99'], color: 'verde' },
      { name: 'Outra', ddds: ['43'], color: 'verde' },
    ])
    expect(cleanFiliais('x')).toEqual([])
  })
})
