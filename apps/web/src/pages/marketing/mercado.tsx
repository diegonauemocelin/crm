import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, ExternalLinkIcon, LightbulbIcon, Loader2Icon, PackageSearchIcon, SparklesIcon, StoreIcon, TrendingUpIcon, UsersIcon, WrenchIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, money, num } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Config {
  company: string
  segment: string
  region: string
  competitors: string[]
  focus: string
}
interface Row {
  id: string
  status: 'GERANDO' | 'PRONTO' | 'ERRO'
  error: string | null
  model: string | null
  createdBy: string | null
  createdAt: string
  finishedAt: string | null
}
interface View {
  config: Config
  ai: 'gemini' | 'claude' | null
  analyses: Row[]
}
type Item = { titulo: string; detalhe: string }
interface Analysis extends Row {
  sources: string[]
  snapshot: {
    periodDays: number
    channels: { canal: string; pedidos: number; faturamento: number }[]
    leads: number
    leadStates: { uf: string; leads: number }[]
    topBrands: { marca: string; unidades: number }[]
    topProducts: { produto: string; unidades: number; canal: string }[]
  } | null
  reading: {
    resumo: string
    produtos: Item[]
    concorrentes: { nome: string; site: string | null; detalhe: string }[]
    canais: { canal: string; detalhe: string }[]
    melhorar: Item[]
    atencao: Item[]
    oportunidades: Item[]
  } | null
}

export function MercadoPage() {
  return (
    <RequirePermission module="mi_mercado">
      <Market />
    </RequirePermission>
  )
}

