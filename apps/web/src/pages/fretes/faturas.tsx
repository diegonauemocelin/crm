import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PlusIcon, ReceiptIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money } from '@/lib/format'
import { CONTEST, DECISION, INVOICE_STATUS, REC_STATUS, useActiveUnit, useFreightContext } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface Totals {
  count: number
  charged: number
  approved: number
  pendingDecision: number
  contested: number
  credit: number
  cancelled: number
}

interface Invoice {
  id: string
  carrierId: string
  carrierName: string | null
  unitId: string | null
  number: string
  issuedAt: string | null
  dueAt: string
  total: number
  status: string
  paidAt: string | null
  paidValue: number | null
  paymentNote: string | null
  notes: string | null
  createdByName: string
  createdAt: string
  ctes: Totals
  unmatched: number
  toPay: number
  cteList?: { id: string; number: string | null; issuedAt: string | null; cityFim: string | null; ufFim: string | null; total: number; expectedTotal: number | null; approvedValue: number | null; recStatus: string; decision: string | null; contestStatus: string | null; fiscalStatus: string }[]
}

interface OpenCte {
  id: string
  number: string | null
  issuedAt: string | null
  cityFim: string | null
  ufFim: string | null
  total: number
  approvedValue: number | null
  recStatus: string
  decision: string | null
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const overdue = (f: Invoice) => (f.status === 'ABERTA' || f.status === 'APROVADA') && f.dueAt < today()

export function FretesFaturasPage() {
  return (
    <RequirePermission module="fretes_financeiro">
      <InvoiceList />
    </RequirePermission>
  )
}

function InvoiceList() {
  const active = useActiveUnit()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const status = params.get('situacao') ?? ''
  const carrier = params.get('transportadora') ?? ''
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next)
  }
  const qs = new URLSearchParams()
  if (status) qs.set('situacao', status)
  if (carrier) qs.set('transportadora', carrier)
  if (active.unitId) qs.set('filial', active.unitId)
  const list = useQuery({ queryKey: ['fretes', 'faturas', qs.toString()], queryFn: () => api.get<Invoice[]>(`/fretes/faturas?${qs}`), enabled: !!active.ctx.data })
  const rows = list.data ?? []
  const sum = (f: (i: Invoice) => number) => rows.filter((i) => i.status !== 'CANCELADA').reduce((s, i) => s + f(i), 0)
  return (
    <div className="space-y-4">
      <PageHeader
        title="Faturas de frete"
        description="Lance a fatura da transportadora, marque os CT-es que ela cobra e pague o aprovado na conciliação. O contestado em aberto fica de fora do valor a pagar."
        actions={
          <>
            <FilialSwitch active={active} />
            <Can module="fretes_financeiro" action="create">
              <Button onClick={() => setCreating(true)}>
                <PlusIcon aria-hidden /> Lançar fatura
              </Button>
            </Can>
          </>
        }
      />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={!status ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', '')}>
          Todas
        </Button>
        {Object.entries(INVOICE_STATUS).map(([k, v]) => (
          <Button key={k} size="sm" variant={status === k ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', k)}>
            {v.label}
          </Button>
        ))}
        <Button size="sm" variant={status === 'VENCIDA' ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', 'VENCIDA')}>
          Vencidas
        </Button>
        <Select value={carrier || '__all__'} onValueChange={(v) => setParam('transportadora', v === '__all__' ? '' : v)}>
          <SelectTrigger size="sm" className="ml-auto w-52" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as transportadoras</SelectItem>
            {active.ctx.data?.carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={ReceiptIcon} title="Nenhuma fatura" description="Lance as faturas das transportadoras para conferir com os CT-es e controlar o pagamento." />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Sum label="Valor das faturas" value={sum((i) => i.total)} />
            <Sum label="Cobrado nos CT-es" value={sum((i) => i.ctes.charged)} />
            <Sum label="Aprovado para pagar" value={sum((i) => i.toPay)} />
            <Sum label="Contestado em aberto" value={sum((i) => i.ctes.contested)} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fatura</TableHead>
                <TableHead>Transportadora</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="hidden text-right md:table-cell">CT-es</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-2 hover:underline" to={`/fretes/faturas/${f.id}`}>
                      {f.number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{f.carrierName}</TableCell>
                  <TableCell className={cn('text-sm', overdue(f) && 'text-destructive')}>{dayBr(f.dueAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(f.total)}</TableCell>
                  <TableCell className="hidden text-right text-sm md:table-cell">
                    {f.ctes.count}
                    {f.ctes.pendingDecision > 0 && <span className="block text-xs text-amber-700 dark:text-amber-300">{f.ctes.pendingDecision} sem decisão</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(f.toPay)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={overdue(f) ? 'border-destructive/50 text-destructive' : INVOICE_STATUS[f.status]?.className}>
                      {overdue(f) ? 'Vencida' : INVOICE_STATUS[f.status]?.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {creating && <InvoiceForm invoice={null} defaultUnit={active.unitId ?? ''} onClose={() => setCreating(false)} />}
    </div>
  )
}

function Sum({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{money(value)}</p>
    </div>
  )
}

function InvoiceForm({ invoice, defaultUnit, onClose }: { invoice: Invoice | null; defaultUnit: string; onClose: () => void }) {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [carrierId, setCarrierId] = useState(invoice?.carrierId ?? '')
  const [unitId, setUnitId] = useState(invoice?.unitId ?? defaultUnit)
  const [number, setNumber] = useState(invoice?.number ?? '')
  const [issuedAt, setIssuedAt] = useState(invoice?.issuedAt ?? '')
  const [dueAt, setDueAt] = useState(invoice?.dueAt ?? '')
  const [total, setTotal] = useState<number | null>(invoice?.total ?? null)
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const [numbers, setNumbers] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(invoice?.cteList?.map((c) => c.id) ?? []))
  const open = useQuery({
    queryKey: ['fretes', 'faturas', 'ctes-em-aberto', carrierId, filter],
    queryFn: () => api.get<OpenCte[]>(`/fretes/faturas/ctes-em-aberto/${carrierId}${filter ? `?numeros=${encodeURIComponent(filter)}` : ''}`),
    enabled: !!carrierId,
  })
  // CT-es já na fatura (edição) mais os em aberto da transportadora.
  const options: OpenCte[] = [...(invoice?.cteList ?? []).filter((c) => c.fiscalStatus !== 'CANCELADO'), ...(open.data ?? [])]
  const selectedSum = options.filter((c) => picked.has(c.id)).reduce((s, c) => s + c.total, 0)
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const save = useMutation({
    mutationFn: () => {
      const body = { carrierId, unitId: unitId || null, number, issuedAt: issuedAt || null, dueAt, total: total ?? 0, notes: notes || null, cteIds: [...picked] }
      return invoice ? api.put<Invoice>(`/fretes/faturas/${invoice.id}`, body) : api.post<Invoice>('/fretes/faturas', body)
    },
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success('Fatura salva.')
      onClose()
      if (!invoice) navigate(`/fretes/faturas/${f.id}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `Fatura ${invoice.number}` : 'Lançar fatura'}</DialogTitle>
          <DialogDescription>Marque os CT-es cobrados. Cole os números da fatura para achar mais rápido.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="f-carrier">Transportadora</Label>
            <Select value={carrierId} onValueChange={(v) => (setCarrierId(v), setPicked(new Set()))} disabled={!!invoice}>
              <SelectTrigger id="f-carrier" className="w-full">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {ctx.data?.carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-unit">Filial</Label>
            <Select value={unitId || '__none__'} onValueChange={(v) => setUnitId(v === '__none__' ? '' : v)}>
              <SelectTrigger id="f-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Várias / matriz paga</SelectItem>
                {ctx.data?.units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-number">Número</Label>
            <Input id="f-number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-issued">Emissão</Label>
            <Input id="f-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-due">Vencimento</Label>
            <Input id="f-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-total">Valor da fatura</Label>
            <MoneyInput id="f-total" value={total} onChange={setTotal} />
          </div>
        </div>
        {carrierId && (
          <div className="space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setFilter(numbers.trim())
              }}
            >
              <Input placeholder="Números dos CT-es (cole da fatura, separados por espaço, vírgula ou linha)" value={numbers} onChange={(e) => setNumbers(e.target.value)} />
              <Button type="submit" variant="outline">
                Filtrar
              </Button>
              {open.data && open.data.length > 0 && (
                <Button type="button" variant="ghost" onClick={() => setPicked((p) => new Set([...p, ...open.data.map((c) => c.id)]))}>
                  Marcar todos
                </Button>
              )}
            </form>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {open.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground">Carregando...</p>
              ) : !options.length ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum CT-e em aberto desta transportadora{filter ? ' com esses números' : ''}.</p>
              ) : (
                options.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0">
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="w-20 font-medium">{c.number}</span>
                    <span className="flex-1 text-muted-foreground">
                      {c.issuedAt ? dayBr(c.issuedAt) : '—'} · {c.cityFim}/{c.ufFim}
                    </span>
                    <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                      {REC_STATUS[c.recStatus]?.label}
                    </Badge>
                    <span className="w-24 text-right tabular-nums">{money(c.total)}</span>
                  </label>
                ))
              )}
            </div>
            <p className={cn('text-sm', total !== null && Math.abs(selectedSum - total) > 0.009 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
              {picked.size} CT-e(s) marcados · soma {money(selectedSum)}
              {total !== null && Math.abs(selectedSum - total) > 0.009 && ` · diferença para a fatura ${money(total - selectedSum)}`}
            </p>
          </div>
        )}
        <Textarea rows={2} aria-label="Observações" placeholder="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!carrierId || !number || !dueAt || !total || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FretesFaturaPage() {
  return (
    <RequirePermission module="fretes_financeiro">
      <InvoiceDetail />
    </RequirePermission>
  )
}

function InvoiceDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<'PAGA' | 'CANCELADA' | null>(null)
  const q = useQuery({ queryKey: ['fretes', 'fatura', id], queryFn: () => api.get<Invoice>(`/fretes/faturas/${id}`) })
  const status = useMutation({
    mutationFn: (body: { status: string; paidAt?: string | null; paidValue?: number | null; note?: string | null }) => api.patch<Invoice>(`/fretes/faturas/${id}/situacao`, body),
    onSuccess: (d) => {
      qc.setQueryData(['fretes', 'fatura', id], d)
      qc.invalidateQueries({ queryKey: ['fretes', 'faturas'] })
      setAction(null)
      toast.success('Situação da fatura atualizada.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const f = q.data
  const editable = can('fretes_financeiro', 'edit') && f.status !== 'PAGA' && f.status !== 'CANCELADA'
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Fatura ${f.number}`}
        description={`${f.carrierName ?? ''} · vencimento ${dayBr(f.dueAt)} · lançada por ${f.createdByName} em ${dateTime(f.createdAt)}`}
        actions={
          editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                Editar
              </Button>
              {f.status === 'ABERTA' && (
                <Button variant="outline" onClick={() => status.mutate({ status: 'APROVADA' })} disabled={status.isPending}>
                  Aprovar para pagamento
                </Button>
              )}
              {f.status === 'APROVADA' && (
                <Button variant="outline" onClick={() => status.mutate({ status: 'ABERTA' })} disabled={status.isPending}>
                  Reabrir
                </Button>
              )}
              <Button onClick={() => setAction('PAGA')}>Registrar pagamento</Button>
              <Button variant="ghost" onClick={() => setAction('CANCELADA')}>
                Cancelar
              </Button>
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={overdue(f) ? 'border-destructive/50 text-destructive' : INVOICE_STATUS[f.status]?.className}>
          {overdue(f) ? 'Vencida' : INVOICE_STATUS[f.status]?.label}
        </Badge>
        {f.paidAt && (
          <span className="text-sm">
            Paga em {dayBr(f.paidAt)} · {money(f.paidValue)}
            {f.paymentNote && ` · ${f.paymentNote}`}
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Sum label="Valor da fatura" value={f.total} />
        <Sum label="Cobrado nos CT-es" value={f.ctes.charged} />
        <Sum label="Sem CT-e correspondente" value={f.unmatched} />
        <Sum label="Aprovado (a pagar)" value={f.toPay} />
        <Sum label="Contestado em aberto" value={f.ctes.contested} />
        <Sum label="Créditos obtidos" value={f.ctes.credit} />
      </div>
      {f.ctes.pendingDecision > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {f.ctes.pendingDecision} CT-e(s) ainda sem decisão. Decida na{' '}
          <Link className="underline underline-offset-2" to="/fretes/conciliacao">
            conciliação
          </Link>{' '}
          antes de aprovar a fatura.
        </p>
      )}
      {f.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{f.notes}</p>}
      <Card>
        <CardHeader>
          <CardTitle>CT-es da fatura ({f.ctes.count})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CT-e</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Aprovado</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.cteList?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-2 hover:underline" to={`/fretes/ctes/${c.id}`}>
                      {c.number}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">{c.issuedAt ? dayBr(c.issuedAt) : '—'}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.cityFim}/{c.ufFim}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.expectedTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.approvedValue)}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                      {REC_STATUS[c.recStatus]?.label}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">{c.contestStatus ? CONTEST[c.contestStatus] : c.decision ? DECISION[c.decision] : 'Sem decisão'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && <InvoiceForm invoice={f} defaultUnit={f.unitId ?? ''} onClose={() => setEditing(false)} />}
      {action && <StatusDialog kind={action} invoice={f} pending={status.isPending} onSubmit={(b) => status.mutate(b)} onClose={() => setAction(null)} />}
    </div>
  )
}

function StatusDialog({ kind, invoice, pending, onSubmit, onClose }: { kind: 'PAGA' | 'CANCELADA'; invoice: Invoice; pending: boolean; onSubmit: (b: { status: string; paidAt?: string | null; paidValue?: number | null; note?: string | null }) => void; onClose: () => void }) {
  const [paidAt, setPaidAt] = useState(today())
  const [paidValue, setPaidValue] = useState<number | null>(invoice.toPay || invoice.total)
  const [note, setNote] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === 'PAGA' ? 'Registrar pagamento' : 'Cancelar fatura'}</DialogTitle>
          <DialogDescription>{kind === 'PAGA' ? `Aprovado nos CT-es: ${money(invoice.toPay)}. Informe o que foi pago de fato.` : 'Os CT-es voltam a ficar sem fatura.'}</DialogDescription>
        </DialogHeader>
        {kind === 'PAGA' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pg-at">Data do pagamento</Label>
              <Input id="pg-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-v">Valor pago</Label>
              <MoneyInput id="pg-v" value={paidValue} onChange={setPaidValue} />
            </div>
          </div>
        )}
        <Input aria-label="Observação" placeholder={kind === 'CANCELADA' ? 'Motivo (obrigatório)' : 'Observação (ex.: abatido crédito da contestação)'} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => onSubmit(kind === 'PAGA' ? { status: 'PAGA', paidAt, paidValue, note: note || null } : { status: 'CANCELADA', note })} disabled={pending || (kind === 'CANCELADA' && !note.trim())}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />} Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
