import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, BellIcon, CalculatorIcon, TableIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { dayBr, money, num, pct, todaySP } from '@/lib/format'
import { useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface Dashboard {
  quotes: number
  chosen: number
  chosenTotal: number
  chosenAverage: number | null
  perKg: number | null
  percentOfGoods: number | null
  estimatedSavings: number
  chosenCheapest: number
  byUnit: { unitId: string; name: string; count: number; total: number }[]
  byCarrier: { carrierId: string | null; name: string; count: number; total: number; perKg: number | null }[]
  byUf: { uf: string; count: number; total: number }[]
  series: { day: string; quotes: number; chosen: number; total: number }[]
  tables: { vigentes: number; drafts: number; expiring: { id: string; name: string; carrier: string; validTo: string }[]; expired: { id: string; name: string; carrier: string; validTo: string }[] }
  activeCarriers: number
  ctes: { count: number; charged: number; expected: number; approved: number; recovered: number; byStatus: Record<string, number>; pendingDecision: number }
  invoices: { open: number; openTotal: number; paidInPeriod: number }
  deliveries: { measured: number; onTime: number; pct: number | null }
}

export interface FreightAlert {
  kind: string
  severity: 'alta' | 'media' | 'baixa'
  title: string
  detail: string
  link: string
  count: number
}

const chart: ChartConfig = { total: { label: 'Frete escolhido', color: 'var(--chart-1)' }, quotes: { label: 'Cotações', color: 'var(--chart-2)' } }

function Kpi({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <Card className="h-full transition-colors hover:bg-muted/30">
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function FretesPainelPage() {
  return (
    <RequirePermission module="fretes_painel">
      <Painel />
    </RequirePermission>
  )
}

function Painel() {
  const active = useActiveUnit()
  const [from, setFrom] = useState(todaySP(-29))
  const [to, setTo] = useState(todaySP())
  const qs = new URLSearchParams({ de: from, ate: to, ...(active.unitId ? { filial: active.unitId } : {}) })
  const d = useQuery({ queryKey: ['fretes', 'painel', qs.toString()], queryFn: () => api.get<Dashboard>(`/fretes/painel?${qs}`), enabled: !!active.ctx.data })
  const list = `/fretes/cotacoes`
  const alerts = useQuery({ queryKey: ['fretes', 'alertas'], queryFn: () => api.get<FreightAlert[]>('/fretes/alertas') })
  return (
    <div className="space-y-5">
      <PageHeader
        title="Painel de fretes"
        description="Cotações, CT-es, conciliação e faturas do período. Clique num número para abrir a lista que o forma."
        actions={
          <>
            <Input type="date" className="w-40" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="w-40" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
            <FilialSwitch active={active} />
          </>
        }
      />
      {d.isLoading || active.ctx.isLoading ? (
        <TableSkeleton />
      ) : d.error || !d.data ? (
        <ErrorState error={d.error} onRetry={() => d.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Cotações no período" value={num(d.data.quotes)} to={list} />
            <Kpi label="Com transportadora escolhida" value={num(d.data.chosen)} hint={d.data.chosen ? `${num(d.data.chosenCheapest)} na opção mais barata` : undefined} to={`${list}?situacao=SELECIONADA`} />
            <Kpi label="Frete cotado escolhido" value={money(d.data.chosenTotal)} hint={`Média ${money(d.data.chosenAverage)} por envio`} />
            <Kpi label="Economia estimada" value={money(d.data.estimatedSavings)} hint="Média das opções − escolhida. Estimativa, não valor recuperado." />
            <Kpi label="Custo médio por kg" value={d.data.perKg === null ? '—' : money(d.data.perKg)} />
            <Kpi label="Frete / valor da mercadoria" value={pct(d.data.percentOfGoods)} />
            <Kpi label="Tabelas vigentes" value={num(d.data.tables.vigentes)} hint={d.data.tables.drafts ? `${d.data.tables.drafts} em rascunho` : undefined} to="/fretes/tabelas?vigencia=VIGENTE" />
            <Kpi label="Transportadoras ativas" value={num(d.data.activeCarriers)} to="/fretes/transportadoras" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Frete cobrado (CT-e)" value={money(d.data.ctes.charged)} hint={`${num(d.data.ctes.count)} CT-e(s) · esperado ${money(d.data.ctes.expected)}`} to={`/fretes/ctes?de=${from}&ate=${to}`} />
            <Kpi label="Aguardando decisão" value={num(d.data.ctes.pendingDecision)} hint={`${num(d.data.ctes.byStatus.DIVERGENTE ?? 0)} divergente(s) no período`} to="/fretes/conciliacao" />
            <Kpi label="Crédito recuperado" value={money(d.data.ctes.recovered)} hint="Contestações aceitas pelas transportadoras" />
            <Kpi label="Entregas no prazo" value={pct(d.data.deliveries.pct)} hint={d.data.deliveries.measured ? `${num(d.data.deliveries.onTime)} de ${num(d.data.deliveries.measured)} entregas` : 'Sem entregas com previsão no período'} to="/fretes/pedidos?situacao=ENTREGUE" />
            <Kpi label="Faturas em aberto" value={money(d.data.invoices.openTotal)} hint={`${num(d.data.invoices.open)} fatura(s)`} to="/fretes/faturas?situacao=ABERTA" />
            <Kpi label="Pago no período" value={money(d.data.invoices.paidInPeriod)} to="/fretes/faturas?situacao=PAGA" />
          </div>

          {!!alerts.data?.length && <AlertList alerts={alerts.data} />}

          {(d.data.tables.expired.length > 0 || d.data.tables.expiring.length > 0) && (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangleIcon className="size-4 text-amber-600" aria-hidden /> Vigência das tabelas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {d.data.tables.expired.map((t) => (
                  <p key={t.id}>
                    <Link className="underline underline-offset-2" to={`/fretes/tabelas/${t.id}`}>
                      {t.name}
                    </Link>{' '}
                    ({t.carrier}) <span className="text-destructive">venceu em {dayBr(t.validTo)}</span>
                  </p>
                ))}
                {d.data.tables.expiring.map((t) => (
                  <p key={t.id}>
                    <Link className="underline underline-offset-2" to={`/fretes/tabelas/${t.id}`}>
                      {t.name}
                    </Link>{' '}
                    ({t.carrier}) vence em {dayBr(t.validTo)}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Frete escolhido por dia</CardTitle>
              <CardDescription>Soma das cotações com transportadora escolhida (valor cotado, não faturado).</CardDescription>
            </CardHeader>
            <CardContent>
              {d.data.series.length ? (
                <ChartContainer config={chart} className="h-64 w-full">
                  <BarChart data={d.data.series.map((s) => ({ ...s, label: dayBr(s.day).slice(0, 5) }))}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={70} tickFormatter={(v: number) => money(v).replace(',00', '')} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="total" fill="var(--color-total)" radius={4} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem cotações no período.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Ranking title="Por transportadora" rows={d.data.byCarrier.map((c) => ({ key: c.carrierId ?? c.name, name: c.name, count: c.count, total: c.total, extra: c.perKg === null ? null : `${money(c.perKg)}/kg` }))} />
            <Ranking title="Por filial" rows={d.data.byUnit.map((u) => ({ key: u.unitId, name: u.name, count: u.count, total: u.total }))} />
            <Ranking title="Por UF de destino" rows={d.data.byUf.map((u) => ({ key: u.uf, name: u.uf, count: u.count, total: u.total }))} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/fretes/cotacao">
                <CalculatorIcon aria-hidden /> Nova cotação
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/fretes/tabelas">
                <TableIcon aria-hidden /> Tabelas de frete
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function AlertList({ alerts }: { alerts: FreightAlert[] }) {
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellIcon className="size-4 text-amber-600" aria-hidden /> Alertas
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {alerts.map((a) => (
          <Link key={a.kind} to={a.link} className="flex items-start gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-muted/40">
            <span className={cn('min-w-8 rounded-md px-2 py-0.5 text-center font-semibold tabular-nums', a.severity === 'alta' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>{a.count}</span>
            <span>
              <span className="font-medium">{a.title}</span>
              <span className="block text-muted-foreground">{a.detail}</span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function Ranking({ title, rows }: { title: string; rows: { key: string; name: string; count: number; total: number; extra?: string | null }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">Sem escolhas no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Envios</TableHead>
                <TableHead className="text-right">Frete</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 10).map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="text-sm">
                    {r.name}
                    {r.extra && <span className="block text-xs text-muted-foreground">{r.extra}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
