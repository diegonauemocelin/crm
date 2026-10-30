import { useQuery } from '@tanstack/react-query'
import { TrendingUpIcon } from 'lucide-react'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { money, moneyShort, num, pct } from '@/lib/marketing'
import { cn } from '@/lib/utils'

type Channel = 'tudo' | 'atendimento' | 'ecommerce' | 'marketplace'
interface Totals {
  revenue: number
  sales: number
}
interface Summary {
  key: Channel
  previous: Totals
  previousToDate: Totals
  current: Totals
  projection: number
  growth: number | null
  pace: number | null
}
interface Comparison {
  months: { current: string; previous: string }
  today: number
  daysInMonth: number
  series: { day: number; current: number | null; previous: number | null; projection: number | null }[]
  channels: Summary[]
}

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'tudo', label: 'Total' },
  { key: 'atendimento', label: 'Atendimento' },
  { key: 'ecommerce', label: 'E-commerce' },
  { key: 'marketplace', label: 'Marketplace' },
]
const LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`

/** Variação em % com sinal e cor (verde subiu, vermelho caiu). */
function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>
  return <span className={cn('font-medium tabular-nums', v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '')}>{`${v > 0 ? '+' : ''}${pct(v * 100)}`}</span>
}

/**
 * Comparativo mensal do faturamento: mês anterior x mês em andamento, acumulado dia a dia, e a projeção até o fim do
 * mês pelo ritmo de hoje. Por canal ou no total; a tabela mostra todos os canais lado a lado.
 */
export function ComparativoMensal() {
  const [channel, setChannel] = useState<Channel>('tudo')
  const q = useQuery({ queryKey: ['marketing-comparativo', channel], queryFn: () => api.get<Comparison>(`/marketing/comparativo?origem=${channel}`), staleTime: 60_000 })
  const d = q.data
  const config: ChartConfig = d
    ? {
        current: { label: monthLabel(d.months.current), color: 'var(--chart-1)' },
        previous: { label: monthLabel(d.months.previous), color: 'var(--chart-4)' },
        projection: { label: 'Projeção', color: 'var(--destructive)' },
      }
    : {}
  const shown = d?.channels.find((c) => c.key === channel)
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUpIcon className="size-4" /> Comparativo do mês
          </CardTitle>
          <CardDescription>Faturamento acumulado dia a dia: mês anterior, mês em andamento e a projeção até o fim do mês pelo ritmo de hoje. Não segue o período dos filtros.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Canal">
          {CHANNELS.map((c) => (
            <Button key={c.key} size="sm" role="tab" aria-selected={channel === c.key} variant={channel === c.key ? 'secondary' : 'ghost'} onClick={() => setChannel(c.key)}>
              {c.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading && <TableSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && shown && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Box label={`${monthLabel(d.months.previous)} (mês inteiro)`} value={money(shown.previous.revenue)} hint={`${num(shown.previous.sales)} venda(s)`} />
              <Box label={`${monthLabel(d.months.current)} até o dia ${d.today}`} value={money(shown.current.revenue)} hint={<>no mesmo ponto do mês anterior: {money(shown.previousToDate.revenue)} (<Change v={shown.pace} />)</>} />
              <Box label="Projeção do mês" value={money(shown.projection)} hint={`média de ${money(shown.current.revenue / d.today)} por dia × ${d.daysInMonth} dias`} />
              <Box label="Crescimento possível" value={<Change v={shown.growth} />} hint={`projeção sobre ${monthLabel(d.months.previous)}`} />
            </div>
            <ChartContainer config={config} className="aspect-auto h-72 w-full">
              <LineChart data={d.series} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
                <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => moneyShort(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Dia ${p?.[0]?.payload?.day ?? ''}`} formatter={(v, n) => `${config[String(n)]?.label ?? n}: ${money(Number(v))}`} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="previous" type="monotone" stroke="var(--color-previous)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line dataKey="projection" type="linear" stroke="var(--color-projection)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ChartContainer>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">{monthLabel(d.months.previous)}</TableHead>
                    <TableHead className="text-right">Até o dia {d.today} ({monthLabel(d.months.previous)})</TableHead>
                    <TableHead className="text-right">{monthLabel(d.months.current)} até hoje</TableHead>
                    <TableHead className="text-right">Ritmo</TableHead>
                    <TableHead className="text-right">Projeção</TableHead>
                    <TableHead className="text-right">Crescimento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.channels.map((c) => (
                    <TableRow key={c.key} className={cn('cursor-pointer', c.key === 'tudo' && 'font-medium', c.key === channel && 'bg-muted/50')} onClick={() => setChannel(c.key)}>
                      <TableCell>{LABEL[c.key]}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.previous.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.previousToDate.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.current.revenue)}</TableCell>
                      <TableCell className="text-right">
                        <Change v={c.pace} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.projection)}</TableCell>
                      <TableCell className="text-right">
                        <Change v={c.growth} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Ritmo: o mês atual comparado ao anterior até o mesmo dia. Projeção: média por dia até hoje × dias do mês (é uma estimativa; fins de semana e feriados mudam o resultado). Atendimento conta a venda no dia do atendimento; loja, os pedidos pagos.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Box({ label, value, hint }: { label: string; value: React.ReactNode; hint: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
