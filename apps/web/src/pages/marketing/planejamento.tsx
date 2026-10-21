import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Kpi } from '@/components/marketing/ui'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money, num, pct, PLATFORM_LABEL, todayLocal } from '@/lib/marketing'
import { cn } from '@/lib/utils'

interface MonthPlan {
  budget: { total: number | null; google: number | null; meta: number | null; tiktok: number | null; campaigns: Record<string, number> }
  goals: { leads: number | null; cpl: number | null; sales: number | null; revenue: number | null }
  updatedAt: string | null
  updatedBy: string | null
}
interface Goal {
  goal: number
  done: number
  pct: number | null
  expected: number
  onTrack: boolean
}
interface PlanView {
  month: string
  days: { total: number; elapsed: number; future: boolean }
  plan: MonthPlan
  budget: {
    total: number | null
    spent: number
    remaining: number | null
    consumedPct: number | null
    projection: { spent: number; projected: number | null; low: number | null; high: number | null; premise: string }
    overBudget: boolean
    platforms: { key: 'google' | 'meta' | 'tiktok'; budget: number | null; spent: number; remaining: number | null; consumedPct: number | null; projected: number | null; overBudget: boolean }[]
    campaigns: { key: string; name: string; platform: string | null; budget: number | null; spent: number; consumedPct: number | null; projected: number | null; leads: number; sales: number; revenue: number }[]
  }
  goals: { leads: Goal | null; sales: Goal | null; revenue: Goal | null; cpl: Goal | null } | null
  realized: { leads: number; sales: number; revenue: number; cpl: number | null; roas: number | null; mediaCost: number } | null
  scenarios: { change: number; investment: number; leads: { low: number; high: number }; sales: { low: number; high: number }; revenue: { low: number; high: number } }[]
  premises: string[]
}

export function PlanejamentoPage() {
  return (
    <RequirePermission module="mi_orcamento">
      <Planejamento />
    </RequirePermission>
  )
}

function Bar({ value, danger }: { value: number | null; danger?: boolean }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="h-2 w-full rounded bg-muted" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-2 rounded', danger ? 'bg-red-500' : 'bg-[color:var(--brand)]')} style={{ width: `${v}%` }} />
    </div>
  )
}

