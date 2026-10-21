import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, LightbulbIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Delta, Stat } from '@/components/atendimento/dashboard'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { brl, int, pctFmt, todaySP } from '@/lib/atendimento'
import { cn } from '@/lib/utils'

interface Funnel {
  sent: number
  failed: number
  bounced: number
  opened: number
  clicked: number
  unsubscribed: number
}
interface Rates {
  delivery: number | null
  bounce: number | null
  open: number | null
  click: number | null
  clickToOpen: number | null
  unsubscribe: number | null
}
interface Money {
  count: number
  revenue: number
}
interface Dash {
  from: string
  to: string
  windowDays: number
  funnel: Funnel
  rates: Rates
  previous: { funnel: Funnel; rates: Rates; sales: Money }
  sales: Money & { store: Money; service: Money; perSent: number | null }
  days: { day: string; sent: number; opened: number; clicked: number }[]
  heat: number[][]
  bestSlot: { weekday: string; hour: number } | null
  campaigns: (Funnel & Money & { id: string; name: string; kind: string; subject: string; firstSent: string | null; open: number | null; click: number | null; unsubscribe: number | null })[]
  automations: (Funnel & Money & { id: string; name: string; active: boolean; entered: number; completed: number; purchased: number; open: number | null; click: number | null })[]
  links: { campaignId: string; campaign: string; url: string; clicks: number; people: number }[]
  base: { withEmail: number; contactable: number; optOut: number; bounced: number }
  insights: { tone: 'bom' | 'atencao' | 'neutro'; text: string }[]
}

const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todaySP().slice(0, 8)}01`, todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
] as const
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const pct = (v: number | null) => (v === null ? '—' : pctFmt.format(v))
const dateBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
/** Endereço curto do link: domínio + caminho, sem os parâmetros de rastreamento. */
const shortUrl = (u: string) => {
  try {
    const x = new URL(u)
    return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`
  } catch {
    return u
  }
}

export function EmailDashboardPage() {
  return (
    <RequirePermission module="email_marketing">
      <Dashboard />
    </RequirePermission>
  )
}

function Dashboard() {
  const [preset, setPreset] = useState<string>('30')
  const [range, setRange] = useState<[string, string]>([todaySP(-29), todaySP()])
  const [source, setSource] = useState('todos')
  const [windowDays, setWindowDays] = useState('7')
  const qs = new URLSearchParams({ de: range[0], ate: range[1], origem: source, janela: windowDays }).toString()
  const q = useQuery({ queryKey: ['email-dashboard', qs], queryFn: () => api.get<Dash>(`/email/dashboard?${qs}`), placeholderData: keepPreviousData })
  return (
    <div>
      <PageHeader title="Dashboard do e-mail marketing" description="Entregas, aberturas, cliques, descadastros e as vendas de quem clicou, por campanha e por fluxo de automação." />
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
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger size="sm" className="w-44" aria-label="Origem dos e-mails">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Campanhas e fluxos</SelectItem>
              <SelectItem value="campanhas">Só campanhas</SelectItem>
              <SelectItem value="automacoes">Só fluxos de automação</SelectItem>
            </SelectContent>
          </Select>
          <Select value={windowDays} onValueChange={setWindowDays}>
            <SelectTrigger size="sm" className="w-52" aria-label="Janela de atribuição das vendas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['1', '3', '7', '14', '30'].map((d) => (
                <SelectItem key={d} value={d}>
                  Vendas até {d} {d === '1' ? 'dia' : 'dias'} após o clique
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && <Body d={q.data} />}
      </div>
    </div>
  )
}

