import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BuildingIcon, DownloadIcon, GiftIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { MoneyInput } from '@/components/money-input'
import { Kpi, TrendChart } from '@/components/marketing/ui'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money, todaySP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Gift {
  id: string
  name: string
  stock: number
  unitCost: number
  active: boolean
  stockValue: number
  deliveries: number
  hasQuota?: boolean
}
interface Balance {
  giftId: string
  quota: number
  used: number
  remaining: number
}
interface MonthView {
  month: string
  gifts: { id: string; name: string; stock: number; unitCost: number; active: boolean; hasQuota?: boolean }[]
  /** Vendedores ("s:<id>") e filiais ("u:<id>"). */
  holders: Holder[]
}
interface Holder {
  id: string
  kind: 'seller' | 'unit'
  name: string
  items: Balance[]
  value: number
}
interface Report {
  from: string
  to: string
  quantity: number
  value: number
  customers: number
  byGift: { giftId: string; name: string; quantity: number; value: number }[]
  byHolder: { id: string; name: string; kind: 'seller' | 'unit'; quantity: number; value: number }[]
  byMonth: { month: string; quantity: number; value: number }[]
}
interface Delivery {
  id: string
  date: string
  giftId: string
  gift: string
  holderId: string
  holder: string
  holderKind: 'seller' | 'unit'
  customerCode: string
  customerName: string | null
  quantity: number
  unitCost: number
  total: number
  notes: string | null
  createdByName: string | null
  createdAt: string
}

const ALL = '__todos__'
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const dateBR = (d: string) => d.split('-').reverse().join('/')
const shortMonth = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '')

/** Nome com a marca de filial (filial não tem vendedor: a cota e as retiradas são dela). */
function HolderName({ name, kind }: { name: string; kind: 'seller' | 'unit' }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === 'unit' && <BuildingIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      {name}
      {kind === 'unit' && (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
          Filial
        </Badge>
      )}
    </span>
  )
}

export function BrindesPage() {
  return (
    <RequirePermission module="brindes">
      <Brindes />
    </RequirePermission>
  )
}

function Brindes() {
  const { can } = useAuth()
  const [month, setMonth] = useState(() => todaySP().slice(0, 7))
  const [deliver, setDeliver] = useState<{ holderId?: string; giftId?: string } | null>(null)
  const view = useQuery({ queryKey: ['brindes', 'mes', month], queryFn: () => api.get<MonthView>(`/marketing/brindes/mes/saldo?mes=${month}`) })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de brindes"
        description="Cadastro dos brindes, cota mensal de cada vendedor ou filial e as retiradas por cliente. Cada retirada baixa o estoque e o saldo do mês."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="month" aria-label="Mês" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Can module="brindes" action="create">
              <Button onClick={() => setDeliver({})}>
                <PlusIcon /> Registrar retirada
              </Button>
            </Can>
          </div>
        }
      />
      <Tabs defaultValue="saldo">
        <TabsList>
          <TabsTrigger value="saldo">Saldo do mês</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="retiradas">Retiradas</TabsTrigger>
          <TabsTrigger value="brindes">Brindes</TabsTrigger>
          {can('brindes', 'edit') && <TabsTrigger value="cotas">Cotas mensais</TabsTrigger>}
        </TabsList>
        <TabsContent value="saldo" className="mt-4">
          <Saldo view={view} month={month} onDeliver={(holderId, giftId) => setDeliver({ holderId, giftId })} />
        </TabsContent>
        <TabsContent value="dashboard" className="mt-4">
          <Dashboard month={month} />
        </TabsContent>
        <TabsContent value="retiradas" className="mt-4">
          <Retiradas month={month} holders={view.data?.holders ?? []} />
        </TabsContent>
        <TabsContent value="brindes" className="mt-4">
          <Cadastro />
        </TabsContent>
        {can('brindes', 'edit') && (
          <TabsContent value="cotas" className="mt-4">
            <Cotas view={view} />
          </TabsContent>
        )}
      </Tabs>
      {deliver && view.data && <DeliverDialog view={view.data} initial={deliver} onClose={() => setDeliver(null)} />}
    </div>
  )
}

