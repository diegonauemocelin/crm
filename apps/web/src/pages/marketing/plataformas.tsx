import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, BanIcon, CalendarPlusIcon, CheckIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon, PencilIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { BreakdownTable, CrmOnlyNotice, Kpi, MEDIA_COLS, MktFilters, PendingIntegration, TrendChart, UpdatedLine } from '@/components/marketing/ui'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDate, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { downloadCsv, money, moneyShort, num, pct, times, useAnalysis, useMktFilters } from '@/lib/marketing'
import { spark } from './paineis'
import { type Col, NA, optNum, SimpleTable, SyncLine, Thumb } from '@/components/marketing/tabela'
import { BestTimes, type TimeCell } from '@/components/marketing/horarios'

// ---------- Google Ads ----------

interface DetailRow {
  key: string
  name: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
  impressionShare: number | null
  ctr: number | null
  cpc: number | null
  costPerConversion: number | null
  conversionRate: number | null
  leads?: number
  sales?: number
  revenue?: number
}
interface Term {
  term: string
  campaigns: string[]
  cost: number
  clicks: number
  impressions: number
  conversions: number
  ctr?: number | null
  cpc?: number | null
  reason?: 'palavra' | 'sem_conversao'
  detail?: string
  review: { status: 'negativar' | 'manter'; by: string; at: string } | null
}
interface GoogleDetail {
  syncedAt: string | null
  hasDetail: boolean
  dimensions: Record<'type' | 'device' | 'network' | 'region' | 'landing' | 'ad' | 'adgroup', DetailRow[]>
  terms: Term[]
  suggestions: Term[]
  negatives: { term: string; status: string; by: string; at: string }[]
}

const DETAIL_COLS: Col<DetailRow>[] = [
  { label: 'Item', value: (r) => <span className="line-clamp-2 break-all" title={r.name}>{r.name}</span>, csv: (r) => r.name },
  { label: 'Investido', value: (r) => money(r.cost), right: true, csv: (r) => r.cost },
  { label: 'Impressões', value: (r) => num(r.impressions), right: true, csv: (r) => r.impressions },
  { label: 'Cliques', value: (r) => num(r.clicks), right: true, csv: (r) => r.clicks },
  { label: 'CTR', value: (r) => pct(r.ctr), right: true, csv: (r) => r.ctr },
  { label: 'CPC', value: (r) => money(r.cpc), right: true, csv: (r) => r.cpc },
  { label: 'Conversões (Google)', value: (r) => num(r.conversions), right: true, csv: (r) => r.conversions },
  { label: 'Custo/conversão', value: (r) => money(r.costPerConversion), right: true, csv: (r) => r.costPerConversion },
]

export function GoogleAdsMktPage() {
  return (
    <RequirePermission module="mi_midia">
      <GoogleAds />
    </RequirePermission>
  )
}

