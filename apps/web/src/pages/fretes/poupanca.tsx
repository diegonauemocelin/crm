import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PiggyBankIcon, PlusIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money, num, todaySP } from '@/lib/format'
import { fmtNum, parseBr } from '@/lib/fretes'
import { cn } from '@/lib/utils'

const PERIODS: Record<string, string> = { MENSAL: 'Mensal', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual', PERSONALIZADO: 'Personalizado' }
const SOURCE: Record<string, string> = { COTACAO: 'cotação', TABELA: 'tabela', CTE: 'CT-e' }

interface Campaign {
  id: string
  name: string
  active: boolean
  pct: number
  period: string
  start: string
  end: string
}

interface SellerBalance {
  seller: string
  notas: number
  nota: number
  cte: number
  markup: number
  credito: number
  debito: number
  movimentos: number
  pendentes: number
  saldo: number
}

interface Balances {
  campaign: Campaign
  sellers: SellerBalance[]
  totals: { saldo: number; credito: number; debito: number; usado: number; acrescimo: number }
}

interface Statement {
  campaign: Campaign
  seller: string
  notes: {
    key: string
    number: number
    issuedAt: string | null
    code: number
    customerName: string | null
    cteNumbers: string | null
    nota: number
    cte: number | null
    quote: number | null
    table: number | null
    entry: { source: 'COTACAO' | 'TABELA' | 'CTE'; base: number; markup: number; charge: number; saldo: number } | null
  }[]
  moves: { id: string; kind: 'USO' | 'AJUSTE'; value: number; note: string | null; createdByName: string; createdAt: string }[]
}

export function FretesPoupancaPage() {
  return (
    <RequirePermission module="fretes_pedidos">
      <WalletPage />
    </RequirePermission>
  )
}

const signed = (v: number) => <span className={cn('tabular-nums', v < 0 && 'text-destructive', v > 0 && 'text-emerald-700 dark:text-emerald-400')}>{money(v)}</span>

function WalletPage() {
  const { can } = useAuth()
  const campaigns = useQuery({ queryKey: ['fretes', 'poupanca', 'campanhas'], queryFn: () => api.get<Campaign[]>('/fretes/poupanca/campanhas') })
  const [picked, setPicked] = useState('')
  const [editing, setEditing] = useState(false)
  const [seller, setSeller] = useState<string | null>(null)
  const list = campaigns.data ?? []
  const today = todaySP()
  const current = picked || (list.find((c) => c.active && c.start <= today && today <= c.end) ?? list[0])?.id || ''
  const balances = useQuery({ queryKey: ['fretes', 'poupanca', current], queryFn: () => api.get<Balances>(`/fretes/poupanca/${current}`), enabled: !!current })
  const d = balances.data
  return (
    <div className="space-y-4">
      <PageHeader
        title="Poupança de frete"
        description="O vendedor cobra do cliente a cotação + o acréscimo da campanha. Em cada nota CIF, o que a nota cobrou acima disso (cotação + acréscimo) vira saldo do vendedor; abaixo, desconta. O saldo pode ser usado em outra negociação."
        actions={
          <>
            {list.length > 0 && (
              <Select value={current} onValueChange={setPicked}>
                <SelectTrigger className="w-72" aria-label="Campanha">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {dayBr(c.start)} a {dayBr(c.end)}
                      {c.active ? '' : ' (inativa)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {can('fretes_tabelas', 'edit') && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Settings2Icon aria-hidden /> Campanhas
              </Button>
            )}
          </>
        }
      />
      {editing && <CampaignsDialog list={list} onClose={() => setEditing(false)} />}
      {campaigns.isLoading ? (
        <TableSkeleton />
      ) : campaigns.error ? (
        <ErrorState error={campaigns.error} onRetry={() => campaigns.refetch()} />
      ) : !list.length ? (
        <EmptyState icon={PiggyBankIcon} title="Nenhuma campanha" description="Crie a campanha (acréscimo sobre a cotação e período) em Campanhas. Quem pode editar tabelas de frete cria e altera." />
      ) : balances.isLoading ? (
        <TableSkeleton />
      ) : balances.error || !d ? (
        <ErrorState error={balances.error} onRetry={() => balances.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label={`Acréscimo da campanha (${fmtNum(d.campaign.pct)}%)`} value={money(d.totals.acrescimo)} hint="Fica com a empresa" />
            <Tile label="Saldo gerado pelas notas" value={money(d.totals.credito)} />
            <Tile label="Cobrado a menos (desconta)" value={money(d.totals.debito)} />
            <Tile label="Usado em negociações" value={money(-d.totals.usado)} />
            <Tile label="Saldo disponível" value={money(d.totals.saldo)} strong />
          </div>
          {!d.sellers.length ? (
            <EmptyState icon={PiggyBankIcon} title="Sem notas na campanha" description="Nenhuma NF-e CIF com vendedor emitida no período. Importe os XMLs das notas em Pedidos e expedição." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Notas</TableHead>
                  <TableHead className="text-right">Cobrado na nota</TableHead>
                  <TableHead className="text-right">CT-e</TableHead>
                  <TableHead className="text-right">Acréscimo</TableHead>
                  <TableHead className="text-right">Saldo das notas</TableHead>
                  <TableHead className="text-right">Usado / ajustes</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.sellers.map((s) => (
                  <TableRow key={s.seller} className="cursor-pointer" onClick={() => setSeller(s.seller)}>
                    <TableCell className="text-sm font-medium">
                      {s.seller}
                      {s.pendentes > 0 && <span className="block text-xs font-normal text-muted-foreground">{s.pendentes} nota(s) sem cotação nem CT-e ainda</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num(s.notas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.nota)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.cte)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.markup)}</TableCell>
                    <TableCell className="text-right">{signed(Math.round((s.credito - s.debito) * 100) / 100)}</TableCell>
                    <TableCell className="text-right">{signed(s.movimentos)}</TableCell>
                    <TableCell className="text-right font-semibold">{signed(s.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
      {seller && current && <StatementSheet campaignId={current} seller={seller} onClose={() => setSeller(null)} />}
    </div>
  )
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', strong && 'border-primary/40')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StatementSheet({ campaignId, seller, onClose }: { campaignId: string; seller: string; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'poupanca', campaignId, 'extrato', seller], queryFn: () => api.get<Statement>(`/fretes/poupanca/${campaignId}/extrato?vendedor=${encodeURIComponent(seller)}`) })
  const [kind, setKind] = useState<'USO' | 'MAIS' | 'MENOS'>('USO')
  const [value, setValue] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['fretes', 'poupanca', campaignId] })
  const add = useMutation({
    mutationFn: () => api.post(`/fretes/poupanca/${campaignId}/movimentos`, { seller, kind: kind === 'USO' ? 'USO' : 'AJUSTE', value: kind === 'MENOS' ? -(value ?? 0) : value, note: note.trim() || null }),
    onSuccess: () => {
      toast.success(kind === 'USO' ? 'Uso do saldo registrado.' : 'Ajuste registrado.')
      setValue(null)
      setNote('')
      refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/fretes/poupanca/movimentos/${id}`),
    onSuccess: () => (toast.success('Movimento excluído.'), refresh()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{seller}</SheetTitle>
          <SheetDescription>{d ? `${d.campaign.name}: ${dayBr(d.campaign.start)} a ${dayBr(d.campaign.end)}, acréscimo de ${fmtNum(d.campaign.pct)}% sobre a cotação.` : ''}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <Can module="fretes_pedidos" action="edit">
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Registrar uso do saldo ou ajuste</p>
              <div className="flex flex-wrap items-end gap-2">
                <Select value={kind} onValueChange={(v) => setKind(v as 'USO' | 'MAIS' | 'MENOS')}>
                  <SelectTrigger className="w-56" aria-label="Tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USO">Uso em outra negociação (tira do saldo)</SelectItem>
                    <SelectItem value="MAIS">Ajuste: somar ao saldo</SelectItem>
                    <SelectItem value="MENOS">Ajuste: tirar do saldo</SelectItem>
                  </SelectContent>
                </Select>
                <div className="w-36">
                  <MoneyInput id="poup-valor" value={value} onChange={setValue} />
                </div>
              </div>
              <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'USO' ? 'Em qual negociação: pedido, NF ou cliente (obrigatório)' : 'Motivo do ajuste'} />
              <Button size="sm" disabled={add.isPending || !value} onClick={() => add.mutate()}>
                {add.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />} Registrar
              </Button>
            </div>
          </Can>
          {q.isLoading ? (
            <TableSkeleton />
          ) : q.error || !d ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              {d.moves.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Usos e ajustes</p>
                  {d.moves.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <div>
                        <Badge variant="outline">{m.kind === 'USO' ? 'Uso' : 'Ajuste'}</Badge> {signed(m.value)}
                        {m.note && <span className="block text-xs">{m.note}</span>}
                        <span className="block text-xs text-muted-foreground">
                          {m.createdByName} · {dateTime(m.createdAt)}
                        </span>
                      </div>
                      <Can module="fretes_pedidos" action="edit">
                        <Button size="icon" variant="ghost" aria-label="Excluir movimento" disabled={del.isPending} onClick={() => confirm('Excluir este movimento?') && del.mutate(m.id)}>
                          <Trash2Icon aria-hidden />
                        </Button>
                      </Can>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium">Notas da campanha</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>NF / cliente</TableHead>
                      <TableHead className="text-right">Cotação</TableHead>
                      <TableHead className="text-right">Cobrar</TableHead>
                      <TableHead className="text-right">Na nota</TableHead>
                      <TableHead className="text-right">CT-e</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.notes.map((n) => (
                      <TableRow key={n.key}>
                        <TableCell className="text-sm">
                          NF {n.number}
                          {n.issuedAt ? ` · ${dayBr(n.issuedAt)}` : ''}
                          <span className="block text-xs text-muted-foreground">
                            {n.customerName ?? '—'} ·{' '}
                            <Link className="underline underline-offset-2" to={`/fretes/pedidos?busca=${n.code}`}>
                              pedido {n.code}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {n.entry ? money(n.entry.base) : money(n.quote)}
                          {n.entry && <span className="block text-xs text-muted-foreground">pela {SOURCE[n.entry.source]}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{n.entry ? money(n.entry.charge) : '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{money(n.nota)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {money(n.cte)}
                          {n.cteNumbers && <span className="block text-xs text-muted-foreground">{n.cteNumbers}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{n.entry ? signed(n.entry.saldo) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface CampaignRow {
  id?: string
  name: string
  active: boolean
  pct: string
  period: string
  start: string
  end: string
}

function CampaignsDialog({ list, onClose }: { list: Campaign[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<CampaignRow[]>(() => list.map((c) => ({ id: c.id, name: c.name, active: c.active, pct: String(c.pct).replace('.', ','), period: c.period, start: c.start, end: c.end })))
  const set = (i: number, p: Partial<CampaignRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const save = useMutation({
    mutationFn: () => api.put<Campaign[]>('/fretes/poupanca/campanhas', { list: rows.map((r) => ({ id: r.id, name: r.name, active: r.active, pct: parseBr(r.pct), period: r.period, start: r.start, end: r.end })) }),
    onSuccess: (saved) => {
      toast.success(`${saved.length} campanha(s) salvas.`)
      qc.invalidateQueries({ queryKey: ['fretes', 'poupanca'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Campanhas da poupança de frete</DialogTitle>
          <DialogDescription>Acréscimo sobre a cotação que o vendedor cobra do cliente e o período (pela data de emissão da nota). O fim é calculado pelo período; em Personalizado, escolha.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={r.id ?? `n${i}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6">
              <div className="space-y-1 sm:col-span-2">
                <Label>Nome</Label>
                <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Ex.: Poupança 2027" />
              </div>
              <div className="space-y-1">
                <Label>Acréscimo (%)</Label>
                <Input inputMode="decimal" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Período</Label>
                <Select value={r.period} onValueChange={(v) => set(i, { period: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIODS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Início</Label>
                <Input type="date" value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Fim</Label>
                <Input type="date" value={r.end} disabled={r.period !== 'PERSONALIZADO'} onChange={(e) => set(i, { end: e.target.value })} title={r.period !== 'PERSONALIZADO' ? 'Calculado pelo período ao salvar' : undefined} />
              </div>
              <div className="flex items-center justify-between sm:col-span-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={r.active} onCheckedChange={(c) => set(i, { active: c === true })} /> Ativa
                </label>
                <Button size="sm" variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  <Trash2Icon aria-hidden /> Remover
                </Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="mr-auto" onClick={() => setRows((x) => [...x, { name: '', active: true, pct: '20', period: 'MENSAL', start: todaySP().slice(0, 8) + '01', end: '' }])}>
            <PlusIcon aria-hidden /> Campanha
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
