import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, FileCheck2Icon, Loader2Icon, RefreshCwIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money } from '@/lib/format'
import { CONTEST, DECISION, fmtNum, formatCep, formatCnpj, formatKey, INVOICE_STATUS, REC_STATUS, REC_TYPE, SHIPMENT_STATUS, useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface RecLine {
  name: string
  expected: number | null
  charged: number | null
  difference: number
  status: 'OK' | 'DIFERENTE' | 'NAO_PREVISTA' | 'NAO_COBRADA' | 'DUPLICADA'
}

interface Cte {
  id: string
  key: string
  number: string | null
  series: string | null
  issuedAt: string | null
  emitCnpj: string | null
  emitName: string | null
  carrierId: string | null
  carrierName: string | null
  unitId: string | null
  unitName?: string | null
  recipientName: string | null
  ufIni: string | null
  ufFim: string | null
  cityIni: string | null
  cityFim: string | null
  destZip: string | null
  total: number
  cargoValue: number | null
  weight: number | null
  components?: { name: string; value: number }[]
  icms: { rate: number | null; value: number | null; base?: number | null } | null
  nfeKeys: string[]
  fiscalStatus: string
  protocol: string | null
  shipmentId: string | null
  recStatus: string
  recTypes: string[]
  recSource: string | null
  expectedTotal: number | null
  difference: number | null
  recDetail?: { reference?: string; reason?: string; allowed?: number; lines?: RecLine[]; notes?: string[] } | null
  recAt: string | null
  decision: string | null
  approvedValue: number | null
  decisionNote: string | null
  decidedByName: string | null
  decidedAt: string | null
  contestStatus: string | null
  creditValue: number | null
  contestNote: string | null
  invoiceId: string | null
  importedByName: string
  createdAt: string
  shipment?: { id: string; code: number; orderNumber: string | null; invoiceNumber: string | null; status: string } | null
  invoice?: { id: string; number: string; status: string } | null
}

interface CteList {
  total: number
  pageSize: number
  counts: Record<string, number>
  sums: { charged: number; expected: number; difference: number; approved: number; credit: number }
  items: Cte[]
}

const LINE_STATUS: Record<RecLine['status'], { label: string; className: string }> = {
  OK: { label: 'Confere', className: 'text-[#006300] dark:text-[#0ca30c]' },
  DIFERENTE: { label: 'Diferente', className: 'text-destructive' },
  NAO_PREVISTA: { label: 'Não prevista', className: 'text-destructive' },
  DUPLICADA: { label: 'Duplicada', className: 'text-destructive' },
  NAO_COBRADA: { label: 'Não cobrada', className: 'text-muted-foreground' },
}

export function FretesCtesPage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteList pendingOnly={false} />
    </RequirePermission>
  )
}

/** Fila de conciliação: divergentes e sem referência sem decisão, e contestações abertas. */
export function FretesConciliacaoPage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteList pendingOnly />
    </RequirePermission>
  )
}

