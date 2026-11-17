import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, PlugIcon, RefreshCwIcon, SaveIcon, SearchIcon, SendIcon, UnplugIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'

type Slug = 'shopee' | 'amazon' | 'tiktok-shop'
const MODULE: Record<Slug, string> = { shopee: 'mkt_shopee', amazon: 'mkt_amazon', 'tiktok-shop': 'mkt_tiktok' }
const NAME: Record<Slug, string> = { shopee: 'Shopee', amazon: 'Amazon', 'tiktok-shop': 'TikTok Shop' }
/** Onde a empresa cria o aplicativo de desenvolvedor (páginas oficiais). */
const PORTAL: Record<Slug, { label: string; url: string }> = {
  shopee: { label: 'Shopee Open Platform', url: 'https://open.shopee.com/' },
  amazon: { label: 'Amazon Seller Central (Developer Central)', url: 'https://sellercentral.amazon.com.br/sellingpartner/developerconsole' },
  'tiktok-shop': { label: 'TikTok Shop Partner Center', url: 'https://partner.tiktokshop.com/' },
}

interface AppField {
  key: string
  label: string
  secret: boolean
  help: string
  options?: { value: string; label: string }[]
}
interface View {
  channel: string
  label: string
  appFields: AppField[]
  app: { appId: string; hasSecret: boolean; extra: Record<string, string> } | null
  redirectUri: string
  loginUri: string | null
  connection: { shopId: string; shopName: string | null; expiresAt: string } | null
  fees: { feePct: number | null; feeFixed: number; shipping: number }
  listings: number
  lastSync: string | null
  syncing: boolean
  changes: { id: string; title: string; sku: string | null; oldPrice: string | null; newPrice: string; status: string; error: string | null; userName: string | null; createdAt: string }[]
  canEdit: boolean
}
interface Row {
  id: string
  listingId: string
  variationId: string | null
  sku: string | null
  title: string
  price: number | null
  stock: number | null
  status: string
  url: string | null
  cost: number | null
  taxLabel: string
  fee: number | null
  margin: { margin: number | null; marginPct: number | null; tax: number | null; missing: string[] } | null
  profitTarget: { value: number; source: string } | null
  suggestedPrice: number | null
}

const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const MISSING: Record<string, string> = { custo: 'custo', tarifa: 'comissão', frete: 'frete', imposto: 'imposto' }

/** Shopee, Amazon e TikTok Shop: conexão da loja, tarifas, anúncios com margem e preço sugerido, e mudança de preço. */
export function CanalPage() {
  const { pathname, search } = useLocation()
  const slug = (pathname.split('/')[2] ?? 'shopee') as Slug
  const step = pathname.split('/')[3]
  const q = useQuery({ queryKey: ['canal', slug], queryFn: () => api.get<View>(`/canais/${slug}`), refetchInterval: (x) => (x.state.data?.syncing ? 5000 : false) })
  return (
    <RequirePermission module={MODULE[slug]}>
      <PageHeader title={`${NAME[slug]}: anúncios e preços`} description={`Anúncios da ${NAME[slug]} com custo, comissão, frete, imposto e margem, o preço que deixa o mesmo lucro da venda por fora, e a mudança de preço direto na ${NAME[slug]}.`} />
      {(step === 'retorno' || step === 'login') && <Retorno slug={slug} step={step} search={search} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <TableSkeleton />}
      {q.data && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Conexao slug={slug} v={q.data} />
            <Tarifas slug={slug} v={q.data} />
          </div>
          {q.data.connection && <Anuncios slug={slug} v={q.data} />}
          {!!q.data.changes.length && <Historico v={q.data} />}
        </div>
      )}
    </RequirePermission>
  )
}

