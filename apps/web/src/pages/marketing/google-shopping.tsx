import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon, PlayIcon, SettingsIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money } from '@/lib/format'

interface Config {
  enabled: boolean
  merchantId: string
  developerEmail?: string
  service: string
  handlingMin: number
  handlingMax: number
  batchSize: number
  ceps: Record<string, string[]>
  source: 'magazord' | 'crm'
  unitId: string | null
  carrierIds: string[]
  magazordPerMinute: number
  refreshDays: number
  dataSource: string | null
  preparedAt: string | null
  lastRunAt: string | null
  lastError: string | null
  lastSummary: string | null
  resumeAt: string | null
}
interface View {
  config: Config
  serviceAccount: string | null
  running: boolean
  progress: { done: number; total: number; source: string } | null
  preparing?: boolean
  estimate: { calls: number; products: number; minutes: number }
  units: { id: string; name: string; zip: string | null; city: string | null; state: string | null }[]
  carriers: { id: string; name: string }[]
  totals: { products: number; withSku: number; sent: number; errors: number }
  recent: { offerId: string; title: string | null; sku: string | null; states: number; min: number | null; max: number | null; sentAt: string | null; error: string | null }[]
}

const KEY = ['marketing', 'google-shopping-frete']
const cepsText = (c: Record<string, string[]>) =>
  Object.entries(c)
    .map(([uf, list]) => `${uf}=${list.map((x) => x.replace(/^(\d{5})(\d{3})$/, '$1-$2')).join(', ')}`)
    .join('\n')