function CteList({ pendingOnly }: { pendingOnly: boolean }) {
  const active = useActiveUnit()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const status = params.get('situacao') ?? ''
  const decision = params.get('decisao') ?? ''
  const carrier = params.get('transportadora') ?? ''
  const from = params.get('de') ?? ''
  const to = params.get('ate') ?? ''
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next)
    setPage(1)
  }
  const qs = new URLSearchParams({ pagina: String(page) })
  if (pendingOnly) qs.set('pendentes', '1')
  if (q) qs.set('busca', q)
  if (status) qs.set('situacao', status)
  if (decision) qs.set('decisao', decision)
  if (carrier) qs.set('transportadora', carrier)
  if (from) qs.set('de', from)
  if (to) qs.set('ate', to)
  if (active.unitId) qs.set('filial', active.unitId)
  const list = useQuery({
    queryKey: ['fretes', 'ctes', qs.toString()],
    queryFn: () => api.get<CteList>(`/fretes/ctes?${qs}`),
    placeholderData: keepPreviousData,
    enabled: !!active.ctx.data,
  })
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const carriers = active.ctx.data?.carriers ?? []
  return (
    <div className="space-y-4">
      <PageHeader
        title={pendingOnly ? 'Conciliação de fretes' : 'CT-e'}
        description={
          pendingOnly
            ? 'CT-es que precisam de decisão: divergentes, sem referência para comparar e contestações abertas. Os que conferem são aprovados sozinhos.'
            : 'Importe os XMLs dos CT-es: o sistema identifica transportadora, filial e pedido, e compara o cobrado com a cotação escolhida ou com a tabela vigente na data.'
        }
        actions={
          <>
            <FilialSwitch active={active} />
            <Can module="fretes_cte" action="create">
              <Button onClick={() => setImporting(true)}>
                <UploadIcon aria-hidden /> Importar XML
              </Button>
            </Can>
          </>
        }
      />
      {!pendingOnly && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={!status ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', '')}>
            Todos
          </Button>
          {Object.entries(REC_STATUS).map(([k, v]) => (
            <Button key={k} size="sm" variant={status === k ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', k)}>
              {v.label}
              <span className="ml-1 text-xs text-muted-foreground">{list.data?.counts[k] ?? 0}</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(search.trim())
            setPage(1)
          }}
        >
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Nº do CT-e, destinatário, cidade, chave do CT-e ou da NF-e" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select value={carrier || '__all__'} onValueChange={(v) => setParam('transportadora', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-52" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as transportadoras</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!pendingOnly && (
          <Select value={decision || '__all__'} onValueChange={(v) => setParam('decisao', v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-56" aria-label="Decisão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Qualquer decisão</SelectItem>
              <SelectItem value="SEM_DECISAO">Sem decisão</SelectItem>
              {Object.entries(DECISION).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
              <SelectItem value="CONTESTACAO_ABERTA">Contestação aberta</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Input type="date" className="w-40" aria-label="Emitidos desde" value={from} onChange={(e) => setParam('de', e.target.value)} />
        <Input type="date" className="w-40" aria-label="Emitidos até" value={to} onChange={(e) => setParam('ate', e.target.value)} />
      </div>
      {list.data && (
        <div className="grid gap-2 sm:grid-cols-5">
          <Sum label="Cobrado" value={list.data.sums.charged} />
          <Sum label="Esperado" value={list.data.sums.expected} />
          <Sum label="Diferença" value={list.data.sums.difference} danger={list.data.sums.difference > 0.009} />
          <Sum label="Aprovado" value={list.data.sums.approved} />
          <Sum label="Créditos obtidos" value={list.data.sums.credit} />
        </div>
      )}
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={FileCheck2Icon} title={pendingOnly ? 'Nada para conciliar' : 'Nenhum CT-e'} description={pendingOnly ? 'Todos os CT-es do filtro conferem ou já têm decisão.' : 'Importe os XMLs dos CT-es (um a um ou num .zip).'} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CT-e</TableHead>
                <TableHead>Transportadora</TableHead>
                <TableHead className="hidden md:table-cell">Rota</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead>Conciliação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-2 hover:underline" to={`/fretes/ctes/${c.id}`}>
                      {c.number ?? '—'}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">{c.issuedAt ? dayBr(c.issuedAt) : '—'}</span>
                  </TableCell>
                  <TableCell className="text-sm">{c.carrierName ?? c.emitName ?? '—'}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {c.cityIni}/{c.ufIni} → {c.cityFim}/{c.ufFim}
                    {c.weight !== null && <span className="block text-xs text-muted-foreground">{fmtNum(c.weight)} kg</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.expectedTotal)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', (c.difference ?? 0) > 0.009 && 'text-destructive')}>{c.difference === null ? '—' : money(c.difference)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                      {REC_STATUS[c.recStatus]?.label ?? c.recStatus}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">{c.contestStatus ? CONTEST[c.contestStatus] : c.decision ? DECISION[c.decision] : c.recTypes.map((t) => REC_TYPE[t] ?? t).join(', ')}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{list.data.total} CT-e(s)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="self-center">
                {page} de {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
      {importing && <ImportCtes onClose={() => setImporting(false)} />}
    </div>
  )
}

function Sum({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-semibold tabular-nums', danger && 'text-destructive')}>{money(value)}</p>
    </div>
  )
}

interface ImportResult {
  imported: number
  duplicated: number
  cancelled: number
  linked: number
  ignored: { file: string; reason: string }[]
  icmsUpdated: { uf: string; to: number }[]
}

function ImportCtes({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      for (const f of files) fd.append('arquivos', f)
      return api.post<ImportResult>('/fretes/ctes/importar', fd)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(`${r.imported} CT-e(s) importado(s), ${r.linked} ligado(s) a pedidos.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const r = m.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar CT-e</DialogTitle>
          <DialogDescription>XMLs dos CT-es ou um .zip com eles (até 500). Eventos de cancelamento também são aceitos. CT-e já importado é pulado pela chave.</DialogDescription>
        </DialogHeader>
        <Input type="file" multiple accept=".xml,.zip,.gz" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        {r && (
          <div className="space-y-2 text-sm">
            <p>
              {r.imported} novo(s) · {r.duplicated} já existiam · {r.cancelled} cancelamento(s) · {r.linked} ligado(s) a pedidos
            </p>
            {r.icmsUpdated.length > 0 && <p>Alíquota interna de ICMS atualizada: {r.icmsUpdated.map((i) => `${i.uf} ${fmtNum(i.to, 2)}%`).join(', ')}.</p>}
            {r.ignored.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
                {r.ignored.map((i, k) => (
                  <p key={k}>
                    {i.file}: {i.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!files.length || m.isPending}>
            {m.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FretesCteDetalhePage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteDetail />
    </RequirePermission>
  )
}

function CteDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['fretes', 'cte', id], queryFn: () => api.get<Cte>(`/fretes/ctes/${id}`) })
  const done = (d: Cte, msg: string) => {
    qc.setQueryData(['fretes', 'cte', id], d)
    qc.invalidateQueries({ queryKey: ['fretes', 'ctes'] })
    toast.success(msg)
  }
  const reprocess = useMutation({ mutationFn: () => api.post<Cte>(`/fretes/ctes/${id}/reconciliar`), onSuccess: (d) => done(d, 'Conciliação refeita.'), onError: (e) => toast.error(errorMessage(e)) })
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const c = q.data
  const editable = can('fretes_cte', 'edit') && c.fiscalStatus !== 'CANCELADO'
  const lines = c.recDetail?.lines ?? []
  return (
    <div className="space-y-4">
      <PageHeader
        title={`CT-e ${c.number ?? ''}${c.series ? ` série ${c.series}` : ''}`}
        description={`${c.carrierName ?? c.emitName ?? 'Transportadora não cadastrada'} · emitido em ${dateTime(c.issuedAt)} · ${c.unitName ?? 'filial não identificada'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button variant="outline" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}>
                {reprocess.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />} Conciliar de novo
              </Button>
            )}
            <Can module="fretes_cte" action="export">
              <Button variant="outline" onClick={() => api.download(`/fretes/ctes/${c.id}/xml`, `CTe${c.key}.xml`).catch((e) => toast.error(errorMessage(e)))}>
                <DownloadIcon aria-hidden /> XML
              </Button>
            </Can>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Conciliação
              <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                {REC_STATUS[c.recStatus]?.label ?? c.recStatus}
              </Badge>
              {c.recTypes.map((t) => (
                <Badge key={t} variant="outline" className="border-destructive/50 text-destructive">
                  {REC_TYPE[t] ?? t}
                </Badge>
              ))}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.recDetail?.reason && <p className="text-sm text-amber-700 dark:text-amber-300">{c.recDetail.reason}</p>}
            {c.recDetail?.reference && (
              <p className="text-sm text-muted-foreground">
                Referência: {c.recDetail.reference}
                {c.recDetail.allowed !== undefined && ` · tolerância ${money(c.recDetail.allowed)}`}
              </p>
            )}
            {lines.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Componente</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.expected === null ? '—' : money(l.expected)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.charged === null ? '—' : money(l.charged)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.difference)}</TableCell>
                      <TableCell className={cn('text-sm', LINE_STATUS[l.status].className)}>{LINE_STATUS[l.status].label}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.expectedTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.total)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', (c.difference ?? 0) > 0.009 && 'text-destructive')}>{money(c.difference)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
            {!lines.length && c.components && c.components.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Componentes cobrados</p>
                {c.components.map((x, i) => (
                  <p key={i}>
                    {x.name}: {money(x.value)}
                  </p>
                ))}
              </div>
            )}
            {c.recDetail?.notes?.map((n, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {n}
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dados do CT-e</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Info label="Chave" value={formatKey(c.key)} />
            <Info label="Emitente" value={`${c.emitName ?? '—'} · ${formatCnpj(c.emitCnpj)}`} />
            <Info label="Origem" value={`${c.cityIni ?? '—'}/${c.ufIni ?? ''}`} />
            <Info label="Destino" value={`${c.cityFim ?? '—'}/${c.ufFim ?? ''} · CEP ${formatCep(c.destZip)}`} />
            <Info label="Destinatário" value={c.recipientName ?? '—'} />
            <Info label="Valor da carga" value={money(c.cargoValue)} />
            <Info label="Peso" value={c.weight === null ? '—' : `${fmtNum(c.weight)} kg`} />
            <Info label="ICMS" value={c.icms ? `${c.icms.rate === null ? '—' : `${fmtNum(c.icms.rate, 2)}%`} · ${money(c.icms.value)}` : '—'} />
            <Info label="NF-e" value={c.nfeKeys.length ? c.nfeKeys.map(formatKey).join(', ') : '—'} />
            <Info label="Situação fiscal" value={c.fiscalStatus === 'CANCELADO' ? 'Cancelado' : `Não conferido na SEFAZ${c.protocol ? ` · protocolo ${c.protocol}` : ''}`} />
            <Info label="Importado" value={`${dateTime(c.createdAt)} por ${c.importedByName}`} />
            {c.invoice && (
              <Info
                label="Fatura"
                value={
                  <Link className="underline underline-offset-2" to={`/fretes/faturas/${c.invoice.id}`}>
                    {c.invoice.number} · {INVOICE_STATUS[c.invoice.status]?.label}
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ShipmentLink cte={c} editable={editable} onDone={(d) => done(d, 'Pedido atualizado e conciliação refeita.')} />
        <DecisionCard cte={c} editable={editable} onDone={done} />
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[7.5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </p>
  )
}

function ShipmentLink({ cte, editable, onDone }: { cte: Cte; editable: boolean; onDone: (d: Cte) => void }) {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const found = useQuery({
    queryKey: ['fretes', 'pedidos', 'vincular', term],
    queryFn: () => api.get<{ items: { id: string; code: number; orderNumber: string | null; invoiceNumber: string | null; customerName: string | null; destCity: string | null; status: string }[] }>(`/fretes/pedidos?busca=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  })
  const link = useMutation({ mutationFn: (shipmentId: string | null) => api.post<Cte>(`/fretes/ctes/${cte.id}/pedido`, { shipmentId }), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cte.shipment ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link className="font-medium underline underline-offset-2" to={`/fretes/pedidos?busca=${cte.shipment.code}`}>
              Pedido nº {cte.shipment.code}
            </Link>
            <span>
              {cte.shipment.orderNumber ?? '—'} · NF {cte.shipment.invoiceNumber ?? '—'}
            </span>
            <Badge variant="outline" className={SHIPMENT_STATUS[cte.shipment.status]?.className}>
              {SHIPMENT_STATUS[cte.shipment.status]?.label}
            </Badge>
            {editable && (
              <Button size="sm" variant="ghost" onClick={() => link.mutate(null)} disabled={link.isPending}>
                Desligar
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Sem pedido. Sem ele, o CT-e é comparado com a tabela vigente na data de emissão.</p>
        )}
        {editable && (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setTerm(search.trim())
              }}
            >
              <Input placeholder="Buscar pedido por nº, NF, cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button type="submit" variant="outline">
                Buscar
              </Button>
            </form>
            {found.data?.items.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span>
                  Nº {s.code} · {s.orderNumber ?? '—'} · NF {s.invoiceNumber ?? '—'} · {s.customerName ?? ''} {s.destCity ?? ''}
                </span>
                <Button size="sm" onClick={() => link.mutate(s.id)} disabled={link.isPending || s.id === cte.shipmentId}>
                  Ligar
                </Button>
              </div>
            ))}
            {found.data && !found.data.items.length && <p className="text-muted-foreground">Nenhum pedido encontrado.</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function DecisionCard({ cte, editable, onDone }: { cte: Cte; editable: boolean; onDone: (d: Cte, msg: string) => void }) {
  const [decision, setDecision] = useState<'APROVADO' | 'APROVADO_COTADO' | 'CONTESTADO' | ''>('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<'ACEITA' | 'RECUSADA' | ''>('')
  const [credit, setCredit] = useState<number | null>(cte.expectedTotal !== null ? Math.max(0, Math.round((cte.total - (cte.approvedValue ?? cte.expectedTotal)) * 100) / 100) : null)
  const [contestNote, setContestNote] = useState('')
  const decide = useMutation({
    mutationFn: () => api.post<Cte>(`/fretes/ctes/${cte.id}/decisao`, { decision, note: note || null }),
    onSuccess: (d) => (onDone(d, 'Decisão registrada.'), setDecision(''), setNote('')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const contest = useMutation({
    mutationFn: () => api.post<Cte>(`/fretes/ctes/${cte.id}/contestacao`, { result, creditValue: result === 'ACEITA' ? credit : null, note: contestNote || null }),
    onSuccess: (d) => (onDone(d, 'Resultado da contestação registrado.'), setResult('')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisão</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cte.decision ? (
          <div className="space-y-1">
            <p className="font-medium">{DECISION[cte.decision]}</p>
            <p>
              Cobrado {money(cte.total)} · aprovado {money(cte.approvedValue)}
              {cte.creditValue !== null && ` · crédito ${money(cte.creditValue)}`}
            </p>
            {cte.decisionNote && <p className="text-muted-foreground">{cte.decisionNote}</p>}
            <p className="text-xs text-muted-foreground">
              {cte.decidedByName} · {dateTime(cte.decidedAt)}
            </p>
            {cte.contestStatus && (
              <p>
                <Badge variant="outline">{CONTEST[cte.contestStatus]}</Badge> {cte.contestNote}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Sem decisão. CT-e que confere é aprovado sozinho; os demais esperam aqui.</p>
        )}
        {editable && cte.contestStatus === 'ABERTA' && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="font-medium">Resultado da contestação</p>
            <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
              <SelectTrigger className="w-full" aria-label="Resultado">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACEITA">Aceita pela transportadora (crédito ou abatimento)</SelectItem>
                <SelectItem value="RECUSADA">Recusada (paga o cobrado)</SelectItem>
              </SelectContent>
            </Select>
            {result === 'ACEITA' && (
              <div className="space-y-1.5">
                <Label htmlFor="ct-credit">Crédito obtido</Label>
                <MoneyInput id="ct-credit" value={credit} onChange={setCredit} />
              </div>
            )}
            <Input aria-label="Observação" placeholder="Observação (nº do protocolo, carta de correção...)" value={contestNote} onChange={(e) => setContestNote(e.target.value)} />
            <Button onClick={() => contest.mutate()} disabled={!result || contest.isPending}>
              {contest.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Registrar
            </Button>
          </div>
        )}
        {editable && cte.contestStatus !== 'ABERTA' && !cte.invoiceId && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="font-medium">{cte.decision ? 'Mudar a decisão' : 'Decidir'}</p>
            <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
              <SelectTrigger className="w-full" aria-label="Decisão">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APROVADO">Aprovar o cobrado ({money(cte.total)})</SelectItem>
                {cte.expectedTotal !== null && <SelectItem value="APROVADO_COTADO">Aprovar o esperado ({money(cte.expectedTotal)}) e contestar a diferença</SelectItem>}
                <SelectItem value="CONTESTADO">Contestar o CT-e inteiro</SelectItem>
              </SelectContent>
            </Select>
            <Textarea rows={2} aria-label="Motivo" placeholder={decision && decision !== 'APROVADO' ? 'Motivo (obrigatório): ex. frete peso acima da tabela' : 'Observação'} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button onClick={() => decide.mutate()} disabled={!decision || decide.isPending}>
              {decide.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Registrar decisão
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