/** Volta da plataforma (e o Log-in URI da Amazon): manda os parâmetros ao CRM uma vez e segue. */
function Retorno({ slug, step, search }: { slug: Slug; step: string; search: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const done = useRef(false)
  const [msg, setMsg] = useState('Confirmando a conexão…')
  useEffect(() => {
    if (done.current) return
    done.current = true
    const params = Object.fromEntries(new URLSearchParams(search).entries())
    if (step === 'login') {
      api
        .post<{ url: string }>(`/canais/${slug}/login`, { params })
        .then((r) => window.location.assign(r.url))
        .catch((e) => setMsg(errorMessage(e)))
      return
    }
    api
      .post<{ shopName: string | null; shopId: string }>(`/canais/${slug}/retorno`, { params })
      .then((r) => {
        toast.success(`Loja conectada: ${r.shopName ?? r.shopId}. Lendo os anúncios…`)
        void qc.invalidateQueries({ queryKey: ['canal', slug] })
        navigate(`/marketplaces/${slug}`, { replace: true })
      })
      .catch((e) => setMsg(errorMessage(e)))
  }, [slug, step, search, navigate, qc])
  return (
    <Card className="mb-4">
      <CardContent className="flex items-center gap-2 py-4 text-sm">
        {msg.startsWith('Confirmando') && <Loader2Icon className="animate-spin" aria-hidden />} {msg}
      </CardContent>
    </Card>
  )
}

function Conexao({ slug, v }: { slug: Slug; v: View }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [form, setForm] = useState<Record<string, string>>({ appId: v.app?.appId ?? '', appSecret: '', ...(v.app?.extra ?? {}) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['canal', slug] })
  const save = useMutation({
    mutationFn: () => {
      const extra = Object.fromEntries(v.appFields.filter((f) => f.key !== 'appId' && f.key !== 'appSecret').map((f) => [f.key, form[f.key] ?? f.options?.[0]?.value ?? '']))
      return api.put(`/canais/${slug}/aplicativo`, { appId: form.appId, ...(form.appSecret ? { appSecret: form.appSecret } : {}), extra })
    },
    onSuccess: () => (toast.success('Chaves do aplicativo salvas.'), setForm((f) => ({ ...f, appSecret: '' })), void refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const connect = useMutation({ mutationFn: () => api.post<{ url: string }>(`/canais/${slug}/conectar`), onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast.error(errorMessage(e)) })
  const disconnect = useMutation({ mutationFn: () => api.delete(`/canais/${slug}/conexao`), onSuccess: () => (toast.success('Desconectada.'), void refresh()), onError: (e) => toast.error(errorMessage(e)) })
  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => toast.success('Copiado.'))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugIcon className="size-4" aria-hidden /> Conexão com a {v.label}
        </CardTitle>
        <CardDescription>
          {v.connection ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2Icon className="size-4" aria-hidden /> Conectada: {v.connection.shopName ?? v.connection.shopId}
            </span>
          ) : (
            'Ainda não conectada. Cadastre as chaves do aplicativo e clique em Conectar.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-md border bg-muted/40 p-3 text-xs">
          <p>
            1. Crie o aplicativo de desenvolvedor da empresa em{' '}
            <a href={PORTAL[slug].url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium underline">
              {PORTAL[slug].label} <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
            .
          </p>
          <p className="mt-1">
            2. Cadastre lá o endereço de retorno:{' '}
            <button type="button" className="font-mono underline" onClick={() => copy(v.redirectUri)}>
              {v.redirectUri}
            </button>
          </p>
          {v.loginUri && (
            <p className="mt-1">
              Log-in URI (Amazon):{' '}
              <button type="button" className="font-mono underline" onClick={() => copy(v.loginUri!)}>
                {v.loginUri}
              </button>
            </p>
          )}
          <p className="mt-1">3. Cole as chaves abaixo (ficam guardadas criptografadas) e clique em Conectar.</p>
        </div>
        {v.appFields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`app-${f.key}`}>{f.label}</Label>
            {f.options?.length ? (
              <Select value={(form[f.key] ?? f.options[0]!.value) || '_'} onValueChange={(x) => setForm((s) => ({ ...s, [f.key]: x === '_' ? '' : x }))} disabled={!v.canEdit}>
                <SelectTrigger id={`app-${f.key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o.value || '_'} value={o.value || '_'}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`app-${f.key}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                disabled={!v.canEdit}
                placeholder={f.secret && v.app?.hasSecret ? '•••••• (guardada; preencha só para trocar)' : ''}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            )}
            <p className="text-xs text-muted-foreground">{f.help}</p>
          </div>
        ))}
        {v.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
              <KeyRoundIcon aria-hidden /> Salvar chaves
            </Button>
            <Button disabled={!v.app || connect.isPending} onClick={() => connect.mutate()}>
              <PlugIcon aria-hidden /> {v.connection ? 'Conectar de novo' : 'Conectar'}
            </Button>
            {v.connection && (
              <Button
                variant="ghost"
                disabled={disconnect.isPending}
                onClick={async () => {
                  if (await confirm({ title: `Desconectar a ${v.label}?`, description: 'O CRM para de ler os anúncios e de mudar preços. Nada é alterado na loja.', confirmLabel: 'Desconectar' })) disconnect.mutate()
                }}
              >
                <UnplugIcon aria-hidden /> Desconectar
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Tarifas({ slug, v }: { slug: Slug; v: View }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ feePct: v.fees.feePct === null ? '' : String(v.fees.feePct), feeFixed: String(v.fees.feeFixed), shipping: String(v.fees.shipping) })
  const save = useMutation({
    mutationFn: () => api.put(`/canais/${slug}/tarifas`, { feePct: f.feePct === '' ? null : Number(f.feePct.replace(',', '.')), feeFixed: Number(f.feeFixed.replace(',', '.')) || 0, shipping: Number(f.shipping.replace(',', '.')) || 0 }),
    onSuccess: () => (toast.success('Tarifas salvas.'), void qc.invalidateQueries({ queryKey: ['canal-anuncios', slug] }), void qc.invalidateQueries({ queryKey: ['canal', slug] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tarifas da {v.label}</CardTitle>
        <CardDescription>
          As do contrato da sua loja (a {v.label} não informa a tarifa antes da venda pela API). Custo, imposto, lucro do produto, custo fixo e outras taxas vêm de Mercado Livre › Preços e promoções.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="fee-pct">Comissão (%)</Label>
            <Input id="fee-pct" inputMode="decimal" disabled={!v.canEdit} value={f.feePct} placeholder="Ex.: 20" onChange={(e) => setF((s) => ({ ...s, feePct: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-fixed">Taxa fixa por item (R$)</Label>
            <Input id="fee-fixed" inputMode="decimal" disabled={!v.canEdit} value={f.feeFixed} onChange={(e) => setF((s) => ({ ...s, feeFixed: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-ship">Frete pago pela loja (R$)</Label>
            <Input id="fee-ship" inputMode="decimal" disabled={!v.canEdit} value={f.shipping} onChange={(e) => setF((s) => ({ ...s, shipping: e.target.value }))} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Preço sugerido = (custo + lucro + taxa fixa + frete) ÷ (1 − comissão − imposto − outras taxas), com centavos ,90: deixa o mesmo lucro em R$ da venda por fora.</p>
        {v.canEdit && (
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
            <SaveIcon aria-hidden /> Salvar tarifas
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function Anuncios({ slug, v }: { slug: Slug; v: View }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const q = useQuery({
    queryKey: ['canal-anuncios', slug, search, page],
    queryFn: () => api.get<{ total: number; page: number; rows: Row[] }>(`/canais/${slug}/anuncios?${new URLSearchParams({ ...(search ? { busca: search } : {}), pagina: String(page) })}`),
    placeholderData: keepPreviousData,
  })
  const sync = useMutation({ mutationFn: () => api.post<{ message: string }>(`/canais/${slug}/sincronizar`), onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['canal', slug] })), onError: (e) => toast.error(errorMessage(e)) })
  const send = useMutation({
    mutationFn: (items: { id: string; price: number }[]) => api.post<{ results: { id: string; ok: boolean; error?: string }[] }>(`/canais/${slug}/precos`, { items }),
    onSuccess: (r) => {
      const ok = r.results.filter((x) => x.ok).length
      const bad = r.results.filter((x) => !x.ok)
      if (ok) toast.success(`${ok} preço(s) alterado(s) na ${v.label}.`)
      for (const b of bad.slice(0, 3)) toast.error(b.error ?? 'Não alterou.')
      setEdits({})
      void qc.invalidateQueries({ queryKey: ['canal-anuncios', slug] })
      void qc.invalidateQueries({ queryKey: ['canal', slug] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const pending = Object.entries(edits)
    .map(([id, p]) => ({ id, price: Number(p.replace(',', '.')) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <div className="mr-auto">
          <CardTitle className="text-base">Anúncios</CardTitle>
          <CardDescription>
            {v.listings} anúncio(s){v.lastSync ? ` · lidos em ${formatDateTime(v.lastSync)}` : ''}
          </CardDescription>
        </div>
        <div className="relative">
          <SearchIcon className="absolute top-2.5 left-2 size-4 text-muted-foreground" aria-hidden />
          <Input className="w-56 pl-8" placeholder="Título, SKU ou código" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <Button variant="outline" disabled={sync.isPending || v.syncing} onClick={() => sync.mutate()}>
          {v.syncing ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />} Ler anúncios
        </Button>
        {v.canEdit && (
          <Button
            disabled={!pending.length || send.isPending}
            onClick={async () => {
              if (await confirm({ title: `Alterar ${pending.length} preço(s) na ${v.label}?`, description: 'O preço muda na loja na hora. Fica registrado no histórico.', confirmLabel: 'Alterar preços' })) send.mutate(pending)
            }}
          >
            <SendIcon aria-hidden /> Enviar preços ({pending.length})
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && !q.data.rows.length && <EmptyState icon={SearchIcon} title="Nenhum anúncio" description={v.listings ? 'Nada com essa busca.' : 'Clique em Ler anúncios.'} />}
        {q.data && !!q.data.rows.length && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anúncio</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead className="text-right">Imposto</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Sugerido</TableHead>
                  {v.canEdit && <TableHead className="w-32">Novo preço</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-80">
                      <p className="truncate font-medium" title={r.title}>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer noopener" className="underline">
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.sku ? `SKU ${r.sku}` : 'sem SKU'} · {r.status}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.stock ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.cost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.fee)}</TableCell>
                    <TableCell className="text-right tabular-nums" title={r.taxLabel}>
                      {brl(r.margin?.tax)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.margin?.margin !== null && r.margin?.margin !== undefined ? (
                        <Badge variant={r.margin.margin < 0 ? 'destructive' : 'secondary'}>
                          {brl(r.margin.margin)}
                          {r.margin.marginPct !== null ? ` · ${r.margin.marginPct}%` : ''}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">falta {(r.margin?.missing ?? ['preço']).map((m) => MISSING[m] ?? m).join(', ')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.suggestedPrice !== null ? (
                        v.canEdit ? (
                          <button type="button" className="underline" title={`Deixa o lucro de ${brl(r.profitTarget?.value)}. Clique para usar.`} onClick={() => setEdits((s) => ({ ...s, [r.id]: String(r.suggestedPrice) }))}>
                            {brl(r.suggestedPrice)}
                          </button>
                        ) : (
                          brl(r.suggestedPrice)
                        )
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {v.canEdit && (
                      <TableCell>
                        <Input inputMode="decimal" className="h-8 w-28 text-right" placeholder={r.price === null ? '' : String(r.price)} value={edits[r.id] ?? ''} onChange={(e) => setEdits((s) => ({ ...s, [r.id]: e.target.value }))} aria-label={`Novo preço de ${r.title}`} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {q.data && q.data.total > 50 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <span>
              Página {page} de {Math.ceil(q.data.total / 50)}
            </span>
            <Button size="sm" variant="outline" disabled={page >= Math.ceil(q.data.total / 50)} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Historico({ v }: { v: View }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preços alterados pelo CRM</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Anúncio</TableHead>
              <TableHead className="text-right">De</TableHead>
              <TableHead className="text-right">Para</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.changes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(c.createdAt)}
                  {c.userName ? ` · ${c.userName}` : ''}
                </TableCell>
                <TableCell className="max-w-72 truncate">{c.title}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(c.oldPrice === null ? null : Number(c.oldPrice))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(Number(c.newPrice))}</TableCell>
                <TableCell>{c.status === 'OK' ? <Badge variant="secondary">alterado</Badge> : <span className="text-xs text-destructive">{c.error}</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
