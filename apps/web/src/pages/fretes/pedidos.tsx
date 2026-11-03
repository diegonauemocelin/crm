import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PackageIcon, PlusIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money } from '@/lib/format'
import { fmtNum, formatCep, maskCep, parseBr, REC_STATUS, SHIPMENT_STATUS, useActiveUnit, useFreightContext } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface Shipment {
  id: string
  code: number
  unitId: string
  unitName?: string | null
  orderNumber: string | null
  invoiceNumber: string | null
  invoiceKey: string | null
  customerName: string | null
  customerDoc: string | null
  personType: 'PF' | 'PJ'
  destZip: string | null
  destCity: string | null
  destUf: string | null
  cargoValue: number | null
  weight: number | null
  volumesCount: number | null
  carrierId: string | null
  carrierName: string | null
  quoteId: string | null
  expected: { quoteCode?: number; carrierName?: string; tableName?: string; versionNumber?: number; total?: number; deadlineDays?: number | null } | null
  expectedTotal: number | null
  status: string
  collectedAt: string | null
  shippedAt: string | null
  expectedDeliveryAt: string | null
  deliveredAt: string | null
  trackingCode: string | null
  notes: string | null
  createdByName: string
  createdAt: string
  cte?: { number: string | null; total: number; recStatus: string } | null
  events?: { id: string; status: string; note: string | null; userName: string; createdAt: string }[]
  ctes?: { id: string; number: string | null; total: number; recStatus: string; issuedAt: string | null }[]
}

const ORDER = ['AGUARDANDO_COTACAO', 'AGUARDANDO_COLETA', 'DESPACHADO', 'EM_TRANSITO', 'COM_OCORRENCIA', 'ENTREGUE', 'AGUARDANDO_CONCILIACAO', 'CONCILIADO', 'CANCELADO']

export function FretesPedidosPage() {
  return (
    <RequirePermission module="fretes_pedidos">
      <ShipmentList />
    </RequirePermission>
  )
}

