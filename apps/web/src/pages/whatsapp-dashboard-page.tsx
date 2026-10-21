import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlarmClockIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon, LightbulbIcon, PhoneIncomingIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Delta, Stat } from '@/components/atendimento/dashboard'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { brl, int, pctFmt, todaySP } from '@/lib/atendimento'
import { cn } from '@/lib/utils'

interface Times {
  count: number
  avg: number | null
  median: number | null
  p90: number | null
}
interface Dash {
  from: string
  to: string
  businessHours: string
  totals: { received: number; initiated: number; activeConversations: number; messagesIn: number; messagesOut: number; calls: number; firstTurns: number; unansweredFirst: number; outsideBusinessShare: number | null }
  previous: { received: number; frtBusinessMedian: number | null }
  times: { frt: Times; frtBusiness: Times; response: Times; responseBusiness: Times; sla: { minutes: number; share: number | null }[] }
  now: { open: number; awaiting: number; waiting: { ate1h: number; ate4h: number; ate24h: number; mais24h: number }; oldest: { conversationId: string; name: string; number: string | null; since: string }[]; closedInPeriod: number }
  days: { day: string; received: number; initiated: number; messagesIn: number; frtMedian: number | null }[]
  heat: number[][]
  sellers: { id: string; name: string; answered: number; firstResponses: number; median: number | null; avg: number | null; p90: number | null; sent: number }[]
  numbers: { id: string; name: string; received: number; initiated: number; messagesIn: number; frtMedian: number | null; awaiting: number }[]
  commercial: { otherOrigin: number; records: number; returned: number; sales: number; revenue: number; fromGoogleAds: number; conversion: number | null; bySeller: { name: string; records: number; sales: number; revenue: number; conversion: number | null }[] }
  reminders: { created: number; done: number; overdue: number; pending: number }
  insights: { tone: 'bom' | 'atencao' | 'neutro'; text: string }[]
}