const parseCeps = (t: string) => {
  const out: Record<string, string[]> = {}
  for (const line of t.split('\n')) {
    const m = /^\s*([A-Za-z]{2})\s*[=:]\s*(.+)$/.exec(line)
    if (m) out[m[1]!.toUpperCase()] = m[2]!.split(/[,;\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 8)
  }
  return out
}

const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`)

/** Mesma conta do servidor (estimateRun): uma consulta por CEP de cada estado e ~1,1 s por envio ao Google. */
function estimate(f: { cepsText: string; batchSize: number; magazordPerMinute: number; source: string }, linked: number) {
  const ceps = parseCeps(f.cepsText)
  const calls = UFS.reduce((n, uf) => n + Math.max(1, Math.min(5, ceps[uf]?.length ?? 0)), 0)
  const products = f.source === 'crm' ? linked : Math.min(Number(f.batchSize) || 0, linked || Number(f.batchSize) || 0)
  const gap = Math.ceil(60_000 / Math.max(1, Number(f.magazordPerMinute) || 1))
  const ms = products * 1_100 + products * calls * (f.source === 'crm' ? 20 : gap)
  return { calls, products, minutes: Math.ceil(ms / 60_000) }
}
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

export function GoogleShoppingPage() {
  return (
    <RequirePermission module="mi_config">
      <GoogleShopping />
    </RequirePermission>
  )
}

function GoogleShopping() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const edit = can('mi_config', 'edit')
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<View>('/marketing/google-shopping/frete'), refetchInterval: (s) => (s.state.data?.running || s.state.data?.preparing ? 5_000 : false) })
  const [form, setForm] = useState<(Config & { cepsText: string }) | null>(null)
  useEffect(() => {
    if (q.data && !form) setForm({ ...q.data.config, cepsText: cepsText(q.data.config.ceps) })
  }, [q.data, form])
  const save = useMutation({
    mutationFn: () => api.put<View>('/marketing/google-shopping/frete', { enabled: form!.enabled, merchantId: form!.merchantId, developerEmail: (form!.developerEmail ?? '').trim(), service: form!.service, handlingMin: Number(form!.handlingMin), handlingMax: Number(form!.handlingMax), batchSize: Number(form!.batchSize), magazordPerMinute: Number(form!.magazordPerMinute), refreshDays: Number(form!.refreshDays), source: form!.source, unitId: form!.unitId || null, carrierIds: form!.carrierIds, ceps: parseCeps(form!.cepsText) }),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v)
      setForm({ ...v.config, cepsText: cepsText(v.config.ceps) })
      toast.success('Configuração salva.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const prepare = useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/marketing/google-shopping/frete/preparar'),
    onSuccess: (r) => {
      toast.info(r.started ? 'Preparando a conta no Google: leva alguns minutos (o Google limita os pedidos por minuto). Pode sair desta tela.' : 'A conta já está sendo preparada.')
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
  const run = useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/marketing/google-shopping/frete/atualizar'),
    onSuccess: (r) => {
      toast.success(r.started ? 'Atualização começou. Pode sair desta tela: o andamento aparece em Situação.' : 'Já existe uma atualização em andamento.')
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (q.isLoading || !form) return <TableSkeleton />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const v = q.data!
  const set = <K extends keyof typeof form>(k: K, val: (typeof form)[K]) => setForm({ ...form, [k]: val })
  const est = estimate(form, v.totals.withSku)
  const crm = form.source === 'crm'

  return (
    <div className="space-y-6">
      <PageHeader title="Frete no Google Shopping" description="O frete de cada produto é calculado para os estados (na Magazord, igual ao carrinho, ou pelas tabelas de Fretes do CRM) e enviado ao Google Merchant Center. A Magazord continua mandando os produtos; o CRM só acrescenta o frete." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuração</CardTitle>
            <CardDescription>
              Antes: no Merchant Center, em Configurações › Pessoas e acesso, adicione {v.serviceAccount ? <strong className="break-all">{v.serviceAccount}</strong> : 'a conta de serviço do Google Analytics (Configurações › Google Analytics)'} como Administrador.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Atualizar o frete toda noite
              <Switch checked={form.enabled} onCheckedChange={(on) => set('enabled', on)} disabled={!edit} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mc-id">Número da conta do Merchant Center</Label>
                <Input id="mc-id" inputMode="numeric" value={form.merchantId} onChange={(e) => set('merchantId', e.target.value.replace(/\D/g, ''))} disabled={!edit} placeholder="Ex.: 123456789" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-dev">E-mail Google de quem administra o Merchant Center</Label>
                <Input id="mc-dev" type="email" maxLength={120} value={form.developerEmail ?? ''} onChange={(e) => set('developerEmail', e.target.value)} disabled={!edit} placeholder="voce@gmail.com" />
                <p className="text-xs text-muted-foreground">Uma pessoa (não a conta de serviço) que seja Administrador em Pessoas e acesso. O Google usa só para o registro do CRM como desenvolvedor.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-service">Nome do serviço de entrega</Label>
                <Input id="mc-service" maxLength={60} value={form.service} onChange={(e) => set('service', e.target.value)} disabled={!edit} />
              </div>
              <div className="space-y-1.5">
                <Label>Prazo para postar (dias úteis)</Label>
                <div className="flex items-center gap-2 text-sm">
                  de <Input aria-label="Mínimo" type="number" min={0} max={30} className="w-20" value={form.handlingMin} onChange={(e) => set('handlingMin', Number(e.target.value))} disabled={!edit} />
                  a <Input aria-label="Máximo" type="number" min={0} max={30} className="w-20" value={form.handlingMax} onChange={(e) => set('handlingMax', Number(e.target.value))} disabled={!edit} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-refresh">Refazer cada produto a cada (dias)</Label>
                <Input id="mc-refresh" type="number" min={1} max={60} className="w-24" value={form.refreshDays} onChange={(e) => set('refreshDays', Number(e.target.value))} disabled={!edit} />
                <p className="text-xs text-muted-foreground">Produto sem mudança de preço{crm ? ', peso, medidas ou tabela' : ''} fica de fora até lá.</p>
              </div>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="mc-source">Fonte do frete</Label>
              <select id="mc-source" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.source} onChange={(e) => set('source', e.target.value === 'crm' ? 'crm' : 'magazord')} disabled={!edit}>
                <option value="magazord">Magazord: igual ao carrinho da loja (recomendado)</option>
                <option value="crm">CRM: tabelas das transportadoras cadastradas em Fretes</option>
              </select>
              {crm ? (
                <>
                  <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>O Google exige que o frete do anúncio seja igual ao cobrado no carrinho da loja. Se as tabelas do CRM forem diferentes das da Magazord, o Google pode reprovar produtos ou advertir a conta.</span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-unit">Filial de origem</Label>
                      <select id="mc-unit" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.unitId ?? ''} onChange={(e) => set('unitId', e.target.value || null)} disabled={!edit}>
                        <option value="">Escolha…</option>
                        {v.units.map((u) => (
                          <option key={u.id} value={u.id} disabled={!u.zip}>
                            {u.name}
                            {u.city ? ` (${u.city}${u.state ? `/${u.state}` : ''})` : ''}
                            {u.zip ? '' : ' (sem CEP de expedição)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-sm font-medium">Transportadoras</span>
                      <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                        {v.carriers.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma transportadora ativa em Fretes.</p>}
                        {v.carriers.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={form.carrierIds.includes(c.id)} onCheckedChange={(on) => set('carrierIds', on ? [...form.carrierIds, c.id] : form.carrierIds.filter((x) => x !== c.id))} disabled={!edit} />
                            {c.name}
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Nenhuma marcada: todas as ativas da filial. Vale a opção mais barata.</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">O peso e as medidas (altura, largura e comprimento, para a cubagem) vêm do cadastro do produto na Magazord, lidos aos poucos depois da cópia diária do Catálogo. Sem peso na Magazord, vale o peso bruto da Tcar; sem nenhum dos dois, o produto fica de fora. Todos os produtos são calculados em cada rodada.</p>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-batch">Produtos por noite</Label>
                    <Input id="mc-batch" type="number" min={10} max={2000} value={form.batchSize} onChange={(e) => set('batchSize', Number(e.target.value))} disabled={!edit} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-rate">Consultas por minuto na Magazord</Label>
                    <Input id="mc-rate" type="number" min={5} max={120} value={form.magazordPerMinute} onChange={(e) => set('magazordPerMinute', Number(e.target.value))} disabled={!edit} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Acima do limite a Magazord recusa (429): o CRM espera e tenta de novo, e diminui o ritmo sozinho.</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Estimativa da rodada: {est.products} produto(s) × {est.calls} {crm ? 'cálculos' : 'consultas'} ≈ <strong>{duration(est.minutes)}</strong>.
                {!crm && est.minutes > 240 ? ' Passa de 4 horas: diminua os produtos por noite ou os CEPs por estado.' : ''}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-ceps">CEPs por estado (opcional)</Label>
              <Textarea id="mc-ceps" rows={4} value={form.cepsText} onChange={(e) => set('cepsText', e.target.value)} disabled={!edit} placeholder={'SC=88010-000, 89874-000\nPR=80010-000, 85801-000'} />
              <p className="text-xs text-muted-foreground">Um estado por linha (até 5 CEPs). Vazio: o centro da capital. Com mais de um CEP, vale o frete mais alto (o anúncio nunca mostra menos que o carrinho), mas cada CEP a mais é uma consulta a mais por produto.</p>
            </div>
          </CardContent>
          {edit && (
            <CardFooter>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
              </Button>
            </CardFooter>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Situação</CardTitle>
            <CardDescription>Cada noite o CRM atualiza os produtos que estão há mais tempo sem atualizar{v.config.source === 'crm' ? ' (fonte: tabelas do CRM)' : ' (fonte: Magazord)'}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center gap-2">
              {v.config.dataSource ? <CheckCircle2Icon className="size-4 text-[#006300]" aria-hidden /> : <SettingsIcon className="size-4 text-muted-foreground" aria-hidden />}
              {v.config.dataSource ? `Conta preparada em ${formatDateTime(v.config.preparedAt)} (fonte "CRM - Frete por estado").` : 'Conta ainda não preparada.'}
            </p>
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">Produtos no Google</span>
                <strong className="text-lg tabular-nums">{v.totals.products}</strong>
              </li>
              <li className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">Ligados à Magazord</span>
                <strong className="text-lg tabular-nums">{v.totals.withSku}</strong>
              </li>
              <li className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">Com frete enviado</span>
                <strong className="text-lg tabular-nums">{v.totals.sent}</strong>
              </li>
              <li className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">Com erro</span>
                <strong className="text-lg tabular-nums">{v.totals.errors}</strong>
              </li>
            </ul>
            {v.config.lastRunAt && <p className="text-xs text-muted-foreground">Última rodada: {formatDateTime(v.config.lastRunAt)}</p>}
            {v.config.lastSummary && <p className="text-xs text-muted-foreground">{v.config.lastSummary}</p>}
            {v.config.lastError && !v.preparing && <p className="text-xs text-destructive">{v.config.lastError}</p>}
            {v.preparing && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Preparando a conta no Google (alguns minutos)…
              </p>
            )}
            {v.running && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Atualizando{v.progress ? `: ${v.progress.done} de ${v.progress.total} produto(s)` : '…'}
              </p>
            )}
          </CardContent>
          {edit && (
            <CardFooter className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => prepare.mutate()} disabled={prepare.isPending || !!v.preparing || !v.config.merchantId}>
                {prepare.isPending || v.preparing ? <Loader2Icon className="animate-spin" /> : <SettingsIcon />} Preparar a conta
              </Button>
              <Button onClick={() => run.mutate()} disabled={run.isPending || v.running || !v.config.dataSource}>
                {run.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Atualizar agora
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
      {v.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos produtos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Estados</TableHead>
                    <TableHead className="text-right">Frete (menor – maior)</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.recent.map((r) => (
                    <TableRow key={r.offerId}>
                      <TableCell>
                        <span className="font-medium">{r.title ?? r.offerId}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.offerId}
                          {r.sku && r.sku !== r.offerId ? ` · SKU ${r.sku}` : ''}
                        </span>
                        {r.error && <span className="block text-xs text-destructive">{r.error}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.states || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.min === null ? '—' : `${money(r.min)} – ${money(r.max)}`}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.sentAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
