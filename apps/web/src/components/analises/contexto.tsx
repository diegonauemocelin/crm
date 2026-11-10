import { useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { InlineError } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { type MedidaInfo, type Modelo, type Registros, registrosQuery } from '@/lib/analises'
import { type Comparacao, type Dim, type Filtros, formatar, juntarFiltros, NOME_DIM, rotuloChave } from '@/lib/analises-modelo'
import { dateTime, dayBr } from '@/lib/format'

/** O que todos os quadros da página compartilham: período, filtros, cross-filter e o "ver registros". */
export interface AnalisesCtx {
  modelo: Modelo
  medida: (id: string) => MedidaInfo | undefined
  de: string
  ate: string
  comparar: Comparacao
  filtros: Filtros
  /** Nomes dos ids de cadastro (filiais, vendedores, origens, motivos). */
  nomes: Map<string, string>
  /** Cross-filter: aplica (ou tira, se já estava) o valor como filtro da página toda. */
  filtrar: (dim: Dim, chave: string) => void
  verRegistros: (medida: string, extra: Filtros, contexto: string) => void
}

const Ctx = createContext<AnalisesCtx | null>(null)

export function useAnalises() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAnalises fora da página de Análises')
  return c
}

interface Pedido {
  medida: string
  extra: Filtros
  contexto: string
}

export function AnalisesProvider({ value, children }: { value: Omit<AnalisesCtx, 'verRegistros'>; children: ReactNode }) {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const ctx: AnalisesCtx = { ...value, verRegistros: (medida, extra, contexto) => setPedido({ medida, extra, contexto }) }
  return (
    <Ctx.Provider value={ctx}>
      {children}
      <RegistrosSheet pedido={pedido} onClose={() => setPedido(null)} />
    </Ctx.Provider>
  )
}

/** Linhas por trás de um número: paginadas, com link para abrir o atendimento ou o lead, e planilha (com permissão). */
function RegistrosSheet({ pedido, onClose }: { pedido: Pedido | null; onClose: () => void }) {
  const c = useAnalises()
  const [pagina, setPagina] = useState(1)
  const [baixando, setBaixando] = useState<'xlsx' | 'csv' | null>(null)
  const filtros = pedido ? juntarFiltros(c.filtros, pedido.extra) : {}
  const qs = pedido ? registrosQuery({ de: c.de, ate: c.ate, medida: pedido.medida, filtros, pagina }) : ''
  const q = useQuery({ queryKey: ['analises-registros', qs], queryFn: () => api.get<Registros>(`/analises/registros?${qs}`), enabled: !!pedido, staleTime: 30_000 })
  const d = q.data
  const m = pedido ? c.medida(pedido.medida) : undefined
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.tamanho)) : 1
  const baixar = async (formato: 'xlsx' | 'csv') => {
    if (!pedido) return
    setBaixando(formato)
    try {
      await api.download(`/analises/registros/exportar?${registrosQuery({ de: c.de, ate: c.ate, medida: pedido.medida, filtros })}&formato=${formato}`, `analises.${formato}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBaixando(null)
    }
  }
  const celula = (col: Registros['colunas'][number], v: string | number | null) => {
    if (v === null || v === undefined || v === '') return '—'
    if (col.tipo === 'moeda') return formatar('moeda', Number(v))
    if (col.tipo === 'datahora') return dateTime(`${String(v)}:00-03:00`)
    return String(v)
  }
  const visiveis = d?.colunas.filter((col) => col.id !== 'id') ?? []
  const filtrosTexto = (Object.entries(filtros) as [Dim, string[]][]).map(([k, v]) => `${NOME_DIM[k]}: ${v.map((x) => rotuloChave(k, x, c.nomes)).join(', ')}`)
  return (
    <Sheet
      open={!!pedido}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setPagina(1)
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{m?.nome ?? 'Registros'}</SheetTitle>
          <SheetDescription>
            {pedido?.contexto ? `${pedido.contexto} · ` : ''}
            {dayBr(c.de)} a {dayBr(c.ate)}
            {filtrosTexto.length ? ` · ${filtrosTexto.join(' · ')}` : ''}
          </SheetDescription>
          {d && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-sm text-muted-foreground">{d.total.toLocaleString('pt-BR')} registros</span>
              {d.podeExportar && d.total > 0 && (
                <>
                  <Button size="sm" variant="outline" disabled={!!baixando} onClick={() => void baixar('xlsx')}>
                    {baixando === 'xlsx' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Excel
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!baixando} onClick={() => void baixar('csv')}>
                    {baixando === 'csv' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} CSV
                  </Button>
                  <span className="text-xs text-muted-foreground">A planilha vai sem nome, telefone e e-mail do cliente.</span>
                </>
              )}
            </div>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {q.isError ? (
            <div className="p-4">
              <InlineError error={q.error} onRetry={() => void q.refetch()} />
            </div>
          ) : !d ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Carregando os registros…
            </div>
          ) : d.linhas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum registro com estes filtros.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {visiveis.map((col) => (
                    <TableHead key={col.id} className={col.tipo === 'moeda' ? 'text-right' : undefined}>
                      {col.nome}
                    </TableHead>
                  ))}
                  {d.abrir && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.linhas.map((r) => (
                  <TableRow key={String(r.id)}>
                    {visiveis.map((col) => (
                      <TableCell key={col.id} className={col.tipo === 'moeda' ? 'text-right tabular-nums' : 'max-w-56 truncate'} title={typeof r[col.id] === 'string' ? String(r[col.id]) : undefined}>
                        {celula(col, r[col.id] ?? null)}
                      </TableCell>
                    ))}
                    {d.abrir && (
                      <TableCell>
                        <Link
                          to={d.abrir === 'lead' ? `/leads/${String(r.id)}` : `/pre-vendas?abrir=${String(r.id)}`}
                          className="inline-flex rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={d.abrir === 'lead' ? 'Abrir o lead' : 'Abrir o atendimento'}
                          aria-label={d.abrir === 'lead' ? 'Abrir o lead' : 'Abrir o atendimento'}
                        >
                          <ExternalLinkIcon className="size-4" />
                        </Link>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {d && paginas > 1 && (
          <div className="flex items-center justify-between border-t p-3 text-sm">
            <Button size="sm" variant="outline" disabled={pagina <= 1 || q.isFetching} onClick={() => setPagina((p) => p - 1)}>
              <ChevronLeftIcon /> Anterior
            </Button>
            <span className="text-muted-foreground">
              Página {pagina} de {paginas}
            </span>
            <Button size="sm" variant="outline" disabled={pagina >= paginas || q.isFetching} onClick={() => setPagina((p) => p + 1)}>
              Próxima <ChevronRightIcon />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
