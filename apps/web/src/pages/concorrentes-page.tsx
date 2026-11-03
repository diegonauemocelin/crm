import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, Loader2Icon, PlusIcon, RefreshCwIcon, StoreIcon, Trash2Icon, TrendingDownIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

interface Competitor {
  id: string
  nickname: string | null
  input: string
  permalink: string | null
  activeItems: number | null
  itemsRead: number
  itemsWithCode: number
  lastSyncAt: string | null
  lastError: string | null
  syncing: boolean
}
interface Offer {
  competitorId: string
  itemId: string
  title: string | null
  price: number | null
  previousPrice: number | null
  permalink: string | null
  freeShipping: boolean
  diff: number | null
  dropped: boolean
}
interface Row {
  item: {
    id: string
    title: string | null
    price: number | null
    permalink: string | null
  }
  code: string
  offers: Offer[]
  cheaper: boolean
  worst: number | null
}
interface View {
  competitors: Competitor[]
  ownItems: number
  rows: Row[]
  totals: { matched: number; cheaper: number; dropped: number }
}

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Marketplaces › Concorrentes: lojas do Mercado Livre e o preço delas nos mesmos produtos (pelo código de referência). */
export function ConcorrentesPage() {
  usePageTitle('Concorrentes no Mercado Livre')
  return (
    <RequirePermission module="marketplaces">
      <Concorrentes />
    </RequirePermission>
  )
}

