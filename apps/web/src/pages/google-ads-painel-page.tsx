import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Stat } from '@/components/atendimento/dashboard'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { brl, brlCompact, int, pctFmt, todaySP } from '@/lib/atendimento'

interface Ratios {
  cpc: number | null
  costPerLead: number | null
  costPerSale: number | null
  conversionRate: number | null
  roas: number | null
}
interface Row extends Ratios {
  cost: number
  clicks: number
  impressions: number
  googleConversions: number
  leads: number
  sales: number
  revenue: number
}
interface Panel {
  from: string
  to: string
  costSyncedAt: string | null
  hasCost: boolean
  hasKeywordCost: boolean
  totals: Row & { unidentifiedLeads: number }
  campaigns: (Row & { id: string | null; name: string })[]
  keywords: (Row & { keyword: string; matchTypes: string[]; campaigns: string[] })[]
  origins: { name: string; leads: number; sales: number; revenue: number; withCampaign: number; conversionRate: number | null }[]
  days: { day: string; cost: number; clicks: number; leads: number; sales: number }[]
}

const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todaySP().slice(0, 8)}01`, todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
] as const

const MATCH: Record<string, string> = { EXACT: 'exata', PHRASE: 'frase', BROAD: 'ampla' }
const money = (v: number | null) => (v === null ? '—' : brl.format(v))
const pct = (v: number | null) => (v === null ? '—' : pctFmt.format(v))
const roas = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`)
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function GoogleAdsPainelPage() {
  return (
    <RequirePermission module="relatorios">
      <Painel />
    </RequirePermission>
  )
}

