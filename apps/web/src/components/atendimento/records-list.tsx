import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockAlertIcon,
  DownloadIcon,
  EraserIcon,
  FilterXIcon,
  InboxIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  Undo2Icon,
  UploadIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import {
  brl,
  FOLLOW_LABEL,
  FOLLOW_STATUSES,
  followDeadline,
  formatDay,
  formatPhone,
  int,
  type Kind,
  KIND_INFO,
  namesOf,
  REGIONS,
  RETURN_LABEL,
  type ReturnStatus,
  SALE_LABEL,
  type ServiceRecord,
  UF_LIST,
  UF_NAMES,
  useOptions,
} from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ClearDialog } from './clear-dialog'
import { ImportDialog } from './import-dialog'
import { RecordSheet } from './record-sheet'

const ALL = '__all__'
export const FILTER_KEYS = ['search', 'from', 'to', 'unitId', 'sellerId', 'originId', 'customerTypeId', 'state', 'region', 'brandId', 'partTypeId', 'forwarded', 'returnStatus', 'saleStatus', 'lostReasonId', 'overdue', 'followStatus', 'followOverdue', 'postSaleReturned'] as const

interface Page {
  total: number
  page: number
  pageSize: number
  alertHours: number
  items: ServiceRecord[]
}

const DEADLINE_TONE = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  pending: 'text-muted-foreground',
  late: 'font-medium text-rose-700 dark:text-rose-400',
}

const SALE_BADGE: Record<string, string> = {
  SIM: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  NAO: 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300',
  NEGOCIACAO: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300',
}

