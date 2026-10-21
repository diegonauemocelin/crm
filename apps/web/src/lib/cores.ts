/** Cores da identidade visual: paletas prontas e avisos de leitura (contraste WCAG). */
import { contrastRatio, contrastText } from './branding'

export interface BrandColors {
  /** Cor da marca: logo sem imagem, relatórios em PDF e e-mails. */
  brand: string
  /** Cor de ação: botões, caixas de marcação, chaves e links. */
  action: string
  /** Fundo do menu (layout Clássico e login). */
  nav: string
}

/** Combinações prontas, conferidas para leitura (texto do botão e da faixa do relatório). */
export const PALETTES: ({ name: string } & BrandColors)[] = [
  { name: 'Azul clássico', brand: '#1d4ed8', action: '#1d4ed8', nav: '#0f1e3d' },
  { name: 'Grafite + azul', brand: '#1f2937', action: '#2563eb', nav: '#111827' },
  { name: 'Grafite + amarelo (linha amarela)', brand: '#1f2937', action: '#a16207', nav: '#111827' },
  { name: 'Grafite + laranja', brand: '#1f2937', action: '#ea580c', nav: '#111827' },
  { name: 'Verde', brand: '#14532d', action: '#16a34a', nav: '#052e16' },
  { name: 'Vermelho', brand: '#7f1d1d', action: '#dc2626', nav: '#1c1917' },
]

const HEX = /^#[0-9a-f]{6}$/i

/** Avisos de leitura: cor clara demais para o fundo branco ou para o texto branco da faixa do relatório. */
export function colorWarnings(c: BrandColors): string[] {
  const out: string[] = []
  if (HEX.test(c.action) && contrastRatio(c.action, '#ffffff') < 3) out.push('A cor de ação está clara demais: caixas marcadas, chaves e links ficam pouco visíveis sobre o fundo branco. Escolha um tom mais escuro.')
  if (HEX.test(c.brand) && contrastRatio(c.brand, '#ffffff') < 3) out.push('A cor da marca está clara demais: o título branco na faixa do relatório (PDF e e-mail) fica difícil de ler.')
  if (HEX.test(c.nav) && contrastRatio(c.nav, contrastText(c.nav)) < 4.5) out.push('O texto do menu fica com pouco contraste nesta cor.')
  if (HEX.test(c.brand) && HEX.test(c.action) && c.brand.toLowerCase() !== c.action.toLowerCase() && contrastRatio(c.brand, c.action) < 1.3) out.push('Marca e ação estão muito parecidas: se a ideia é diferenciar os botões, escolha cores mais distantes.')
  return out
}