function Planejamento() {
  const { can } = useAuth()
  const [month, setMonth] = useState(todayLocal().slice(0, 7))
  const q = useQuery({ queryKey: ['mkt-plano', month], queryFn: () => api.get<PlanView>(`/marketing/planejamento/${month}`) })
  const d = q.data
  return (
    <div>
      <PageHeader title="Planejamento e orçamento" description="Orçamento do mês por plataforma e campanha, metas de leads, CPL, vendas e faturamento, projeção até o fim do mês e cenários." />
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="plan-month">Mês</Label>
          <Input id="plan-month" type="month" className="h-8 w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            {!d.days.future && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Gasto em mídia no mês" value={money(d.budget.spent)} hint={d.budget.total !== null ? `${pct(d.budget.consumedPct)} do orçamento de ${money(d.budget.total)}` : 'sem orçamento cadastrado'} />
                <Kpi label="Saldo do orçamento" value={money(d.budget.remaining)} hint={`dia ${d.days.elapsed} de ${d.days.total}`} />
                <Kpi label="Projeção até o fim do mês" value={money(d.budget.projection.projected)} hint={d.budget.projection.low !== null ? `faixa: ${money(d.budget.projection.low)} a ${money(d.budget.projection.high)}` : 'faixa a partir de 7 dias de dados'} />
                <Kpi label="Leads · vendas no mês" value={`${num(d.realized?.leads ?? 0)} · ${num(d.realized?.sales ?? 0)}`} hint={`${money(d.realized?.revenue ?? 0)} · CPL ${money(d.realized?.cpl ?? null)}`} />
              </div>
            )}
            {d.budget.overBudget && (
              <p className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                <AlertTriangleIcon className="size-4 text-red-600" /> No ritmo atual, o gasto do mês passa o orçamento ({money(d.budget.projection.projected)} de {money(d.budget.total)}).
              </p>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Orçamento por plataforma</CardTitle>
                  <CardDescription>{d.budget.projection.premise}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {d.budget.platforms.map((p) => (
                    <div key={p.key} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{PLATFORM_LABEL[p.key]}</span>
                        <span className="text-muted-foreground">
                          {money(p.spent)} {p.budget !== null ? `de ${money(p.budget)} (${pct(p.consumedPct)})` : '· sem orçamento'} · projeção {money(p.projected)}
                        </span>
                      </div>
                      {p.budget !== null && <Bar value={p.consumedPct} danger={p.overBudget} />}
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Metas do mês</CardTitle>
                  <CardDescription>Esperado até hoje = meta proporcional aos dias que passaram.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!d.goals || Object.values(d.goals).every((g) => !g) ? (
                    <p className="text-muted-foreground">Nenhuma meta cadastrada para o mês.</p>
                  ) : (
                    (
                      [
                        ['Leads', d.goals.leads, num],
                        ['Vendas', d.goals.sales, num],
                        ['Faturamento', d.goals.revenue, money],
                        ['CPL (máximo)', d.goals.cpl, money],
                      ] as const
                    )
                      .filter(([, g]) => g)
                      .map(([label, g, fmt]) => (
                        <div key={label} className="space-y-1">
                          <div className="flex justify-between gap-2">
                            <span className="flex items-center gap-1 font-medium">
                              {g!.onTrack ? <CheckCircle2Icon className="size-4 text-[#006300] dark:text-[#0ca30c]" /> : <AlertTriangleIcon className="size-4 text-amber-600" />} {label}
                            </span>
                            <span className="text-muted-foreground">
                              {fmt(g!.done)} de {fmt(g!.goal)} {label !== 'CPL (máximo)' && `· esperado até hoje ${fmt(g!.expected)}`}
                            </span>
                          </div>
                          {label !== 'CPL (máximo)' && <Bar value={g!.pct} />}
                        </div>
                      ))
                  )}
                </CardContent>
              </Card>
            </div>
            {d.scenarios.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cenários de investimento (estimativas)</CardTitle>
                  <CardDescription>{d.premises.slice(1).join(' ')}</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Cenário</TableHead>
                        <TableHead className="text-right">Investimento</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Vendas</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/40">
                        <TableCell className="pl-6 font-medium">Mês até agora</TableCell>
                        <TableCell className="text-right">{money(d.realized?.mediaCost ?? 0)}</TableCell>
                        <TableCell className="text-right">{num(d.realized?.leads ?? 0)}</TableCell>
                        <TableCell className="text-right">{num(d.realized?.sales ?? 0)}</TableCell>
                        <TableCell className="text-right">{money(d.realized?.revenue ?? 0)}</TableCell>
                      </TableRow>
                      {d.scenarios.map((s) => (
                        <TableRow key={s.change}>
                          <TableCell className="pl-6">
                            {s.change > 0 ? '+' : ''}
                            {s.change}% de investimento
                          </TableCell>
                          <TableCell className="text-right">{money(s.investment)}</TableCell>
                          <TableCell className="text-right">
                            {num(s.leads.low)} a {num(s.leads.high)}
                          </TableCell>
                          <TableCell className="text-right">
                            {num(s.sales.low)} a {num(s.sales.high)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(s.revenue.low)} a {money(s.revenue.high)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            {d.budget.campaigns.length > 0 && <CampaignBudgets key={`orc-${month}-${d.plan.updatedAt}`} d={d} month={month} canEdit={can('mi_orcamento', 'edit')} />}
            <PlanForm key={`plano-${month}-${d.plan.updatedAt}`} d={d} month={month} canEdit={can('mi_orcamento', 'edit')} />
          </>
        )}
      </div>
    </div>
  )
}

const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const s = (v: number | null) => (v === null ? '' : String(v))

function PlanForm({ d, month, canEdit }: { d: PlanView; month: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => toForm(d.plan))
  const save = useMutation({
    mutationFn: () => api.put<PlanView>(`/marketing/planejamento/${month}`, { budget: { total: n(f.total), google: n(f.google), meta: n(f.meta), tiktok: n(f.tiktok), campaigns: d.plan.budget.campaigns }, goals: { leads: n(f.leads), cpl: n(f.cpl), sales: n(f.sales), revenue: n(f.revenue) } }),
    onSuccess: (v) => (qc.setQueryData(['mkt-plano', month], v), toast.success('Planejamento salvo.')),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`plan-${k}`}>{label}</Label>
      <Input id={`plan-${k}`} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!canEdit} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Orçamento e metas de {month.slice(5, 7)}/{month.slice(0, 4)}</CardTitle>
        <CardDescription>Deixe em branco o que não quiser acompanhar.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {field('total', 'Orçamento total (R$)', 'Vazio = soma das plataformas')}
        {field('google', 'Google Ads (R$)')}
        {field('meta', 'Meta Ads (R$)')}
        {field('tiktok', 'TikTok Ads (R$)')}
        {field('leads', 'Meta de leads')}
        {field('cpl', 'CPL máximo (R$)')}
        {field('sales', 'Meta de vendas')}
        {field('revenue', 'Meta de faturamento (R$)')}
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-between gap-2">
          <span className="text-xs text-muted-foreground">{d.plan.updatedAt ? `Salvo por ${d.plan.updatedBy} em ${formatDateTime(d.plan.updatedAt)}` : 'Ainda sem planejamento para o mês.'}</span>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar planejamento
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
const toForm = (p: MonthPlan) => ({ total: s(p.budget.total), google: s(p.budget.google), meta: s(p.budget.meta), tiktok: s(p.budget.tiktok), leads: s(p.goals.leads), cpl: s(p.goals.cpl), sales: s(p.goals.sales), revenue: s(p.goals.revenue) })

function CampaignBudgets({ d, month, canEdit }: { d: PlanView; month: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(d.plan.budget.campaigns).map(([k, v]) => [k, String(v)])))
  const save = useMutation({
    mutationFn: () =>
      api.put<PlanView>(`/marketing/planejamento/${month}`, {
        budget: { ...d.plan.budget, campaigns: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v.replace(',', '.'))])) },
        goals: d.plan.goals,
      }),
    onSuccess: (v) => (qc.setQueryData(['mkt-plano', month], v), toast.success('Orçamento por campanha salvo.')),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Por campanha</CardTitle>
        <CardDescription>Gasto do mês e projeção no ritmo atual. Cadastre o orçamento de cada campanha para acompanhar o consumo.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Campanha</TableHead>
              <TableHead className="text-right">Orçamento (R$)</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Consumido</TableHead>
              <TableHead className="text-right">Projeção</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.budget.campaigns.map((c) => (
              <TableRow key={c.key}>
                <TableCell className="max-w-72 truncate pl-6" title={c.name}>
                  {c.name}
                  {c.platform && <span className="ml-1 text-xs text-muted-foreground">{PLATFORM_LABEL[c.platform as keyof typeof PLATFORM_LABEL] ?? c.platform}</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Input aria-label={`Orçamento de ${c.name}`} className="ml-auto h-8 w-28 text-right" inputMode="decimal" value={values[c.key] ?? ''} onChange={(e) => setValues({ ...values, [c.key]: e.target.value })} disabled={!canEdit} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(c.spent)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', c.budget !== null && c.projected !== null && c.projected > c.budget * 1.05 && 'text-red-600')}>{pct(c.consumedPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(c.projected)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(c.leads)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(c.sales)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar orçamento por campanha
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
