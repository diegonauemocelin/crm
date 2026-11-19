import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheckIcon, Loader2Icon, SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { dateTime, dayBr, money } from '@/lib/format'
import { useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface Hint {
  kind: string
  text: string
  diff: number | null
}

interface Row {
  id: string
  code: number
  orderNumber: string | null
  invoiceNumber: string | null
  issuedAt: string | null
  customerName: string | null
  destCity: string | null
  destUf: string | null
  carrierName: string | null
  seller: string | null
  cteNumbers: string | null
  freightMode: string | null
  nfeFreight: number | null
  cteTotal: number | null
  tableExpected: number | null
  quoted: number | null
  hints: Hint[]
  hasDifference: boolean
  suggestedCause: string | null
  audit: { status: 'OK' | 'DIVERGENTE'; cause: string | null; note: string | null; byName: string | null; at: string | null } | null
}

interface AuditList {
  total: number
  page: number
  pageSize: number
  tolerance: number
  sums: { nota: number | null; cte: number | null; tabela: number | null }
  causes: Record<string, string>
  items: Row[]
}

const STATUS_FILTER: Record<string, string> = { PENDENTE: 'A conferir', OK: 'Conferidos sem problema', DIVERGENTE: 'Com divergência', TODOS: 'Todos' }

export function FretesConferenciaPage() {
  return (
    <RequirePermission module="fretes_pedidos">
      <AuditPage />
    </RequirePermission>
  )
}

/** Modalidade do frete na NF-e: 0 = CIF (a empresa paga e cobra do cliente na nota); os demais o cliente ou terceiro paga. */
function modeLabel(mode: string | null) {
  if (mode === null) return null
  return mode === '0' ? 'CIF' : mode === '1' ? 'FOB' : mode === '9' ? 'sem frete' : 'outro'
}

function AuditPage() {
  const active = useActiveUnit()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('PENDENTE')
  const [onlyDiff, setOnlyDiff] = useState(true)
  const [mode, setMode] = useState('CIF')
  const [carrier, setCarrier] = useState('')
  const [seller, setSeller] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<Row | null>(null)
  const qs = new URLSearchParams({ pagina: String(page), situacao: status, frete: mode, diferenca: onlyDiff ? '1' : '0' })
  if (active.unitId) qs.set('filial', active.unitId)
  if (carrier) qs.set('transportadora', carrier)
  if (seller) qs.set('vendedor', seller)
  if (from) qs.set('de', from)
  if (to) qs.set('ate', to)
  if (q) qs.set('busca', q)
  const list = useQuery({
    queryKey: ['fretes', 'conferencia', qs.toString()],
    queryFn: () => api.get<AuditList>(`/fretes/conferencia?${qs}`),
    placeholderData: keepPreviousData,
    enabled: !!active.ctx.data,
  })
  const sellers = useQuery({ queryKey: ['fretes', 'pedidos', 'vendedores'], queryFn: () => api.get<{ name: string; count: number }[]>('/fretes/pedidos/vendedores'), staleTime: 300_000 })
  const carriers = active.ctx.data?.carriers ?? []
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1))
  return (
    <div className="space-y-4">
      <PageHeader
        title="Conferência de frete"
        description="Pedido a pedido: frete cobrado na nota, cobrado no CT-e e esperado pela tabela de frete do CRM. Confira a diferença e registre a causa."
        actions={<FilialSwitch active={active} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(search.trim())
            setPage(1)
          }}
        >
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Nº do pedido, NF, CT-e ou cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select value={status} onValueChange={reset(setStatus)}>
          <SelectTrigger className="w-52" aria-label="Situação da conferência">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_FILTER).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mode} onValueChange={reset(setMode)}>
          <SelectTrigger className="w-56" aria-label="Modalidade do frete" title="CIF: a empresa paga a transportadora (e cobra do cliente na nota). FOB: o cliente ou terceiro paga.">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CIF">CIF (a empresa paga o frete)</SelectItem>
            <SelectItem value="FOB">FOB (cliente paga)</SelectItem>
            <SelectItem value="TODOS">CIF e FOB</SelectItem>
          </SelectContent>
        </Select>
        <Select value={onlyDiff ? '1' : '0'} onValueChange={(v) => (setOnlyDiff(v === '1'), setPage(1))}>
          <SelectTrigger className="w-48" aria-label="Diferença">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Só com diferença</SelectItem>
            <SelectItem value="0">Todos os pedidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={seller || '__todos__'} onValueChange={(v) => (setSeller(v === '__todos__' ? '' : v), setPage(1))}>
          <SelectTrigger className="w-52" aria-label="Vendedor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todos os vendedores</SelectItem>
            {(sellers.data ?? []).map((v) => (
              <SelectItem key={v.name} value={v.name}>
                {v.name} ({v.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={carrier || '__todas__'} onValueChange={(v) => (setCarrier(v === '__todas__' ? '' : v), setPage(1))}>
          <SelectTrigger className="w-52" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas__">Todas as transportadoras</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="w-40" aria-label="Notas emitidas desde" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        <Input type="date" className="w-40" aria-label="Notas emitidas até" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
      </div>
      {data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Pedidos" value={String(data.total)} />
          <Stat label="Cobrado nas notas (CIF)" value={money(data.sums.nota)} />
          <Stat label="Cobrado nos CT-es" value={money(data.sums.cte)} />
          <Stat label="Esperado pela tabela" value={money(data.sums.tabela)} />
        </div>
      )}
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !data?.items.length ? (
        <EmptyState
          icon={ClipboardCheckIcon}
          title="Nada para conferir"
          description={onlyDiff ? 'Nenhum pedido com diferença nestes filtros. Troque para "Todos os pedidos" para ver os demais.' : 'Nenhum pedido nestes filtros.'}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido / NF</TableHead>
                <TableHead className="hidden md:table-cell">Cliente / destino</TableHead>
                <TableHead>Transportadora / CT-e</TableHead>
                <TableHead className="text-right" title="Frete destacado na NF-e. CIF: a empresa paga a transportadora e cobra do cliente na nota.">
                  Na nota
                </TableHead>
                <TableHead className="text-right">CT-e</TableHead>
                <TableHead className="text-right" title="Esperado pela tabela de frete do CRM na conferência do CT-e. Embaixo, o cotado no pedido.">
                  Tabela
                </TableHead>
                <TableHead>Diferenças</TableHead>
                <TableHead>Conferência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer align-top" onClick={() => setOpen(r)}>
                  <TableCell className="text-sm">
                    <span className="font-medium">NF {r.invoiceNumber ?? '—'}</span>
                    <span className="block text-xs text-muted-foreground">
                      Pedido {r.code}
                      {r.issuedAt ? ` · ${dayBr(r.issuedAt)}` : ''}
                    </span>
                    {r.seller && <span className="block text-xs text-muted-foreground">Vendedor: {r.seller}</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {r.customerName ?? '—'}
                    <span className="block text-xs text-muted-foreground">
                      {r.destCity ?? ''}
                      {r.destUf ? `/${r.destUf}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.carrierName ?? '—'}
                    {r.cteNumbers && <span className="block text-xs text-muted-foreground">CT-e {r.cteNumbers}</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.freightMode === null ? '—' : money(r.nfeFreight ?? 0)}
                    {modeLabel(r.freightMode) && <span className="block text-xs text-muted-foreground">{modeLabel(r.freightMode)}</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{money(r.cteTotal)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {money(r.tableExpected)}
                    {r.quoted != null && <span className="block text-xs text-muted-foreground">cotado {money(r.quoted)}</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.hints.length ? (
                      r.hints.map((h) => (
                        <span key={h.kind} className={cn('block', h.diff !== null ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                          {h.text}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Sem diferença</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.audit ? (
                      <>
                        <Badge variant="outline" className={r.audit.status === 'OK' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400' : 'border-destructive/40 text-destructive'}>
                          {r.audit.status === 'OK' ? 'Conferido' : 'Divergência'}
                        </Badge>
                        {r.audit.cause && <span className="mt-1 block">{data.causes[r.audit.cause] ?? r.audit.cause}</span>}
                        <span className="block text-muted-foreground">{r.audit.byName}</span>
                      </>
                    ) : (
                      <Badge variant="outline">A conferir</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span>
                {page} de {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
      {open && data && <AuditDialog row={open} causes={data.causes} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function AuditDialog({ row, causes, onClose }: { row: Row; causes: Record<string, string>; onClose: () => void }) {
  const qc = useQueryClient()
  const [cause, setCause] = useState(row.audit?.cause ?? row.suggestedCause ?? '')
  const [note, setNote] = useState(row.audit?.note ?? '')
  const save = useMutation({
    mutationFn: (status: 'OK' | 'DIVERGENTE' | null) =>
      api.patch(`/fretes/conferencia/${row.id}`, { status, causa: status === 'DIVERGENTE' ? cause || null : status === 'OK' ? cause || null : null, observacao: status ? note.trim() || null : null }),
    onSuccess: (_, status) => {
      toast.success(status ? 'Conferência registrada.' : 'Conferência desfeita.')
      qc.invalidateQueries({ queryKey: ['fretes', 'conferencia'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            NF {row.invoiceNumber ?? '—'} · pedido {row.code}
          </DialogTitle>
          <DialogDescription>
            {row.customerName ?? ''}
            {row.seller ? ` · Vendedor: ${row.seller}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <Value label={`Na nota${modeLabel(row.freightMode) ? ` (${modeLabel(row.freightMode)})` : ''}`} value={row.freightMode === null ? '—' : money(row.nfeFreight ?? 0)} />
          <Value label="CT-e" value={money(row.cteTotal)} />
          <Value label="Tabela" value={money(row.tableExpected)} />
        </div>
        {row.hints.length > 0 && (
          <ul className="space-y-0.5 text-sm">
            {row.hints.map((h) => (
              <li key={h.kind} className={h.diff !== null ? 'text-destructive' : 'text-muted-foreground'}>
                {h.text}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1.5">
          <Label>Causa da diferença</Label>
          <Select value={cause || '__nenhuma__'} onValueChange={(v) => setCause(v === '__nenhuma__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nenhuma__">Sem causa (sem problema)</SelectItem>
              {Object.entries(causes).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf-obs">Observação</Label>
          <Textarea id="conf-obs" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que foi verificado, com quem falou, providência..." />
        </div>
        {row.audit && (
          <p className="text-xs text-muted-foreground">
            Conferido por {row.audit.byName} em {row.audit.at ? dateTime(row.audit.at) : '—'}.
          </p>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Link className="mr-auto self-center text-xs underline underline-offset-2" to={`/fretes/pedidos?busca=${row.code}`}>
            Abrir o pedido
          </Link>
          <Can module="fretes_pedidos" action="edit">
            {row.audit && (
              <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
                Desfazer
              </Button>
            )}
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate('OK')}>
              Sem problema
            </Button>
            <Button disabled={save.isPending || !cause} onClick={() => save.mutate('DIVERGENTE')} title={cause ? undefined : 'Escolha a causa'}>
              {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Registrar divergência
            </Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  )
}
