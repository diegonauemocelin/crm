import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import type { MagazordConfig } from '@/lib/rastreamento'
import { FormError } from '../auth/auth-layout'

const NONE = '__none__'

export function MagazordTab() {
  const q = useQuery({
    queryKey: ['magazord-config'],
    queryFn: () => api.get<MagazordConfig>('/integracoes/magazord'),
    // Enquanto sincroniza, acompanha o andamento.
    refetchInterval: (query) => (query.state.data?.state.running ? 5_000 : 60_000),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <MagazordEditor key={`${q.data.hasToken}-${q.data.enabled}`} initial={q.data} />
      <SyncStatus config={q.data} />
    </div>
  )
}

function MagazordEditor({ initial }: { initial: MagazordConfig }) {
  const { can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const options = useOptions()
  const [form, setForm] = useState(initial)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [tagsText, setTagsText] = useState(initial.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof MagazordConfig>(k: K, v: MagazordConfig[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await api.put<MagazordConfig>('/integracoes/magazord', {
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        importCustomers: form.importCustomers,
        importOrders: form.importOrders,
        importCarts: form.importCarts,
        ownerId: form.ownerId,
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        abandonHours: form.abandonHours,
        cartMessage: form.cartMessage,
        coupon: form.coupon.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(password ? { password } : {}),
      })
      qc.setQueryData(['magazord-config'], saved)
      setToken('')
      setPassword('')
      toast.success(saved.enabled && !initial.enabled ? 'Integração ligada. A primeira sincronização começa em instantes.' : 'Loja virtual salva.')
      if (saved.enabled && !initial.enabled) await api.post('/integracoes/magazord/sincronizar').catch(() => undefined)
      void qc.invalidateQueries({ queryKey: ['magazord-config'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (k: 'importCustomers' | 'importOrders' | 'importCarts', label: string, help: string) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={`mz-${k}`}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={`mz-${k}`} checked={form[k]} onCheckedChange={(v) => set(k, v)} disabled={!canEdit} />
    </div>
  )

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Loja virtual (Magazord)
            <Badge variant={initial.enabled ? 'default' : 'outline'}>{initial.enabled ? 'Ligada' : 'Desligada'}</Badge>
          </CardTitle>
          <CardDescription>
            Traz os clientes cadastrados na loja para a base de leads (origem “Ecommerce”), os pedidos (o lead vira Cliente e a última compra vai para o histórico) e os carrinhos para recuperar vendas. Sincroniza a cada 10 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="mz-enabled">Integração ligada</Label>
              <p className="text-xs text-muted-foreground">Use o token e a senha do usuário WebService criado no painel da Magazord.</p>
            </div>
            <Switch id="mz-enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={!canEdit} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mz-url">Endereço do painel</Label>
              <Input id="mz-url" placeholder="https://usaparts.painel.magazord.com.br" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mz-token">Token</Label>
              <Input id="mz-token" type="password" autoComplete="off" placeholder={initial.hasToken ? '•••••••• (mantido)' : ''} value={token} onChange={(e) => setToken(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mz-pass">Senha</Label>
              <Input id="mz-pass" type="password" autoComplete="new-password" placeholder={initial.hasPassword ? '•••••••• (mantida)' : ''} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canEdit} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Token e senha ficam guardados criptografados e nunca são mostrados de novo. Deixe em branco para manter os atuais.</p>

          <div className="space-y-4 rounded-md border p-3">
            {toggle('importCustomers', 'Clientes da loja viram leads', 'Na primeira vez traz todos os cadastros; depois, só os novos e alterados.')}
            {toggle('importOrders', 'Pedidos', 'Pedido pago torna o lead Cliente, registra a compra e tira as tags de carrinho. Traz os últimos 2 anos.')}
            {toggle('importCarts', 'Carrinhos e checkout', 'Carrinhos de clientes identificados, com produtos e link para retomar a compra.')}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mz-owner">Responsável pelos leads novos</Label>
              <Select value={form.ownerId ?? NONE} onValueChange={(v) => set('ownerId', v === NONE ? null : v)} disabled={!canEdit}>
                <SelectTrigger id="mz-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem responsável</SelectItem>
                  {(options.data?.sellers ?? [])
                    .filter((s) => s.active || s.id === form.ownerId)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mz-tags">Tags aplicadas</Label>
              <Input id="mz-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mz-hours">Carrinho parado vira abandonado após (horas)</Label>
              <Input id="mz-hours" type="number" min={1} max={168} className="w-28" value={form.abandonHours} onChange={(e) => set('abandonHours', Number(e.target.value))} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mz-coupon">Cupom de recuperação</Label>
              <Input id="mz-coupon" placeholder="VOLTA10" maxLength={40} value={form.coupon} onChange={(e) => set('coupon', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mz-msg">Mensagem de WhatsApp para carrinho abandonado</Label>
              <Textarea id="mz-msg" rows={3} maxLength={1000} value={form.cartMessage} onChange={(e) => set('cartMessage', e.target.value)} disabled={!canEdit} />
              <p className="text-xs text-muted-foreground">Variáveis: {'{nome}'}, {'{produtos}'}, {'{cupom}'} e {'{link}'} (link que reabre o carrinho do cliente).</p>
            </div>
          </div>
          <FormError message={error} />
        </CardContent>
        {canEdit && (
          <CardFooter className="mt-4">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

function SyncStatus({ config }: { config: MagazordConfig }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)
  const [checks, setChecks] = useState<{ name: string; ok: boolean; message: string }[] | null>(null)
  const st = config.state
  const ready = config.hasToken && config.hasPassword && !!config.baseUrl

  const test = async () => {
    setBusy('test')
    setChecks(null)
    try {
      setChecks((await api.post<{ checks: { name: string; ok: boolean; message: string }[] }>('/integracoes/magazord/testar')).checks)
    } catch (err) {
      setChecks([{ name: 'Conexão', ok: false, message: errorMessage(err) }])
    } finally {
      setBusy(null)
    }
  }
  const sync = async () => {
    setBusy('sync')
    try {
      await api.post('/integracoes/magazord/sincronizar')
      toast.success('Sincronização iniciada.')
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['magazord-config'] }), 1500)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Sincronização</CardTitle>
        <CardDescription>
          {st.running ? 'Sincronizando agora…' : st.lastOkAt ? `Última sincronização completa: ${formatDateTime(st.lastOkAt)}` : 'Ainda não sincronizou.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['Clientes lidos', st.totals.customers],
            ['Leads novos criados', st.totals.leadsCreated],
            ['Pedidos lidos', st.totals.orders],
            ['Carrinhos lidos', st.totals.carts],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-lg font-semibold tabular-nums">{int.format(v as number)}</dd>
            </div>
          ))}
        </dl>
        {!st.customersBackfillDone && st.customersPage > 1 && (
          <p className="text-sm text-muted-foreground">Carga inicial de clientes em andamento: página {int.format(st.customersPage - 1)} concluída (100 clientes por página).</p>
        )}
        {st.lastError && (
          <p role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            {st.lastError}
          </p>
        )}
        {checks && (
          <ul className="space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                {c.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <span>
                  <strong>{c.name}:</strong> {c.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          O usuário WebService precisa de permissão de leitura (GET) em: /api/v2/site/pessoa, /api/v2/site/pedido, /api/v2/site/carrinho e /api/v2/site/carrinho/…/itens.
        </p>
      </CardContent>
      {can('configuracoes', 'edit') && (
        <CardFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => void test()} disabled={busy !== null || !ready}>
            {busy === 'test' ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            Testar conexão
          </Button>
          <Button variant="outline" onClick={() => void sync()} disabled={busy !== null || !config.enabled || st.running}>
            {busy === 'sync' || st.running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            Sincronizar agora
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
