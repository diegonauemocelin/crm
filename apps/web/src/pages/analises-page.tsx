import { useMemo } from 'react'
import { AnalisesProvider } from '@/components/analises/contexto'
import { FiltrosAnalises } from '@/components/analises/filtros'
import { VisualAnalise } from '@/components/analises/visuais'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/page'
import { SavedViews } from '@/components/saved-views'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAnalisesUrl, useModelo, useOpcoes } from '@/lib/analises'
import { PAGINAS_UI } from '@/lib/analises-paginas'
import { usePageTitle } from '@/lib/page-title'

const ESCOPO = { OWN: 'só os seus', UNIT: 'os da sua unidade', ALL: 'todos' } as const

/**
 * Análises: BI dentro do CRM. Páginas com filtros no endereço, cross-filter (clicar num valor filtra a página),
 * drill-down nas hierarquias, matriz que abre por linha e "ver registros" em qualquer número. Os dados são os do
 * CRM na hora, com as permissões e o escopo do perfil de quem abre.
 */
export function AnalisesPage() {
  usePageTitle('Análises')
  const u = useAnalisesUrl()
  const modelo = useModelo()
  const opcoes = useOpcoes()
  const nomes = useMemo(() => {
    const o = opcoes.data
    return new Map(o ? [...o.filiais, ...o.vendedores, ...o.origens, ...o.motivos].map((x) => [x.id, x.nome] as const) : [])
  }, [opcoes.data])
  if (modelo.isError) return <ErrorState error={modelo.error} onRetry={() => void modelo.refetch()} />
  if (!modelo.data) return <TableSkeleton rows={8} />
  const m = modelo.data
  const pagina = m.paginas.find((p) => p.id === u.aba) ?? m.paginas[0]!
  const config = PAGINAS_UI.find((p) => p.id === pagina.id)
  const medidas = new Map(m.medidas.map((x) => [x.id, x]))
  const escopos = m.fontes.filter((f) => f.ver && pagina.fontes.includes(f.id))
  const [kpis, ...resto] = config?.visuais ?? []
  return (
    <AnalisesProvider
      value={{
        modelo: m,
        medida: (id) => medidas.get(id),
        de: u.de,
        ate: u.ate,
        comparar: u.comparar,
        filtros: u.filtros,
        nomes,
        filtrar: (dim, chave) => {
          const atual = u.filtros[dim]
          u.setFiltro(dim, atual?.length === 1 && atual[0] === chave ? null : [chave])
        },
      }}
    >
      <div className="space-y-4">
        <PageHeader title="Análises" description="Indicadores do CRM com filtros, detalhamento e os registros por trás de cada número. Dados atualizados na hora." />
        <SavedViews screen="analises" />
        {m.paginas.length > 1 && (
          <Tabs value={pagina.id} onValueChange={u.setAba}>
            <TabsList>
              {m.paginas.map((p) => (
                <TabsTrigger key={p.id} value={p.id} title={p.descricao}>
                  {p.nome}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <FiltrosAnalises opcoes={opcoes.data} nomes={nomes} />
        <p className="text-xs text-muted-foreground">
          Você vê {escopos.map((f) => `${f.nome.toLowerCase()}: ${ESCOPO[f.escopo]}`).join(' · ')}. Clique num cartão, barra ou número para ver os registros, descer um nível ou filtrar a página.
        </p>
        <div key={`${pagina.id}|${u.de}|${u.ate}`} className="space-y-4">
          {kpis && <VisualAnalise v={kpis} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {resto.map((v) => (
              <VisualAnalise key={v.id} v={v} />
            ))}
          </div>
        </div>
      </div>
    </AnalisesProvider>
  )
}
