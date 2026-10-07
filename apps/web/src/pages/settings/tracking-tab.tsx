import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, CircleDashedIcon, KeyRoundIcon, Loader2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { HBar } from '@/components/atendimento/dashboard'
import { CopyField } from '@/components/copy-field'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { DEVICE_LABEL, mediumLabel, pathOf, SHOP_LABEL, type TrackingConfig, type TrackingSummary } from '@/lib/rastreamento'
import { FormError } from '../auth/auth-layout'

export function TrackingTab() {
  const q = useQuery({ queryKey: ['tracking-config'], queryFn: () => api.get<TrackingConfig>('/rastreamento/config') })
  const { can } = useAuth()
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={5} />
  return (
    <div className="space-y-4">
      <TrackingEditor key={q.data.siteKey} initial={q.data} />
      {can('leads', 'view') && q.data.enabled && <TrackingSummaryView />}
    </div>
  )
}

function TrackingEditor({ initial }: { initial: TrackingConfig }) {
  const { can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const [form, setForm] = useState(initial)
  const [domainsText, setDomainsText] = useState(initial.domains.join('\n'))
  const [appText, setAppText] = useState((initial.appMarkers ?? []).join(', '))
  const [busy, setBusy] = useState<'save' | 'key' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const domains = domainsText.split(/[\n,;]/).map((d) => d.trim()).filter(Boolean)
      const appMarkers = appText.split(',').map((m) => m.trim()).filter(Boolean)
      const saved = await api.put<TrackingConfig>('/rastreamento/config', { enabled: form.enabled, domains, requireConsent: form.requireConsent, retentionDays: form.retentionDays, appMarkers })
      qc.setQueryData(['tracking-config'], saved)
      setForm(saved)
      setDomainsText(saved.domains.join('\n'))
      toast.success('Rastreamento salvo.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const rotate = async () => {
    setBusy('key')
    try {
      const saved = await api.post<TrackingConfig>('/rastreamento/config/nova-chave')
      qc.setQueryData(['tracking-config'], saved)
      toast.success('Chave trocada. Substitua o código no site.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
      setConfirmKey(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle>Rastreamento do site</CardTitle>
            <CardDescription>
              Registra as páginas visitadas e de onde o visitante veio (Google, anúncios, redes sociais, e-mail, UTMs). Quando o visitante vira lead, as visitas aparecem na ficha e contam no lead scoring.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="t-enabled">Rastreamento ligado</Label>
                <p className="text-xs text-muted-foreground">Desligado, o código no site não envia nada.</p>
              </div>
              <Switch id="t-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-domains">Domínios do site</Label>
              <textarea
                id="t-domains"
                rows={3}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                placeholder={'usaparts.com.br\nwww.usaparts.com.br'}
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">Um por linha. Subdomínios entram junto (usaparts.com.br aceita www.usaparts.com.br). Visitas de outros endereços são ignoradas.</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="t-consent">Só depois do aceite de cookies</Label>
                <p className="text-xs text-muted-foreground">
                  Ligue se o site tem banner de cookies: o rastreamento começa quando o visitante aceitar. O banner precisa chamar <code className="rounded bg-muted px-1">usaCrm(&apos;consent&apos;, true)</code>.
                </p>
              </div>
              <Switch id="t-consent" checked={form.requireConsent} onCheckedChange={(v) => setForm({ ...form, requireConsent: v })} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-app">Identificação do app da loja (opcional)</Label>
              <Input id="t-app" placeholder="ex.: UsaPartsApp" value={appText} onChange={(e) => setAppText(e.target.value)} disabled={!canEdit} />
              <p className="text-xs text-muted-foreground">
                O app é reconhecido automaticamente quando abre o site por dentro (WebView). Se o fornecedor do app informar um texto próprio no navegador dele, coloque aqui (separe por vírgula).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-retention">Guardar páginas visitadas por (dias)</Label>
              <Input id="t-retention" type="number" className="w-32" min={30} max={1095} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} disabled={!canEdit} />
              <p className="text-xs text-muted-foreground">Depois disso, o histórico detalhado é apagado (LGPD). As visitas já registradas na linha do tempo dos leads continuam.</p>
            </div>
            <FormError message={error} />
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Instalação</CardTitle>
          <CardDescription>Cole este código no site, antes de &lt;/head&gt;, em todas as páginas: no campo de scripts do cabeçalho da loja ou como “HTML personalizado” no Google Tag Manager.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyField id="t-snippet" value={initial.snippet} multiline />
          <InstallStatus enabled={initial.enabled} />
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Os visitantes são ligados aos leads quando clicam em links dos e-mails do CRM (parâmetro crm_lid) e, na próxima fase, quando preenchem formulários.</p>
            <p>Navegadores com “Global Privacy Control” ligado não são rastreados.</p>
          </div>
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmKey(true)} disabled={busy !== null}>
              <KeyRoundIcon /> Trocar chave do site
            </Button>
          </CardFooter>
        )}
      </Card>

      <AlertDialog open={confirmKey} onOpenChange={setConfirmKey}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar a chave do site?</AlertDialogTitle>
            <AlertDialogDescription>O código atual para de funcionar na hora. Use só se o código foi colado num site que não é seu. Depois, cole o código novo no site.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotate()}>Trocar chave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InstallStatus({ enabled }: { enabled: boolean }) {
  const { can } = useAuth()
  const q = useQuery({
    queryKey: ['tracking-summary', 30],
    queryFn: () => api.get<TrackingSummary>('/rastreamento/resumo?dias=30'),
    enabled: enabled && can('leads', 'view'),
    refetchInterval: 30_000,
  })
  if (!enabled) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleDashedIcon className="size-4" /> Rastreamento desligado.</p>
  const last = q.data?.lastHit
  return last ? (
    <p className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <span>
        Funcionando. Última página recebida em {formatDateTime(last.occurredAt)}: <span className="break-all">{pathOf(last.url)}</span>
      </span>
    </p>
  ) : (
    <p className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
      <CircleDashedIcon className="size-4 shrink-0" /> Aguardando a primeira visita. Depois de colar o código, abra o site: em alguns segundos aparece aqui.
    </p>
  )
}

const spDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function TrackingSummaryView() {
  const q = useQuery({ queryKey: ['tracking-summary', 30], queryFn: () => api.get<TrackingSummary>('/rastreamento/resumo?dias=30'), refetchInterval: 30_000 })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  const d = q.data
  // Dias sem visita aparecem como zero (a série não "pula" dias). Referência: o momento da consulta.
  const byDay = new Map(d.perDay.map((p) => [p.day, p]))
  const series = Array.from({ length: d.days }, (_, i) => {
    const day = spDay(new Date(q.dataUpdatedAt - (d.days - 1 - i) * 86_400_000))
    return { day, visits: byDay.get(day)?.visits ?? 0 }
  })
  const visits = d.perDay.reduce((s, p) => s + p.visits, 0)
  const pageviews = d.perDay.reduce((s, p) => s + p.pageviews, 0)
  const config: ChartConfig = { visits: { label: 'Visitas', color: 'var(--chart-1)' } }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Visitas (30 dias)', visits],
          ['Páginas vistas', pageviews],
          ['Visitantes', d.visitors],
          ['Identificados como lead', d.identified],
        ].map(([k, v]) => (
          <Card key={k as string} className="py-4">
            <CardContent>
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-2xl font-semibold tabular-nums">{int.format(v as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visitas por dia</CardTitle>
          <CardDescription>Uma visita = uma sessão (até 30 minutos sem atividade).</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="aspect-auto h-56 w-full">
            <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortDay} />
              <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTooltipContent hideIndicator labelFormatter={(v) => shortDay(String(v))} />} />
              <Bar dataKey="visits" fill="var(--color-visits)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <HBar
          title="Visitas por dispositivo"
          description="Celular, computador, tablet ou app da loja."
          valueLabel="Visitas"
          data={d.devices.map((x) => ({ name: DEVICE_LABEL[x.device] ?? x.device, value: x.visits }))}
        />
        <HBar
          title="Leads por dispositivo"
          description="Leads identificados no período, pelo dispositivo da primeira visita."
          valueLabel="Leads"
          data={d.leadDevices.map((x) => ({ name: DEVICE_LABEL[x.device] ?? x.device, value: x.leads }))}
        />
      </div>
      <HBar
        title="Funil da loja"
        description="Visitantes que fizeram cada etapa no período (eventos publicados pela loja)."
        valueLabel="Visitantes"
        data={['add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'].map((k) => ({ name: SHOP_LABEL[k] ?? k, value: d.shop[k] ?? 0 }))}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <HBar title="De onde vêm as visitas" description="Fonte e meio (UTMs, buscadores, redes sociais)." valueLabel="Visitas" data={d.sources.map((s) => ({ name: s.source === 'direto' ? 'Acesso direto' : `${s.source} · ${mediumLabel(s.medium)}`, value: s.visits }))} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Páginas mais vistas</CardTitle>
          </CardHeader>
          <CardContent>
            {d.pages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {d.pages.map((p) => (
                  <li key={p.url} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate" title={p.url}>
                      {pathOf(p.url)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{int.format(p.views)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