function Saldo({ view, month, onDeliver }: { view: ReturnType<typeof useQuery<MonthView>>; month: string; onDeliver: (holderId: string, giftId?: string) => void }) {
  const { can } = useAuth()
  if (view.isLoading) return <TableSkeleton />
  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} />
  const d = view.data!
  const names = new Map(d.gifts.map((g) => [g.id, g.name]))
  const sellers = d.holders.filter((s) => s.items.length > 0)
  const totalQty = sellers.reduce((t, s) => t + s.items.reduce((a, i) => a + i.used, 0), 0)
  const totalValue = sellers.reduce((t, s) => t + s.value, 0)
  if (!sellers.length)
    return <EmptyState icon={GiftIcon} title="Nenhum vendedor ou filial com cota" description="Cadastre os brindes e defina na aba Cotas mensais quantos cada vendedor ou filial tem por mês." />
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {monthLabel(month)}: <strong className="text-foreground">{totalQty}</strong> {totalQty === 1 ? 'brinde entregue' : 'brindes entregues'}, <strong className="text-foreground">{money(totalValue)}</strong>.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sellers.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-base">
                  <HolderName name={s.name} kind={s.kind} />
                </CardTitle>
                <CardDescription>Entregue no mês: {money(s.value)}</CardDescription>
              </div>
              {can('brindes', 'create') && (
                <Button size="sm" variant="outline" onClick={() => onDeliver(s.id)}>
                  <PlusIcon /> Retirada
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {s.items.map((i) => {
                const pct = i.quota ? Math.min(100, (i.used / i.quota) * 100) : 100
                return (
                  <div key={i.giftId} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{names.get(i.giftId) ?? 'Brinde'}</span>
                      <span className={cn('tabular-nums', i.remaining === 0 ? 'text-muted-foreground' : 'font-semibold')}>
                        {i.remaining === 0 ? 'acabou' : `${i.remaining} de ${i.quota}`}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={i.used} aria-valuemax={i.quota} aria-label={`${names.get(i.giftId)}: ${i.used} de ${i.quota} entregues`}>
                      <div className={cn('h-full rounded-full', i.remaining === 0 ? 'bg-muted-foreground/40' : 'bg-[color:var(--brand)]')} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Retiradas({ month, holders }: { month: string; holders: { id: string; name: string; kind: 'seller' | 'unit' }[] }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const [seller, setSeller] = useState(ALL)
  const q = useQuery({ queryKey: ['brindes', 'retiradas', month, seller], queryFn: () => api.get<{ items: Delivery[] }>(`/marketing/brindes/mes/retiradas?mes=${month}${seller !== ALL ? `&vendedor=${seller}` : ''}`) })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/brindes/mes/retiradas/${id}`),
    onSuccess: () => {
      toast.success('Retirada desfeita: o brinde voltou ao estoque e ao saldo do mês.')
      qc.invalidateQueries({ queryKey: ['brindes'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const items = q.data?.items ?? []

  function exportCsv() {
    const head = ['Data', 'Vendedor ou filial', 'Código do cliente', 'Cliente', 'Brinde', 'Quantidade', 'Valor unitário', 'Total', 'Observação', 'Lançado por']
    const rows = items.map((r) => [dateBR(r.date), r.holderKind === 'unit' ? `Filial ${r.holder}` : r.holder, r.customerCode, r.customerName ?? '', r.gift, r.quantity, r.unitCost.toFixed(2).replace('.', ','), r.total.toFixed(2).replace('.', ','), r.notes ?? '', r.createdByName ?? ''])
    const csv = [head, ...rows].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    a.download = `brindes-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Retiradas de {monthLabel(month)}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={seller} onValueChange={setSeller}>
            <SelectTrigger className="w-56" aria-label="Vendedor ou filial">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos (vendedores e filiais)</SelectItem>
              {holders.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.kind === 'unit' ? `Filial ${s.name}` : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {can('brindes', 'export') && (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!items.length}>
              <DownloadIcon /> Exportar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState icon={GiftIcon} title="Nenhuma retirada neste mês" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Vendedor ou filial</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Brinde</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Lançado por</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{dateBR(r.date)}</TableCell>
                    <TableCell>
                      <HolderName name={r.holder} kind={r.holderKind} />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium tabular-nums">{r.customerCode}</span>
                      {r.customerName && <span className="block text-xs text-muted-foreground">{r.customerName}</span>}
                      {r.notes && <span className="block text-xs text-muted-foreground">{r.notes}</span>}
                    </TableCell>
                    <TableCell>{r.gift}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.total)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.createdByName ?? '—'}
                      <span className="block">{formatDateTime(r.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      {can('brindes', 'delete') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Desfazer retirada"
                          disabled={remove.isPending}
                          onClick={async () => {
                            if (await confirm({ title: 'Desfazer esta retirada?', description: `${r.quantity} ${r.gift} do cliente ${r.customerCode} volta ao estoque e ao saldo de ${r.holder}.`, confirmLabel: 'Desfazer' })) remove.mutate(r.id)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Cadastro() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const [edit, setEdit] = useState<Gift | 'new' | null>(null)
  const q = useQuery({ queryKey: ['brindes', 'cadastro'], queryFn: () => api.get<Gift[]>('/marketing/brindes') })
  const toggle = useMutation({
    mutationFn: (g: Gift) => api.put(`/marketing/brindes/${g.id}`, { active: !g.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brindes'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/brindes/${id}`),
    onSuccess: () => {
      toast.success('Brinde excluído.')
      qc.invalidateQueries({ queryKey: ['brindes'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const gifts = q.data ?? []
  const total = gifts.filter((g) => g.active).reduce((t, g) => t + g.stockValue, 0)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Brindes</CardTitle>
          <CardDescription>Valor em estoque (ativos): {money(total)}</CardDescription>
        </div>
        {can('brindes', 'create') && (
          <Button size="sm" onClick={() => setEdit('new')}>
            <PlusIcon /> Novo brinde
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !gifts.length ? (
          <EmptyState icon={GiftIcon} title="Nenhum brinde cadastrado" description="Cadastre copo, chaveiro, chapéu... com o estoque e o valor unitário." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brinde</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Valor unitário</TableHead>
                  <TableHead className="text-right">Valor em estoque</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {gifts.map((g) => (
                  <TableRow key={g.id} className={cn(!g.active && 'text-muted-foreground')}>
                    <TableCell className="font-medium">
                      {g.name}
                      {g.hasQuota === false && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          sem cota
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {g.stock === 0 ? <Badge variant="outline">sem estoque</Badge> : g.stock}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(g.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(g.stockValue)}</TableCell>
                    <TableCell>
                      <Switch checked={g.active} disabled={!can('brindes', 'edit') || toggle.isPending} onCheckedChange={() => toggle.mutate(g)} aria-label={`${g.name} ativo`} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {can('brindes', 'edit') && (
                        <Button size="icon" variant="ghost" aria-label={`Editar ${g.name}`} onClick={() => setEdit(g)}>
                          <PencilIcon />
                        </Button>
                      )}
                      {can('brindes', 'delete') && g.deliveries === 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Excluir ${g.name}`}
                          onClick={async () => {
                            if (await confirm({ title: `Excluir ${g.name}?`, description: 'O brinde e as cotas dele saem do cadastro.', confirmLabel: 'Excluir' })) remove.mutate(g.id)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {edit && <GiftDialog gift={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function GiftDialog({ gift, onClose }: { gift: Gift | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(gift?.name ?? '')
  const [stock, setStock] = useState(String(gift?.stock ?? 0))
  const [unitCost, setUnitCost] = useState<number | null>(gift?.unitCost ?? null)
  const [hasQuota, setHasQuota] = useState(gift?.hasQuota !== false)
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), stock: Number(stock) || 0, unitCost: unitCost ?? 0, hasQuota }
      return gift ? api.put(`/marketing/brindes/${gift.id}`, body) : api.post('/marketing/brindes', body)
    },
    onSuccess: () => {
      toast.success(gift ? 'Brinde salvo.' : 'Brinde cadastrado.')
      qc.invalidateQueries({ queryKey: ['brindes'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gift ? `Editar ${gift.name}` : 'Novo brinde'}</DialogTitle>
          <DialogDescription>O estoque baixa sozinho a cada retirada. Use este campo para dar entrada quando chegar mais.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="g-name" required>
              Nome
            </Label>
            <Input id="g-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Copo térmico" autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="g-stock">Estoque</Label>
              <Input id="g-stock" type="number" inputMode="numeric" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-cost">Valor unitário</Label>
              <MoneyInput id="g-cost" value={unitCost} onChange={setUnitCost} />
            </div>
          </div>
          <Label className="flex items-start justify-between gap-4 font-normal">
            <span>
              <span className="block font-medium">Controlado por cota mensal</span>
              <span className="block text-xs text-muted-foreground">Desligado: o brinde não aparece em Cotas mensais e qualquer vendedor ou filial pode retirar, só baixando o estoque.</span>
            </span>
            <Switch checked={hasQuota} onCheckedChange={setHasQuota} aria-label="Controlado por cota mensal" />
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Cotas({ view }: { view: ReturnType<typeof useQuery<MonthView>> }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const d = view.data
  const gifts = useMemo(() => (d?.gifts ?? []).filter((g) => g.active && g.hasQuota !== false), [d])
  const [all, setAll] = useState<Record<string, string>>({})
  const current = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of d?.holders ?? []) for (const i of s.items) m.set(`${s.id}|${i.giftId}`, i.quota)
    return m
  }, [d])
  const changed = Object.entries(draft).filter(([k, v]) => (Number(v) || 0) !== (current.get(k) ?? 0))
  const save = useMutation({
    mutationFn: () =>
      api.put('/marketing/brindes/mes/cotas', {
        list: changed.map(([k, v]) => {
          const [holderId, giftId] = k.split('|')
          return { holderId, giftId, monthly: Math.max(0, Math.floor(Number(v) || 0)) }
        }),
      }),
    onSuccess: () => {
      toast.success('Cotas salvas. Valem para todos os meses até serem alteradas.')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['brindes'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (view.isLoading) return <TableSkeleton />
  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} />
  if (!gifts.length) return <EmptyState icon={GiftIcon} title="Cadastre os brindes primeiro" description="Na aba Brindes, cadastre o que o vendedor pode distribuir." />
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Cotas mensais</CardTitle>
          <CardDescription>Quantos de cada brinde o vendedor ou a filial tem por mês. Vale todo mês até mudar; 0 ou vazio = sem cota. As filiais são as Unidades de Configurações › Listas.</CardDescription>
        </div>
        <Button size="sm" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className="animate-spin" />} Salvar{changed.length ? ` (${changed.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendedor ou filial</TableHead>
                {gifts.map((g) => (
                  <TableHead key={g.id} className="min-w-24 text-center">
                    {g.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell className="font-medium whitespace-nowrap">
                  Replicar para todos
                  <span className="block text-xs font-normal text-muted-foreground">Digite e clique em Aplicar; depois Salvar</span>
                </TableCell>
                {gifts.map((g) => (
                  <TableCell key={g.id} className="text-center">
                    <div className="mx-auto flex w-28 items-center gap-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        aria-label={`${g.name}: mesma cota para todos`}
                        className="h-8 w-16 text-center tabular-nums"
                        value={all[g.id] ?? ''}
                        placeholder="—"
                        onChange={(e) => setAll((x) => ({ ...x, [g.id]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        disabled={(all[g.id] ?? '') === ''}
                        onClick={() => setDraft((x) => ({ ...x, ...Object.fromEntries(d!.holders.map((h) => [`${h.id}|${g.id}`, all[g.id]!])) }))}
                      >
                        Aplicar
                      </Button>
                    </div>
                  </TableCell>
                ))}
              </TableRow>
              {d!.holders.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <HolderName name={s.name} kind={s.kind} />
                  </TableCell>
                  {gifts.map((g) => {
                    const k = `${s.id}|${g.id}`
                    const v = draft[k] ?? (current.get(k) ? String(current.get(k)) : '')
                    return (
                      <TableCell key={g.id} className="text-center">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          aria-label={`${s.name}: ${g.name} por mês`}
                          className="mx-auto h-8 w-20 text-center tabular-nums"
                          value={v}
                          placeholder="0"
                          onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))}
                        />
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function DeliverDialog({ view, initial, onClose }: { view: MonthView; initial: { holderId?: string; giftId?: string }; onClose: () => void }) {
  const qc = useQueryClient()
  // Brindes sem cota mensal: qualquer vendedor ou filial retira (só o estoque limita).
  const free = view.gifts.filter((g) => g.active && g.hasQuota === false)
  const hasQuota = (s: Holder) => s.items.some((i) => i.quota > 0)
  const canDeliver = (s: Holder) => hasQuota(s) || free.length > 0
  const sellers = [...view.holders].sort((a, b) => Number(canDeliver(b)) - Number(canDeliver(a)))
  const allowed = sellers.filter(canDeliver)
  const [sellerId, setSellerId] = useState(initial.holderId ?? (allowed.length === 1 ? allowed[0]!.id : ''))
  const [lines, setLines] = useState<{ giftId: string; quantity: string }[]>(() => [{ giftId: initial.giftId ?? '', quantity: '1' }])
  const [code, setCode] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [date, setDate] = useState(() => todaySP())
  const [notes, setNotes] = useState('')
  const seller = view.holders.find((s) => s.id === sellerId)
  const giftOf = (id: string) => view.gifts.find((g) => g.id === id)
  const sameMonth = date.slice(0, 7) === view.month
  /** Brindes que este vendedor/filial pode retirar: os com cota (saldo do mês) e os sem cota. */
  const options = [
    ...(seller?.items ?? []).filter((i) => i.quota > 0 && giftOf(i.giftId)?.hasQuota !== false).map((i) => {
      const g = giftOf(i.giftId)
      return { giftId: i.giftId, label: `${g?.name ?? 'Brinde'} · saldo ${i.remaining} de ${i.quota} · estoque ${g?.stock ?? 0}`, disabled: !g?.active || (sameMonth && i.remaining === 0) || (g?.stock ?? 0) === 0 }
    }),
    ...(seller ? free : []).map((g) => ({ giftId: g.id, label: `${g.name} · sem cota · estoque ${g.stock}`, disabled: g.stock === 0 })),
  ]
  const valid = lines.filter((l) => l.giftId && (Number(l.quantity) || 0) >= 1)
  const setLine = (idx: number, patch: Partial<{ giftId: string; quantity: string }>) => setLines((x) => x.map((l, k) => (k === idx ? { ...l, ...patch } : l)))
  const save = useMutation({
    mutationFn: () =>
      api.post('/marketing/brindes/mes/retiradas', {
        holderId: sellerId,
        items: valid.map((l) => ({ giftId: l.giftId, quantity: Math.floor(Number(l.quantity)) })),
        customerCode: code.trim(),
        customerName: customerName.trim() || null,
        date,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(valid.length > 1 ? `Retirada de ${valid.length} brindes registrada.` : 'Retirada registrada.')
      qc.invalidateQueries({ queryKey: ['brindes'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar retirada</DialogTitle>
          <DialogDescription>Um ou vários brindes para o mesmo cliente. Baixa do estoque e do saldo do mês do vendedor ou da filial.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="d-seller" required>
              Vendedor ou filial
            </Label>
            <Select
              value={sellerId}
              onValueChange={(v) => {
                setSellerId(v)
                setLines([{ giftId: '', quantity: '1' }])
              }}
            >
              <SelectTrigger id="d-seller" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {!sellers.length && <div className="px-2 py-3 text-sm text-muted-foreground">Nenhum vendedor ou filial ativo no seu acesso.</div>}
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!canDeliver(s)}>
                    {s.kind === 'unit' ? `Filial ${s.name}` : s.name}
                    {!canDeliver(s) && ' · sem cota'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!allowed.length && (
              <p className="text-xs text-destructive">Ninguém tem cota de brinde por mês ainda. Defina na aba Cotas mensais (e clique em Salvar) quantos brindes cada vendedor ou filial pode entregar.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label required>Brindes</Label>
            {lines.map((l, idx) => {
              const used = new Set(lines.filter((_, k) => k !== idx).map((x) => x.giftId))
              return (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={l.giftId} onValueChange={(v) => setLine(idx, { giftId: v })} disabled={!seller}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label={`Brinde ${idx + 1}`}>
                      <SelectValue placeholder={seller ? 'Selecione o brinde' : 'Escolha o vendedor ou a filial'} />
                    </SelectTrigger>
                    <SelectContent>
                      {seller && !options.length && <div className="px-2 py-3 text-sm text-muted-foreground">Sem brinde disponível para este vendedor ou filial.</div>}
                      {options.map((o) => (
                        <SelectItem key={o.giftId} value={o.giftId} disabled={o.disabled || used.has(o.giftId)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" inputMode="numeric" min={1} step={1} className="w-20 text-center tabular-nums" aria-label={`Quantidade do brinde ${idx + 1}`} value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Tirar este brinde" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, k) => k !== idx))}>
                    <Trash2Icon />
                  </Button>
                </div>
              )
            })}
            <Button type="button" size="sm" variant="outline" disabled={!seller || lines.length >= Math.min(30, options.length)} onClick={() => setLines((x) => [...x, { giftId: '', quantity: '1' }])}>
              <PlusIcon /> Adicionar brinde
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-code" required>
                Código do cliente
              </Label>
              <Input id="d-code" required maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Nome do cliente</Label>
              <Input id="d-name" maxLength={160} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-date" required>
                Data
              </Label>
              <Input id="d-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-notes">Observação</Label>
              <Input id="d-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !sellerId || !valid.length || !code.trim()}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Registrar{valid.length > 1 ? ` (${valid.length} brindes)` : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const addMonths = (m: string, k: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1))
  return d.toISOString().slice(0, 7)
}

/** Resumo dos brindes entregues num período: totais, por brinde, por vendedor/filial e mês a mês. */
function Dashboard({ month }: { month: string }) {
  const [to, setTo] = useState(month)
  const [from, setFrom] = useState(() => addMonths(month, -5))
  const q = useQuery({ queryKey: ['brindes', 'relatorio', from, to], queryFn: () => api.get<Report>(`/marketing/brindes/mes/relatorio?de=${from}&ate=${to}`) })
  const d = q.data
  const units = d?.byHolder.filter((h) => h.kind === 'unit') ?? []
  const sellers = d?.byHolder.filter((h) => h.kind === 'seller') ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="r-from">De</Label>
          <Input id="r-from" type="month" className="w-44" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-to">Até</Label>
          <Input id="r-to" type="month" className="w-44" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {[
            ['Mês', 0],
            ['3 meses', -2],
            ['6 meses', -5],
            ['12 meses', -11],
          ].map(([label, k]) => (
            <Button key={label} size="sm" variant="outline" onClick={() => setFrom(addMonths(to, k as number))}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || d.quantity === 0 ? (
        <EmptyState icon={GiftIcon} title="Nenhum brinde entregue no período" description="As retiradas registradas aparecem aqui somadas por brinde, vendedor, filial e mês." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Brindes entregues" value={d.quantity.toLocaleString('pt-BR')} spark={d.byMonth.map((m) => m.quantity)} hint={d.from === d.to ? monthLabel(d.from) : `${shortMonth(d.from)} a ${shortMonth(d.to)}`} />
            <Kpi label="Valor entregue" value={money(d.value)} spark={d.byMonth.map((m) => m.value)} />
            <Kpi label="Clientes que receberam" value={d.customers.toLocaleString('pt-BR')} hint={`Média de ${money(d.customers ? d.value / d.customers : 0)} por cliente`} />
            <Kpi label="Vendedores e filiais" value={String(d.byHolder.length)} hint={`${sellers.length} ${sellers.length === 1 ? 'vendedor' : 'vendedores'}, ${units.length} ${units.length === 1 ? 'filial' : 'filiais'}`} />
          </div>
          {d.byMonth.length > 1 && (
            <TrendChart
              title="Mês a mês"
              description="Valor dos brindes entregues em cada mês."
              kind="bar"
              format={money}
              data={d.byMonth.map((m) => ({ label: shortMonth(m.month), valor: m.value }))}
              series={[{ key: 'valor', label: 'Valor', color: 'var(--chart-1)' }]}
            />
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Ranking title="Por brinde" rows={d.byGift.map((g) => ({ key: g.giftId, name: <>{g.name}</>, quantity: g.quantity, value: g.value }))} total={d.quantity} />
            <Ranking title="Por vendedor e filial" rows={d.byHolder.map((h) => ({ key: h.id, name: <HolderName name={h.name} kind={h.kind} />, quantity: h.quantity, value: h.value }))} total={d.quantity} />
          </div>
        </>
      )}
    </div>
  )
}

function Ranking({ title, rows, total }: { title: string; rows: { key: string; name: React.ReactNode; quantity: number; value: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.quantity))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right">Qtd.</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-[color:var(--brand)]" style={{ width: `${(r.quantity / max) * 100}%` }} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.quantity.toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{total ? Math.round((r.quantity / total) * 100) : 0}%</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