function ShipmentList() {
  const active = useActiveUnit()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('busca') ?? '')
  const [q, setQ] = useState(params.get('busca') ?? '')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | 'novo' | null>(null)
  const [importing, setImporting] = useState(false)
  const status = params.get('situacao') ?? ''
  const late = params.get('atrasados') === '1'
  const qs = new URLSearchParams({ pagina: String(page) })
  if (late) qs.set('atrasados', '1')
  if (q) qs.set('busca', q)
  if (status) qs.set('situacao', status)
  if (active.unitId) qs.set('filial', active.unitId)
  const list = useQuery({
    queryKey: ['fretes', 'pedidos', qs.toString()],
    queryFn: () => api.get<{ total: number; pageSize: number; counts: Record<string, number>; items: Shipment[] }>(`/fretes/pedidos?${qs}`),
    placeholderData: keepPreviousData,
    enabled: !!active.ctx.data,
  })
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const units = active.ctx.data?.units ?? []
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedidos e expedição"
        description="Do pedido/NF à coleta, entrega e CT-e. Gere o pedido pela cotação para a conciliação comparar com o valor escolhido."
        actions={
          <>
            <FilialSwitch active={active} />
            <Can module="fretes_pedidos" action="create">
              <Button variant="outline" onClick={() => setImporting(true)}>
                <UploadIcon aria-hidden /> Importar planilha
              </Button>
              <Button onClick={() => setOpen('novo')}>
                <PlusIcon aria-hidden /> Novo pedido
              </Button>
            </Can>
          </>
        }
      />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={!status && !late ? 'secondary' : 'ghost'} onClick={() => (setParams({}), setPage(1))}>
          Todos
        </Button>
        <Button size="sm" variant={late ? 'secondary' : 'ghost'} onClick={() => (setParams({ atrasados: '1' }), setPage(1))}>
          Atrasados
        </Button>
        {ORDER.map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'secondary' : 'ghost'} onClick={() => (setParams({ situacao: s }), setPage(1))}>
            {SHIPMENT_STATUS[s]!.label}
            <span className="ml-1 text-xs text-muted-foreground">{list.data?.counts[s] ?? 0}</span>
          </Button>
        ))}
      </div>
      <form
        className="relative max-w-xl"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(search.trim())
          setPage(1)
        }}
      >
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-8" placeholder="Nº, pedido, NF, chave da NF-e, cliente ou rastreio" value={search} onChange={(e) => setSearch(e.target.value)} />
      </form>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={PackageIcon} title="Nenhum pedido" description="Cadastre, importe a planilha do ERP ou gere a partir de uma cotação com transportadora escolhida." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Pedido / NF</TableHead>
                <TableHead className="hidden md:table-cell">Cliente / destino</TableHead>
                <TableHead>Transportadora</TableHead>
                <TableHead className="text-right">Cotado</TableHead>
                <TableHead className="hidden lg:table-cell">CT-e</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s.id)}>
                  <TableCell className="font-medium">{s.code}</TableCell>
                  <TableCell className="text-sm">
                    {s.orderNumber ?? '—'}
                    <span className="block text-xs text-muted-foreground">NF {s.invoiceNumber ?? '—'}</span>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {s.customerName ?? '—'}
                    <span className="block text-xs text-muted-foreground">
                      {s.destCity ?? formatCep(s.destZip)}
                      {s.destUf ? `/${s.destUf}` : ''} · {units.find((u) => u.id === s.unitId)?.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{s.carrierName ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(s.expectedTotal)}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {s.cte ? (
                      <>
                        {s.cte.number} · {money(s.cte.total)}
                        <Badge variant="outline" className={cn('ml-1', REC_STATUS[s.cte.recStatus]?.className)}>
                          {REC_STATUS[s.cte.recStatus]?.label}
                        </Badge>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={SHIPMENT_STATUS[s.status]?.className}>
                      {SHIPMENT_STATUS[s.status]?.label ?? s.status}
                    </Badge>
                    {s.expectedDeliveryAt && <span className="block text-xs text-muted-foreground">previsão {dayBr(s.expectedDeliveryAt)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{list.data.total} pedido(s)</span>
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
      {open && <ShipmentSheet id={open === 'novo' ? null : open} defaultUnit={active.unitId ?? units[0]?.id ?? ''} onClose={() => setOpen(null)} />}
      {importing && <ImportShipments defaultUnit={active.unitId ?? units[0]?.id ?? ''} onClose={() => setImporting(false)} />}
    </div>
  )
}

function ImportShipments({ defaultUnit, onClose }: { defaultUnit: string; onClose: () => void }) {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const [unitId, setUnitId] = useState(defaultUnit)
  const [file, setFile] = useState<File | null>(null)
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('arquivo', file!)
      return api.post<{ created: number; skipped: number; errors: { line: number; message: string }[] }>(`/fretes/pedidos/importar/${unitId}`, fd)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes', 'pedidos'] })
      toast.success(`${r.created} pedido(s) importado(s)${r.skipped ? `, ${r.skipped} já existiam` : ''}${r.errors.length ? `, ${r.errors.length} com erro` : ''}.`)
      if (!r.errors.length) onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar pedidos</DialogTitle>
          <DialogDescription>Planilha do ERP ou da loja (.xlsx ou .csv). Colunas reconhecidas pelo título: pedido, NF, chave da NF-e, cliente, CPF/CNPJ, CEP, cidade, UF, valor, peso e volumes. Pedidos com a mesma chave de NF-e são pulados.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger className="w-full" aria-label="Filial">
              <SelectValue placeholder="Filial" />
            </SelectTrigger>
            <SelectContent>
              {ctx.data?.units.filter((u) => u.active).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {m.data && m.data.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
              {m.data.errors.map((e, i) => (
                <p key={i}>
                  Linha {e.line}: {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!file || !unitId || m.isPending}>
            {m.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShipmentSheet({ id, defaultUnit, onClose }: { id: string | null; defaultUnit: string; onClose: () => void }) {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const { can } = useAuth()
  const detail = useQuery({ queryKey: ['fretes', 'pedido', id], queryFn: () => api.get<Shipment>(`/fretes/pedidos/${id}`), enabled: !!id })
  if (id && !detail.data) {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl">{detail.error ? <ErrorState error={detail.error} /> : <TableSkeleton />}</SheetContent>
      </Sheet>
    )
  }
  const s = detail.data ?? null
  const refresh = () => qc.invalidateQueries({ queryKey: ['fretes'] })
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{s ? `Pedido nº ${s.code}` : 'Novo pedido'}</SheetTitle>
          {s && (
            <SheetDescription>
              {s.unitName} · cadastrado em {dateTime(s.createdAt)} por {s.createdByName}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {s && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={SHIPMENT_STATUS[s.status]?.className}>
                  {SHIPMENT_STATUS[s.status]?.label}
                </Badge>
                {s.expected && (
                  <span className="text-sm">
                    Cotação nº {s.expected.quoteCode} · {s.expected.carrierName} · {money(s.expected.total)} ({s.expected.tableName} v{s.expected.versionNumber})
                  </span>
                )}
                {s.quoteId && (
                  <Link className="text-xs underline underline-offset-2" to={`/fretes/cotacoes/${s.quoteId}`}>
                    abrir cotação
                  </Link>
                )}
              </div>
              {s.ctes && s.ctes.length > 0 && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">CT-e</p>
                  {s.ctes.map((c) => (
                    <p key={c.id}>
                      <Link className="underline underline-offset-2" to={`/fretes/ctes/${c.id}`}>
                        CT-e {c.number}
                      </Link>{' '}
                      · {money(c.total)}{' '}
                      <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                        {REC_STATUS[c.recStatus]?.label}
                      </Badge>
                    </p>
                  ))}
                </div>
              )}
              {can('fretes_pedidos', 'edit') && s.status !== 'CANCELADO' && <StatusForm shipment={s} onDone={refresh} />}
            </>
          )}
          <ShipmentForm shipment={s} defaultUnit={defaultUnit} units={ctx.data?.units ?? []} carriers={ctx.data?.carriers ?? []} editable={s ? can('fretes_pedidos', 'edit') : can('fretes_pedidos', 'create')} onSaved={() => (refresh(), !s && onClose())} />
          {s?.events && s.events.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Histórico</p>
              <ol className="space-y-2 border-l pl-4 text-sm">
                {s.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{SHIPMENT_STATUS[e.status]?.label ?? e.status}</span> · {dateTime(e.createdAt)} · {e.userName}
                    {e.note && <span className="block text-muted-foreground">{e.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function StatusForm({ shipment, onDone }: { shipment: Shipment; onDone: () => void }) {
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [at, setAt] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`/fretes/pedidos/${shipment.id}/situacao`, { status, note: note || null, at: at ? new Date(at).toISOString() : null }),
    onSuccess: () => {
      toast.success('Situação atualizada.')
      setStatus('')
      setNote('')
      setAt('')
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        m.mutate()
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="st-s">Nova situação</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="st-s" className="w-52">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SHIPMENT_STATUS)
              .filter(([k]) => k !== shipment.status)
              .map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="st-at">Quando</Label>
        <Input id="st-at" type="datetime-local" className="w-52" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <Input aria-label="Observação" className="min-w-40 flex-1" placeholder={status === 'CANCELADO' ? 'Motivo do cancelamento (obrigatório)' : 'Observação (ocorrência, recebedor...)'} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" disabled={!status || m.isPending}>
        {m.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Atualizar
      </Button>
    </form>
  )
}

function ShipmentForm({ shipment, defaultUnit, units, carriers, editable, onSaved }: { shipment: Shipment | null; defaultUnit: string; units: { id: string; name: string; active: boolean }[]; carriers: { id: string; name: string }[]; editable: boolean; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    unitId: shipment?.unitId ?? defaultUnit,
    orderNumber: shipment?.orderNumber ?? '',
    invoiceNumber: shipment?.invoiceNumber ?? '',
    invoiceKey: shipment?.invoiceKey ?? '',
    customerName: shipment?.customerName ?? '',
    customerDoc: shipment?.customerDoc ?? '',
    destZip: shipment?.destZip ? maskCep(shipment.destZip) : '',
    destCity: shipment?.destCity ?? '',
    destUf: shipment?.destUf ?? '',
    weight: fmtNum(shipment?.weight ?? null),
    volumesCount: shipment?.volumesCount?.toString() ?? '',
    carrierId: shipment?.carrierId ?? '',
    trackingCode: shipment?.trackingCode ?? '',
    notes: shipment?.notes ?? '',
  }))
  const [value, setValue] = useState<number | null>(shipment?.cargoValue ?? null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const w = parseBr(f.weight)
      if (Number.isNaN(w)) throw new Error('Peso inválido.')
      const body = { ...f, orderNumber: f.orderNumber || null, invoiceNumber: f.invoiceNumber || null, invoiceKey: f.invoiceKey || null, customerName: f.customerName || null, customerDoc: f.customerDoc || null, destZip: f.destZip || null, destCity: f.destCity || null, destUf: f.destUf || null, cargoValue: value, weight: w, volumesCount: f.volumesCount ? Number(f.volumesCount) : null, carrierId: f.carrierId || null, trackingCode: f.trackingCode || null, notes: f.notes || null }
      return shipment ? api.put(`/fretes/pedidos/${shipment.id}`, body) : api.post('/fretes/pedidos', body)
    },
    onSuccess: () => {
      toast.success('Pedido salvo.')
      onSaved()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-unit">Filial</Label>
          <Select value={f.unitId} onValueChange={(v) => set('unitId', v)}>
            <SelectTrigger id="p-unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.filter((u) => u.active || u.id === f.unitId).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-carrier">Transportadora</Label>
          <Select value={f.carrierId || '__none__'} onValueChange={(v) => set('carrierId', v === '__none__' ? '' : v)}>
            <SelectTrigger id="p-carrier" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">A definir</SelectItem>
              {carriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-order">Pedido</Label>
          <Input id="p-order" value={f.orderNumber} onChange={(e) => set('orderNumber', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-nf">Nota fiscal</Label>
          <Input id="p-nf" value={f.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="p-key">Chave da NF-e (liga o CT-e sozinho)</Label>
          <Input id="p-key" inputMode="numeric" value={f.invoiceKey} onChange={(e) => set('invoiceKey', e.target.value.replace(/\D/g, '').slice(0, 44))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-cust">Cliente</Label>
          <Input id="p-cust" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-doc">CPF/CNPJ</Label>
          <Input id="p-doc" value={f.customerDoc} onChange={(e) => set('customerDoc', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-zip">CEP de destino</Label>
          <Input id="p-zip" value={f.destZip} onChange={(e) => set('destZip', maskCep(e.target.value))} />
        </div>
        <div className="grid grid-cols-[1fr_4rem] gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-city">Cidade</Label>
            <Input id="p-city" value={f.destCity} onChange={(e) => set('destCity', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-uf">UF</Label>
            <Input id="p-uf" maxLength={2} className="uppercase" value={f.destUf} onChange={(e) => set('destUf', e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-value">Valor da mercadoria</Label>
          <MoneyInput id="p-value" value={value} onChange={setValue} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-w">Peso (kg)</Label>
            <Input id="p-w" inputMode="decimal" value={f.weight} onChange={(e) => set('weight', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-v">Volumes</Label>
            <Input id="p-v" inputMode="numeric" value={f.volumesCount} onChange={(e) => set('volumesCount', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="p-track">Código de rastreamento</Label>
          <Input id="p-track" value={f.trackingCode} onChange={(e) => set('trackingCode', e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="p-notes">Observações</Label>
          <Textarea id="p-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </fieldset>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || !f.unitId}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
        </div>
      )}
    </form>
  )
}