function Body({ d }: { d: Dash }) {
  const f = d.funnel
  const r = d.rates
  const pr = d.previous.rates
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
        <Stat label="Entregues" value={int.format(f.sent)} delta={<Delta now={f.sent} before={d.previous.funnel.sent} />} hint={`${pct(r.delivery)} dos envios · ${int.format(f.failed)} recusados`} />
        <Stat label="Taxa de abertura" value={pct(r.open)} delta={<Delta now={r.open} before={pr.open} asPoints />} hint={`${int.format(f.opened)} pessoas abriram (aproximado)`} />
        <Stat label="Taxa de cliques" value={pct(r.click)} delta={<Delta now={r.click} before={pr.click} asPoints />} hint={`${int.format(f.clicked)} pessoas · ${pct(r.clickToOpen)} de quem abriu`} />
        <Stat label="Vendas de quem clicou" value={brl.format(d.sales.revenue)} delta={<Delta now={d.sales.revenue} before={d.previous.sales.revenue} />} hint={`${int.format(d.sales.count)} venda(s) · ${d.sales.perSent === null ? '—' : brl.format(d.sales.perSent)} por e-mail entregue`} />
        <Stat label="Descadastros" value={int.format(f.unsubscribed)} delta={<Delta now={r.unsubscribe} before={pr.unsubscribe} asPoints lowerIsBetter />} hint={`${pct(r.unsubscribe)} dos entregues`} />
        <Stat label="Devolvidos (e-mail inexistente)" value={int.format(f.bounced)} delta={<Delta now={r.bounce} before={pr.bounce} asPoints lowerIsBetter />} hint={`${pct(r.bounce)} dos envios`} />
        <Stat label="Pedidos na loja" value={int.format(d.sales.store.count)} delta={null} hint={brl.format(d.sales.store.revenue)} />
        <Stat label="Vendas pelo atendimento" value={int.format(d.sales.service.count)} delta={null} hint={`${brl.format(d.sales.service.revenue)} (pré-vendas marcadas como venda)`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <FunnelCard f={f} />
        <BaseCard base={d.base} />
      </div>

      <DayChart data={d.days} />
      <Heatmap heat={d.heat} best={d.bestSlot} />

      <Section title="Campanhas" description={`Enviadas no período. Vendas: pedidos pagos e pré-vendas fechadas até ${d.windowDays} dia(s) após o clique, contadas para o último e-mail clicado.`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead className="hidden md:table-cell">Envio</TableHead>
              <Num>Entregues</Num>
              <Num>Abertura</Num>
              <Num>Cliques</Num>
              <Num className="hidden lg:table-cell">Descadastros</Num>
              <Num className="hidden md:table-cell">Vendas</Num>
              <Num>Valor</Num>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.campaigns.length === 0 && <Empty cols={8} />}
            {d.campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="max-w-72">
                  <Link to={`/email-marketing/${c.id}`} className="block truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {c.kind === 'MODELO' && <Badge variant="secondary">Fluxo</Badge>}
                    {c.subject}
                  </span>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{dateBR(c.firstSent)}</TableCell>
                <Num>{int.format(c.sent)}</Num>
                <Num>{pct(c.open)}</Num>
                <Num>{pct(c.click)}</Num>
                <Num className="hidden lg:table-cell">{int.format(c.unsubscribed)}</Num>
                <Num className="hidden md:table-cell">{int.format(c.count)}</Num>
                <Num>{brl.format(c.revenue)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Fluxos de automação" description="Leads que entraram, terminaram ou saíram porque compraram no período, e o resultado dos e-mails de cada fluxo.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fluxo</TableHead>
              <Num>Entraram</Num>
              <Num className="hidden md:table-cell">Terminaram</Num>
              <Num>Compraram</Num>
              <Num className="hidden md:table-cell">E-mails</Num>
              <Num>Abertura</Num>
              <Num>Cliques</Num>
              <Num>Valor</Num>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.automations.length === 0 && <Empty cols={8} />}
            {d.automations.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="max-w-64">
                  <Link to={`/automacoes/${a.id}`} className="block truncate font-medium hover:underline">
                    {a.name}
                  </Link>
                  {!a.active && <span className="text-xs text-muted-foreground">desligado</span>}
                </TableCell>
                <Num>{int.format(a.entered)}</Num>
                <Num className="hidden md:table-cell">{int.format(a.completed)}</Num>
                <Num>{int.format(a.purchased)}</Num>
                <Num className="hidden md:table-cell">{int.format(a.sent)}</Num>
                <Num>{pct(a.open)}</Num>
                <Num>{pct(a.click)}</Num>
                <Num>{brl.format(a.revenue)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Links mais clicados" description="O que mais chamou a atenção nos e-mails do período.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Link</TableHead>
              <TableHead className="hidden md:table-cell">Campanha</TableHead>
              <Num>Cliques</Num>
              <Num>Pessoas</Num>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.links.length === 0 && <Empty cols={4} />}
            {d.links.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-80 truncate text-sm" title={l.url}>
                  {shortUrl(l.url)}
                </TableCell>
                <TableCell className="hidden max-w-56 truncate text-sm text-muted-foreground md:table-cell">{l.campaign}</TableCell>
                <Num>{int.format(l.clicks)}</Num>
                <Num>{int.format(l.people)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <p className="text-xs text-muted-foreground">
        Como contamos: “entregues” são os e-mails aceitos pelo servidor de envio; devoluções que chegam depois, por e-mail, não entram. A abertura é aproximada, porque alguns programas (Apple Mail, antivírus) abrem as imagens sozinhos e outros as bloqueiam. Os cliques são exatos. As taxas são sobre os entregues.
      </p>
    </>
  )
}

/** Funil em barras: cada etapa em relação aos entregues. */
function FunnelCard({ f }: { f: Funnel }) {
  const steps: [string, number, string][] = [
    ['Entregues', f.sent, ''],
    ['Abriram', f.opened, 'aproximado'],
    ['Clicaram', f.clicked, ''],
    ['Descadastraram', f.unsubscribed, ''],
  ]
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Funil dos e-mails</CardTitle>
        <CardDescription>Pessoas em cada etapa, em relação aos e-mails entregues.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map(([label, n, note]) => {
          const share = f.sent ? n / f.sent : 0
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 text-muted-foreground">
                {label}
                {note && <span className="block text-xs">{note}</span>}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(n ? 1 : 0, Math.round(share * 100))}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right tabular-nums">
                <span className="font-medium">{int.format(n)}</span> <span className="text-xs text-muted-foreground">{f.sent ? pctFmt.format(share) : '—'}</span>
              </span>
            </div>
          )
        })}
        {f.failed > 0 && (
          <p className="text-xs text-muted-foreground">
            Além disso, {int.format(f.failed)} envio(s) recusado(s) pelo servidor, {int.format(f.bounced)} por e-mail inexistente (esses leads deixam de receber).
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BaseCard({ base }: { base: Dash['base'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saúde da base</CardTitle>
        <CardDescription>Leads com e-mail hoje (não depende do período).</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Mini label="Com e-mail" value={int.format(base.withEmail)} />
        <Mini label="Podem receber" value={int.format(base.contactable)} hint={base.withEmail ? `${pctFmt.format(base.contactable / base.withEmail)} da base` : undefined} />
        <Mini label="Sem consentimento" value={int.format(base.optOut)} hint="descadastrados ou nunca aceitaram" />
        <Mini label="E-mail inexistente" value={int.format(base.bounced)} />
      </CardContent>
    </Card>
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
function DayChart({ data }: { data: Dash['days'] }) {
  const config: ChartConfig = { sent: { label: 'Entregues', color: 'var(--chart-1)' } }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">E-mails entregues por dia</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tickFormatter={(v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} />
            <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={(v) => int.format(Number(v))} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => String(v).split('-').reverse().join('/')}
                  formatter={(v, _n, item) => {
                    const p = item.payload as Dash['days'][number]
                    return `${int.format(Number(v))} entregues · ${int.format(p.opened)} abriram · ${int.format(p.clicked)} clicaram`
                  }}
                />
              }
            />
            <Bar dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

/** Aberturas por dia da semana e hora: uma cor só, mais escuro = mais aberturas. */
function Heatmap({ heat, best }: { heat: number[][]; best: Dash['bestSlot'] }) {
  const max = Math.max(1, ...heat.flat())
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quando os e-mails são abertos</CardTitle>
        <CardDescription>
          Primeira abertura por dia da semana e hora (horário de Brasília). Mais escuro = mais aberturas.
          {best ? ` Melhor momento: ${best.weekday}, por volta das ${best.hour}h.` : ' Ainda sem volume para indicar o melhor horário.'}
        </CardDescription>
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
                    title={`${WEEK[w]} ${h}h: ${n} abertura(s)`}
                    aria-label={`${WEEK[w]} ${h}h: ${n} aberturas`}
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
      <TableCell colSpan={cols} className="py-6 text-center text-sm text-muted-foreground">
        Sem dados no período.
      </TableCell>
    </TableRow>
  )
}
