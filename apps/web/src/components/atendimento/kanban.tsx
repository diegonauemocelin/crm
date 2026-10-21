import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { ClockAlertIcon, Loader2Icon, PlusIcon, SearchIcon } from 'lucide-react'
import { type DragEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'
import { money } from '@/lib/format'
import { formatDay, namesOf, type ServiceRecord, todaySP, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { RecordSheet } from './record-sheet'

/**
 * Pré-Vendas em quadro (telas novas): uma coluna por etapa. Arrastar o cartão muda a etapa; Vendida e Perdida abrem a
 * ficha, porque pedem nota fiscal e valor, ou o motivo da perda.
 */

type ColumnId = 'nova' | 'vendedor' | 'retornou' | 'vendida' | 'perdida'

interface Column {
  id: ColumnId
  title: string
  dot: string
  hint: string
}

const COLUMNS: Column[] = [
  { id: 'nova', title: 'Nova', dot: 'bg-slate-500', hint: 'Ainda não repassada ao vendedor' },
  { id: 'vendedor', title: 'Com o vendedor', dot: 'bg-violet-600', hint: 'Repassada, esperando o vendedor retornar' },
  { id: 'retornou', title: 'Vendedor retornou', dot: 'bg-blue-600', hint: 'Em negociação com o cliente' },
  { id: 'vendida', title: 'Vendida', dot: 'bg-green-600', hint: 'Venda realizada no período' },
  { id: 'perdida', title: 'Perdida', dot: 'bg-red-600', hint: 'Venda perdida no período' },
]

interface Page {
  total: number
  alertHours: number
  items: ServiceRecord[]
}

const PERIODS = [
  { v: '30', label: 'Últimos 30 dias' },
  { v: '60', label: 'Últimos 60 dias' },
  { v: '90', label: 'Últimos 90 dias' },
  { v: '365', label: 'Último ano' },
]

function columnOf(r: ServiceRecord): ColumnId {
  if (r.saleStatus === 'SIM') return 'vendida'
  if (r.saleStatus === 'NAO') return 'perdida'
  if (!r.forwarded) return 'nova'
  return r.returnStatus === 'SIM' ? 'retornou' : 'vendedor'
}

/** O que muda no atendimento ao soltar o cartão na coluna (Vendida e Perdida pedem dados: abrem a ficha). */
const MOVE: Partial<Record<ColumnId, Record<string, unknown>>> = {
  nova: { forwarded: false, saleStatus: 'NEGOCIACAO' },
  vendedor: { forwarded: true, returnStatus: 'PENDENTE', saleStatus: 'NEGOCIACAO' },
  retornou: { forwarded: true, returnStatus: 'SIM', saleStatus: 'NEGOCIACAO' },
}

const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000))
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} dia(s)`
}

export function PreVendasKanban() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('pre_vendas', 'edit')
  const options = useOptions()
  const names = useMemo(() => namesOf(options.data), [options.data])
  const [days, setDays] = useState('60')
  const [sellerId, setSellerId] = useState('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<ServiceRecord | 'new' | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<ColumnId | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const base = { kind: 'PRE_VENDAS', from: todaySP(-Number(days)), pageSize: '100', sort: 'leadAt', dir: 'desc', ...(sellerId !== 'all' ? { sellerId } : {}), ...(q ? { search: q } : {}) }
  // Três consultas: em andamento (divididas em Nova / Com o vendedor / Retornou), vendidas e perdidas.
  const groups = [{ saleStatus: 'NEGOCIACAO' }, { saleStatus: 'SIM' }, { saleStatus: 'NAO' }]
  const results = useQueries({
    queries: groups.map((g) => {
      const qs = new URLSearchParams({ ...base, ...g }).toString()
      return { queryKey: ['atendimentos', 'quadro', qs], queryFn: () => api.get<Page>(`/atendimentos?${qs}`) }
    }),
  })
  const error = results.find((r) => r.error)?.error
  const loading = results.some((r) => r.isLoading)
  const alertHours = results[0]?.data?.alertHours ?? 24

  const byColumn = useMemo(() => {
    const m: Record<ColumnId, ServiceRecord[]> = { nova: [], vendedor: [], retornou: [], vendida: [], perdida: [] }
    for (const r of results) for (const item of r.data?.items ?? []) m[columnOf(item)].push(item)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join()])
  const more = (results[1]?.data && results[1].data.total > results[1].data.items.length) || (results[0]?.data && results[0].data.total > results[0].data.items.length)

  const move = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch<ServiceRecord>(`/atendimentos/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      void qc.invalidateQueries({ queryKey: ['atendimento-alertas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const drop = (col: ColumnId, e: DragEvent) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null)
    const rec = Object.values(byColumn).flat().find((r) => r.id === id)
    if (!rec || columnOf(rec) === col) return
    const data = MOVE[col]
    if (!data) {
      setOpen(rec)
      toast.info(col === 'vendida' ? 'Marque "Vendeu" e informe a nota fiscal e o valor.' : 'Marque a venda como perdida e informe o motivo.')
      return
    }
    if (col === 'vendedor' && !rec.sellerId) {
      setOpen(rec)
      toast.info('Escolha o vendedor e marque "Repassou ao vendedor".')
      return
    }
    move.mutate({ id: rec.id, data })
  }

  if (error) return <ErrorState error={error} onRetry={() => results.forEach((r) => void r.refetch())} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, telefone ou código" className="h-9 pl-8" aria-label="Buscar no quadro" />
        </div>
        <Select value={sellerId} onValueChange={setSellerId}>
          <SelectTrigger className="h-9 w-48" aria-label="Vendedor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os vendedores</SelectItem>
            <SelectItem value="none">Sem vendedor</SelectItem>
            {(options.data?.sellers ?? []).filter((s) => s.active).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-9 w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.v} value={p.v}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(loading || move.isPending) && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        {can('pre_vendas', 'create') && (
          <Button className="ml-auto" onClick={() => setOpen('new')}>
            <PlusIcon /> Nova pré-venda
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {canEdit ? 'Arraste o cartão para outra coluna para mudar a etapa. ' : ''}Faixa laranja: repassada há mais de {alertHours} h sem retorno do vendedor.
        {more ? ' Mostrando os 100 mais recentes de cada grupo; use a busca ou o vendedor para achar os outros.' : ''}
      </p>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-3">
          {COLUMNS.map((col) => {
            const list = byColumn[col.id]
            return (
              <section
                key={col.id}
                aria-label={col.title}
                onDragOver={(e) => {
                  if (!canEdit || !dragId) return
                  e.preventDefault()
                  setOver(col.id)
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={(e) => drop(col.id, e)}
                className={cn('flex w-72 flex-col gap-2 rounded-xl bg-muted/60 p-2 transition-colors', over === col.id && 'bg-[color:var(--brand)]/10 ring-2 ring-[color:var(--brand)]')}
              >
                <div className="flex items-center gap-2 px-1 pt-1" title={col.hint}>
                  <span className={cn('size-2 rounded-full', col.dot)} aria-hidden />
                  <h3 className="text-sm font-semibold">{col.title}</h3>
                  <span className="rounded-full bg-background px-2 text-xs text-muted-foreground tabular-nums">{list.length}</span>
                </div>
                <div className="flex max-h-[calc(100vh-17rem)] min-h-24 flex-col gap-2 overflow-y-auto">
                  {list.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{loading ? 'Carregando…' : 'Nenhum'}</p>}
                  {list.map((r) => {
                    const late = r.overdue
                    const parts = [...r.partTypeIds, ...r.brandIds].map((id) => names.get(id)).filter(Boolean).join(' · ')
                    return (
                      <button
                        key={r.id}
                        type="button"
                        draggable={canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', r.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDragId(r.id)
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setOver(null)
                        }}
                        onClick={() => setOpen(r)}
                        className={cn(
                          'flex flex-col gap-1 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-[color:var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          canEdit && 'cursor-grab active:cursor-grabbing',
                          late && 'border-orange-300 border-l-4 border-l-orange-500 dark:border-orange-500/50',
                          dragId === r.id && 'opacity-50',
                        )}
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-medium">{r.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDay(r.leadAt)}</span>
                        </span>
                        {parts && <span className="truncate text-xs text-muted-foreground">{parts}</span>}
                        <span className="flex flex-wrap items-center gap-1.5 text-xs">
                          {r.sellerId ? (
                            <span className="rounded-full bg-muted px-2 py-0.5">{names.get(r.sellerId) ?? 'Vendedor'}</span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Sem vendedor</span>
                          )}
                          {late && (
                            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                              <ClockAlertIcon className="size-3" /> sem retorno há {ago(r.forwardedAt)}
                            </span>
                          )}
                          {col.id === 'vendida' && r.saleValue !== null && (
                            <span className="ml-auto font-medium text-green-700 dark:text-green-400">{money(Number(r.saleValue))}</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
      {open && <RecordSheet kind="PRE_VENDAS" record={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  )
}