/** Filtro de lista com "Todos" e, quando faz sentido, "Sem valor". */
function FilterSelect({ label, value, onChange, items, withNone }: { label: string; value: string | null; onChange: (v: string | null) => void; items: { id: string; name: string }[]; withNone?: boolean }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className={cn('w-full', value && 'border-[color:var(--brand)]')} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {withNone && <SelectItem value="none">Sem {label.toLowerCase()}</SelectItem>}
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RecordsList({ kind }: { kind: Kind }) {
  const info = KIND_INFO[kind]
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const options = useOptions()
  const names = useMemo(() => namesOf(options.data), [options.data])
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('search') ?? '')
  const [open, setOpen] = useState<ServiceRecord | 'new' | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const page = Number(params.get('page') ?? '1')
  const openId = params.get('abrir')

  // Link direto para um atendimento (ex.: da pré-venda para o pós-venda gerado).
  useEffect(() => {
    if (!openId) return
    let cancelled = false
    api
      .get<ServiceRecord>(`/atendimentos/${openId}`)
      .then((r) => !cancelled && setOpen(r))
      .catch((err) => toast.error(errorMessage(err)))
    const next = new URLSearchParams(params)
    next.delete('abrir')
    setParams(next, { replace: true })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
    setSelected(new Set())
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== searchText.trim()) setFilter('search', searchText.trim() || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const query = new URLSearchParams({ kind, page: String(page), pageSize: '50' })
  for (const k of FILTER_KEYS) {
    const v = params.get(k)
    if (v) query.set(k, v)
  }
  const activeFilters = FILTER_KEYS.filter((k) => params.get(k)).length

  const list = useQuery({
    queryKey: ['atendimentos', query.toString()],
    queryFn: () => api.get<Page>(`/atendimentos?${query}`),
    placeholderData: keepPreviousData,
  })

  const quick = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch<ServiceRecord>(`/atendimentos/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      void qc.invalidateQueries({ queryKey: ['atendimento-alertas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const move = useMutation({
    mutationFn: () => api.post<{ moved: number }>('/atendimentos/mover', { ids: [...selected], kind: info.other }),
    onSuccess: (r) => {
      toast.success(`${int.format(r.moved)} atendimento(s) movido(s) para ${KIND_INFO[info.other].title}.`)
      setSelected(new Set())
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const exportCsv = async () => {
    const q = new URLSearchParams(query)
    q.delete('page')
    q.delete('pageSize')
    const res = await fetch(`/api/atendimentos/exportar?${q}`, { credentials: 'same-origin' })
    if (!res.ok) {
      toast.error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha ao exportar.')
      return
    }
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: `${kind === 'PRE_VENDAS' ? 'pre-vendas' : 'pos-vendas'}-${new Date().toISOString().slice(0, 10)}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const o = options.data
  const canEdit = can(info.module, 'edit')
  const canMove = canEdit && can(KIND_INFO[info.other].module, 'edit')
  const data = list.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const allOnPage = !!data?.items.length && data.items.every((r) => selected.has(r.id))

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por nome, telefone, código, NF ou observação"
            className="h-8 pl-8"
            aria-label="Buscar atendimentos"
          />
        </div>
        {can(info.module, 'create') && (
          <Button size="sm" onClick={() => setOpen('new')}>
            <PlusIcon /> Novo atendimento
          </Button>
        )}
        {can(info.module, 'export') && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <DownloadIcon /> Exportar
          </Button>
        )}
        {me?.role.isSystem && (
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <UploadIcon /> Importar planilha
          </Button>
        )}
        {me?.role.isSystem && kind === 'PRE_VENDAS' && (
          <Button size="sm" variant="outline" onClick={() => setClearing(true)}>
            <EraserIcon /> Limpar e recomeçar
          </Button>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Input type="date" className="h-8" aria-label="De" value={params.get('from') ?? ''} onChange={(e) => setFilter('from', e.target.value || null)} />
        <Input type="date" className="h-8" aria-label="Até" value={params.get('to') ?? ''} onChange={(e) => setFilter('to', e.target.value || null)} />
        <FilterSelect label="Unidade" value={params.get('unitId')} onChange={(v) => setFilter('unitId', v)} items={o?.units ?? []} withNone />
        <FilterSelect label="Vendedor" value={params.get('sellerId')} onChange={(v) => setFilter('sellerId', v)} items={o?.sellers ?? []} withNone />
        <FilterSelect label="Origem" value={params.get('originId')} onChange={(v) => setFilter('originId', v)} items={o?.origins ?? []} withNone />
        <FilterSelect label="Tipo de cliente" value={params.get('customerTypeId')} onChange={(v) => setFilter('customerTypeId', v)} items={o?.customerTypes ?? []} withNone />
        <FilterSelect
          label="Estado"
          value={params.get('state')}
          onChange={(v) => setFilter('state', v)}
          items={[...UF_LIST.map((uf) => ({ id: uf, name: `${UF_NAMES[uf]} (${uf})` })), { id: 'EX', name: 'Exterior' }]}
        />
        <FilterSelect label="Região" value={params.get('region')} onChange={(v) => setFilter('region', v)} items={REGIONS.map((r) => ({ id: r, name: r }))} />
        <FilterSelect label="Marca" value={params.get('brandId')} onChange={(v) => setFilter('brandId', v)} items={o?.brands ?? []} />
        <FilterSelect label="Tipo de peça" value={params.get('partTypeId')} onChange={(v) => setFilter('partTypeId', v)} items={o?.partTypes ?? []} />
        <FilterSelect label="Repassou" value={params.get('forwarded')} onChange={(v) => setFilter('forwarded', v)} items={[{ id: 'true', name: 'Sim' }, { id: 'false', name: 'Não' }]} />
        <FilterSelect label="Retorno" value={params.get('returnStatus')} onChange={(v) => setFilter('returnStatus', v)} items={(['SIM', 'NAO', 'PENDENTE'] as const).map((s) => ({ id: s, name: RETURN_LABEL[s] }))} />
        <FilterSelect label="Venda" value={params.get('saleStatus')} onChange={(v) => setFilter('saleStatus', v)} items={(['SIM', 'NAO', 'NEGOCIACAO'] as const).map((s) => ({ id: s, name: SALE_LABEL[s] }))} />
        <FilterSelect label="Motivo de perda" value={params.get('lostReasonId')} onChange={(v) => setFilter('lostReasonId', v)} items={o?.lostReasons ?? []} />
        <Button
          size="sm"
          variant={params.get('overdue') ? 'default' : 'outline'}
          className="h-8"
          onClick={() => setFilter('overdue', params.get('overdue') ? null : 'true')}
          aria-pressed={!!params.get('overdue')}
        >
          <AlertTriangleIcon /> Sem retorno
        </Button>
        {kind === 'POS_VENDAS' && (
          <>
            <FilterSelect label="Pós-venda" value={params.get('followStatus')} onChange={(v) => setFilter('followStatus', v)} items={FOLLOW_STATUSES.map((s) => ({ id: s, name: FOLLOW_LABEL[s] }))} />
            <Button
              size="sm"
              variant={params.get('followOverdue') ? 'default' : 'outline'}
              className="h-8"
              onClick={() => setFilter('followOverdue', params.get('followOverdue') ? null : 'true')}
              aria-pressed={!!params.get('followOverdue')}
            >
              <ClockAlertIcon /> Fora do prazo
            </Button>
          </>
        )}
        {kind === 'PRE_VENDAS' && (
          <Button
            size="sm"
            variant={params.get('postSaleReturned') ? 'default' : 'outline'}
            className="h-8"
            onClick={() => setFilter('postSaleReturned', params.get('postSaleReturned') ? null : 'true')}
            aria-pressed={!!params.get('postSaleReturned')}
          >
            <Undo2Icon /> Voltou do pós-venda
          </Button>
        )}
        {activeFilters > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setSearchText('')
              setParams(new URLSearchParams(), { replace: true })
            }}
          >
            <FilterXIcon /> Limpar ({activeFilters})
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>{int.format(selected.size)} selecionado(s)</span>
          {canMove && (
            <Button size="sm" variant="outline" onClick={() => move.mutate()} disabled={move.isPending}>
              {move.isPending ? <Loader2Icon className="animate-spin" /> : <ArrowLeftRightIcon />}
              Mover para {KIND_INFO[info.other].title}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {list.isLoading && <TableSkeleton />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title={activeFilters ? 'Nenhum atendimento com esses filtros' : 'Nenhum atendimento ainda'}
          description={activeFilters ? 'Ajuste ou limpe os filtros.' : 'Registre o primeiro atendimento ou importe a planilha atual.'}
        />
      )}

      {data && data.items.length > 0 && (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canMove && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allOnPage}
                        onCheckedChange={(c) => setSelected(new Set(c ? data.items.map((r) => r.id) : []))}
                        aria-label="Selecionar todos desta página"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-24">Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden lg:table-cell">Origem</TableHead>
                  <TableHead className="hidden xl:table-cell">Interesse</TableHead>
                  <TableHead className="hidden md:table-cell">UF</TableHead>
                  <TableHead className="hidden 2xl:table-cell">Unidade</TableHead>
                  <TableHead className="min-w-36">Vendedor</TableHead>
                  <TableHead className="w-20 text-center">Repassou</TableHead>
                  <TableHead className="w-28">Retorno</TableHead>
                  <TableHead className="w-32">Venda</TableHead>
                  {kind === 'POS_VENDAS' && <TableHead className="w-40">Pós-venda</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id} className={cn('cursor-pointer', r.overdue && 'bg-amber-500/5')} onClick={() => setOpen(r)}>
                    {canMove && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(c) =>
                            setSelected((s) => {
                              const n = new Set(s)
                              if (c) n.add(r.id)
                              else n.delete(r.id)
                              return n
                            })
                          }
                          aria-label={`Selecionar ${r.name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-sm whitespace-nowrap tabular-nums">{formatDay(r.leadAt)}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.customerCode && `Cód. ${r.customerCode}`, formatPhone(r.phone)].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{r.originId ? names.get(r.originId) : '—'}</TableCell>
                    <TableCell className="hidden max-w-48 truncate text-sm xl:table-cell">
                      {[...r.brandIds, ...r.partTypeIds].map((id) => names.get(id)).filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{r.country !== 'BR' ? r.country : (r.state ?? '—')}</TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap 2xl:table-cell">{r.unitId ? names.get(r.unitId) : '—'}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canEdit ? (
                        <Select
                          value={r.sellerId ?? ALL}
                          onValueChange={(v) => quick.mutate({ id: r.id, data: { sellerId: v === ALL ? null : v } })}
                        >
                          <SelectTrigger size="sm" className="h-7 w-full border-transparent bg-transparent px-1.5 shadow-none hover:border-input" aria-label={`Vendedor de ${r.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL}>
                              <span className="text-muted-foreground">Sem vendedor</span>
                            </SelectItem>
                            {o?.sellers.filter((s) => s.active || s.id === r.sellerId).map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">{r.sellerId ? names.get(r.sellerId) : '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={r.forwarded}
                        disabled={!canEdit}
                        onCheckedChange={(c) => quick.mutate({ id: r.id, data: { forwarded: c } })}
                        aria-label={`Repassou ${r.name} ao vendedor`}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {r.forwarded ? (
                        <Select
                          value={r.returnStatus ?? 'PENDENTE'}
                          disabled={!canEdit}
                          onValueChange={(v) => quick.mutate({ id: r.id, data: { returnStatus: v as ReturnStatus } })}
                        >
                          <SelectTrigger
                            size="sm"
                            className={cn('h-7 w-full border-transparent bg-transparent px-1.5 shadow-none hover:border-input', r.overdue && 'font-medium text-amber-700 dark:text-amber-400')}
                            aria-label={`Retorno do vendedor para ${r.name}`}
                          >
                            {r.overdue && <AlertTriangleIcon className="size-3.5" aria-label="Sem retorno além do prazo" />}
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(['SIM', 'NAO', 'PENDENTE'] as const).map((s) => (
                              <SelectItem key={s} value={s}>
                                {RETURN_LABEL[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="px-1.5 text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SALE_BADGE[r.saleStatus]}>
                        {SALE_LABEL[r.saleStatus]}
                      </Badge>
                      {r.saleStatus === 'SIM' && r.saleValue !== null && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{brl.format(r.saleValue)}</p>}
                      {r.saleStatus === 'NAO' && r.lostReasonId && <p className="mt-0.5 truncate text-xs text-muted-foreground">{names.get(r.lostReasonId)}</p>}
                    </TableCell>
                    {kind === 'POS_VENDAS' && (
                      <TableCell>
                        {r.followStatus ? (
                          <>
                            <p className="text-sm">{FOLLOW_LABEL[r.followStatus]}</p>
                            <FollowDeadline r={r} />
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {int.format(data.total)} atendimento(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => setFilterPage(page - 1)} aria-label="Página anterior">
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" disabled={page >= totalPages} onClick={() => setFilterPage(page + 1)} aria-label="Próxima página">
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {open && <RecordSheet kind={kind} record={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      {importing && <ImportDialog kind={kind} onClose={() => setImporting(false)} />}
      {clearing && (
        <ClearDialog
          onClose={() => setClearing(false)}
          onImport={() => {
            setClearing(false)
            setImporting(true)
          }}
        />
      )}
    </>
  )

  function setFilterPage(p: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(p))
    setParams(next, { replace: true })
  }
}

/** Prazo do primeiro contato do pós-venda, recalculado a cada minuto. */
function FollowDeadline({ r }: { r: ServiceRecord }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const d = followDeadline(r, now)
  if (!d) return null
  return <p className={cn('text-xs', DEADLINE_TONE[d.tone])}>{d.text}</p>
}