function GoogleAds() {
  const f = useMktFilters()
  const { can } = useAuth()
  const q = new URLSearchParams(f.query)
  q.set('plataforma', 'google')
  const a = useAnalysis(q.toString())
  const det = useQuery({ queryKey: ['mkt-google', f.from, f.to, f.filters.campanha], queryFn: () => api.get<GoogleDetail>(`/marketing/google?de=${f.from}&ate=${f.to}${f.filters.campanha && f.filters.campanha !== '-' ? `&campanha=${f.filters.campanha}` : ''}`), placeholderData: keepPreviousData })
  const d = a.data
  const g = det.data
  return (
    <div>
      <PageHeader title="Google Ads" description="Investimento, campanhas, termos de pesquisa, dispositivos, regiões e páginas de destino, cruzados com os leads e as vendas do CRM." />
      <div className="space-y-4">
        <MktFilters />
        {(a.isLoading || det.isLoading) && <TableSkeleton rows={6} />}
        {a.error && <ErrorState error={a.error} onRetry={() => a.refetch()} />}
        {d && (
          <>
            <UpdatedLine d={d} />
            <CrmOnlyNotice d={d} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Investimento" value={money(d.now.mediaCost)} delta={d.deltas.mediaCost} lowerIsBetter spark={spark(d, 'mediaCost')} />
              <Kpi label="Cliques" value={num(d.now.clicks)} delta={d.deltas.clicks} hint={`CTR ${pct(d.now.ctr)} · CPM ${money(d.now.cpm)}`} />
              <Kpi label="CPC médio" value={money(d.now.cpc)} delta={d.deltas.cpc} lowerIsBetter />
              <Kpi label="Leads (CRM)" value={num(d.now.leads)} delta={d.deltas.leads} hint={`CPL ${money(d.now.cpl)}`} />
              <Kpi label="Vendas (CRM)" value={num(d.now.sales)} delta={d.deltas.sales} hint={`ROAS ${times(d.now.roas)} · conversões no Google: ${num(d.now.platformConversions)}`} />
            </div>
          </>
        )}
        {g && !g.hasDetail && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Os detalhes (termos de pesquisa, dispositivo, rede, região, anúncios e páginas de destino) chegam com o script novo do Google Ads.{' '}
              {can('configuracoes') ? (
                <Link className="font-medium underline" to="/configuracoes?secao=google-ads">
                  Copie o código em Configurações › Google Ads
                </Link>
              ) : (
                'Peça ao administrador para atualizar o script em Configurações › Google Ads'
              )}{' '}
              e troque o script no Google Ads (Ferramentas › Scripts).
            </span>
          </p>
        )}
        <Tabs defaultValue="campanhas">
          <TabsList className="flex-wrap">
            <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
            <TabsTrigger value="termos">Termos de pesquisa{g?.suggestions.length ? ` (${g.suggestions.length})` : ''}</TabsTrigger>
            <TabsTrigger value="tipos">Tipo de campanha</TabsTrigger>
            <TabsTrigger value="dispositivos">Dispositivo e rede</TabsTrigger>
            <TabsTrigger value="regioes">Região</TabsTrigger>
            <TabsTrigger value="anuncios">Anúncios e grupos</TabsTrigger>
            <TabsTrigger value="paginas">Páginas de destino</TabsTrigger>
          </TabsList>
          <TabsContent value="campanhas" className="space-y-4">
            {d && <TrendChart title="Investimento e faturamento atribuído" data={d.series} series={[{ key: 'mediaCost', label: 'Investimento', color: 'var(--chart-2)' }, { key: 'mktRevenue', label: 'Faturamento atribuído', color: 'var(--chart-1)' }]} format={moneyShort} />}
            {d && <BreakdownTable title="Por campanha" rows={d.byCampaign} columns={MEDIA_COLS} exportName="google-ads-campanhas" onPick={(r) => f.set({ campanha: r.key })} />}
            {g && (
              <SimpleTable
                title="Parcela de impressões na pesquisa"
                description="Quanto das buscas elegíveis o anúncio apareceu (média do período, quando o Google informa). Abaixo de 50% costuma indicar orçamento ou lance limitando."
                rows={g.dimensions.type.filter((r) => r.impressionShare !== null)}
                rowKey={(r) => r.key}
                cols={[{ label: 'Tipo', value: (r) => r.name }, { label: 'Parcela de impressões', value: (r) => pct(r.impressionShare), right: true }, { label: 'Investido', value: (r) => money(r.cost), right: true }]}
                empty="O Google ainda não informou a parcela de impressões (só campanhas de pesquisa)."
              />
            )}
          </TabsContent>
          <TabsContent value="termos" className="space-y-4">
            {g && <SearchTerms g={g} />}
          </TabsContent>
          <TabsContent value="tipos">{g && <SimpleTable title="Por tipo de campanha" description="Pesquisa, Performance Max, Display, Vídeo, Shopping…" rows={g.dimensions.type} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-tipos" />}</TabsContent>
          <TabsContent value="dispositivos" className="grid gap-4 xl:grid-cols-2">
            {g && <SimpleTable title="Por dispositivo" rows={g.dimensions.device} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-dispositivos" />}
            {g && <SimpleTable title="Por rede" rows={g.dimensions.network} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-redes" />}
          </TabsContent>
          <TabsContent value="regioes">{g && <SimpleTable title="Por região (estado)" description="Onde estava quem viu o anúncio (pelo Google). Leads e vendas por estado do cliente estão no Dashboard executivo." rows={g.dimensions.region} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-regioes" />}</TabsContent>
          <TabsContent value="anuncios" className="space-y-4">
            {g && <SimpleTable title="Anúncios" rows={g.dimensions.ad} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-anuncios" />}
            {g && <SimpleTable title="Grupos de anúncios" rows={g.dimensions.adgroup} cols={DETAIL_COLS} rowKey={(r) => r.key} exportName="google-ads-grupos" />}
          </TabsContent>
          <TabsContent value="paginas">
            {g && (
              <SimpleTable
                title="Páginas de destino"
                description="Investimento do Google por página e os leads/vendas do CRM que entraram por ela (página de entrada do atendimento). Página com custo e sem lead merece revisão."
                rows={g.dimensions.landing}
                rowKey={(r) => r.key}
                exportName="google-ads-paginas"
                cols={[
                  { label: 'Página', value: (r) => <a href={r.key} target="_blank" rel="noreferrer noopener" className="line-clamp-2 break-all hover:underline">{r.key}</a>, csv: (r) => r.key },
                  { label: 'Investido', value: (r) => money(r.cost), right: true, csv: (r) => r.cost },
                  { label: 'Cliques', value: (r) => num(r.clicks), right: true, csv: (r) => r.clicks },
                  { label: 'Conversões (Google)', value: (r) => num(r.conversions), right: true, csv: (r) => r.conversions },
                  { label: 'Leads (CRM)', value: (r) => num(r.leads ?? 0), right: true, csv: (r) => r.leads ?? 0 },
                  { label: 'Vendas (CRM)', value: (r) => num(r.sales ?? 0), right: true, csv: (r) => r.sales ?? 0 },
                  { label: 'Faturamento', value: (r) => money(r.revenue ?? 0), right: true, csv: (r) => r.revenue ?? 0 },
                  { label: 'Custo/lead', value: (r) => money(r.leads ? r.cost / r.leads : null), right: true, csv: (r) => (r.leads ? Math.round((r.cost / r.leads) * 100) / 100 : null) },
                ]}
              />
            )}
          </TabsContent>
        </Tabs>
        {g?.syncedAt && <p className="text-xs text-muted-foreground">Detalhes do Google Ads atualizados em {formatDateTime(g.syncedAt)}.</p>}
      </div>
    </div>
  )
}

function SearchTerms({ g }: { g: GoogleDetail }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('mi_midia', 'edit')
  const review = useMutation({
    mutationFn: (x: { term: string; status: 'negativar' | 'manter' | null }) => api.put('/marketing/google/termos', x),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-google'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const actions = (t: Term) =>
    canEdit ? (
      <div className="flex justify-end gap-1">
        {t.review ? (
          <>
            <Badge variant={t.review.status === 'negativar' ? 'destructive' : 'secondary'}>{t.review.status === 'negativar' ? 'Negativar' : 'Manter'}</Badge>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`Desfazer revisão do termo “${t.term}”`} onClick={() => review.mutate({ term: t.term, status: null })}>
              <Undo2Icon />
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-7" onClick={() => review.mutate({ term: t.term, status: 'negativar' })}>
              <BanIcon /> Negativar
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => review.mutate({ term: t.term, status: 'manter' })}>
              <CheckIcon /> Manter
            </Button>
          </>
        )}
      </div>
    ) : t.review ? (
      <Badge variant="secondary">{t.review.status}</Badge>
    ) : null
  return (
    <>
      <SimpleTable
        title="Sugestões de palavras negativas"
        description="Termos com palavra de alerta (emprego, curso, grátis…) ou com gasto e nenhuma conversão. É só sugestão: revise e aplique no Google Ads (o CRM não altera a conta). As palavras de alerta ficam em Configurações › Marketing Inteligente."
        rows={g.suggestions}
        rowKey={(t) => t.term}
        empty="Nenhum termo para revisar no período."
        cols={[
          { label: 'Termo pesquisado', value: (t) => t.term },
          { label: 'Motivo', value: (t) => <span className="block min-w-48 max-w-72 whitespace-normal text-xs text-muted-foreground">{t.detail}</span> },
          { label: 'Investido', value: (t) => money(t.cost), right: true },
          { label: 'Cliques', value: (t) => num(t.clicks), right: true },
          { label: 'Campanhas', value: (t) => <span className="line-clamp-1 text-xs">{t.campaigns.join(', ')}</span> },
          { label: 'Decisão', value: actions, right: true },
        ]}
      />
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Negativas aprovadas ({g.negatives.length})</CardTitle>
            <CardDescription>Baixe a lista para colar no Google Ads (Palavras-chave › Palavras-chave negativas) ou no Google Ads Editor.</CardDescription>
          </div>
          {g.negatives.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => downloadCsv('negativas-google-ads', ['Palavra-chave negativa', 'Aprovado por', 'Em'], g.negatives.map((n) => [`[${n.term}]`, n.by, formatDateTime(n.at)]))}>
              <DownloadIcon /> Baixar lista
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {g.negatives.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma ainda.</p> : g.negatives.map((n) => <Badge key={n.term} variant="outline">{n.term}</Badge>)}
        </CardContent>
      </Card>
      <SimpleTable
        title="Termos de pesquisa"
        description="O que as pessoas digitaram no Google antes de clicar (os 300 com mais investimento)."
        rows={g.terms}
        rowKey={(t) => t.term}
        exportName="google-ads-termos"
        cols={[
          { label: 'Termo', value: (t) => t.term, csv: (t) => t.term },
          { label: 'Investido', value: (t) => money(t.cost), right: true, csv: (t) => t.cost },
          { label: 'Impressões', value: (t) => num(t.impressions), right: true, csv: (t) => t.impressions },
          { label: 'Cliques', value: (t) => num(t.clicks), right: true, csv: (t) => t.clicks },
          { label: 'CTR', value: (t) => pct(t.ctr), right: true, csv: (t) => t.ctr ?? null },
          { label: 'Conversões (Google)', value: (t) => num(t.conversions), right: true, csv: (t) => t.conversions },
          { label: 'Decisão', value: actions, right: true, csv: (t) => t.review?.status ?? '' },
        ]}
      />
    </>
  )
}

// ---------- Meta Ads e TikTok Ads ----------

interface MediaRow {
  entityId: string
  name: string
  campaignName: string
  objective: string | null
  creative: { title: string | null; body: string | null; cta: string | null; type: string | null; image: string | null } | null
  spend: number
  impressions: number
  reach: number | null
  clicks: number
  leads: number
  conversations: number
  conversions: number
  videoViews: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
  frequency: number | null
  resultLabel: string
  results: number
  costPerResult: number | null
  crmLeads?: number
  crmSales?: number
  crmRevenue?: number
  crmCpl?: number | null
  roas?: number | null
}
interface AdsData {
  connected: boolean
  sync: { lastOkAt?: string; lastError?: string | null } | null
  totals: { spend: number; impressions: number; clicks: number; leads: number; conversations: number; conversions: number; ctr: number | null; cpc: number | null; cpm: number | null; crmLeads: number; crmSales: number; crmRevenue: number; roas: number | null; cpl: number | null }
  campaigns: MediaRow[]
  adsets: MediaRow[]
  ads: MediaRow[]
  fatigue: { entityId: string; name: string; reasons: string[] }[]
  breakdowns: { dimension: string; rows: { key: string; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpc: number | null; cpl: number | null }[] }[]
  crmUnattributed: number
}

const MEDIA_ROW_COLS: Col<MediaRow>[] = [
  { label: 'Nome', value: (r) => <span className="line-clamp-2" title={r.name}>{r.name}</span>, csv: (r) => r.name },
  { label: 'Investido', value: (r) => money(r.spend), right: true, csv: (r) => r.spend },
  { label: 'Impressões', value: (r) => num(r.impressions), right: true, csv: (r) => r.impressions },
  { label: 'Frequência', value: (r) => (r.frequency === null ? NA : r.frequency.toLocaleString('pt-BR')), right: true, csv: (r) => r.frequency },
  { label: 'CPM', value: (r) => money(r.cpm), right: true, csv: (r) => r.cpm },
  { label: 'Cliques', value: (r) => num(r.clicks), right: true, csv: (r) => r.clicks },
  { label: 'CTR', value: (r) => pct(r.ctr), right: true, csv: (r) => r.ctr },
  { label: 'Resultado', value: (r) => `${num(r.results)} ${r.resultLabel.toLowerCase()}`, right: true, csv: (r) => r.results },
  { label: 'Custo/resultado', value: (r) => money(r.costPerResult), right: true, csv: (r) => r.costPerResult },
]

export function MetaAdsPage() {
  return (
    <RequirePermission module="mi_midia">
      <PaidPlatform platform="meta" title="Meta Ads: Facebook e Instagram" />
    </RequirePermission>
  )
}

export function TikTokAdsPage() {
  return (
    <RequirePermission module="mi_midia">
      <PaidPlatform platform="tiktok" title="TikTok Ads" />
    </RequirePermission>
  )
}

const BREAKDOWN_LABEL: Record<string, string> = { placement: 'Posicionamento', device: 'Dispositivo', region: 'Região', age_gender: 'Idade e gênero' }

function PaidPlatform({ platform, title }: { platform: 'meta' | 'tiktok'; title: string }) {
  const f = useMktFilters()
  const q = useQuery({ queryKey: ['mkt-ads', platform, f.from, f.to, f.filters.campanha], queryFn: () => api.get<AdsData>(`/marketing/plataforma/${platform}?de=${f.from}&ate=${f.to}${f.filters.campanha && f.filters.campanha !== '-' ? `&campanha=${f.filters.campanha}` : ''}`), placeholderData: keepPreviousData })
  const d = q.data
  const name = platform === 'meta' ? 'Meta' : 'TikTok'
  return (
    <div>
      <PageHeader title={title} description={`Campanhas, ${platform === 'meta' ? 'conjuntos' : 'grupos'}, anúncios e criativos do ${name}, cruzados com os leads e as vendas do CRM. Conversões da plataforma e vendas do CRM ficam separadas.`} />
      <div className="space-y-4">
        <MktFilters show="period" />
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            <SyncLine sync={d.sync} label={`${name} Ads`} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Investimento" value={d.connected || d.totals.spend ? money(d.totals.spend) : 'Não disponível'} hint={`CPM ${money(d.totals.cpm)}`} />
              <Kpi label="Cliques" value={num(d.totals.clicks)} hint={`CTR ${pct(d.totals.ctr)} · CPC ${money(d.totals.cpc)}`} />
              <Kpi label={`Leads e conversas (${name})`} value={`${num(d.totals.leads)} · ${num(d.totals.conversations)}`} hint={platform === 'tiktok' ? 'O relatório do TikTok não separa leads: veja as conversões' : 'Contados pela plataforma'} />
              <Kpi label="Leads no CRM" value={num(d.totals.crmLeads)} hint={`CPL ${money(d.totals.cpl)} · ${num(d.crmUnattributed)} sem campanha identificada`} />
              <Kpi label="Vendas no CRM" value={num(d.totals.crmSales)} hint={`${money(d.totals.crmRevenue)} · ROAS ${times(d.totals.roas)}`} />
            </div>
            {!d.connected && d.campaigns.length === 0 && (
              <PendingIntegration
                title={platform === 'meta' ? 'Meta Marketing API' : 'TikTok Business API'}
                what={platform === 'meta' ? ['Investimento, alcance, impressões, frequência, CPM, cliques, CTR e CPC', 'Leads, conversas iniciadas e conversões por campanha, conjunto e anúncio', 'Criativos (imagem, texto, chamada), posicionamento, dispositivo, região, idade e gênero', 'Anúncios com sinais de cansaço'] : ['Campanhas, grupos e anúncios', 'Investimento, impressões, alcance, cliques, CPM, CPC e CTR', 'Visualizações de vídeo e conversões', 'Métrica que a API não liberar aparece como “Não disponível”']}
                steps={<p>Cadastre o token e as contas em Configurações › Marketing Inteligente, ligue a integração e clique em Sincronizar agora.</p>}
              />
            )}
            {d.fatigue.length > 0 && (
              <Card className="border-amber-500/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangleIcon className="size-4 text-amber-600" /> Anúncios com sinais de cansaço
                  </CardTitle>
                  <CardDescription>Últimos 7 dias contra os 7 anteriores. Teste um criativo novo antes de pausar o atual.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {d.fatigue.map((x) => (
                    <p key={x.entityId}>
                      <b>{x.name}:</b> {x.reasons.join('; ')}.
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
            <Tabs defaultValue="campanhas">
              <TabsList className="flex-wrap">
                <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
                <TabsTrigger value="conjuntos">{platform === 'meta' ? 'Conjuntos' : 'Grupos'}</TabsTrigger>
                <TabsTrigger value="anuncios">Anúncios e criativos</TabsTrigger>
                {platform === 'meta' && <TabsTrigger value="recortes">Público e posicionamento</TabsTrigger>}
              </TabsList>
              <TabsContent value="campanhas">
                <SimpleTable
                  title="Campanhas"
                  description="Leads e vendas do CRM pela campanha do link do anúncio (utm_campaign com o número da campanha)."
                  rows={d.campaigns}
                  rowKey={(r) => r.entityId}
                  exportName={`${platform}-campanhas`}
                  cols={[
                    ...MEDIA_ROW_COLS.slice(0, 2),
                    { label: 'Objetivo', value: (r) => <span className="text-xs">{r.objective ?? '—'}</span>, csv: (r) => r.objective },
                    ...MEDIA_ROW_COLS.slice(2),
                    { label: 'Leads CRM', value: (r) => num(r.crmLeads ?? 0), right: true, csv: (r) => r.crmLeads ?? 0 },
                    { label: 'Vendas CRM', value: (r) => num(r.crmSales ?? 0), right: true, csv: (r) => r.crmSales ?? 0 },
                    { label: 'ROAS', value: (r) => times(r.roas ?? null), right: true, csv: (r) => r.roas ?? null },
                  ]}
                />
              </TabsContent>
              <TabsContent value="conjuntos">
                <SimpleTable title={platform === 'meta' ? 'Conjuntos de anúncios' : 'Grupos de anúncios'} rows={d.adsets} rowKey={(r) => r.entityId} exportName={`${platform}-conjuntos`} cols={MEDIA_ROW_COLS} />
              </TabsContent>
              <TabsContent value="anuncios">
                <SimpleTable
                  title="Anúncios e criativos"
                  description="Compare imagem, texto e chamada para ação de cada anúncio."
                  rows={d.ads}
                  rowKey={(r) => r.entityId}
                  exportName={`${platform}-anuncios`}
                  cols={[
                    {
                      label: 'Anúncio',
                      value: (r) => (
                        <div className="flex gap-2">
                          {r.creative?.image && <img src={r.creative.image} alt="" className="size-12 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                          <div className="min-w-0">
                            <p className="line-clamp-1 font-medium">{r.name}</p>
                            {r.creative?.title && <p className="line-clamp-1 text-xs">{r.creative.title}</p>}
                            {r.creative?.body && <p className="line-clamp-2 text-xs text-muted-foreground">{r.creative.body}</p>}
                            {r.creative?.cta && <Badge variant="outline" className="mt-0.5 text-xs">{r.creative.cta}</Badge>}
                          </div>
                        </div>
                      ),
                      csv: (r) => r.name,
                    },
                    ...MEDIA_ROW_COLS.slice(1),
                    { label: 'Vídeo', value: (r) => optNum(r.videoViews), right: true, csv: (r) => r.videoViews },
                  ]}
                />
              </TabsContent>
              {platform === 'meta' && (
                <TabsContent value="recortes" className="grid gap-4 xl:grid-cols-2">
                  {d.breakdowns.map((b) => (
                    <SimpleTable
                      key={b.dimension}
                      title={BREAKDOWN_LABEL[b.dimension] ?? b.dimension}
                      rows={b.rows}
                      rowKey={(r) => r.key}
                      cols={[
                        { label: BREAKDOWN_LABEL[b.dimension] ?? 'Item', value: (r) => r.key },
                        { label: 'Investido', value: (r) => money(r.spend), right: true },
                        { label: 'Cliques', value: (r) => num(r.clicks), right: true },
                        { label: 'CTR', value: (r) => pct(r.ctr), right: true },
                        { label: 'Leads', value: (r) => num(r.leads), right: true },
                        { label: 'CPL', value: (r) => money(r.cpl), right: true },
                      ]}
                    />
                  ))}
                </TabsContent>
              )}
            </Tabs>
            <p className="text-xs text-muted-foreground">Frequência = impressões ÷ alcance somado dia a dia (aproximação: a mesma pessoa em dias diferentes conta mais de uma vez). Métrica que a plataforma não informa aparece como “Não disponível”.</p>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Redes sociais ----------

interface SocialData {
  connected: boolean
  sync: { lastOkAt?: string; lastError?: string | null } | null
  networks: { network: string; profileId: string; label: string; followers: number | null; followersGrowth: number | null; reach: number | null; impressions: number | null; profileViews: number | null; websiteClicks: number | null; series: { label: string; followers: number | null; reach: number | null }[] }[]
  posts: Post[]
  worst: Post[]
  byFormat: { format: string; posts: number; engagement: number; reach: number | null; avgEngagement: number; engagementRate: number | null }[]
  byTheme: { theme: string; posts: number; engagement: number; avgEngagement: number }[]
  postsPerWeek: number | null
  times: { network: 'instagram' | 'facebook'; cells: TimeCell[]; best: TimeCell[] }[]
  organicVsPaid: { organicReach: number | null; paidImpressions: number; paidSpend: number; paidClicks: number; paidLeads: number }
}
interface Post {
  network: string
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
  extra?: Record<string, number | string> | null
}

const POST_COLS: Col<Post>[] = [
  { label: 'Publicação', value: (p) => (
    <div className="flex min-w-0 items-center gap-3">
      <Thumb src={p.extra?.thumb} alt={p.caption.slice(0, 80) || p.format} />
      <div className="min-w-0">
      <p className="line-clamp-2 text-sm">{p.caption || '(sem texto)'}</p>
      <p className="text-xs text-muted-foreground">
        {p.network === 'instagram' ? 'Instagram' : 'Facebook'} · {p.format} · {formatDate(p.publishedAt)}
        {p.permalink && (
          <a href={p.permalink} target="_blank" rel="noreferrer noopener" className="ml-1 inline-flex items-center hover:underline">
            abrir <ExternalLinkIcon className="ml-0.5 size-3" />
          </a>
        )}
      </p>
      </div>
    </div>
  ), csv: (p) => p.caption },
  { label: 'Alcance', value: (p) => optNum(p.reach), right: true, csv: (p) => p.reach },
  { label: 'Curtidas', value: (p) => optNum(p.likes), right: true, csv: (p) => p.likes },
  { label: 'Comentários', value: (p) => optNum(p.comments), right: true, csv: (p) => p.comments },
  { label: 'Compart.', value: (p) => optNum(p.shares), right: true, csv: (p) => p.shares },
  { label: 'Salvos', value: (p) => optNum(p.saves), right: true, csv: (p) => p.saves },
  { label: 'Engajamento', value: (p) => `${num(p.engagement)}${p.engagementRate !== null ? ` · ${pct(p.engagementRate)}` : ''}`, right: true, csv: (p) => p.engagement },
]

export function SocialPage() {
  return (
    <RequirePermission module="mi_social">
      <Social />
    </RequirePermission>
  )
}

function Social() {
  const f = useMktFilters()
  const q = useQuery({ queryKey: ['mkt-social', f.from, f.to], queryFn: () => api.get<SocialData>(`/marketing/social?de=${f.from}&ate=${f.to}`), placeholderData: keepPreviousData })
  const d = q.data
  return (
    <div>
      <PageHeader title="Redes sociais orgânicas" description="Instagram e Facebook: crescimento, alcance, engajamento, as publicações e os temas que mais funcionam, e o calendário editorial." />
      <div className="space-y-4">
        <MktFilters show="period" />
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        <Tabs defaultValue="resultados">
          <TabsList>
            <TabsTrigger value="resultados">Resultados</TabsTrigger>
            <TabsTrigger value="calendario">Calendário editorial</TabsTrigger>
          </TabsList>
          <TabsContent value="resultados" className="space-y-4">
            {d && (
              <>
                <SyncLine sync={d.sync} label="Instagram e Facebook" />
                {!d.connected && d.networks.length === 0 && (
                  <PendingIntegration
                    title="Instagram e Facebook (Graph API)"
                    what={['Seguidores, alcance, visitas ao perfil e cliques no link', 'Curtidas, comentários, compartilhamentos e salvamentos por publicação', 'Ranking das melhores e piores publicações, por formato e por tema', 'Comparação entre orgânico e pago']}
                    steps={<p>Usa o mesmo token da Meta Ads, com pages_read_engagement, instagram_basic e instagram_manage_insights. Informe a página e o Instagram em Configurações › Marketing Inteligente.</p>}
                  />
                )}
                {d.networks.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {d.networks.map((n) => (
                      <Card key={`${n.network}-${n.profileId}`}>
                        <CardHeader>
                          <CardTitle className="text-base">{n.label}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-3 text-sm">
                          <Kpi label="Seguidores" value={optNumText(n.followers)} hint={n.followersGrowth !== null ? `${n.followersGrowth >= 0 ? '+' : ''}${num(n.followersGrowth)} no período` : undefined} />
                          <Kpi label="Alcance" value={optNumText(n.reach)} />
                          <Kpi label="Visitas ao perfil" value={optNumText(n.profileViews)} />
                          <Kpi label="Cliques no link" value={optNumText(n.websiteClicks)} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi label="Publicações por semana" value={d.postsPerWeek === null ? '—' : d.postsPerWeek.toLocaleString('pt-BR')} />
                  <Kpi label="Alcance orgânico" value={optNumText(d.organicVsPaid.organicReach)} hint="somado dia a dia" />
                  <Kpi label="Impressões pagas (Meta Ads)" value={num(d.organicVsPaid.paidImpressions)} hint={`${money(d.organicVsPaid.paidSpend)} investidos`} />
                  <Kpi label="Leads da mídia paga (Meta)" value={num(d.organicVsPaid.paidLeads)} hint={`${num(d.organicVsPaid.paidClicks)} cliques`} />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <SimpleTable title="Por formato" rows={d.byFormat} rowKey={(r) => r.format} cols={[{ label: 'Formato', value: (r) => r.format }, { label: 'Publicações', value: (r) => num(r.posts), right: true }, { label: 'Engajamento médio', value: (r) => num(r.avgEngagement), right: true }, { label: 'Taxa', value: (r) => pct(r.engagementRate), right: true }]} />
                  <SimpleTable title="Por tema (marcas e tipos de peça citados)" rows={d.byTheme} rowKey={(r) => r.theme} cols={[{ label: 'Tema', value: (r) => r.theme }, { label: 'Publicações', value: (r) => num(r.posts), right: true }, { label: 'Engajamento médio', value: (r) => num(r.avgEngagement), right: true }]} empty="Nenhuma publicação cita marcas ou tipos de peça cadastrados." />
                </div>
                {d.times.some((t) => t.cells.length > 0) && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {d.times
                      .filter((t) => t.cells.length > 0)
                      .map((t) => (
                        <BestTimes key={t.network} network={t.network === 'instagram' ? 'Instagram' : 'Facebook'} cells={t.cells} best={t.best} basedOnPosts={t.cells.reduce((n, c) => n + c.posts, 0)} />
                      ))}
                  </div>
                )}
                <SimpleTable title="Melhores publicações (por taxa de engajamento)" rows={d.posts} rowKey={(p) => p.postId} cols={POST_COLS} exportName="publicacoes" limit={15} empty="Nenhuma publicação sincronizada no período." />
                <SimpleTable title="Publicações com menor engajamento" rows={d.worst} rowKey={(p) => p.postId} cols={POST_COLS} limit={10} empty="—" />
              </>
            )}
          </TabsContent>
          <TabsContent value="calendario">
            <Editorial />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
const optNumText = (v: number | null) => (v === null ? 'Não disponível' : num(v))

interface EditorialItem {
  id: string
  title: string
  network: string
  format: string
  theme: string | null
  ownerId: string | null
  ownerName: string | null
  plannedAt: string
  status: string
  postUrl: string | null
  notes: string | null
}
const STATUS_LABEL: Record<string, string> = { ideia: 'Ideia', producao: 'Em produção', aprovacao: 'Em aprovação', agendado: 'Agendado', publicado: 'Publicado', cancelado: 'Cancelado' }
const NETWORK_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', outro: 'Outro' }

function Editorial() {
  const f = useMktFilters()
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['mkt-editorial', f.from, f.to], queryFn: () => api.get<{ items: EditorialItem[]; owners: { id: string; name: string }[]; statuses: string[]; networks: string[] }>(`/marketing/editorial?de=${f.from}&ate=${f.to}`) })
  const [edit, setEdit] = useState<Partial<EditorialItem> | null>(null)
  const confirm = useConfirm()
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/editorial/${id}`),
    onSuccess: () => (toast.success('Publicação excluída do calendário.'), qc.invalidateQueries({ queryKey: ['mkt-editorial'] })),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const startNew = () => setEdit({ network: 'instagram', format: 'Imagem', status: 'ideia', plannedAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16) })
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Calendário editorial</CardTitle>
          <CardDescription>Planejamento das publicações do período: rede, formato, tema, responsável, data, situação e o link quando publicado.</CardDescription>
        </div>
        {can('mi_social', 'create') && (
          <Button size="sm" onClick={startNew}>
            <CalendarPlusIcon /> Nova publicação
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {q.isLoading && <TableSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && d.items.length === 0 && (
          <EmptyState
            icon={CalendarPlusIcon}
            title="Nada planejado no período"
            description="Cadastre as publicações para acompanhar o que vai sair, quem faz e o resultado."
            action={
              can('mi_social', 'create') ? (
                <Button size="sm" onClick={startNew}>
                  <CalendarPlusIcon /> Nova publicação
                </Button>
              ) : undefined
            }
          />
        )}
        {d && d.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Data</TableHead>
                <TableHead>Publicação</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="pr-6 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-6 whitespace-nowrap">{formatDateTime(i.plannedAt)}</TableCell>
                  <TableCell className="max-w-96">
                    <p className="font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {NETWORK_LABEL[i.network] ?? i.network} · {i.format}
                      {i.theme ? ` · ${i.theme}` : ''}
                      {i.postUrl && (
                        <a className="ml-1 hover:underline" href={i.postUrl} target="_blank" rel="noreferrer noopener">
                          ver publicação
                        </a>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>{i.ownerName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={i.status === 'publicado' ? 'default' : i.status === 'cancelado' ? 'outline' : 'secondary'}>{STATUS_LABEL[i.status] ?? i.status}</Badge>
                  </TableCell>
                  <TableCell className="pr-6 text-right whitespace-nowrap">
                    {can('mi_social', 'edit') && (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Editar publicação ${i.title}`} onClick={() => setEdit({ ...i, plannedAt: new Date(new Date(i.plannedAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) })}>
                        <PencilIcon />
                      </Button>
                    )}
                    {can('mi_social', 'delete') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Excluir publicação ${i.title}`}
                        onClick={async () => {
                          if (await confirm({ title: `Excluir a publicação “${i.title}”?`, description: 'Ela sai do calendário editorial e não pode ser recuperada. Se já foi publicada, continua na rede social.', confirmLabel: 'Excluir publicação' })) remove.mutate(i.id)
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
        )}
      </CardContent>
      {edit && d && <EditorialDialog initial={edit} owners={d.owners} statuses={d.statuses} networks={d.networks} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function EditorialDialog({ initial, owners, statuses, networks, onClose }: { initial: Partial<EditorialItem>; owners: { id: string; name: string }[]; statuses: string[]; networks: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [x, setX] = useState(initial)
  const save = useMutation({
    mutationFn: () => {
      const body = { ...x, plannedAt: x.plannedAt ? new Date(x.plannedAt).toISOString() : '' }
      return x.id ? api.put(`/marketing/editorial/${x.id}`, body) : api.post('/marketing/editorial', body)
    },
    onSuccess: () => (toast.success('Calendário salvo.'), qc.invalidateQueries({ queryKey: ['mkt-editorial'] }), onClose()),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const set = (p: Partial<EditorialItem>) => setX((v) => ({ ...v, ...p }))
  const guard = useCloseGuard(isDirty(initial, x), onClose, 'a publicação')
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{x.id ? 'Editar publicação' : 'Nova publicação'}</DialogTitle>
          <DialogDescription>O calendário só organiza o planejamento: a publicação continua sendo feita na rede social.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ed-title" required>
              Título
            </Label>
            <Input id="ed-title" autoFocus maxLength={200} value={x.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Reels: troca de filtros da JCB 3CX" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Rede</Label>
              <Select value={x.network} onValueChange={(v) => set({ network: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {networks.map((n) => (
                    <SelectItem key={n} value={n}>
                      {NETWORK_LABEL[n] ?? n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-format">Formato</Label>
              <Input id="ed-format" maxLength={40} value={x.format ?? ''} onChange={(e) => set({ format: e.target.value })} placeholder="Reels, Carrossel…" />
            </div>
            <div className="space-y-1.5">
              <Label>Situação</Label>
              <Select value={x.status} onValueChange={(v) => set({ status: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ed-date" required>
                Data e hora
              </Label>
              <Input id="ed-date" type="datetime-local" value={x.plannedAt ?? ''} onChange={(e) => set({ plannedAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={x.ownerId ?? 'ninguem'} onValueChange={(v) => set({ ownerId: v === 'ninguem' ? null : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguem">Sem responsável</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-theme">Tema</Label>
            <Input id="ed-theme" maxLength={80} value={x.theme ?? ''} onChange={(e) => set({ theme: e.target.value })} placeholder="Ex.: Material rodante, JCB, dica de manutenção" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-url">Link da publicação (quando publicada)</Label>
            <Input id="ed-url" value={x.postUrl ?? ''} onChange={(e) => set({ postUrl: e.target.value })} placeholder="https://www.instagram.com/p/…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-notes">Observações</Label>
            <Textarea id="ed-notes" rows={3} maxLength={2000} value={x.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => void guard()}>
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

// ---------- SEO e site ----------

interface SeoAgg {
  key: string
  clicks: number
  impressions: number
  position: number | null
  ctr: number | null
}
interface SeoData {
  connected: boolean
  sync: { lastOkAt?: string; lastError?: string | null } | null
  totals: SeoAgg | null
  before: SeoAgg | null
  series: { label: string; clicks: number; impressions: number; position: number }[]
  queries: SeoAgg[]
  pages: (SeoAgg & { crm: { leads: number; organic: number; sales: number; revenue: number } | null })[]
  opportunities: (SeoAgg & { expectedCtr: number; potentialClicks: number })[]
  byBrand: { queries: Group[]; pages: Group[] }
  byPartType: { queries: Group[]; pages: Group[] }
  entryPages: { path: string; leads: number; organic: number; sales: number; revenue: number }[]
  ecommerce: { orders: number; revenue: number }
}
interface Group {
  name: string
  items: number
  clicks: number
  impressions: number
  ctr: number | null
}
const dPct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10)

const SEO_COLS: Col<SeoAgg>[] = [
  { label: 'Consulta', value: (r) => r.key, csv: (r) => r.key },
  { label: 'Cliques', value: (r) => num(r.clicks), right: true, csv: (r) => r.clicks },
  { label: 'Impressões', value: (r) => num(r.impressions), right: true, csv: (r) => r.impressions },
  { label: 'CTR', value: (r) => pct(r.ctr), right: true, csv: (r) => r.ctr },
  { label: 'Posição média', value: (r) => (r.position === null ? '—' : r.position.toLocaleString('pt-BR')), right: true, csv: (r) => r.position },
]
const GROUP_COLS: Col<Group>[] = [
  { label: 'Nome', value: (r) => r.name },
  { label: 'Itens', value: (r) => num(r.items), right: true },
  { label: 'Cliques', value: (r) => num(r.clicks), right: true },
  { label: 'Impressões', value: (r) => num(r.impressions), right: true },
  { label: 'CTR', value: (r) => pct(r.ctr), right: true },
]

export function SeoPage() {
  return (
    <RequirePermission module="mi_seo">
      <Seo />
    </RequirePermission>
  )
}

function Seo() {
  const f = useMktFilters()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['mkt-seo', f.from, f.to], queryFn: () => api.get<SeoData>(`/marketing/seo?de=${f.from}&ate=${f.to}`), placeholderData: keepPreviousData })
  const d = q.data
  return (
    <div>
      <PageHeader title="SEO e tráfego do site" description="Busca orgânica do Google (Search Console), páginas de marcas e categorias, e as páginas por onde os leads entram no site." />
      <div className="space-y-4">
        <MktFilters show="period" />
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            <SyncLine sync={d.sync} label="Search Console (os dados chegam com 2 a 3 dias de atraso)" />
            {!d.connected && !d.totals && (
              <PendingIntegration
                title="Google Search Console"
                what={['Cliques e impressões orgânicas, CTR e posição média', 'Consultas e páginas com mais potencial', 'Páginas de marcas, máquinas e categorias de peças', 'Relação entre páginas, leads e vendas do CRM']}
                steps={<p>Adicione a conta de serviço do Google Analytics como usuária da propriedade no Search Console e informe a propriedade em Configurações › Marketing Inteligente.</p>}
              />
            )}
            {d.totals && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Cliques orgânicos" value={num(d.totals.clicks)} delta={dPct(d.totals.clicks, d.before?.clicks)} spark={d.series.map((s) => s.clicks)} />
                <Kpi label="Impressões orgânicas" value={num(d.totals.impressions)} delta={dPct(d.totals.impressions, d.before?.impressions)} spark={d.series.map((s) => s.impressions)} />
                <Kpi label="CTR orgânico" value={pct(d.totals.ctr)} delta={dPct(d.totals.ctr, d.before?.ctr)} />
                <Kpi label="Posição média" value={d.totals.position === null ? '—' : d.totals.position.toLocaleString('pt-BR')} delta={dPct(d.totals.position, d.before?.position)} lowerIsBetter />
              </div>
            )}
            {d.series.length > 1 && <TrendChart title="Cliques e impressões por dia" data={d.series} series={[{ key: 'clicks', label: 'Cliques', color: 'var(--chart-1)' }, { key: 'impressions', label: 'Impressões', color: 'var(--chart-2)' }]} />}
            <Tabs defaultValue="oportunidades">
              <TabsList className="flex-wrap">
                <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
                <TabsTrigger value="consultas">Consultas</TabsTrigger>
                <TabsTrigger value="paginas">Páginas</TabsTrigger>
                <TabsTrigger value="marcas">Marcas e categorias</TabsTrigger>
                <TabsTrigger value="entrada">Páginas de entrada dos leads</TabsTrigger>
              </TabsList>
              <TabsContent value="oportunidades">
                <SimpleTable
                  title="Consultas com espaço para crescer"
                  description="Na 1ª ou 2ª página do Google (posição 4 a 20), com muitas impressões e CTR abaixo do esperado para a posição. Melhorar título, descrição e conteúdo pode trazer mais cliques (potencial estimado, não garantido)."
                  rows={d.opportunities}
                  rowKey={(r) => r.key}
                  exportName="seo-oportunidades"
                  cols={[...SEO_COLS, { label: 'CTR esperado', value: (r) => pct(r.expectedCtr), right: true, csv: (r) => r.expectedCtr }, { label: 'Cliques potenciais', value: (r) => `+${num(r.potentialClicks)}`, right: true, csv: (r) => r.potentialClicks }]}
                />
              </TabsContent>
              <TabsContent value="consultas">
                <SimpleTable title="Consultas" rows={d.queries} rowKey={(r) => r.key} cols={SEO_COLS} exportName="seo-consultas" />
              </TabsContent>
              <TabsContent value="paginas">
                <SimpleTable
                  title="Páginas"
                  description="Leads e vendas: atendimentos do Pré-Vendas que entraram por essa página (qualquer origem)."
                  rows={d.pages}
                  rowKey={(r) => r.key}
                  exportName="seo-paginas"
                  cols={[
                    { label: 'Página', value: (r) => <a href={r.key} target="_blank" rel="noreferrer noopener" className="line-clamp-2 break-all hover:underline">{r.key}</a>, csv: (r) => r.key },
                    ...SEO_COLS.slice(1),
                    { label: 'Leads', value: (r) => num(r.crm?.leads ?? 0), right: true, csv: (r) => r.crm?.leads ?? 0 },
                    { label: 'Vendas', value: (r) => num(r.crm?.sales ?? 0), right: true, csv: (r) => r.crm?.sales ?? 0 },
                  ]}
                />
              </TabsContent>
              <TabsContent value="marcas" className="grid gap-4 xl:grid-cols-2">
                <SimpleTable title="Consultas por marca" rows={d.byBrand.queries} rowKey={(r) => r.name} cols={GROUP_COLS} />
                <SimpleTable title="Páginas por marca" rows={d.byBrand.pages} rowKey={(r) => r.name} cols={GROUP_COLS} />
                <SimpleTable title="Consultas por tipo de peça" rows={d.byPartType.queries} rowKey={(r) => r.name} cols={GROUP_COLS} />
                <SimpleTable title="Páginas por tipo de peça" rows={d.byPartType.pages} rowKey={(r) => r.name} cols={GROUP_COLS} />
              </TabsContent>
              <TabsContent value="entrada">
                <SimpleTable
                  title="Páginas de entrada dos leads (CRM)"
                  description={`Por onde os leads chegaram ao site no período. Loja virtual no período: ${num(d.ecommerce.orders)} pedido(s), ${money(d.ecommerce.revenue)}.`}
                  rows={d.entryPages}
                  rowKey={(r) => r.path}
                  exportName="paginas-de-entrada"
                  cols={[
                    { label: 'Página', value: (r) => r.path, csv: (r) => r.path },
                    { label: 'Leads', value: (r) => num(r.leads), right: true, csv: (r) => r.leads },
                    { label: 'Sem anúncio', value: (r) => num(r.organic), right: true, csv: (r) => r.organic },
                    { label: 'Vendas', value: (r) => num(r.sales), right: true, csv: (r) => r.sales },
                    { label: 'Faturamento', value: (r) => money(r.revenue), right: true, csv: (r) => r.revenue },
                  ]}
                />
              </TabsContent>
            </Tabs>
            {can('relatorios') && (
              <p className="text-xs text-muted-foreground">
                Sessões, usuários e origem/mídia do Google Analytics 4 estão em{' '}
                <Link to="/relatorios" className="underline">
                  Relatórios
                </Link>
                .
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