function Concorrentes() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const edit = can('marketplaces', 'edit')
  const confirm = useConfirm()
  const [link, setLink] = useState('')
  const [onlyCheaper, setOnlyCheaper] = useState(false)
  const [search, setSearch] = useState('')
  const q = useQuery({
    queryKey: ['concorrentes'],
    queryFn: () => api.get<View>('/marketplaces/concorrentes'),
    refetchInterval: (s) => (s.state.data?.competitors.some((c) => c.syncing) ? 5000 : false),
  })
  const reload = () => void qc.invalidateQueries({ queryKey: ['concorrentes'] })
  const add = useMutation({
    mutationFn: () =>
      api.post<{ competitor: Competitor }>('/marketplaces/concorrentes', {
        link: link.trim(),
      }),
    onSuccess: (r) => {
      toast.success(`${r.competitor.nickname ?? 'Loja'} incluída. Lendo os anúncios (leva alguns minutos).`)
      setLink('')
      reload()
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/marketplaces/concorrentes/${id}/atualizar`),
    onSuccess: () => (toast.success('Atualizando os anúncios da loja.'), reload()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplaces/concorrentes/${id}`),
    onSuccess: () => (toast.success('Loja tirada da comparação.'), reload()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const names = new Map((d?.competitors ?? []).map((c) => [c.id, c.nickname ?? 'Loja']))
  const term = search.trim().toLowerCase()
  const rows = (d?.rows ?? []).filter((r) => (!onlyCheaper || r.cheaper) && (!term || `${r.item.title ?? ''} ${r.code}`.toLowerCase().includes(term)))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (link.trim()) add.mutate()
  }
  return (
    <div>
      <PageHeader
        title="Concorrentes no Mercado Livre"
        description="Cole o link da loja de um concorrente: o CRM lê os anúncios dela todo dia e mostra o preço só nos produtos com o mesmo código de referência que a sua loja."
      />
      <div className="space-y-4">
        {edit && (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-[1_1_28rem] space-y-1.5">
                  <Label htmlFor="link-loja">Link da loja do concorrente</Label>
                  <Input id="link-loja" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.mercadolivre.com.br/loja/nome-da-loja (ou o link de um anúncio dela)" maxLength={1000} />
                </div>
                <Button type="submit" disabled={add.isPending || !link.trim()}>
                  {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Incluir loja
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && !d.competitors.length && <EmptyState icon={StoreIcon} title="Nenhuma loja ainda" description="Inclua o link da loja de um concorrente para comparar os preços." />}
        {d && d.competitors.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {d.competitors.map((c) => (
                <Card key={c.id} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{c.nickname ?? 'Loja'}</p>
                      <p className="text-xs text-muted-foreground">{c.syncing ? 'Lendo os anúncios…' : c.lastSyncAt ? `Atualizado em ${formatDateTime(c.lastSyncAt)}` : 'Aguardando a primeira leitura'}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {c.permalink && (
                        <Button asChild size="icon" variant="ghost" aria-label={`Abrir a loja ${c.nickname ?? ''} no Mercado Livre`}>
                          <a href={c.permalink} target="_blank" rel="noreferrer">
                            <ExternalLinkIcon />
                          </a>
                        </Button>
                      )}
                      {edit && (
                        <>
                          <Button size="icon" variant="ghost" aria-label="Atualizar agora" disabled={c.syncing || refresh.isPending} onClick={() => refresh.mutate(c.id)}>
                            <RefreshCwIcon className={cn(c.syncing && 'animate-spin')} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Tirar ${c.nickname ?? 'a loja'}`}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: 'Tirar esta loja da comparação?',
                                  description: 'Os anúncios guardados dela são apagados. Dá para incluir de novo depois.',
                                  confirmLabel: 'Tirar',
                                  destructive: true,
                                })
                              )
                                remove.mutate(c.id)
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm">
                    <strong>{c.itemsRead.toLocaleString('pt-BR')}</strong> anúncios lidos
                    {c.activeItems != null && c.activeItems > c.itemsRead ? ` de ${c.activeItems.toLocaleString('pt-BR')}` : ''} · <strong>{c.itemsWithCode.toLocaleString('pt-BR')}</strong> com código
                  </p>
                  {c.activeItems != null && c.activeItems > 1000 && <p className="text-xs text-muted-foreground">O Mercado Livre lista no máximo 1.000 anúncios por loja na busca.</p>}
                  {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
                </Card>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="gap-1 p-4">
                <p className="text-sm text-muted-foreground">Produtos iguais encontrados</p>
                <p className="text-2xl font-extrabold tabular-nums">{d.totals.matched.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">de {d.ownItems.toLocaleString('pt-BR')} anúncios ativos da sua loja</p>
              </Card>
              <Card className={cn('gap-1 p-4', d.totals.cheaper > 0 && 'border-destructive')}>
                <p className="text-sm text-muted-foreground">Concorrente mais barato</p>
                <p className="text-2xl font-extrabold tabular-nums">{d.totals.cheaper.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">produtos em que alguém vende por menos</p>
              </Card>
              <Card className="gap-1 p-4">
                <p className="text-sm text-muted-foreground">Baixaram o preço</p>
                <p className="text-2xl font-extrabold tabular-nums">{d.totals.dropped.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">nos últimos 7 dias</p>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparação por código de referência</CardTitle>
                <CardDescription>Só os produtos com o mesmo código (número de peça, modelo, OEM ou código no título). Diferença negativa: o concorrente vende mais barato.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou código" className="max-w-xs" aria-label="Buscar produto ou código" />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={onlyCheaper} onCheckedChange={setOnlyCheaper} /> Só onde o concorrente está mais barato
                  </label>
                  <span className="ml-auto text-sm text-muted-foreground">{rows.length.toLocaleString('pt-BR')} produto(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto da sua loja</TableHead>
                        <TableHead className="text-right">Seu preço</TableHead>
                        <TableHead>Concorrentes (mais barato de cada loja)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 300).map((r) => (
                        <TableRow key={r.item.id} className="align-top">
                          <TableCell className="max-w-80">
                            <a href={r.item.permalink ?? '#'} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:underline">
                              {r.item.title ?? r.item.id}
                            </a>
                            <span className="text-xs text-muted-foreground">código {r.code}</span>
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{brl(r.item.price)}</TableCell>
                          <TableCell>
                            <ul className="space-y-1.5">
                              {r.offers.map((o) => (
                                <li key={o.itemId} className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="font-semibold">{names.get(o.competitorId)}</span>
                                  <a href={o.permalink ?? '#'} target="_blank" rel="noreferrer" className="tabular-nums hover:underline">
                                    {brl(o.price)}
                                  </a>
                                  {o.diff != null && (
                                    <Badge
                                      variant="secondary"
                                      className={cn(
                                        'border-0 tabular-nums',
                                        o.diff < 0 ? 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
                                      )}
                                    >
                                      {pct(o.diff)}
                                    </Badge>
                                  )}
                                  {o.freeShipping && <span className="text-xs text-muted-foreground">frete grátis</span>}
                                  {o.dropped && (
                                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                      <TrendingDownIcon className="size-3.5" /> baixou de {brl(o.previousPrice)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!rows.length && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            {d.rows.length ? 'Nenhum produto com esse filtro.' : 'Ainda nenhum produto com o mesmo código. Se a loja acabou de entrar, espere a leitura terminar.'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {rows.length > 300 && <p className="text-xs text-muted-foreground">Mostrando os 300 primeiros (os de maior diferença). Use a busca para achar os outros.</p>}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