/** Análise de mercado fora dos marketplaces: números do CRM + IA com pesquisa na web. */
function Market() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['mercado'], queryFn: () => api.get<View>('/mercado'), refetchInterval: (x) => (x.state.data?.analyses.some((a) => a.status === 'GERANDO') ? 5000 : false) })
  const [picked, setPicked] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => api.post<Row>('/mercado/analises'),
    onSuccess: (a) => {
      toast.success('Análise começou. Leva alguns minutos: a IA pesquisa o mercado na web.')
      setPicked(a.id)
      void qc.invalidateQueries({ queryKey: ['mercado'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = q.data
  const current = picked ?? d?.analyses.find((a) => a.status === 'PRONTO')?.id ?? d?.analyses[0]?.id ?? null
  const generating = d?.analyses.some((a) => a.status === 'GERANDO')
  return (
    <div className="space-y-5">
      <PageHeader
        title="Análise de mercado"
        description="O mercado fora dos marketplaces: produtos em alta, concorrentes, comparação de canais e pontos a melhorar. A IA cruza os números do CRM (só totais) com a pesquisa na web e mostra as fontes."
        actions={
          can('mi_mercado', 'create') && (
            <Button disabled={start.isPending || generating || !d?.ai || !d?.config.segment} onClick={() => start.mutate()} title={!d?.ai ? 'Cadastre a chave do Gemini ou do Claude' : !d?.config.segment ? 'Descreva o segmento primeiro' : undefined}>
              {start.isPending || generating ? <Loader2Icon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />} {generating ? 'Gerando…' : 'Gerar análise'}
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {!d.ai && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Para gerar, cadastre a chave do Gemini (gratuita) ou do Claude em Atendimento › Busca de leads › Configurações.</p>}
          <ConfigCard config={d.config} editable={can('mi_mercado', 'edit')} />
          {d.analyses.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Análises:</span>
              {d.analyses.map((a) => (
                <button key={a.id} type="button" onClick={() => setPicked(a.id)} className={cn('rounded-md border px-2 py-1', current === a.id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                  {dateTime(a.createdAt)}
                  {a.status === 'ERRO' ? ' · erro' : a.status === 'GERANDO' ? ' · gerando' : ''}
                </button>
              ))}
            </div>
          )}
          {current ? <AnalysisView id={current} /> : <EmptyState icon={TrendingUpIcon} title="Nenhuma análise ainda" description="Preencha o segmento e clique em Gerar análise." />}
        </>
      )}
    </div>
  )
}

function ConfigCard({ config, editable }: { config: Config; editable: boolean }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ ...config, competitors: config.competitors.join('\n') })
  const [open, setOpen] = useState(!config.segment)
  const save = useMutation({
    mutationFn: () => api.put<Config>('/mercado/config', { ...f, competitors: f.competitors.split('\n').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => {
      toast.success('Dados da análise salvos.')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['mercado'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
        <p className="min-w-0 flex-1">
          <span className="font-medium">{config.company || 'Empresa'}</span> · {config.segment} · {config.region}
          {config.competitors.length > 0 && <span className="text-muted-foreground"> · {config.competitors.length} concorrente(s) conhecido(s)</span>}
        </p>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Editar dados
          </Button>
        )}
      </div>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dados para a análise</CardTitle>
        <CardDescription>A IA usa isto para pesquisar o mercado certo. Quanto mais claro o segmento, melhor a análise.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mk-co">Empresa</Label>
          <Input id="mk-co" value={f.company} disabled={!editable} onChange={(e) => setF({ ...f, company: e.target.value })} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mk-reg">Região de atuação</Label>
          <Input id="mk-reg" value={f.region} disabled={!editable} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={200} placeholder="Ex.: Brasil e América Latina; foco no Sul" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="mk-seg">Segmento (o que vende e para quem) *</Label>
          <Textarea id="mk-seg" rows={2} value={f.segment} disabled={!editable} onChange={(e) => setF({ ...f, segment: e.target.value })} maxLength={500} placeholder="Ex.: importadora de peças e filtros para máquinas pesadas da linha amarela (escavadeiras, retroescavadeiras, pás carregadeiras), para oficinas, locadoras e construtoras" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mk-comp">Concorrentes que já conhece (um por linha, nome ou site)</Label>
          <Textarea id="mk-comp" rows={4} value={f.competitors} disabled={!editable} onChange={(e) => setF({ ...f, competitors: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mk-foc">Foco desta análise (opcional)</Label>
          <Textarea id="mk-foc" rows={4} value={f.focus} disabled={!editable} onChange={(e) => setF({ ...f, focus: e.target.value })} maxLength={500} placeholder="Ex.: material rodante; abrir vendas no Centro-Oeste" />
        </div>
        {editable && (
          <div className="flex justify-end gap-2 sm:col-span-2">
            {config.segment && (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            )}
            <Button disabled={save.isPending || !f.segment.trim()} onClick={() => save.mutate()}>
              {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Section({ icon: Icon, title, tone, children }: { icon: typeof TrendingUpIcon; title: string; tone?: 'good' | 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('size-4', tone === 'good' ? 'text-[#006300] dark:text-[#0ca30c]' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-primary')} aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

const Items = ({ list }: { list: Item[] }) =>
  list.length ? (
    <ul className="space-y-2.5">
      {list.map((x, i) => (
        <li key={i}>
          <p className="font-medium">{x.titulo}</p>
          {x.detalhe && <p className="text-muted-foreground">{x.detalhe}</p>}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground">Nada nesta parte.</p>
  )

function AnalysisView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['mercado', id], queryFn: () => api.get<Analysis>(`/mercado/analises/${id}`), refetchInterval: (x) => (x.state.data?.status === 'GERANDO' ? 5000 : false) })
  const a = q.data
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !a) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (a.status === 'GERANDO')
    return (
      <div className="flex items-center gap-3 rounded-lg border p-6 text-sm">
        <Loader2Icon className="size-5 animate-spin" aria-hidden /> A IA está pesquisando o mercado na web e lendo os números do CRM. Leva alguns minutos; pode sair desta tela.
      </div>
    )
  if (a.status === 'ERRO') return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">Não deu certo: {a.error}</p>
  const r = a.reading
  const s = a.snapshot
  if (!r) return null
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumo</CardTitle>
          <CardDescription>
            Gerada em {dateTime(a.createdAt)}
            {a.createdBy ? ` por ${a.createdBy}` : ''}
            {a.model ? ` · IA: ${a.model}` : ''}. Texto da IA: confira as fontes antes de decidir.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">{r.resumo}</CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={PackageSearchIcon} title="Produtos em alta no segmento">
          <Items list={r.produtos} />
        </Section>
        <Section icon={StoreIcon} title="Comparação de canais">
          {s && s.channels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {s.channels.map((c) => (
                <Badge key={c.canal} variant="outline" className="font-normal">
                  {c.canal}: {num(c.pedidos)} pedidos · {money(c.faturamento)}
                </Badge>
              ))}
              <Badge variant="outline" className="font-normal">
                Leads: {num(s.leads)} em {s.periodDays} dias
              </Badge>
            </div>
          )}
          <Items list={r.canais.map((c) => ({ titulo: c.canal, detalhe: c.detalhe }))} />
        </Section>
      </div>
      <Section icon={UsersIcon} title="Concorrentes">
        {r.concorrentes.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {r.concorrentes.map((c, i) => (
              <div key={i} className="rounded-md border p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  {c.nome}
                  {c.site && (
                    <a href={c.site} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`Abrir o site de ${c.nome}`}>
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  )}
                </p>
                {c.detalhe && <p className="text-muted-foreground">{c.detalhe}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">A pesquisa não trouxe concorrentes.</p>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section icon={WrenchIcon} title="Pontos a melhorar" tone="info">
          <Items list={r.melhorar} />
        </Section>
        <Section icon={AlertTriangleIcon} title="Pontos de atenção" tone="warn">
          <Items list={r.atencao} />
        </Section>
        <Section icon={LightbulbIcon} title="Oportunidades" tone="good">
          <Items list={r.oportunidades} />
        </Section>
      </div>
      {s && (s.topProducts.length > 0 || s.topBrands.length > 0 || s.leadStates.length > 0) && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Números do CRM usados na análise (últimos {s.periodDays} dias)</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1 font-medium">Produtos que mais saíram</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {s.topProducts.map((p, i) => (
                  <li key={i}>
                    {num(p.unidades)} un. · {p.produto} <span className="text-xs">({p.canal})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">Marcas (loja virtual)</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {s.topBrands.map((b) => (
                  <li key={b.marca}>
                    {b.marca}: {num(b.unidades)} un.
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">Estados com mais leads</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {s.leadStates.map((x) => (
                  <li key={x.uf}>
                    {x.uf}: {num(x.leads)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      )}
      {a.sources.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Fontes da pesquisa ({a.sources.length})</summary>
          <ul className="mt-2 space-y-1">
            {a.sources.map((u) => (
              <li key={u} className="truncate">
                <a href={u} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
