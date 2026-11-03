/**
 * Visual "Por sistema": o menu é dividido em sistemas (Atendimento, Marketing...). Depois do login, quem tem mais de um
 * escolhe onde vai trabalhar; dentro dele, o menu mostra só as telas daquele sistema, com troca rápida no topo.
 * Regras sem React nem ícones (testadas em apps/api/test/sistemas.spec.ts).
 */

export interface SistemaDef {
  id: string
  nome: string
  descricao: string
  /** Grupos do menu (NAVIGATION) que formam o sistema. */
  grupos: string[]
}

export const SISTEMAS: SistemaDef[] = [
  { id: 'atendimento', nome: 'Atendimento', descricao: 'Chat do WhatsApp, pré-venda, pós-venda e agenda de contatos.', grupos: ['Atendimento Comercial'] },
  { id: 'dashboards', nome: 'Dashboards', descricao: 'Início, vendas em tempo real, atendimento e relatórios.', grupos: ['Dashboards', 'Análise'] },
  { id: 'crm', nome: 'CRM e leads', descricao: 'Base de clientes e leads, com origem, código e vendedor.', grupos: ['CRM'] },
  { id: 'marketing', nome: 'Marketing', descricao: 'E-mail, landing pages, postagens, captura e automações.', grupos: ['Marketing'] },
  { id: 'mi', nome: 'Marketing Inteligente', descricao: 'Anúncios, Instagram, SEO, funil e recomendações da IA.', grupos: ['Marketing Inteligente'] },
  { id: 'ecommerce', nome: 'E-commerce', descricao: 'Catálogo, carrinhos abandonados e SEO dos produtos.', grupos: ['E-commerce'] },
  { id: 'marketplaces', nome: 'Marketplaces', descricao: 'Mercado Livre Ads e o Assistente das perguntas.', grupos: ['Marketplaces'] },
  { id: 'admin', nome: 'Administração', descricao: 'Configurações, usuários, perfis e auditoria.', grupos: ['Administração'] },
]

/** Grupos que aparecem em todos os sistemas (sugestões, ajuda e atualizações). */
export const GRUPOS_GERAIS = ['Sugestões', 'Sistema']

interface Grupo<I> {
  title: string
  items: I[]
}

/** Sistemas que a pessoa pode usar: os que têm ao menos uma tela liberada no menu dela. */
export function sistemasVisiveis<I>(grupos: Grupo<I>[]): SistemaDef[] {
  const comItens = new Set(grupos.filter((g) => g.items.length > 0).map((g) => g.title))
  return SISTEMAS.filter((s) => s.grupos.some((g) => comItens.has(g)))
}

/** Sistema de um grupo do menu (o da tela aberta); null para os gerais e telas fora do menu. */
export function sistemaDoGrupo(grupo: string | null | undefined): string | null {
  if (!grupo) return null
  return SISTEMAS.find((s) => s.grupos.includes(grupo))?.id ?? null
}

/** Menu dentro de um sistema: os grupos dele e, no fim, os gerais. */
export function menuDoSistema<G extends Grupo<unknown>>(grupos: G[], id: string | null): G[] {
  const s = SISTEMAS.find((x) => x.id === id)
  if (!s) return grupos
  return [...grupos.filter((g) => s.grupos.includes(g.title)), ...grupos.filter((g) => GRUPOS_GERAIS.includes(g.title))]
}

/** Primeira tela liberada do sistema (para onde o cartão leva). */
export function inicioDoSistema<I extends { to: string }>(grupos: Grupo<I>[], id: string): string | null {
  const s = SISTEMAS.find((x) => x.id === id)
  if (!s) return null
  for (const nome of s.grupos) {
    const g = grupos.find((x) => x.title === nome)
    if (g?.items[0]) return g.items[0].to
  }
  return null
}

/**
 * Para onde ir logo depois de entrar: um sistema só, direto nele; vários, a tela de escolha (ou o último usado, se a
 * pessoa marcou "entrar direto"). null = fica onde está.
 */
export function destinoAoEntrar<I extends { to: string }>(grupos: Grupo<I>[], o: { ultimo: string | null; direto: boolean }): string | null {
  const vis = sistemasVisiveis(grupos)
  if (vis.length === 0) return null
  if (vis.length === 1) return inicioDoSistema(grupos, vis[0]!.id)
  if (o.direto && o.ultimo && vis.some((s) => s.id === o.ultimo)) return inicioDoSistema(grupos, o.ultimo)
  return '/sistemas'
}
