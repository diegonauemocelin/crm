import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, AlertTriangleIcon, CheckCircle2Icon, CpuIcon, DatabaseIcon, HardDriveIcon, MemoryStickIcon, MessageCircleIcon, ServerIcon, XCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

type Level = 'ok' | 'atencao' | 'problema'
interface Data {
  now: { cpuPct: number | null; load: number[]; cpus: number; memPct: number; disk: { pct: number | null; freeGb: number | null; totalGb: number | null }; apiMemMb: number; serverUptimeH: number; dbMs: number | null }
  systems: { key: string; name: string; level: Level; detail: string }[]
  chart: { at: string; cpu: number; mem: number; disk: number | null; dbMs: number; apiMemMb: number; requests: number; errors: number; avgMs: number }[]
  bucketMin: number
  numbers: { id: string; name: string; phone: string | null; status: string; why: string; level: Level; lastInboundAt: string | null; inToday: number; outToday: number; purpose: string }[]
  activity: { logins: number; failedLogins: number; activeUsers: number; leads: number; messagesIn: number; messagesOut: number; requests: number; errors: number; byHour: { h: number; in: number; out: number }[] }
}

const LEVEL: Record<Level, { label: string; cls: string; Icon: typeof CheckCircle2Icon }> = {
  ok: { label: 'Normal', cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2Icon },
  atencao: { label: 'Atenção', cls: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangleIcon },
  problema: { label: 'Problema', cls: 'text-destructive', Icon: XCircleIcon },
}

const usage: ChartConfig = { cpu: { label: 'CPU %', color: 'var(--chart-1)' }, mem: { label: 'Memória %', color: 'var(--chart-2)' }, disk: { label: 'Disco %', color: 'var(--chart-3)' } }
const traffic: ChartConfig = { requests: { label: 'Pedidos', color: 'var(--chart-1)' }, errors: { label: 'Erros', color: 'var(--chart-5)' } }
const speed: ChartConfig = { avgMs: { label: 'Resposta da API (ms)', color: 'var(--chart-2)' }, dbMs: { label: 'Banco (ms)', color: 'var(--chart-4)' } }
const msgs: ChartConfig = { in: { label: 'Recebidas', color: 'var(--chart-1)' }, out: { label: 'Enviadas', color: 'var(--chart-2)' } }

const hm = (iso: string, long: boolean) => {
  const d = new Date(iso)
  return long ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h` : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const ago = (iso: string | null) => {
  if (!iso) return 'nunca'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 48 * 60 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`
}

