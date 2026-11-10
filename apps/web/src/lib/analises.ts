import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api } from './api'
import { type Comparacao, comFiltro, type Dim, type Filtros, filtrosDaUrl, filtrosParaApi, type Formato, periodoDaUrl } from './analises-modelo'
import { todaySP } from './format'

/** Análises (BI nativo): tipos da API e os ganchos da tela. As regras puras ficam em analises-modelo.ts. */

export interface MedidaInfo {
  id: string
  nome: string
  fonte: 'atendimentos' | 'leads' | 'whatsapp'
  formato: Formato
  descricao: string
  menorMelhor: boolean
  registros: boolean
}

export interface FonteInfo {
  id: MedidaInfo['fonte']
  nome: string
  ver: boolean
  exportar: boolean
  escopo: 'OWN' | 'UNIT' | 'ALL'
  registros: boolean
  abrir: 'pre-vendas' | 'lead' | null
  dims: Dim[]
}

export interface Modelo {
  paginas: { id: string; nome: string; descricao: string; fontes: string[] }[]
  fontes: FonteInfo[]
  medidas: MedidaInfo[]
  dimensoes: { id: Dim; nome: string }[]
}

export interface Opcoes {
  filiais: { id: string; nome: string; ativo: boolean }[]
  vendedores: { id: string; nome: string; ativo: boolean; filial: string | null }[]
  origens: { id: string; nome: string; ativo: boolean }[]
  motivos: { id: string; nome: string; ativo: boolean }[]
  ufs: string[]
}

export interface Comparativo {
  anterior: number | null
  variacao: number | null
  diferenca: number | null
}

export interface LinhaConsulta {
  chaves: string[]
  rotulos: string[]
  valores: Record<string, number | null>
  comparacao?: Record<string, Comparativo>
}

export interface Consulta {
  periodo: { de: string; ate: string }
  comparacao: { tipo: Comparacao; de: string; ate: string } | null
  dims: Dim[]
  medidas: string[]
  linhas: LinhaConsulta[]
  temMais: boolean
  avisos: { semAcesso: string[]; naoAplica: { fonte: string; dims: Dim[] }[] }
}

export interface Registros {
  medida: { id: string; nome: string }
  fonte: string
  abrir: 'pre-vendas' | 'lead' | null
  colunas: { id: string; nome: string; tipo: 'texto' | 'datahora' | 'moeda' | 'decimal'; pessoal: boolean }[]
  linhas: Record<string, string | number | null>[]
  total: number
  pagina: number
  tamanho: number
  podeExportar: boolean
}

export function useModelo() {
  return useQuery({ queryKey: ['analises-modelo'], queryFn: () => api.get<Modelo>('/analises/modelo'), staleTime: 5 * 60_000 })
}

export function useOpcoes() {
  return useQuery({ queryKey: ['analises-opcoes'], queryFn: () => api.get<Opcoes>('/analises/opcoes'), staleTime: 5 * 60_000 })
}

/** Estado da página no endereço: aba, período, comparação e filtros (cross-filter incluído). */
export function useAnalisesUrl() {
  const [params, setParams] = useSearchParams()
  const hoje = todaySP()
  const { de, ate, periodo } = periodoDaUrl(params, hoje)
  const filtros = filtrosDaUrl(params)
  const comparar = (params.get('comparar') as Comparacao | null) ?? 'anterior'
  const aba = params.get('aba') ?? ''
  const update = (fn: (p: URLSearchParams) => URLSearchParams) => setParams((prev) => fn(new URLSearchParams(prev)), { replace: true })
  return {
    de,
    ate,
    periodo,
    filtros,
    comparar,
    aba,
    setAba: (id: string) => update((p) => (p.set('aba', id), p)),
    setPeriodo: (id: string) =>
      update((p) => {
        p.delete('de')
        p.delete('ate')
        p.set('periodo', id)
        return p
      }),
    setDatas: (novoDe: string, novoAte: string) =>
      update((p) => {
        p.delete('periodo')
        p.set('de', novoDe)
        p.set('ate', novoAte)
        return p
      }),
    setComparar: (c: Comparacao) => update((p) => (c === 'anterior' ? p.delete('comparar') : p.set('comparar', c), p)),
    setFiltro: (dim: Dim, valores: string[] | null) => update((p) => comFiltro(p, dim, valores)),
    limpar: (dims: readonly Dim[]) =>
      update((p) => {
        for (const d of dims) p.delete(d)
        return p
      }),
  }
}

export interface PedidoConsulta {
  de: string
  ate: string
  medidas: string[]
  dims?: Dim[]
  filtros: Filtros
  comparar?: Comparacao | null
  limite?: number
}

export function consultaQuery(p: PedidoConsulta) {
  const q = new URLSearchParams({ de: p.de, ate: p.ate, medidas: p.medidas.join(',') })
  if (p.dims?.length) q.set('dims', p.dims.join(','))
  const f = filtrosParaApi(p.filtros)
  if (f) q.set('filtros', f)
  if (p.comparar) q.set('comparar', p.comparar)
  if (p.limite) q.set('limite', String(p.limite))
  return q.toString()
}

export function useConsulta(p: PedidoConsulta, enabled = true) {
  const qs = consultaQuery(p)
  return useQuery({
    queryKey: ['analises-consulta', qs],
    queryFn: () => api.get<Consulta>(`/analises/consulta?${qs}`),
    enabled: enabled && p.medidas.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

export function registrosQuery(p: { de: string; ate: string; medida: string; filtros: Filtros; pagina?: number }) {
  const q = new URLSearchParams({ de: p.de, ate: p.ate, medida: p.medida })
  const f = filtrosParaApi(p.filtros)
  if (f) q.set('filtros', f)
  if (p.pagina) q.set('pagina', String(p.pagina))
  return q.toString()
}
