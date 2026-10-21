import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BestTimes, type OnlinePeaks, type TimeCell } from '@/components/marketing/horarios'
import { type Col, NA, optNum, SimpleTable, SyncLine, Thumb } from '@/components/marketing/tabela'
import { Kpi, MktFilters, PendingIntegration, TrendChart } from '@/components/marketing/ui'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDate, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money, num, pct, useMktFilters } from '@/lib/marketing'

// ---------- Tipos (espelham /api/marketing/instagram) ----------

type Pair = { now: number | null; before: number | null }
type KpiKey = 'reach' | 'views' | 'accountsEngaged' | 'interactions' | 'profileViews' | 'websiteClicks' | 'linkTaps' | 'follows' | 'unfollows'
interface IgPost {
  postId: string
  publishedAt: string
  format: string
  caption: string
  permalink: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
  videoViews: number | null
  engagement: number
  engagementRate: number | null
  extra: Record<string, number | string> | null
}
interface IgStory {
  postId: string
  thumb: string | null
  account: string | null
  publishedAt: string
  permalink: string | null
  reach: number | null
  views: number | null
  replies: number
  tapsForward: number
  tapsBack: number
  exits: number
}
interface IgView {
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number }
  connected: boolean
  selected: string
  accounts: { id: string; label: string; owner: 'empresa' | 'vendedor'; official: boolean }[]
  company: boolean
  sync: { lastOkAt?: string; lastError?: string | null } | null
  organic: {
    followers: number | null
    followersGrowth: number | null
    kpis: Record<KpiKey, Pair>
    engagementRate: Pair
    series: { day: string; label: string; reach: number | null; views: number | null; interactions: number | null; follows: number | null; profileViews: number | null; followers: number | null }[]
  }
  content: { posts: IgPost[]; byFormat: { format: string; posts: number; engagement: number; reach: number | null; avgEngagement: number; engagementRate: number | null }[]; postsPerWeek: number; reelsAvgWatchSec: number | null }
  stories: { count: number; perDay: number; avgReach: number | null; replies: number; exitRate: number | null; list: IgStory[] }
  times: { online: number[][] | null; peaks: OnlinePeaks | null; cells: TimeCell[]; best: TimeCell[]; recommendations: string[]; basedOnPosts: number }
  audience: { of: 'oficial' | 'perfil'; updatedAt: string | null; error: string | null; city: KV[]; age: KV[]; gender: KV[]; country: KV[] }
  paid: {
    totals: { spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpc: number | null; cpl: number | null; shareOfMeta: number | null }
    positions: { label: string; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpc: number | null; cpl: number | null }[]
    series: { day: string; label: string; spend: number; clicks: number; leads: number }[]
  } | null
  site: { visits: number; visitors: number; paidVisits: number; organicVisits: number; identified: number; series: { day: string; label: string; visits: number }[]; pages: { path: string; visits: number }[] } | null
  leads: { leads: number; paid: number; organic: number; qualified: number; sales: number; revenue: number; conversionRate: number | null; qualificationRate: number | null; forms: { form: string; leads: number }[] } | null
}
interface KV {
  key: string
  value: number
}

const dPct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10)
const txt = (v: number | null | undefined) => (v === null || v === undefined ? 'Não disponível' : num(v))
const GENDER: Record<string, string> = { m: 'Masculino', f: 'Feminino', u: 'Não informado' }
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  } catch {
    return null
  }
})()
const countryName = (code: string) => (/^[A-Z]{2}$/.test(code) ? (regionNames?.of(code) ?? code) : code)

export function InstagramPage() {
  return (
    <RequirePermission module="mi_social">
      <Instagram />
    </RequirePermission>
  )
}

