import { describe, expect, it } from 'vitest'
import { destinoAoEntrar, inicioDoSistema, menuDoSistema, sistemaDoGrupo, sistemasVisiveis } from '../../web/src/lib/sistemas'

const menu = [
  { title: 'Dashboards', items: [{ to: '/' }, { to: '/vendas-ao-vivo' }] },
  { title: 'Atendimento Comercial', items: [{ to: '/pre-vendas' }, { to: '/chat' }] },
  { title: 'Marketplaces', items: [{ to: '/marketplaces' }] },
  { title: 'E-commerce', items: [] },
  { title: 'Sugestões', items: [{ to: '/sugestoes' }] },
  { title: 'Sistema', items: [{ to: '/atualizacoes' }] },
]

describe('visual Por sistema', () => {
  it('mostra só os sistemas com tela liberada, e o menu do sistema com os grupos gerais no fim', () => {
    expect(sistemasVisiveis(menu).map((s) => s.id)).toEqual(['atendimento', 'dashboards', 'marketplaces'])
    expect(menuDoSistema(menu, 'atendimento').map((g) => g.title)).toEqual(['Atendimento Comercial', 'Sugestões', 'Sistema'])
    expect(sistemaDoGrupo('Análise')).toBe('dashboards')
    expect(sistemaDoGrupo('Sugestões')).toBeNull()
    expect(inicioDoSistema(menu, 'atendimento')).toBe('/pre-vendas')
  })

  it('depois do login: vários sistemas vão para a escolha; com "entrar direto", para o último; um só, direto nele', () => {
    expect(destinoAoEntrar(menu, { ultimo: null, direto: false })).toBe('/sistemas')
    expect(destinoAoEntrar(menu, { ultimo: 'marketplaces', direto: true })).toBe('/marketplaces')
    expect(destinoAoEntrar(menu, { ultimo: 'ecommerce', direto: true })).toBe('/sistemas')
    const vendedor = [{ title: 'Atendimento Comercial', items: [{ to: '/chat' }] }, { title: 'Sistema', items: [{ to: '/atualizacoes' }] }]
    expect(destinoAoEntrar(vendedor, { ultimo: null, direto: false })).toBe('/chat')
  })
})
