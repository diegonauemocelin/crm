/**
 * Análises: as páginas são configuração. Cada quadro diz as medidas (ids da API, src/analises/modelo.ts) e a
 * dimensão ou hierarquia; a tela monta tudo (filtros, cross-filter, drill-down e "ver registros").
 * Fases 2 e 3 (WhatsApp, Loja/ML, Marketing, Fretes, Cenários): nova página aqui + medidas e fonte na API.
 */
import type { Dim } from './analises-modelo'

export const CALENDARIO: Dim[] = ['ano', 'trimestre', 'mes', 'dia']
export const COMERCIAL: Dim[] = ['filial', 'vendedor']
export const GEOGRAFIA: Dim[] = ['uf', 'cidade']
export const ORIGEM: Dim[] = ['canal', 'origem', 'campanha']

export type Visual =
  | { tipo: 'kpis'; id: string; medidas: string[] }
  | { tipo: 'tendencia'; id: string; titulo: string; descricao?: string; series: { nome: string; medidas: string[] }[]; largura?: 1 | 2 }
  | { tipo: 'barras'; id: string; titulo: string; descricao?: string; medidas: string[]; hierarquia: Dim[]; limite?: number; largura?: 1 | 2 }
  | { tipo: 'matriz'; id: string; titulo: string; descricao?: string; medidas: string[]; hierarquia: Dim[]; largura?: 1 | 2 }
  | { tipo: 'funil'; id: string; titulo: string; descricao?: string; passos: string[]; largura?: 1 | 2 }

export interface PaginaUi {
  id: string
  visuais: Visual[]
}

export const PAGINAS_UI: PaginaUi[] = [
  {
    id: 'visao-geral',
    visuais: [
      { tipo: 'kpis', id: 'kpis', medidas: ['leads', 'atendimentos', 'vendas', 'receita', 'conversao', 'ticket', 'wa_primeira_resposta', 'wa_atendimentos'] },
      {
        tipo: 'tendencia',
        id: 'tendencia',
        titulo: 'Evolução no tempo',
        descricao: 'Clique numa barra para descer (ano › trimestre › mês › dia), filtrar a página ou ver os registros.',
        series: [
          { nome: 'Receita', medidas: ['receita'] },
          { nome: 'Atendimentos e vendas', medidas: ['atendimentos', 'vendas'] },
          { nome: 'Leads', medidas: ['leads'] },
          { nome: 'WhatsApp', medidas: ['wa_atendimentos'] },
        ],
        largura: 2,
      },
      { tipo: 'barras', id: 'canais', titulo: 'Por canal e origem', descricao: 'Canal › origem › campanha do Google Ads.', medidas: ['receita', 'vendas', 'atendimentos'], hierarquia: ORIGEM, limite: 12 },
      { tipo: 'barras', id: 'filiais', titulo: 'Filiais e vendedores', descricao: 'Clique numa filial para ver os vendedores dela.', medidas: ['receita', 'vendas', 'conversao'], hierarquia: COMERCIAL, limite: 12 },
    ],
  },
  {
    id: 'comercial',
    visuais: [
      { tipo: 'kpis', id: 'kpis', medidas: ['atendimentos', 'vendas', 'perdas', 'negociacao', 'conversao', 'taxa_perda', 'receita', 'repasse_min'] },
      { tipo: 'funil', id: 'funil', titulo: 'Funil comercial', descricao: 'Leads que entraram › pré-vendas › repassadas ao vendedor › vendas, no período.', passos: ['leads', 'atendimentos', 'repassados', 'vendas'] },
      { tipo: 'barras', id: 'perdas', titulo: 'Perdas por motivo', descricao: 'Clique num motivo para filtrar a página por ele.', medidas: ['perdas'], hierarquia: ['motivo'], limite: 15 },
      {
        tipo: 'matriz',
        id: 'filial-vendedor',
        titulo: 'Conversão e receita por filial e vendedor',
        descricao: 'Abra a filial (+) para ver os vendedores. Clique num número para ver os registros.',
        medidas: ['atendimentos', 'vendas', 'conversao', 'receita', 'ticket', 'perdas'],
        hierarquia: COMERCIAL,
        largura: 2,
      },
      { tipo: 'matriz', id: 'origem-campanha', titulo: 'Origem e campanha', descricao: 'Canal › origem › campanha do Google Ads.', medidas: ['atendimentos', 'vendas', 'conversao', 'receita'], hierarquia: ORIGEM, largura: 2 },
      { tipo: 'barras', id: 'geografia', titulo: 'Por UF e cidade', descricao: 'Clique numa UF para ver as cidades.', medidas: ['vendas', 'receita', 'atendimentos'], hierarquia: GEOGRAFIA, limite: 15, largura: 2 },
    ],
  },
]

/** Todas as medidas usadas pelas páginas (conferidas contra a API nos testes). */
export const MEDIDAS_USADAS = [
  ...new Set(
    PAGINAS_UI.flatMap((p) =>
      p.visuais.flatMap((v) => (v.tipo === 'tendencia' ? v.series.flatMap((s) => s.medidas) : v.tipo === 'funil' ? v.passos : v.medidas)),
    ),
  ),
]