function Instagram() {
  const f = useMktFilters()
  const [conta, setConta] = useState('todas')
  const q = useQuery({ queryKey: ['mkt-instagram', f.from, f.to, conta], queryFn: () => api.get<IgView>(`/marketing/instagram?de=${f.from}&ate=${f.to}&conta=${conta}`), placeholderData: keepPreviousData })
  const d = q.data
  return (
    <div>
      <PageHeader title="Instagram" description="Perfil oficial e dos vendedores: crescimento, alcance, conteúdo, stories, público, melhores horários, tráfego pago e do site, leads de formulário e concorrentes." />
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <MktFilters show="period" />
          </div>
          {d && d.accounts.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Perfil</Label>
              <Select value={d.selected} onValueChange={setConta}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Visão geral (todos os perfis conectados)</SelectItem>
                  {d.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                      {a.owner === 'vendedor' ? ' · vendedor' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            <SyncLine sync={d.sync} label="Instagram" />
            {!d.connected && (
              <PendingIntegration
                title="Instagram (Graph API)"
                what={['Seguidores, alcance, visualizações, contas com interação e toques nos links', 'Publicações, reels e stories com alcance, salvamentos e respostas', 'Público por cidade, idade e gênero e as horas em que ele está online', 'Perfis dos vendedores e comparação com concorrentes']}
                steps={<p>Usa o token da Meta (com instagram_basic e instagram_manage_insights). Informe a conta oficial do Instagram em Configurações › Marketing Inteligente.</p>}
              />
            )}
            <Tabs defaultValue="visao">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="visao">Visão geral</TabsTrigger>
                <TabsTrigger value="conteudo">Conteúdo</TabsTrigger>
                <TabsTrigger value="stories">Stories</TabsTrigger>
                <TabsTrigger value="horarios">Melhores horários</TabsTrigger>
                <TabsTrigger value="publico">Público</TabsTrigger>
                <TabsTrigger value="trafego">Tráfego e leads</TabsTrigger>
                <TabsTrigger value="perfis">Perfis</TabsTrigger>
                <TabsTrigger value="concorrentes">Concorrentes</TabsTrigger>
              </TabsList>
              <TabsContent value="visao" className="space-y-4">
                <Overview d={d} />
              </TabsContent>
              <TabsContent value="conteudo" className="space-y-4">
                <Content d={d} />
              </TabsContent>
              <TabsContent value="stories" className="space-y-4">
                <Stories d={d} />
              </TabsContent>
              <TabsContent value="horarios" className="space-y-4">
                <BestTimes title="Melhores horários para postar" cells={d.times.cells} best={d.times.best} online={d.times.online} peaks={d.times.peaks} recommendations={d.times.recommendations} basedOnPosts={d.times.basedOnPosts} />
                {!d.times.online && <p className="text-xs text-muted-foreground">O Instagram não informou as horas em que os seguidores ficam online para esta conta (a Meta só entrega para contas com 100 seguidores ou mais). A sugestão usa o desempenho das publicações.</p>}
              </TabsContent>
              <TabsContent value="publico" className="space-y-4">
                <Audience d={d} />
              </TabsContent>
              <TabsContent value="trafego" className="space-y-4">
                <Traffic d={d} />
              </TabsContent>
              <TabsContent value="perfis" className="space-y-4">
                <Profiles />
              </TabsContent>
              <TabsContent value="concorrentes" className="space-y-4">
                <Competitors />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Visão geral ----------

function Overview({ d }: { d: IgView }) {
  const k = d.organic.kpis
  const card = (label: string, p: Pair, hint?: string) => <Kpi label={label} value={txt(p.now)} delta={dPct(p.now, p.before)} before={p.before !== null ? num(p.before) : undefined} hint={hint} />
  const all = d.selected === 'todas' && d.accounts.length > 1
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Seguidores" value={txt(d.organic.followers)} hint={d.organic.followersGrowth !== null ? `${d.organic.followersGrowth >= 0 ? '+' : ''}${num(d.organic.followersGrowth)} no período` : undefined} />
        {card('Alcance', k.reach, all ? 'soma dos perfis (a mesma pessoa pode contar em mais de um)' : 'contas alcançadas, somadas dia a dia')}
        {card('Visualizações', k.views)}
        {card('Contas com interação', k.accountsEngaged)}
        {card('Interações', k.interactions, 'curtidas, comentários, compartilhamentos, salvamentos e respostas')}
        <Kpi label="Taxa de engajamento" value={pct(d.organic.engagementRate.now)} delta={dPct(d.organic.engagementRate.now, d.organic.engagementRate.before)} hint="interações ÷ alcance" />
        {card('Visitas ao perfil', k.profileViews)}
        {card('Toques nos links', k.linkTaps.now !== null ? k.linkTaps : k.websiteClicks, 'link da bio, site, WhatsApp e outros botões do perfil')}
        {card('Novos seguidores', k.follows)}
        {card('Deixaram de seguir', k.unfollows)}
      </div>
      <p className="text-xs text-muted-foreground">Seguidores e interações são só números somados das redes: não entram na base de leads e não contam como possível venda. Lead é só quem preencheu um formulário (aba Tráfego e leads).</p>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Alcance e interações por dia" data={d.organic.series} series={[{ key: 'reach', label: 'Alcance', color: 'var(--chart-1)' }, { key: 'interactions', label: 'Interações', color: 'var(--chart-2)' }]} />
        <TrendChart title="Novos seguidores e visitas ao perfil" kind="bar" data={d.organic.series} series={[{ key: 'follows', label: 'Novos seguidores', color: 'var(--chart-3)' }, { key: 'profileViews', label: 'Visitas ao perfil', color: 'var(--chart-4)' }]} />
      </div>
    </>
  )
}

// ---------- Conteúdo ----------

const POST_COLS: Col<IgPost>[] = [
  {
    label: 'Publicação',
    value: (p) => (
      <div className="flex min-w-0 items-center gap-3">
        <Thumb src={p.extra?.thumb} alt={p.caption.slice(0, 80) || p.format} />
        <div className="min-w-0">
        <p className="line-clamp-2 text-sm">{p.caption || '(sem texto)'}</p>
        <p className="text-xs text-muted-foreground">
          {p.format} · {formatDate(p.publishedAt)}
          {p.permalink && (
            <a href={p.permalink} target="_blank" rel="noreferrer noopener" className="ml-1 inline-flex items-center hover:underline">
              abrir <ExternalLinkIcon className="ml-0.5 size-3" />
            </a>
          )}
        </p>
        </div>
      </div>
    ),
    csv: (p) => p.caption,
  },
  { label: 'Alcance', value: (p) => optNum(p.reach), right: true, csv: (p) => p.reach },
  { label: 'Visualizações', value: (p) => optNum(p.videoViews), right: true, csv: (p) => p.videoViews },
  { label: 'Curtidas', value: (p) => optNum(p.likes), right: true, csv: (p) => p.likes },
  { label: 'Comentários', value: (p) => optNum(p.comments), right: true, csv: (p) => p.comments },
  { label: 'Compart.', value: (p) => optNum(p.shares), right: true, csv: (p) => p.shares },
  { label: 'Salvos', value: (p) => optNum(p.saves), right: true, csv: (p) => p.saves },
  { label: 'Engajamento', value: (p) => `${num(p.engagement)}${p.engagementRate !== null ? ` · ${pct(p.engagementRate)}` : ''}`, right: true, csv: (p) => p.engagement },
]

function Content({ d }: { d: IgView }) {
  const c = d.content
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Publicações no período" value={num(c.posts.length)} hint="feed, carrossel e reels" />
        <Kpi label="Publicações por semana" value={c.postsPerWeek.toLocaleString('pt-BR')} />
        <Kpi label="Reels: tempo médio assistido" value={c.reelsAvgWatchSec === null ? 'Não disponível' : `${c.reelsAvgWatchSec.toLocaleString('pt-BR')} s`} />
        <Kpi label="Stories no período" value={num(d.stories.count)} />
      </div>
      <SimpleTable title="Por formato" rows={c.byFormat} rowKey={(r) => r.format} cols={[{ label: 'Formato', value: (r) => r.format }, { label: 'Publicações', value: (r) => num(r.posts), right: true }, { label: 'Alcance', value: (r) => optNum(r.reach), right: true }, { label: 'Engajamento médio', value: (r) => num(r.avgEngagement), right: true }, { label: 'Taxa', value: (r) => pct(r.engagementRate), right: true }]} />
      <SimpleTable title="Publicações (melhores primeiro, pela taxa de engajamento)" rows={c.posts} rowKey={(p) => p.postId} cols={POST_COLS} exportName="instagram-publicacoes" limit={20} empty="Nenhuma publicação sincronizada no período." />
    </>
  )
}

// ---------- Stories ----------

function Stories({ d }: { d: IgView }) {
  const s = d.stories
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Stories" value={num(s.count)} />
        <Kpi label="Por dia" value={s.perDay.toLocaleString('pt-BR')} />
        <Kpi label="Alcance médio" value={txt(s.avgReach)} />
        <Kpi label="Respostas" value={num(s.replies)} hint="mensagens enviadas pelo story (não viram lead)" />
        <Kpi label="Taxa de saída" value={pct(s.exitRate)} hint="saídas ÷ alcance: quanto menor, melhor" />
      </div>
      <p className="text-xs text-muted-foreground">O Instagram só mostra cada story por 24 horas: o CRM guarda os números a cada sincronização (a cada 6 horas). Stories publicados antes da ligação da integração não aparecem.</p>
      <SimpleTable
        title="Stories do período"
        rows={s.list}
        rowKey={(r) => r.postId}
        limit={30}
        empty="Nenhum story guardado no período."
        cols={[
          {
            label: 'Publicado',
            value: (r) => (
              <div className="flex items-center gap-3">
                <Thumb src={r.thumb} alt="Story" />
                <div>
                {r.permalink ? (
                  <a href={r.permalink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center hover:underline">
                    {formatDateTime(r.publishedAt)} <ExternalLinkIcon className="ml-1 size-3" />
                  </a>
                ) : (
                  formatDateTime(r.publishedAt)
                )}
                {r.account && <p className="text-xs text-muted-foreground">{r.account}</p>}
                </div>
              </div>
            ),
          },
          { label: 'Alcance', value: (r) => optNum(r.reach), right: true },
          { label: 'Visualizações', value: (r) => optNum(r.views), right: true },
          { label: 'Respostas', value: (r) => num(r.replies), right: true },
          { label: 'Avançou', value: (r) => num(r.tapsForward), right: true },
          { label: 'Voltou', value: (r) => num(r.tapsBack), right: true },
          { label: 'Saiu', value: (r) => num(r.exits), right: true },
        ]}
      />
    </>
  )
}

// ---------- Público ----------

function Audience({ d }: { d: IgView }) {
  const a = d.audience
  const total = (l: KV[]) => l.reduce((s, x) => s + x.value, 0)
  const cols = (label: string, l: KV[], fmt: (k: string) => string = (k) => k): Col<KV>[] => [
    { label, value: (r) => fmt(r.key) },
    { label: 'Seguidores', value: (r) => num(r.value), right: true },
    { label: '%', value: (r) => pct(total(l) ? Math.round((r.value / total(l)) * 1000) / 10 : null), right: true },
  ]
  const empty = a.error ? 'A Meta não entregou estes dados (veja o motivo acima).' : 'A Meta não informou (só entrega para contas com 100 seguidores ou mais).'
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {a.of === 'oficial' && d.accounts.length > 1 ? 'Público do perfil oficial. Escolha um perfil no topo para ver o público dele. ' : ''}
        Só totais por cidade, idade e gênero: nenhum seguidor é identificado. {a.updatedAt ? `Atualizado em ${formatDateTime(a.updatedAt)}.` : ''}
      </p>
      {a.error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          A Meta recusou parte destes dados. Resposta dela: {a.error}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <SimpleTable title="Cidades" rows={a.city} rowKey={(r) => r.key} cols={cols('Cidade', a.city)} empty={empty} limit={15} />
        <SimpleTable title="Idade" rows={a.age} rowKey={(r) => r.key} cols={cols('Faixa', a.age)} empty={empty} />
        <SimpleTable title="Gênero" rows={a.gender} rowKey={(r) => r.key} cols={cols('Gênero', a.gender, (k) => GENDER[k.toLowerCase()] ?? k)} empty={empty} />
        <SimpleTable title="Países" rows={a.country} rowKey={(r) => r.key} cols={cols('País', a.country, countryName)} empty={empty} />
      </div>
    </>
  )
}

// ---------- Tráfego e leads ----------

function Traffic({ d }: { d: IgView }) {
  if (!d.company)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">Anúncios, visitas ao site e leads de formulário são da empresa: aparecem na visão geral e no perfil oficial. Escolha um deles no topo da tela.</CardContent>
      </Card>
    )
  return (
    <>
      {d.paid && (
        <>
          <h3 className="text-sm font-semibold">Tráfego pago (anúncios da Meta entregues no Instagram)</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Investido no Instagram" value={money(d.paid.totals.spend)} hint={d.paid.totals.shareOfMeta !== null ? `${pct(d.paid.totals.shareOfMeta)} do investido na Meta` : undefined} />
            <Kpi label="Impressões" value={num(d.paid.totals.impressions)} />
            <Kpi label="Cliques no link" value={num(d.paid.totals.clicks)} />
            <Kpi label="CTR" value={pct(d.paid.totals.ctr)} />
            <Kpi label="Custo por clique" value={money(d.paid.totals.cpc)} />
            <Kpi label="Leads de formulário (Meta)" value={num(d.paid.totals.leads)} hint={d.paid.totals.cpl !== null ? `${money(d.paid.totals.cpl)} por lead` : undefined} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <SimpleTable
              title="Por posicionamento"
              rows={d.paid.positions}
              rowKey={(r) => r.label}
              empty="Sem anúncios entregues no Instagram no período (ou a Meta Ads ainda não foi sincronizada)."
              cols={[
                { label: 'Onde', value: (r) => r.label },
                { label: 'Investido', value: (r) => money(r.spend), right: true },
                { label: 'Impressões', value: (r) => num(r.impressions), right: true },
                { label: 'CTR', value: (r) => pct(r.ctr), right: true },
                { label: 'CPC', value: (r) => money(r.cpc), right: true },
                { label: 'Leads', value: (r) => num(r.leads), right: true },
                { label: 'CPL', value: (r) => money(r.cpl), right: true },
              ]}
            />
            {d.paid.series.length > 0 && <TrendChart title="Investimento no Instagram por dia" kind="bar" data={d.paid.series} format={(v) => money(v)} series={[{ key: 'spend', label: 'Investido', color: 'var(--chart-1)' }]} />}
          </div>
        </>
      )}
      {d.site && (
        <>
          <h3 className="text-sm font-semibold">Visitas ao site vindas do Instagram</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Visitas" value={num(d.site.visits)} />
            <Kpi label="Visitantes" value={num(d.site.visitors)} />
            <Kpi label="De anúncio" value={num(d.site.paidVisits)} />
            <Kpi label="Orgânicas (bio, stories, posts)" value={num(d.site.organicVisits)} />
            <Kpi label="Visitantes que se identificaram" value={num(d.site.identified)} hint="preencheram um formulário do site" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {d.site.series.length > 0 && <TrendChart title="Visitas por dia" kind="bar" data={d.site.series} series={[{ key: 'visits', label: 'Visitas', color: 'var(--chart-2)' }]} />}
            <SimpleTable title="Páginas de entrada" rows={d.site.pages} rowKey={(r) => r.path} cols={[{ label: 'Página', value: (r) => <span className="break-all">{r.path}</span> }, { label: 'Visitas', value: (r) => num(r.visits), right: true }]} empty="Nenhuma visita do Instagram registrada pelo rastreamento do site." />
          </div>
          <p className="text-xs text-muted-foreground">Vem do rastreamento do site do CRM. Para separar bem orgânico de pago, use links com utm_source=instagram (e utm_medium=social na bio e nos stories).</p>
        </>
      )}
      {d.leads && (
        <>
          <h3 className="text-sm font-semibold">Leads de formulário vindos do Instagram</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Leads (formulário)" value={num(d.leads.leads)} hint={`${num(d.leads.paid)} de anúncio · ${num(d.leads.organic)} orgânicos`} />
            <Kpi label="Qualificados" value={num(d.leads.qualified)} hint={pct(d.leads.qualificationRate)} />
            <Kpi label="Vendas" value={num(d.leads.sales)} />
            <Kpi label="Conversão em venda" value={pct(d.leads.conversionRate)} />
            <Kpi label="Faturamento" value={money(d.leads.revenue)} hint="Pré-Vendas" />
          </div>
          <SimpleTable title="Por formulário" rows={d.leads.forms} rowKey={(r) => r.form} cols={[{ label: 'Formulário', value: (r) => r.form }, { label: 'Leads', value: (r) => num(r.leads), right: true }]} empty="Nenhum formulário preenchido com origem no Instagram no período." />
          <p className="text-xs text-muted-foreground">Lead é só quem preencheu um formulário: Lead Ads da Meta, formulário, pop-up ou landing page do site com origem no Instagram. Seguidores, curtidas, comentários e mensagens não contam. Venda é o atendimento do Pré-Vendas desse lead, aberto depois do formulário, marcado como vendido.</p>
        </>
      )}
    </>
  )
}

/** Seguidores e, embaixo, o ganho (ou perda) no período. */
function Followers({ v, g }: { v: number | null; g: number | null }) {
  return (
    <div>
      <p>{optNum(v)}</p>
      {g !== null && <p className={g >= 0 ? 'text-xs text-emerald-600' : 'text-xs text-red-600'}>{`${g >= 0 ? '+' : ''}${num(g)} no período`}</p>}
    </div>
  )
}

// ---------- Perfis (oficial e vendedores) ----------

interface ProfileRow {
  key: string
  label: string
  owner: 'empresa' | 'vendedor'
  official: boolean
  seller: string | null
  access: 'completo' | 'publico'
  followers: number | null
  followersGrowth: number | null
  feedPosts: number
  reels: number
  postsPerWeek: number
  avgLikes: number | null
  avgComments: number | null
  engagementRate: number | null
  hiddenLikes: number
  lastPostAt: string | null
  reach: number | null
  interactions: number | null
  stories: number | null
  status: { at: string; error: string | null } | null
}
interface IgAccountInput {
  id: string
  username: string
  label: string
  owner: 'empresa' | 'vendedor'
  sellerId: string | null
}
interface ProfilesData {
  connected: boolean
  officialId: string | null
  list: IgAccountInput[]
  max: number
  sellers: { id: string; name: string }[]
  totals: { profiles: number; followers: number; feedPosts: number; reels: number }
  profiles: ProfileRow[]
}

function Profiles() {
  const f = useMktFilters()
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ['mkt-ig-perfis', f.from, f.to], queryFn: () => api.get<ProfilesData>(`/marketing/instagram/perfis?de=${f.from}&ate=${f.to}`), placeholderData: keepPreviousData })
  const d = q.data
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!d) return <TableSkeleton rows={4} />
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Perfil oficial da Usaparts e os perfis dos vendedores, com o mesmo cálculo para todos. Engajamento por publicação = (curtidas + comentários) ÷ seguidores.</p>
        {can('mi_social', 'edit') && (
          <Button size="sm" onClick={() => setEditing(true)}>
            <PencilIcon /> Perfis da empresa
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Perfis" value={num(d.totals.profiles)} />
        <Kpi label="Seguidores somados" value={num(d.totals.followers)} hint="a mesma pessoa pode seguir mais de um perfil" />
        <Kpi label="Publicações no feed" value={num(d.totals.feedPosts)} />
        <Kpi label="Reels" value={num(d.totals.reels)} />
      </div>
      <SimpleTable
        title="Comparação dos perfis"
        rows={d.profiles}
        rowKey={(r) => r.key}
        exportName="instagram-perfis"
        empty="Nenhum perfil. Ligue a conta oficial em Configurações › Marketing Inteligente e cadastre os perfis dos vendedores aqui."
        cols={[
          {
            label: 'Perfil',
            value: (r) => (
              <div>
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {r.official ? 'Oficial' : r.owner === 'vendedor' ? `Vendedor${r.seller ? `: ${r.seller}` : ''}` : 'Empresa'} · {r.access === 'completo' ? 'dados completos' : 'só dados públicos'}
                </p>
                {r.status?.error && <p className="max-w-72 whitespace-normal text-xs text-red-600">{r.status.error}</p>}
              </div>
            ),
            csv: (r) => r.label,
          },
          { label: 'Seguidores', value: (r) => <Followers v={r.followers} g={r.followersGrowth} />, right: true, csv: (r) => r.followers },
          { label: 'Feed', value: (r) => num(r.feedPosts), right: true, csv: (r) => r.feedPosts },
          { label: 'Reels', value: (r) => num(r.reels), right: true, csv: (r) => r.reels },
          { label: 'Stories', value: (r) => (r.stories === null ? NA : num(r.stories)), right: true, csv: (r) => r.stories },
          { label: 'Por semana', value: (r) => r.postsPerWeek.toLocaleString('pt-BR'), right: true, csv: (r) => r.postsPerWeek },
          { label: 'Curtidas (média)', value: (r) => optNum(r.avgLikes), right: true, csv: (r) => r.avgLikes },
          { label: 'Engajamento', value: (r) => pct(r.engagementRate), right: true, csv: (r) => r.engagementRate },
          { label: 'Alcance', value: (r) => (r.access === 'publico' ? NA : optNum(r.reach)), right: true, csv: (r) => r.reach },
          { label: 'Última publicação', value: (r) => (r.lastPostAt ? formatDate(r.lastPostAt) : '—'), csv: (r) => r.lastPostAt },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        Dados completos: conta no Gerenciador de Negócios da empresa (alcance, stories, público, horários). Só públicos: conta comercial ou de criador fora do Gerenciador; a Meta mostra seguidores, publicações, curtidas e comentários. Os números dos perfis não entram na base de leads.
      </p>
      {editing && <ProfilesDialog d={d} onClose={() => setEditing(false)} />}
    </>
  )
}

function ProfilesDialog({ d, onClose }: { d: ProfilesData; onClose: () => void }) {
  const qc = useQueryClient()
  const [list, setList] = useState<IgAccountInput[]>(d.list.length ? d.list : [])
  const [found, setFound] = useState<{ id: string; username: string; name: string }[] | null>(null)
  const set = (i: number, patch: Partial<IgAccountInput>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const save = useMutation({
    mutationFn: () => api.put('/marketing/instagram/perfis', { list: list.map((x) => ({ ...x, username: x.username.trim() })) }),
    onSuccess: () => {
      toast.success('Perfis salvos. Os números aparecem depois da próxima sincronização (Configurações › Marketing Inteligente › Sincronizar agora).')
      void qc.invalidateQueries({ queryKey: ['mkt-ig-perfis'] })
      void qc.invalidateQueries({ queryKey: ['mkt-instagram'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const guard = useCloseGuard(isDirty(d.list, list), onClose, 'os perfis')
  const discover = useMutation({
    mutationFn: () => api.post<{ accounts: { id: string; username: string; name: string }[] }>('/marketing/instagram/perfis/buscar'),
    onSuccess: (r) => setFound(r.accounts.filter((a) => a.id !== d.officialId)),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Perfis do Instagram da empresa</DialogTitle>
          <DialogDescription>O perfil oficial vem de Configurações › Marketing Inteligente. Aqui entram os outros perfis da empresa e os dos vendedores (até {d.max}).</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => discover.mutate()} disabled={discover.isPending}>
              {discover.isPending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />} Buscar contas do Gerenciador
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setList((l) => [...l, { id: '', username: '', label: '', owner: 'vendedor', sellerId: null }])} disabled={list.length >= d.max}>
              <PlusIcon /> Adicionar pelo @
            </Button>
          </div>
          {found && (
            <Card>
              <CardContent className="space-y-1 py-3 text-sm">
                {found.length === 0 ? (
                  <p className="text-muted-foreground">O token da empresa não alcança outras contas do Instagram. Peça ao dono do perfil para adicioná-lo ao Gerenciador de Negócios da empresa, ou adicione pelo @ (só dados públicos).</p>
                ) : (
                  found.map((a) => {
                    const added = list.some((x) => x.id === a.id)
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2">
                        <span>
                          @{a.username || a.id} {a.name && <span className="text-muted-foreground">· {a.name}</span>}
                        </span>
                        <Button type="button" size="sm" variant="ghost" disabled={added} onClick={() => setList((l) => [...l, { id: a.id, username: a.username, label: a.name || `@${a.username}`, owner: 'vendedor', sellerId: null }])}>
                          {added ? 'Adicionado' : 'Adicionar (dados completos)'}
                        </Button>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          )}
          {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum perfil além do oficial.</p>}
          {list.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_8rem_12rem_auto] sm:items-end">
              <div className="space-y-1">
                <Label className="text-xs">@ do Instagram</Label>
                <Input value={x.username} onChange={(e) => set(i, { username: e.target.value })} placeholder="@vendedor.usaparts" disabled={!!x.id} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome na tela</Label>
                <Input value={x.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Ex.: João · Cascavel" maxLength={80} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">De quem</Label>
                <Select value={x.owner} onValueChange={(v) => set(i, { owner: v as IgAccountInput['owner'], ...(v === 'empresa' ? { sellerId: null } : {}) })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                    <SelectItem value="empresa">Empresa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vendedor</Label>
                <Select value={x.sellerId ?? '__nenhum'} onValueChange={(v) => set(i, { sellerId: v === '__nenhum' ? null : v })} disabled={x.owner !== 'vendedor'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nenhum">—</SelectItem>
                    {d.sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={x.id ? 'default' : 'secondary'}>{x.id ? 'Completo' : 'Público'}</Badge>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remover perfil ${x.username || x.label}`.trim()} onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Pelo @ só funciona com conta comercial ou de criador (a Meta não mostra dados de conta pessoal). Para ver alcance, stories e público do perfil de um vendedor, ele precisa estar no Gerenciador de Negócios da empresa: aí use “Buscar contas do Gerenciador”.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Concorrentes ----------

interface CompetitorRow {
  username: string
  name: string | null
  own: boolean
  followers: number | null
  followersGrowth: number | null
  totalPosts: number | null
  feedPosts: number
  reels: number
  postsPerWeek: number
  avgLikes: number | null
  avgComments: number | null
  engagementRate: number | null
  hiddenLikes: number
  lastPostAt: string | null
  topPost: { permalink: string | null; caption: string; format: string; interactions: number } | null
  storiesDaysSeen: number
  storiesAvg: number | null
  storyChecks: number
  storiesCount: number | null
  adsActive: boolean | null
  adsCheckedAt: string | null
  adLibrary: string | null
  status: { at: string; error: string | null } | null
}
type QC = ReturnType<typeof useQueryClient>
/** A busca dos concorrentes roda no servidor por alguns segundos: atualiza a tabela logo depois. */
const refreshCompetitorsSoon = (qc: QC) => [5_000, 15_000].forEach((ms) => setTimeout(() => void qc.invalidateQueries({ queryKey: ['mkt-ig-concorrentes'] }), ms))

interface CompetitorsData {
  connected: boolean
  list: { username: string; label: string }[]
  max: number
  profiles: CompetitorRow[]
  notes: { id: string; username: string; date: string; storiesSeen: number | null; adsActive: boolean | null; note: string | null }[]
}

function Competitors() {
  const f = useMktFilters()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [noting, setNoting] = useState<string | null>(null)
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['mkt-ig-concorrentes', f.from, f.to], queryFn: () => api.get<CompetitorsData>(`/marketing/instagram/concorrentes?de=${f.from}&ate=${f.to}`), placeholderData: keepPreviousData })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/instagram/concorrentes/registros/${id}`),
    onSuccess: () => (toast.success('Registro excluído.'), void qc.invalidateQueries({ queryKey: ['mkt-ig-concorrentes'] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const fetchNow = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>('/marketing/instagram/concorrentes/buscar'),
    onSuccess: (r) => {
      if (!r.ok) return void toast.error(r.message)
      toast.success(r.message)
      refreshCompetitorsSoon(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = q.data
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!d) return <TableSkeleton rows={4} />
  const label = (r: CompetitorRow) => (r.own ? 'Usaparts (oficial)' : r.name || `@${r.username}`)
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Mesmo cálculo para todos, só com o que é público: seguidores, publicações no feed e reels, curtidas e comentários.</p>
        {can('mi_social', 'edit') && (
          <div className="flex gap-2">
            {d.list.length > 0 && (
              <Button size="sm" variant="outline" disabled={fetchNow.isPending} onClick={() => fetchNow.mutate()} title="Busca agora seguidores e publicações públicas dos concorrentes (também é feito sozinho a cada sincronização do Instagram)">
                {fetchNow.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Buscar dados agora
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(true)}>
              <PencilIcon /> Concorrentes ({d.list.length}/{d.max})
            </Button>
          </div>
        )}
      </div>
      {d.list.length === 0 ? (
        <EmptyState
          title="Nenhum concorrente cadastrado"
          description="Informe o @ de cada concorrente (só contas comerciais ou de criador)."
          action={
            can('mi_social', 'edit') ? (
              <Button size="sm" onClick={() => setEditing(true)}>
                <PlusIcon /> Cadastrar concorrentes
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SimpleTable
          title="Comparação com concorrentes"
          rows={d.profiles}
          rowKey={(r) => r.username}
          exportName="instagram-concorrentes"
          cols={[
            {
              label: 'Perfil',
              value: (r) => (
                <div>
                  <p className="font-medium">
                    {label(r)}
                    {!r.own && (
                      <a href={`https://www.instagram.com/${r.username}/`} target="_blank" rel="noreferrer noopener" className="ml-1 inline-flex items-center text-xs font-normal text-muted-foreground hover:underline">
                        @{r.username} <ExternalLinkIcon className="ml-0.5 size-3" />
                      </a>
                    )}
                  </p>
                  {r.status?.error ? (
                    <p className="max-w-72 whitespace-normal text-xs text-red-600">{r.status.error}</p>
                  ) : !r.own && (
                    <p className="text-xs text-muted-foreground">{r.status ? `Dados de ${formatDateTime(r.status.at)}` : 'Ainda não buscado: clique em "Buscar dados agora"'}</p>
                  )}
                </div>
              ),
              csv: (r) => label(r),
            },
            { label: 'Seguidores', value: (r) => <Followers v={r.followers} g={r.followersGrowth} />, right: true, csv: (r) => r.followers },
            { label: 'Feed', value: (r) => num(r.feedPosts), right: true, csv: (r) => r.feedPosts },
            { label: 'Reels', value: (r) => num(r.reels), right: true, csv: (r) => r.reels },
            { label: 'Por semana', value: (r) => r.postsPerWeek.toLocaleString('pt-BR'), right: true, csv: (r) => r.postsPerWeek },
            {
              label: 'Média por publicação',
              value: (r) => (r.avgLikes === null ? NA : <span className="whitespace-nowrap">{num(r.avgLikes)} curtidas · {(r.avgComments ?? 0).toLocaleString('pt-BR')} coment.</span>),
              right: true,
              csv: (r) => r.avgLikes,
            },
            { label: 'Engajamento', value: (r) => pct(r.engagementRate), right: true, csv: (r) => r.engagementRate },
            {
              label: 'Stories',
              value: (r) => <span className="block min-w-28 whitespace-normal text-sm">{r.own ? (r.storiesCount === null ? NA : `${num(r.storiesCount)} no período`) : r.storyChecks ? `visto em ${r.storiesDaysSeen} de ${r.storyChecks} dias${r.storiesAvg !== null ? ` · média ${r.storiesAvg.toLocaleString('pt-BR')}` : ''}` : <span className="text-muted-foreground">sem registro</span>}</span>,
              csv: (r) => (r.own ? r.storiesCount : r.storiesAvg),
            },
            {
              label: 'Anúncio ativo',
              value: (r) =>
                r.own ? (
                  <span className="text-muted-foreground">ver Tráfego e leads</span>
                ) : (
                  <div className="space-y-0.5">
                    {r.adsActive === null ? <span className="text-muted-foreground">não conferido</span> : <Badge variant={r.adsActive ? 'default' : 'secondary'}>{r.adsActive ? 'Sim' : 'Não'}</Badge>}
                    {r.adsCheckedAt && <p className="text-xs text-muted-foreground">em {formatDate(`${r.adsCheckedAt}T12:00:00`)}</p>}
                    {r.adLibrary && (
                      <a href={r.adLibrary} target="_blank" rel="noreferrer noopener" className="inline-flex items-center text-xs hover:underline">
                        Biblioteca de Anúncios <ExternalLinkIcon className="ml-0.5 size-3" />
                      </a>
                    )}
                  </div>
                ),
              csv: (r) => (r.adsActive === null ? '' : r.adsActive ? 'Sim' : 'Não'),
            },
            { label: '', value: (r) => (!r.own && can('mi_social', 'create') ? <Button size="sm" variant="outline" aria-label={`Registrar o que viu de @${r.username}`} onClick={() => setNoting(r.username)}>Registrar</Button> : null) },
          ]}
        />
      )}
      <p className="text-xs text-muted-foreground">
        A Meta não entrega stories de outras contas nem diz se elas têm anúncio: abra o perfil ou a Biblioteca de Anúncios, veja e clique em Registrar. Curtidas ocultas pelo dono ficam fora da média. Engajamento por publicação = (curtidas + comentários) ÷ seguidores.
      </p>
      {d.notes.length > 0 && (
        <SimpleTable
          title="Registros da equipe"
          rows={d.notes}
          rowKey={(r) => r.id}
          limit={20}
          cols={[
            { label: 'Dia', value: (r) => formatDate(`${r.date}T12:00:00`) },
            { label: 'Concorrente', value: (r) => `@${r.username}` },
            { label: 'Stories vistos', value: (r) => (r.storiesSeen === null ? '—' : num(r.storiesSeen)), right: true },
            { label: 'Anúncio ativo', value: (r) => (r.adsActive === null ? '—' : r.adsActive ? 'Sim' : 'Não') },
            { label: 'Observação', value: (r) => <span className="line-clamp-2 text-sm">{r.note ?? ''}</span> },
            {
              label: '',
              value: (r) =>
                can('mi_social', 'delete') ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir registro de @${r.username}`}
                    onClick={async () => {
                      if (await confirm({ title: `Excluir o registro de @${r.username}?`, description: `O registro de ${formatDate(`${r.date}T12:00:00`)} sai do histórico da equipe. Não dá para desfazer.`, confirmLabel: 'Excluir registro' })) remove.mutate(r.id)
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {editing && <CompetitorsDialog list={d.list} max={d.max} onClose={() => setEditing(false)} />}
      {noting && <NoteDialog username={noting} onClose={() => setNoting(null)} />}
    </>
  )
}

function CompetitorsDialog({ list: initial, max, onClose }: { list: { username: string; label: string }[]; max: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [start] = useState(() => (initial.length ? initial.map((c) => ({ ...c, username: `@${c.username}` })) : [{ username: '', label: '' }]))
  const [list, setList] = useState(start)
  const guard = useCloseGuard(isDirty(start, list), onClose, 'os concorrentes')
  const save = useMutation({
    mutationFn: () => api.put<{ busca?: { ok: boolean; message: string } }>('/marketing/instagram/concorrentes', { list: list.filter((c) => c.username.trim()) }),
    onSuccess: (r) => {
      if (r.busca?.ok) {
        toast.success(`Concorrentes salvos. ${r.busca.message}`)
        refreshCompetitorsSoon(qc)
      } else toast.success(`Concorrentes salvos. ${r.busca?.message ?? 'Os números aparecem depois da próxima sincronização do Instagram.'}`)
      void qc.invalidateQueries({ queryKey: ['mkt-ig-concorrentes'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Concorrentes no Instagram</DialogTitle>
          <DialogDescription>Informe o @ (ou o link do perfil) de até {max} concorrentes. O nome serve para buscar os anúncios na Biblioteca de Anúncios da Meta.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-2">
          {list.map((c, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                {i === 0 && <Label className="text-xs">@ do Instagram</Label>}
                <Input autoFocus={i === 0} value={c.username} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))} placeholder="@concorrente" />
              </div>
              <div className="flex-1 space-y-1">
                {i === 0 && <Label className="text-xs">Nome da empresa</Label>}
                <Input value={c.label} maxLength={80} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Ex.: Peças Tratores Ltda" />
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remover concorrente ${c.username || c.label}`.trim()} onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setList((l) => [...l, { username: '', label: '' }])} disabled={list.length >= max}>
            <PlusIcon /> Adicionar concorrente
          </Button>
          <p className="text-xs text-muted-foreground">Só contas comerciais ou de criador mostram dados públicos para a Meta. O CRM lê apenas o que qualquer pessoa vê no perfil.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NoteDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [stories, setStories] = useState('')
  const [ads, setAds] = useState<'—' | 'sim' | 'nao'>('—')
  const [note, setNote] = useState('')
  const empty = stories === '' && ads === '—' && !note.trim()
  const guard = useCloseGuard(!empty, onClose, 'o registro')
  const save = useMutation({
    mutationFn: () => api.post('/marketing/instagram/concorrentes/registros', { username, storiesSeen: stories === '' ? null : Number(stories), adsActive: ads === '—' ? null : ads === 'sim', note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Registro salvo.')
      void qc.invalidateQueries({ queryKey: ['mkt-ig-concorrentes'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar o que viu de @{username}</DialogTitle>
          <DialogDescription>Hoje. Preencha o que conferiu: stories no perfil e anúncio ativo na Biblioteca de Anúncios.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="note-stories">Stories no ar agora</Label>
            <Input id="note-stories" autoFocus type="number" min={0} max={200} value={stories} onChange={(e) => setStories(e.target.value)} placeholder="Ex.: 3 (0 se não tinha)" />
          </div>
          <div className="space-y-1">
            <Label>Anúncio patrocinado ativo</Label>
            <Select value={ads} onValueChange={(v) => setAds(v as typeof ads)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="—">Não conferi</SelectItem>
                <SelectItem value="sim">Sim, tem anúncio ativo</SelectItem>
                <SelectItem value="nao">Não tem anúncio ativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="note-text">Observação</Label>
            <Textarea id="note-text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ex.: promoção de filtros JCB, sorteio, vídeo de oficina..." />
          </div>
          {empty && <p className="text-xs text-muted-foreground">Preencha ao menos um campo para salvar.</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || empty}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