const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todaySP().slice(0, 8)}01`, todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
] as const
const ALL = '__all__'
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Minutos para texto curto: 45 s, 12 min, 3,5 h, 2,1 dias. */
function dur(min: number | null) {
  if (min === null) return '—'
  if (min < 1) return `${Math.round(min * 60)} s`
  if (min < 60) return `${Math.round(min)} min`
  if (min < 48 * 60) return `${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${(min / 1440).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}
const pct = (v: number | null) => (v === null ? '—' : pctFmt.format(v))
const since = (iso: string) => dur((Date.now() - new Date(iso).getTime()) / 60_000)

export function WhatsappDashboardPage() {
  return (
    <RequirePermission module="chat">
      <Dashboard />
    </RequirePermission>
  )
}

function Dashboard() {
  const [preset, setPreset] = useState<string>('30')
  const [range, setRange] = useState<[string, string]>([todaySP(-29), todaySP()])
  const [numberId, setNumberId] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const qs = new URLSearchParams({ de: range[0], ate: range[1], ...(numberId ? { numero: numberId } : {}), ...(all ? { todos: 'true' } : {}) }).toString()
  const q = useQuery({ queryKey: ['whatsapp-dashboard', qs], queryFn: () => api.get<Dash>(`/whatsapp/dashboard?${qs}`), placeholderData: keepPreviousData, refetchInterval: 60_000 })
  const numbers = useQuery({ queryKey: ['chat-numeros-visiveis'], queryFn: () => api.get<{ numbers: { id: string; name: string }[] }>('/chat/conversas?pagina=1') })
  const d = q.data
  return (
    <div>
      <PageHeader title="Dashboard do WhatsApp" description="Tempo de resposta, volume, situação agora, equipe e o resultado comercial das conversas." />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preset}
            onValueChange={(v) => {
              if (!v) return
              setPreset(v)
              const pr = PRESETS.find((x) => x.id === v)
              if (pr) setRange(pr.range() as [string, string])
            }}
            aria-label="Período"
          >
            {PRESETS.map((pr) => (
              <ToggleGroupItem key={pr.id} value={pr.id} className="px-3">
                {pr.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-1">
            <Input type="date" className="h-8 w-36" aria-label="De" value={range[0]} max={range[1]} onChange={(e) => e.target.value && (setPreset(''), setRange([e.target.value, range[1]]))} />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" className="h-8 w-36" aria-label="Até" value={range[1]} min={range[0]} onChange={(e) => e.target.value && (setPreset(''), setRange([range[0], e.target.value]))} />
          </div>
          <Select value={numberId ?? ALL} onValueChange={(v) => setNumberId(v === ALL ? null : v)}>
            <SelectTrigger size="sm" className="w-48" aria-label="Número">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os números</SelectItem>
              {numbers.data?.numbers.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Por padrão só entram conversas com clientes (sem colegas e fornecedores)">
            <Switch checked={all} onCheckedChange={setAll} aria-label="Incluir colegas e fornecedores" /> Incluir colegas e fornecedores
          </label>
        </div>

        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && <Body d={d} />}
      </div>
    </div>
  )
}

function Body({ d }: { d: Dash }) {
  const t = d.times
  const firstNoReply = d.totals.firstTurns ? d.totals.unansweredFirst / d.totals.firstTurns : null
  return (
    <>
      {d.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LightbulbIcon className="size-4 text-amber-500" /> O que chama atenção
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {d.insights.map((i, k) => (
                <li key={k} className="flex items-start gap-2">
                  {i.tone === 'atencao' ? (
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Atenção" />
                  ) : i.tone === 'bom' ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-[#006300] dark:text-[#0ca30c]" aria-label="Bom" />
                  ) : (
                    <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Informação" />
                  )}
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Atendimentos recebidos" value={int.format(d.totals.received)} delta={<Delta now={d.totals.received} before={d.previous.received} />} hint={`+ ${int.format(d.totals.initiated)} iniciados pela empresa`} />
        <Stat
          label="1ª resposta (típica, comercial)"
          value={dur(t.frtBusiness.median)}
          delta={<Delta now={t.frtBusiness.median} before={d.previous.frtBusinessMedian} lowerIsBetter />}
          hint={`Corrido: ${dur(t.frt.median)} · média ${dur(t.frtBusiness.avg)}`}
        />
        <Stat label="Entre pergunta e resposta" value={dur(t.responseBusiness.median)} delta={null} hint={`Típico, comercial · média ${dur(t.responseBusiness.avg)} · 10% piores: ${dur(t.responseBusiness.p90)}`} />
        <Stat label="Sem nenhuma resposta" value={pct(firstNoReply)} delta={null} hint={`${int.format(d.totals.unansweredFirst)} de ${int.format(d.totals.firstTurns)} atendimentos`} />
        <Stat label="Aguardando resposta agora" value={int.format(d.now.awaiting)} delta={null} hint={`${int.format(d.now.waiting.mais24h)} há mais de 24 h`} />
        <Stat label="Conversas em aberto" value={int.format(d.now.open)} delta={null} hint={`${int.format(d.now.closedInPeriod)} encerradas (arquivadas) no período`} />
        <Stat label="Mensagens" value={int.format(d.totals.messagesIn + d.totals.messagesOut)} delta={null} hint={`${int.format(d.totals.messagesIn)} recebidas · ${int.format(d.totals.messagesOut)} enviadas`} />
        <Stat label="Fora do horário comercial" value={pct(d.totals.outsideBusinessShare)} delta={null} hint="das mensagens de clientes" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Metas de 1ª resposta</CardTitle>
            <CardDescription>Atendimentos respondidos dentro de cada tempo, contando só o horário comercial ({d.businessHours}).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {t.sla.map((s) => (
              <div key={s.minutes} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">até {s.minutes < 60 ? `${s.minutes} min` : `${s.minutes / 60} h`}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                  <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.round((s.share ?? 0) * 100)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right font-medium tabular-nums">{pct(s.share)}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              1ª resposta: típica {dur(t.frtBusiness.median)}, média {dur(t.frtBusiness.avg)}, 10% piores acima de {dur(t.frtBusiness.p90)} ({int.format(t.frtBusiness.count)} respondidos).
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Esperando resposta agora</CardTitle>
            <CardDescription>Conversas de clientes cuja última mensagem foi do cliente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ['até 1 h', d.now.waiting.ate1h],
                  ['até 4 h', d.now.waiting.ate4h],
                  ['até 24 h', d.now.waiting.ate24h],
                  ['+ 24 h', d.now.waiting.mais24h],
                ] as const
              ).map(([k, v], i) => (
                <div key={k} className={cn('rounded-md border p-2', i === 3 && v > 0 && 'border-amber-500/50 bg-amber-500/10')}>
                  <p className="text-lg font-semibold tabular-nums">{v}</p>
                  <p className="text-xs text-muted-foreground">{k}</p>
                </div>
              ))}
            </div>
            {d.now.oldest.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {d.now.oldest.map((o) => (
                  <li key={o.conversationId}>
                    <Link to={`/chat?conversa=${o.conversationId}`} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50">
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">há {since(o.since)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DayChart title="Atendimentos recebidos por dia" data={d.days} dataKey="received" label="Atendimentos" format={(v) => int.format(v)} />
        <DayChart title="1ª resposta típica por dia (comercial)" data={d.days} dataKey="frtMedian" label="Minutos" format={(v) => dur(v)} />
      </div>

      <Heatmap heat={d.heat} />

      <Section title="Equipe" description="Quem respondeu (pelo CRM) e as respostas dadas direto no celular. Tempos em horário comercial.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quem</TableHead>
              <Num>Respostas</Num>
              <Num className="hidden md:table-cell">1ªs respostas</Num>
              <Num>Típico</Num>
              <Num className="hidden md:table-cell">Média</Num>
              <Num className="hidden lg:table-cell">10% piores</Num>
              <Num>Mensagens enviadas</Num>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.sellers.length === 0 && <Empty cols={7} />}
            {d.sellers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className={cn('font-medium', s.id === 'celular' && 'text-muted-foreground')}>{s.name}</TableCell>
                <Num>{int.format(s.answered)}</Num>
                <Num className="hidden md:table-cell">{int.format(s.firstResponses)}</Num>
                <Num>{dur(s.median)}</Num>
                <Num className="hidden md:table-cell">{dur(s.avg)}</Num>
                <Num className="hidden lg:table-cell">{dur(s.p90)}</Num>
                <Num>{int.format(s.sent)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Por número">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <Num>Recebidos</Num>
                <Num className="hidden md:table-cell">Iniciados</Num>
                <Num>1ª resposta</Num>
                <Num>Aguardando</Num>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.numbers.length === 0 && <Empty cols={5} />}
              {d.numbers.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.name}</TableCell>
                  <Num>{int.format(n.received)}</Num>
                  <Num className="hidden md:table-cell">{int.format(n.initiated)}</Num>
                  <Num>{dur(n.frtMedian)}</Num>
                  <Num>{int.format(n.awaiting)}</Num>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado comercial</CardTitle>
            <CardDescription>Pré-vendas abertas pelas conversas do chat do CRM no período.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Pré-vendas" value={int.format(d.commercial.records)} />
              <Mini label="Vendedor retornou" value={int.format(d.commercial.returned)} />
              <Mini label="Vendas" value={int.format(d.commercial.sales)} hint={pct(d.commercial.conversion)} />
              <Mini label="Valor vendido" value={brl.format(d.commercial.revenue)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {int.format(d.commercial.fromGoogleAds)} delas vieram de anúncio do Google Ads.
              {d.commercial.otherOrigin > 0 && ` Além disso, ${int.format(d.commercial.otherOrigin)} pré-venda(s) com origem WhatsApp entraram pelo botão do site ou pela planilha (veja no dashboard do Pré-Vendas).`}
            </p>
            {d.commercial.bySeller.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <Num>Pré-vendas</Num>
                    <Num>Vendas</Num>
                    <Num>Conversão</Num>
                    <Num className="hidden sm:table-cell">Vendido</Num>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.commercial.bySeller.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell>{s.name}</TableCell>
                      <Num>{int.format(s.records)}</Num>
                      <Num>{int.format(s.sales)}</Num>
                      <Num>{pct(s.conversion)}</Num>
                      <Num className="hidden sm:table-cell">{brl.format(s.revenue)}</Num>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lembretes atrasados" value={int.format(d.reminders.overdue)} delta={null} hint={`${int.format(d.reminders.pending)} agendados`} />
        <Stat label="Lembretes concluídos" value={int.format(d.reminders.done)} delta={null} hint={`${int.format(d.reminders.created)} criados no período`} />
        <Stat label="Ligações recebidas" value={int.format(d.totals.calls)} delta={null} hint="Atendidas pelo celular" />
        <Stat label="Conversas com movimento" value={int.format(d.totals.activeConversations)} delta={null} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlarmClockIcon className="size-3.5" /> Atendimento = conversa que o cliente abre depois de 24 h sem falar (ou a primeira). <PhoneIncomingIcon className="size-3.5" /> “Típico” = mediana (metade
        mais rápida que isso); “10% piores” = os mais demorados.
      </p>
    </>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-0 sm:px-6">{children}</CardContent>
    </Card>
  )
}

function Num({ children, className }: { children?: ReactNode; className?: string }) {
  return <TableCell className={cn('text-right whitespace-nowrap tabular-nums', className)}>{children}</TableCell>
}

function Empty({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">
        Sem dados no período.
      </TableCell>
    </TableRow>
  )
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Uma série por gráfico (nunca dois eixos). */
function DayChart({ title, data, dataKey, label, format }: { title: string; data: Dash['days']; dataKey: 'received' | 'frtMedian'; label: string; format: (v: number) => string }) {
  const config: ChartConfig = { [dataKey]: { label, color: 'var(--chart-1)' } }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tickFormatter={(v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} />
            <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={(v) => format(Number(v))} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => String(v).split('-').reverse().join('/')} formatter={(v) => format(Number(v))} />} />
            <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

/** Mensagens de clientes por dia da semana e hora: uma cor só, mais escura = mais mensagens. */
function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat())
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quando os clientes escrevem</CardTitle>
        <CardDescription>Mensagens recebidas por dia da semana e hora (horário de Brasília). Mais escuro = mais mensagens; ajuda a escalar a equipe.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr>
              <th className="w-10" />
              {hours.map((h) => (
                <th key={h} className="font-normal text-muted-foreground">
                  {h % 3 === 0 ? h : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.map((row, w) => (
              <tr key={w}>
                <th className="pr-1 text-right font-normal text-muted-foreground">{WEEK[w]}</th>
                {row.map((n, h) => (
                  <td
                    key={h}
                    className="h-6 rounded-[3px]"
                    style={{ background: n ? `color-mix(in oklab, var(--chart-1) ${Math.round(15 + (n / max) * 85)}%, transparent)` : 'var(--muted)' }}
                    title={`${WEEK[w]} ${h}h: ${n} mensagem(ns)`}
                    aria-label={`${WEEK[w]} ${h}h: ${n} mensagens`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