function Stat({ icon: Icon, label, value, sub, level }: { icon: typeof CpuIcon; label: string; value: string; sub?: string; level?: Level }) {
  return (
    <Card className="gap-1 p-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden /> {label}
      </p>
      <p className={cn('text-2xl font-semibold tabular-nums', level && level !== 'ok' && LEVEL[level].cls)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

/** Administração › Monitoramento: saúde do servidor e dos sistemas, gráficos de uso e as atividades do dia (só o Administrador). */
export function MonitorPage() {
  const { me } = useAuth()
  const [hours, setHours] = useState('24')
  const q = useQuery({ queryKey: ['monitoramento', hours], queryFn: () => api.get<Data>(`/monitoramento?horas=${hours}`), refetchInterval: 60_000, enabled: !!me?.role.isSystem })
  if (me && !me.role.isSystem) return <Navigate to="/" replace />
  const d = q.data
  const long = Number(hours) > 24
  const chart = (d?.chart ?? []).map((c) => ({ ...c, label: hm(c.at, long) }))
  const problems = d ? [...d.systems.filter((s) => s.level !== 'ok'), ...d.numbers.filter((n) => n.level !== 'ok')].length : 0
  return (
    <>
      <PageHeader
        title="Monitoramento"
        description="Saúde do servidor e dos sistemas, uso ao longo do tempo e as atividades do dia. Atualiza sozinho a cada minuto. Número de WhatsApp que cai ou para de receber avisa os administradores no celular."
        actions={
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="w-40" aria-label="Período dos gráficos">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Última hora</SelectItem>
              <SelectItem value="6">Últimas 6 horas</SelectItem>
              <SelectItem value="24">Últimas 24 horas</SelectItem>
              <SelectItem value="72">Últimos 3 dias</SelectItem>
              <SelectItem value="168">Últimos 7 dias</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!d && !q.error && <TableSkeleton />}
      {d && (
        <div className="space-y-4">
          <Card className={cn('flex-row items-center gap-3 p-4', problems ? 'border-amber-500/50 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            {problems ? <AlertTriangleIcon className="size-6 text-amber-600" aria-hidden /> : <CheckCircle2Icon className="size-6 text-emerald-600" aria-hidden />}
            <p className="font-medium">{problems ? `${problems} ponto(s) pedem atenção (veja abaixo).` : 'Tudo funcionando normalmente.'}</p>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat icon={CpuIcon} label="CPU" value={d.now.cpuPct === null ? '—' : `${Math.round(d.now.cpuPct)}%`} sub={`${d.now.cpus} núcleo(s) · carga ${d.now.load[0]}`} level={d.now.cpuPct !== null && d.now.cpuPct > 90 ? 'problema' : d.now.cpuPct !== null && d.now.cpuPct > 75 ? 'atencao' : 'ok'} />
            <Stat icon={MemoryStickIcon} label="Memória" value={`${d.now.memPct}%`} sub={`API usa ${d.now.apiMemMb} MB`} level={d.systems.find((s) => s.key === 'mem')?.level} />
            <Stat icon={HardDriveIcon} label="Disco" value={d.now.disk.pct === null ? '—' : `${d.now.disk.pct}%`} sub={d.now.disk.freeGb === null ? undefined : `${d.now.disk.freeGb} GB livres`} level={d.systems.find((s) => s.key === 'disk')?.level} />
            <Stat icon={DatabaseIcon} label="Banco" value={d.now.dbMs === null ? 'fora' : `${d.now.dbMs} ms`} sub="tempo de resposta" level={d.systems.find((s) => s.key === 'db')?.level} />
            <Stat icon={ServerIcon} label="Servidor ligado" value={`${d.now.serverUptimeH} h`} sub="desde o último reinício" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sistemas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {d.systems.map((s) => {
                  const L = LEVEL[s.level]
                  return (
                    <div key={s.key} className="flex items-start gap-2 rounded-md border p-2.5">
                      <L.Icon className={cn('mt-0.5 size-4 shrink-0', L.cls)} aria-label={L.label} />
                      <span className="min-w-0">
                        <span className="font-medium">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">{s.detail}</span>
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Uso do servidor</CardTitle>
                <CardDescription>Média a cada {d.bucketMin} min.</CardDescription>
              </CardHeader>
              <CardContent>
                {chart.length ? (
                  <ChartContainer config={usage} className="aspect-auto h-60 w-full">
                    <LineChart data={chart} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis domain={[0, 100]} width={32} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line dataKey="cpu" stroke="var(--color-cpu)" dot={false} strokeWidth={2} />
                      <Line dataKey="mem" stroke="var(--color-mem)" dot={false} strokeWidth={2} />
                      <Line dataKey="disk" stroke="var(--color-disk)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">As leituras começam a aparecer alguns minutos depois de atualizar o sistema.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Uso do sistema</CardTitle>
                <CardDescription>Pedidos à API e erros do servidor (somados a cada {d.bucketMin} min).</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={traffic} className="aspect-auto h-56 w-full">
                  <AreaChart data={chart} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis width={40} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area dataKey="requests" type="monotone" fill="var(--color-requests)" fillOpacity={0.25} stroke="var(--color-requests)" />
                    <Area dataKey="errors" type="monotone" fill="var(--color-errors)" fillOpacity={0.4} stroke="var(--color-errors)" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Velocidade</CardTitle>
                <CardDescription>Tempo médio de resposta da API e do banco de dados.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={speed} className="aspect-auto h-56 w-full">
                  <LineChart data={chart} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis width={40} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line dataKey="avgMs" stroke="var(--color-avgMs)" dot={false} strokeWidth={2} />
                    <Line dataKey="dbMs" stroke="var(--color-dbMs)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat icon={ActivityIcon} label="Pessoas usando (24 h)" value={String(d.activity.activeUsers)} />
            <Stat icon={ActivityIcon} label="Entradas hoje" value={String(d.activity.logins)} sub={d.activity.failedLogins ? `${d.activity.failedLogins} com senha errada` : undefined} level={d.activity.failedLogins > 20 ? 'atencao' : 'ok'} />
            <Stat icon={MessageCircleIcon} label="Mensagens recebidas hoje" value={String(d.activity.messagesIn)} />
            <Stat icon={MessageCircleIcon} label="Mensagens enviadas hoje" value={String(d.activity.messagesOut)} />
            <Stat icon={ActivityIcon} label="Leads novos hoje" value={String(d.activity.leads)} />
            <Stat icon={AlertTriangleIcon} label="Erros do servidor hoje" value={String(d.activity.errors)} sub={`em ${d.activity.requests} pedidos`} level={d.activity.errors > 50 ? 'atencao' : 'ok'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Números de WhatsApp</CardTitle>
                <CardDescription>Situação de cada número e o movimento de hoje.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Última recebida</TableHead>
                      <TableHead className="text-right">Hoje (rec./env.)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.numbers.map((n) => {
                      const L = LEVEL[n.level]
                      return (
                        <TableRow key={n.id}>
                          <TableCell>
                            <span className="font-medium">{n.name}</span>
                            {n.purpose === 'MONITORAMENTO' && <Badge variant="outline" className="ml-1.5 text-[10px]">monitoramento</Badge>}
                          </TableCell>
                          <TableCell>
                            <span className={cn('inline-flex items-center gap-1 text-sm', L.cls)}>
                              <L.Icon className="size-3.5" aria-hidden /> {L.label}
                            </span>
                            <span className="block max-w-64 text-xs text-muted-foreground">{n.why}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{ago(n.lastInboundAt)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {n.inToday} / {n.outToday}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mensagens por hora (hoje)</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={msgs} className="aspect-auto h-56 w-full">
                  <BarChart data={d.activity.byHour.map((x) => ({ ...x, label: `${x.h}h` }))} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} />
                    <YAxis width={32} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="in" fill="var(--color-in)" radius={3} />
                    <Bar dataKey="out" fill="var(--color-out)" radius={3} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
