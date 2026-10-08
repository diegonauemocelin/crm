import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, ImageOffIcon, Loader2Icon, PackageIcon, RefreshCwIcon, SearchIcon, ShoppingCartIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { brl, int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface Product {
  id: string
  code: string
  name: string
  brand: string | null
  price: number | null
  priceFrom: number | null
  discount: number | null
  stock: number | null
  image: string | null
  url: string | null
  active: boolean
  syncedAt: string
  carts: number
  abandoned: number
  bought: number
}
interface ProductPage {
  items: Product[]
  total: number
  page: number
  pageSize: number
  interestDays: number
}
interface Summary {
  active: number
  inactive: number
  noStock: number
  promo: number
  brands: { brand: string | null; count: number }[]
  sync: { enabled: boolean; updating: boolean; syncedAt: string | null; error: string | null }
  interestDays: number
}

const SORT_LABEL: Record<string, string> = {
  nome: 'Nome (A–Z)',
  interesse: 'Mais colocados no carrinho',
  abandonados: 'Mais abandonados no carrinho',
  desconto: 'Maior desconto',
  preco_menor: 'Menor preço',
  preco_maior: 'Maior preço',
  estoque: 'Maior estoque',
}
const ALL = '__all__'
const FILTERS = ['search', 'brand', 'stock', 'status', 'promo', 'sort'] as const

export function CatalogoPage() {
  return (
    <RequirePermission module="catalogo">
      <Catalog />
    </RequirePermission>
  )
}

function Catalog() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('search') ?? '')
  const [exporting, setExporting] = useState(false)
  const page = Number(params.get('page') ?? 1) || 1

  const setFilter = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    next.delete('page')
    setParams(next, { replace: true })
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== searchText.trim()) setFilter('search', searchText.trim() || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const query = new URLSearchParams({ page: String(page), pageSize: '48' })
  for (const k of FILTERS) {
    const v = params.get(k)
    if (v) query.set(k, v)
  }
  const summary = useQuery({ queryKey: ['catalogo-resumo'], queryFn: () => api.get<Summary>('/catalogo/resumo'), refetchInterval: (q) => (q.state.data?.sync.updating ? 5_000 : false) })
  const list = useQuery({ queryKey: ['catalogo', query.toString()], queryFn: () => api.get<ProductPage>(`/catalogo?${query}`), placeholderData: keepPreviousData })
  const s = summary.data
  const data = list.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  // Quando a atualização termina, recarrega a lista.
  const updating = !!s?.sync.updating
  const [wasUpdating, setWasUpdating] = useState(false)
  useEffect(() => {
    if (wasUpdating && !updating) void qc.invalidateQueries({ queryKey: ['catalogo'] })
    setWasUpdating(updating)
  }, [updating, wasUpdating, qc])

  const refresh = async () => {
    try {
      await api.post('/catalogo/atualizar')
      toast.success('Atualização do catálogo iniciada. Pode levar alguns minutos.')
      await qc.invalidateQueries({ queryKey: ['catalogo-resumo'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const exportCsv = async () => {
    const q = new URLSearchParams(query)
    q.delete('page')
    q.delete('pageSize')
    setExporting(true)
    try {
      const res = await fetch(`/api/catalogo/exportar?${q}`, { credentials: 'same-origin' })
      if (!res.ok) return toast.error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha ao exportar.')
      const url = URL.createObjectURL(await res.blob())
      Object.assign(document.createElement('a'), { href: url, download: `catalogo-${new Date().toISOString().slice(0, 10)}.csv` }).click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success('Link copiado.'))
  }

  if (summary.error) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
  if (!s) return <TableSkeleton rows={8} />

  const empty = s.active + s.inactive === 0
  return (
    <>
      <PageHeader
        title="Catálogo de produtos"
        description={`Produtos da loja virtual, copiados da Magazord a cada 12 horas. Mostra também o interesse dos clientes: quantos carrinhos dos últimos ${s.interestDays} dias tiveram o produto. Os produtos entram nos e-mails pelo editor do Email marketing.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Can module="catalogo" action="export">
              <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || !data?.total}>
                {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Exportar
              </Button>
            </Can>
            {can('catalogo', 'edit') && s.sync.enabled && (
              <Button onClick={() => void refresh()} disabled={updating}>
                <RefreshCwIcon className={cn(updating && 'animate-spin')} /> {updating ? 'Atualizando…' : 'Atualizar agora'}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {s.sync.enabled ? (
          <span>{s.sync.syncedAt ? `Última atualização: ${formatDateTime(s.sync.syncedAt)}` : 'Ainda não atualizado.'}</span>
        ) : (
          <span>
            A cópia do catálogo está desligada.{' '}
            {can('configuracoes', 'view') && (
              <Link to="/configuracoes?aba=loja" className="underline">
                Ligar em Configurações → Loja virtual (Magazord)
              </Link>
            )}
          </span>
        )}
        {s.sync.error && <span className="text-destructive">Erro na última atualização: {s.sync.error}</span>}
      </div>

      {empty ? (
        <EmptyState
          icon={PackageIcon}
          title="Nenhum produto no catálogo"
          description={
            s.sync.enabled
              ? 'Clique em “Atualizar agora” para copiar os produtos da loja. O usuário WebService da Magazord precisa de leitura em /api/v2/site/frontend/produto.'
              : 'Ligue a opção “Catálogo de produtos” na integração com a Magazord (Configurações → Loja virtual) para copiar os produtos da loja.'
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Produtos ativos" value={int.format(s.active)} onClick={() => setFilter('status', null)} />
            <Stat label="Sem estoque" value={int.format(s.noStock)} onClick={() => setFilter('stock', 'sem')} active={params.get('stock') === 'sem'} />
            <Stat label="Em promoção (preço de/por)" value={int.format(s.promo)} onClick={() => setFilter('promo', params.get('promo') ? null : 'true')} active={!!params.get('promo')} />
            <Stat label="Marcas" value={int.format(s.brands.filter((b) => b.brand).length)} />
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Buscar por nome, código ou marca" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
            </div>
            <Select value={params.get('brand') ?? ALL} onValueChange={(v) => setFilter('brand', v === ALL ? null : v)}>
              <SelectTrigger className="w-full" aria-label="Marca">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as marcas</SelectItem>
                {s.brands.map((b) => (
                  <SelectItem key={b.brand ?? 'none'} value={b.brand ?? 'none'}>
                    {b.brand ?? 'Sem marca'} ({int.format(b.count)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={params.get('stock') ?? ALL} onValueChange={(v) => setFilter('stock', v === ALL ? null : v)}>
              <SelectTrigger className="w-full" aria-label="Estoque">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Qualquer estoque</SelectItem>
                <SelectItem value="com">Com estoque</SelectItem>
                <SelectItem value="sem">Sem estoque</SelectItem>
              </SelectContent>
            </Select>
            <Select value={params.get('sort') ?? 'nome'} onValueChange={(v) => setFilter('sort', v === 'nome' ? null : v)}>
              <SelectTrigger className="w-full" aria-label="Ordenar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Select value={params.get('status') ?? 'ativos'} onValueChange={(v) => setFilter('status', v === 'ativos' ? null : v)}>
              <SelectTrigger size="sm" className="w-48" aria-label="Situação na loja">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos na loja</SelectItem>
                <SelectItem value="inativos">Fora da loja ({int.format(s.inactive)})</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
            {FILTERS.some((k) => k !== 'sort' && params.get(k)) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchText('')
                  setParams({}, { replace: true })
                }}
              >
                Limpar filtros
              </Button>
            )}
            {data && <span className="ml-auto text-muted-foreground">{int.format(data.total)} produto(s)</span>}
          </div>

          {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
          {!data ? (
            <TableSkeleton rows={8} />
          ) : data.items.length === 0 ? (
            <EmptyState icon={SearchIcon} title="Nenhum produto encontrado" description="Mude a busca ou os filtros." />
          ) : (
            <Card className="py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Produto</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right" title={`Carrinhos dos últimos ${data.interestDays} dias com o produto`}>
                        Carrinhos ({data.interestDays} dias)
                      </TableHead>
                      <TableHead className="pr-4 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((p) => (
                      <TableRow key={p.id} className={cn(!p.active && 'opacity-60')}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            {p.image ? (
                              <img src={p.image} alt="" loading="lazy" className="size-12 shrink-0 rounded-md border bg-white object-contain" />
                            ) : (
                              <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
                                <ImageOffIcon className="size-4 text-muted-foreground" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="line-clamp-2 max-w-md font-medium">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Cód. {p.code}
                                {p.brand ? ` · ${p.brand}` : ''}
                                {!p.active && ' · fora da loja'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {p.priceFrom && p.price !== null && p.priceFrom > p.price && <p className="text-xs text-muted-foreground line-through">{brl.format(p.priceFrom)}</p>}
                          <p className="font-medium tabular-nums">{p.price === null ? '—' : brl.format(p.price)}</p>
                          {p.discount ? <Badge variant="secondary">-{p.discount}%</Badge> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.stock === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : p.stock <= 0 ? (
                            <Badge variant="outline" className="border-destructive/50 text-destructive">
                              Sem estoque
                            </Badge>
                          ) : (
                            int.format(p.stock)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.carts ? (
                            <Link to={`/carrinhos?view=todos&search=${encodeURIComponent(p.code)}`} className="inline-flex items-center gap-1 hover:underline" title="Ver os carrinhos">
                              <ShoppingCartIcon className="size-3.5 text-muted-foreground" />
                              <span className="tabular-nums">{int.format(p.carts)}</span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                          {p.carts > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {int.format(p.abandoned)} abandonado(s) · {int.format(p.bought)} comprado(s)
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 text-right whitespace-nowrap">
                          {p.url && (
                            <>
                              <Button variant="ghost" size="icon" className="size-8" onClick={() => copy(p.url!)} aria-label={`Copiar link de ${p.name}`} title="Copiar link">
                                <CopyIcon />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-8" asChild>
                                <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${p.name} na loja`} title="Abrir na loja">
                                  <ExternalLinkIcon />
                                </a>
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {data && totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <Button variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => setParams((p) => (p.set('page', String(page - 1)), p))} aria-label="Página anterior">
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="icon" className="size-8" disabled={page >= totalPages} onClick={() => setParams((p) => (p.set('page', String(page + 1)), p))} aria-label="Próxima página">
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

function Stat({ label, value, onClick, active }: { label: string; value: string; onClick?: () => void; active?: boolean }) {
  const content = (
    <CardContent className="space-y-1 px-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </CardContent>
  )
  return (
    <Card className={cn('gap-1 py-4', onClick && 'cursor-pointer transition-colors hover:bg-muted/40', active && 'border-primary')} onClick={onClick}>
      {content}
    </Card>
  )
}