function Painel() {
  const [preset, setPreset] = useState<string>('30')
  const [range, setRange] = useState<[string, string]>([todaySP(-29), todaySP()])
  const q = useQuery({
    queryKey: ['google-ads-painel', range],
    queryFn: () => api.get<Panel>(`/integracoes/google-ads/painel?de=${range[0]}&ate=${range[1]}`),
    placeholderData: keepPreviousData,
  })
  const d = q.data
  const t = d?.totals
  return (
    <div>
      <PageHeader title="Google Ads" description="Investimento das campanhas cruzado com os contatos e as vendas do Pré-Vendas." />
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
          {d && <span className="text-xs text-muted-foreground">{d.costSyncedAt ? `Investimento atualizado em ${formatDateTime(d.costSyncedAt)}` : 'Investimento ainda não recebido'}</span>}
        </div>

        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

        {d && t && (
          <>
            {!d.hasCost && (
              <p className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangleIcon className="size-4 text-amber-600" />
                <span>
                  Sem investimento neste período. Para trazer o valor investido, cole o script novo no Google Ads (em{' '}
                  <Link to="/configuracoes?aba=google-ads" className="font-medium underline underline-offset-4">
                    Configurações → Google Ads
                  </Link>
                  , “Nomes das campanhas”) e programe para rodar diariamente.
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Valor investido" value={brl.format(t.cost)} delta={null} hint={`${int.format(t.clicks)} cliques · CPC ${money(t.cpc)}`} />
              <Stat label="Leads (Pré-Vendas)" value={int.format(t.leads)} delta={null} hint={t.unidentifiedLeads ? `${int.format(t.unidentifiedLeads)} sem campanha identificada` : 'Atendimentos que vieram dos anúncios'} />
              <Stat label="Custo por lead" value={money(t.costPerLead)} delta={null} />
              <Stat label="Vendas" value={int.format(t.sales)} delta={null} hint={`Conversão: ${pct(t.conversionRate)}`} />
              <Stat label="Custo por venda" value={money(t.costPerSale)} delta={null} />
              <Stat label="Valor vendido" value={brl.format(t.revenue)} delta={null} />
              <Stat label="Retorno (ROAS)" value={roas(t.roas)} delta={null} hint="Valor vendido ÷ valor investido" />
              <Stat label="Conversões no Google" value={t.googleConversions.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} delta={null} hint="Contadas pelo Google Ads" />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <DayChart title="Investimento por dia" data={d.days} dataKey="cost" label="Investido" format={(v) => brlCompact.format(v)} tooltip={(v) => brl.format(v)} />
              <DayChart title="Leads por dia" data={d.days} dataKey="leads" label="Leads" format={(v) => int.format(v)} tooltip={(v) => int.format(v)} />
            </div>

            <Section title="Por campanha" description="Investimento do Google e resultado no CRM, pelo número da campanha.">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <Num>Investido</Num>
                    <Num className="hidden md:table-cell">Cliques</Num>
                    <Num className="hidden lg:table-cell">CPC</Num>
                    <Num>Leads</Num>
                    <Num>Custo/lead</Num>
                    <Num>Vendas</Num>
                    <Num className="hidden md:table-cell">Conversão</Num>
                    <Num>Custo/venda</Num>
                    <Num className="hidden lg:table-cell">Vendido</Num>
                    <Num className="hidden lg:table-cell">ROAS</Num>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.campaigns.length === 0 && <Empty cols={11} />}
                  {d.campaigns.map((c) => (
                    <TableRow key={c.id ?? '-'}>
                      <TableCell className="max-w-64">
                        <p className="truncate font-medium" title={c.name}>
                          {c.name}
                        </p>
                        {c.id && <p className="text-xs text-muted-foreground">nº {c.id}</p>}
                      </TableCell>
                      <Num>{brl.format(c.cost)}</Num>
                      <Num className="hidden md:table-cell">{int.format(c.clicks)}</Num>
                      <Num className="hidden lg:table-cell">{money(c.cpc)}</Num>
                      <Num>{int.format(c.leads)}</Num>
                      <Num>{money(c.costPerLead)}</Num>
                      <Num>{int.format(c.sales)}</Num>
                      <Num className="hidden md:table-cell">{pct(c.conversionRate)}</Num>
                      <Num>{money(c.costPerSale)}</Num>
                      <Num className="hidden lg:table-cell">{brl.format(c.revenue)}</Num>
                      <Num className="hidden lg:table-cell">{roas(c.roas)}</Num>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <Section
              title="Por palavra-chave"
              description={
                d.hasKeywordCost
                  ? 'Investimento por palavra-chave; os leads contam quando o link do anúncio traz a palavra (utm_term={keyword} no sufixo do URL).'
                  : 'Sem investimento por palavra-chave no período (campanhas de Performance Max não têm palavra-chave).'
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Palavra-chave</TableHead>
                    <Num>Investido</Num>
                    <Num className="hidden md:table-cell">Cliques</Num>
                    <Num className="hidden lg:table-cell">CPC</Num>
                    <Num>Leads</Num>
                    <Num>Custo/lead</Num>
                    <Num>Vendas</Num>
                    <Num>Custo/venda</Num>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.keywords.length === 0 && <Empty cols={8} />}
                  {d.keywords.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell className="max-w-64">
                        <p className="truncate font-medium">{k.keyword}</p>
                        <p className="truncate text-xs text-muted-foreground" title={k.campaigns.join(', ')}>
                          {[k.matchTypes.map((m) => MATCH[m] ?? m).join(', '), k.campaigns.join(', ')].filter(Boolean).join(' · ') || 'sem investimento registrado'}
                        </p>
                      </TableCell>
                      <Num>{brl.format(k.cost)}</Num>
                      <Num className="hidden md:table-cell">{int.format(k.clicks)}</Num>
                      <Num className="hidden lg:table-cell">{money(k.cpc)}</Num>
                      <Num>{int.format(k.leads)}</Num>
                      <Num>{money(k.costPerLead)}</Num>
                      <Num>{int.format(k.sales)}</Num>
                      <Num>{money(k.costPerSale)}</Num>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <Section title="Por origem do lead" description="Por onde os leads dos anúncios entraram (formulário, WhatsApp de cada LP...).">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origem</TableHead>
                    <Num>Leads</Num>
                    <Num className="hidden md:table-cell">Com campanha</Num>
                    <Num>Vendas</Num>
                    <Num>Conversão</Num>
                    <Num>Vendido</Num>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.origins.length === 0 && <Empty cols={6} />}
                  {d.origins.map((o) => (
                    <TableRow key={o.name}>
                      <TableCell className="font-medium">{o.name}</TableCell>
                      <Num>{int.format(o.leads)}</Num>
                      <Num className="hidden md:table-cell">
                        {o.withCampaign === o.leads ? (
                          int.format(o.withCampaign)
                        ) : (
                          <Badge variant="outline" className="font-normal tabular-nums" title="Os demais vieram pela origem, sem passar pelo site com o link do anúncio">
                            {int.format(o.withCampaign)} de {int.format(o.leads)}
                          </Badge>
                        )}
                      </Num>
                      <Num>{int.format(o.sales)}</Num>
                      <Num>{pct(o.conversionRate)}</Num>
                      <Num>{brl.format(o.revenue)}</Num>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </>
        )}
      </div>
    </div>
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
  return <TableCell className={`text-right whitespace-nowrap tabular-nums ${className ?? ''}`}>{children}</TableCell>
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

/** Uma série por gráfico (nunca dois eixos): investimento e leads ficam em gráficos separados. */
function DayChart({ title, data, dataKey, label, format, tooltip }: { title: string; data: Panel['days']; dataKey: 'cost' | 'leads'; label: string; format: (v: number) => string; tooltip: (v: number) => string }) {
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
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tickFormatter={dayLabel} />
            <YAxis tickLine={false} axisLine={false} width={dataKey === 'cost' ? 64 : 32} allowDecimals={dataKey === 'cost'} tickFormatter={(v) => format(Number(v))} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => String(v).split('-').reverse().join('/')} formatter={(v) => tooltip(Number(v))} />} />
            <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
