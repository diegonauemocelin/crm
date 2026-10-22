import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money, num } from '@/lib/format'
import { BASE, Field, KNOWLEDGE_LABELS, Pager, qs, VALIDATION_LABELS } from './comum'

interface AppRow {
  id: number
  partCode: string
  productName: string | null
  partBrand: string | null
  machineBrand: string | null
  machineModel: string | null
  system: string | null
  application: string | null
  mlItemId: string | null
  validationStatus: string
  source: string | null
  validatedByName: string | null
  validatedAt: string | null
  itemTitle: string | null
  permalink: string | null
  itemStatus?: string | null
}
interface AppsMeta {
  machineBrands: string[]
  models: string[]
  systems: string[]
  partBrands: string[]
}
interface ItemRow {
  id: string
  title: string | null
  permalink: string | null
  price: number | null
  availableQuantity: number | null
  status: string | null
  sellerSku: string | null
  partNumber: string | null
  brand: string | null
  syncedAt: string | null
}

const validationVariant = (s: string) => (s === 'confirmada' ? 'secondary' : s === 'pendente' ? 'default' : 'outline')
const ITEM_STATUS: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Finalizado', under_review: 'Em revisão', inactive: 'Inativo' }

export function AssistenteAplicacoesPage() {
  return (
    <RequirePermission module="assist_aplicacoes">
      <Aplicacoes />
    </RequirePermission>
  )
}

function Aplicacoes() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') === 'anuncios' ? 'anuncios' : 'aplicacoes'
  return (
    <div>
      <PageHeader title="Produtos e aplicações" description="Quais peças servem em quais máquinas. A IA só afirma compatibilidade quando a aplicação está confirmada; a pendente vira pergunta para a equipe." />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'anuncios' ? { aba: 'anuncios' } : {}, { replace: true })} className="mb-4">
        <TabsList>
          <TabsTrigger value="aplicacoes">Aplicações peça × máquina</TabsTrigger>
          <TabsTrigger value="anuncios">Anúncios da loja</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'anuncios' ? <Anuncios /> : <ListaAplicacoes />}
    </div>
  )
}

function ListaAplicacoes() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const meta = useQuery({ queryKey: ['assist-apps-meta'], queryFn: () => api.get<AppsMeta>('/assistente/aplicacoes/meta'), staleTime: 60_000 })
  const f = { q: params.get('q') ?? '', brand: params.get('brand') ?? '', validation: params.get('validation') ?? '', system: params.get('system') ?? '' }
  const [search, setSearch] = useState(f.q)
  const list = useQuery({ queryKey: ['assist-apps', f, page], queryFn: () => api.get<{ rows: AppRow[]; total: number; pageSize: number; counts: Record<string, number> }>(`/assistente/aplicacoes${qs({ ...f, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
  const [form, setForm] = useState<AppRow | 'novo' | null>(null)
  const [product, setProduct] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v && v !== 'todas') p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    setPage(1)
  }
  const validate = async (a: AppRow, status: string) => {
    setBusy(a.id)
    try {
      await api.post(`/assistente/aplicacoes/${a.id}/validar`, { status })
      toast.success(status === 'confirmada' ? 'Compatibilidade confirmada: a IA já pode afirmar.' : 'Situação alterada.')
      void qc.invalidateQueries({ queryKey: ['assist-apps'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const counts = list.data?.counts ?? {}
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={f.validation || 'todas'} onValueChange={(v) => set('validation', v)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda validação</SelectItem>
            {Object.entries(VALIDATION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v} ({counts[k] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.brand || 'todas'} onValueChange={(v) => set('brand', v)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda marca</SelectItem>
            {(meta.data?.machineBrands ?? []).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.system || 'todas'} onValueChange={(v) => set('system', v)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todo sistema</SelectItem>
            {(meta.data?.systems ?? []).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set('q', search.trim())
          }}
        >
          <Input className="w-64" placeholder="Buscar código, produto ou aplicação" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Can module="assist_aplicacoes" action="create">
          <Button className="ml-auto" onClick={() => setForm('novo')}>
            <PlusIcon /> Nova aplicação
          </Button>
        </Can>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error || !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.rows.length ? (
        <EmptyState title="Nenhuma aplicação" description="Cadastre aqui, pela base de conhecimento ou pela planilha." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Código</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Máquina</TableHead>
                <TableHead>Aplicação</TableHead>
                <TableHead>Anúncio</TableHead>
                <TableHead>Validação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-4">
                    <button type="button" className="font-medium hover:underline" onClick={() => setProduct(a.partCode)}>
                      {a.partCode}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-60">{a.productName ?? '—'}</TableCell>
                  <TableCell>{[a.machineBrand, a.machineModel].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="line-clamp-2">{a.application ?? '—'}</span>
                  </TableCell>
                  <TableCell className="max-w-60">
                    {a.mlItemId ? (
                      <a href={a.permalink ?? undefined} target="_blank" rel="noreferrer" className="line-clamp-2 hover:underline">
                        {a.itemTitle ?? a.mlItemId}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={validationVariant(a.validationStatus)}>{VALIDATION_LABELS[a.validationStatus] ?? a.validationStatus}</Badge>
                    {a.validatedByName && <p className="text-xs text-muted-foreground">{a.validatedByName}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {can('assist_aplicacoes', 'edit') && (
                      <div className="flex justify-end gap-1">
                        {a.validationStatus !== 'confirmada' && (
                          <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => validate(a, 'confirmada')}>
                            Confirmar
                          </Button>
                        )}
                        {a.validationStatus !== 'nao_confirmada' && (
                          <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => validate(a, 'nao_confirmada')}>
                            Não serve
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setForm(a)}>
                          Editar
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      {form && <AppForm initial={form === 'novo' ? null : form} meta={meta.data} onClose={() => setForm(null)} />}
      {product && <ProductSheet code={product} onClose={() => setProduct(null)} />}
    </>
  )
}

function AppForm({ initial, meta, onClose }: { initial: AppRow | null; meta?: AppsMeta; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [f, setF] = useState({
    partCode: initial?.partCode ?? '',
    productName: initial?.productName ?? '',
    partBrand: initial?.partBrand ?? '',
    machineBrand: initial?.machineBrand ?? '',
    machineModel: initial?.machineModel ?? '',
    system: initial?.system ?? '',
    application: initial?.application ?? '',
    source: initial?.source ?? '',
    mlItemId: initial?.mlItemId ?? '',
    validationStatus: initial?.validationStatus ?? 'pendente',
  })
  const [saving, setSaving] = useState(false)
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const mlItemId = f.mlItemId.trim().toUpperCase().replace(/-/g, '') || null
      if (initial) await api.put(`/assistente/aplicacoes/${initial.id}`, { productName: f.productName, partBrand: f.partBrand, system: f.system, application: f.application, source: f.source, mlItemId })
      else await api.post('/assistente/aplicacoes', { ...f, mlItemId: mlItemId ?? undefined })
      toast.success('Aplicação salva.')
      void qc.invalidateQueries({ queryKey: ['assist-apps'] })
      void qc.invalidateQueries({ queryKey: ['assist-apps-meta'] })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{initial ? `Editar aplicação ${initial.partCode}` : 'Nova aplicação'}</DialogTitle>
            <DialogDescription>Código e máquina identificam a aplicação; o mesmo par cadastrado de novo atualiza o existente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código da peça">
              <Input value={f.partCode} onChange={up('partCode')} required disabled={!!initial} />
            </Field>
            <Field label="Produto">
              <Input value={f.productName} onChange={up('productName')} />
            </Field>
            <Field label="Marca da máquina">
              <Input value={f.machineBrand} onChange={up('machineBrand')} disabled={!!initial} list="assist-brands" />
            </Field>
            <Field label="Modelo da máquina">
              <Input value={f.machineModel} onChange={up('machineModel')} required disabled={!!initial} list="assist-models" />
            </Field>
            <Field label="Sistema">
              <Input value={f.system} onChange={up('system')} list="assist-systems" />
            </Field>
            <Field label="Marca da peça">
              <Input value={f.partBrand} onChange={up('partBrand')} />
            </Field>
          </div>
          <datalist id="assist-brands">{meta?.machineBrands.map((b) => <option key={b} value={b} />)}</datalist>
          <datalist id="assist-models">{meta?.models.map((b) => <option key={b} value={b} />)}</datalist>
          <datalist id="assist-systems">{meta?.systems.map((b) => <option key={b} value={b} />)}</datalist>
          <Field label="Aplicação" hint="Obrigatória para confirmar a compatibilidade. Ex.: Retroescavadeira JCB 3C, motor Perkins.">
            <Textarea rows={2} value={f.application} onChange={up('application')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Anúncio do Mercado Livre" hint="Ex.: MLB1234567890">
              <Input value={f.mlItemId} onChange={up('mlItemId')} />
            </Field>
            <Field label="Fonte">
              <Input value={f.source} onChange={up('source')} />
            </Field>
          </div>
          {!initial && (
            <Field label="Validação">
              <Select value={f.validationStatus} onValueChange={(v) => setF({ ...f, validationStatus: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VALIDATION_LABELS)
                    .filter(([k]) => can('assist_aplicacoes', 'edit') || k === 'pendente')
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['assist-produto', code],
    queryFn: () =>
      api.get<{ code: string; product: string; confirmed: AppRow[]; pending: AppRow[]; notConfirmed: AppRow[]; items: { id: string; title: string | null; permalink: string | null; price: number | null; status: string | null; availableQuantity: number | null }[]; knowledge: { id: number; title: string; category: string; status: string }[] }>(`/assistente/aplicacoes/produto/${encodeURIComponent(code)}`),
  })
  const d = q.data
  const group = (title: string, rows: AppRow[]) =>
    rows.length > 0 && (
      <div>
        <p className="font-medium">
          {title} ({rows.length})
        </p>
        <ul className="text-muted-foreground">
          {rows.map((a) => (
            <li key={a.id}>
              {[a.machineBrand, a.machineModel].filter(Boolean).join(' ')}
              {a.application && ` · ${a.application}`}
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ficha do produto {code}</DialogTitle>
          {d && <DialogDescription>{d.product}</DialogDescription>}
        </DialogHeader>
        {q.isLoading ? (
          <TableSkeleton rows={4} />
        ) : q.error || !d ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-3 text-sm">
            {group('Serve (confirmada)', d.confirmed)}
            {group('A confirmar', d.pending)}
            {group('Não serve', d.notConfirmed)}
            {d.items.length > 0 && (
              <div>
                <p className="font-medium">Anúncios</p>
                {d.items.map((i) => (
                  <p key={i.id}>
                    <a className="inline-flex items-center gap-1 underline" href={i.permalink ?? undefined} target="_blank" rel="noreferrer">
                      {i.title ?? i.id} <ExternalLinkIcon className="size-3" />
                    </a>{' '}
                    <span className="text-muted-foreground">
                      {money(i.price)} · estoque {i.availableQuantity ?? '—'} · {ITEM_STATUS[i.status ?? ''] ?? i.status}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {d.knowledge.length > 0 && (
              <div>
                <p className="font-medium">Conhecimentos do código</p>
                {d.knowledge.map((k) => (
                  <p key={k.id}>
                    <Link className="underline" to={`${BASE}/conhecimento?id=${k.id}`}>
                      #{k.id} {k.title}
                    </Link>{' '}
                    <span className="text-muted-foreground">({KNOWLEDGE_LABELS[k.status] ?? k.status})</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Anuncios() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const list = useQuery({ queryKey: ['assist-anuncios', status, q, page], queryFn: () => api.get<{ rows: ItemRow[]; total: number; pageSize: number; counts: Record<string, number> }>(`/assistente/anuncios${qs({ status, q, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
  const counts = list.data?.counts ?? {}
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          value={status || 'todas'}
          onValueChange={(v) => {
            setStatus(v === 'todas' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda situação ({num(Object.values(counts).reduce((s, n) => s + n, 0))})</SelectItem>
            {Object.entries(counts).map(([k, n]) => (
              <SelectItem key={k} value={k}>
                {ITEM_STATUS[k] ?? k} ({num(n)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setQ(search.trim())
            setPage(1)
          }}
        >
          <Input className="w-72" placeholder="Buscar título, código, SKU ou MLB" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <p className="self-center text-sm text-muted-foreground">Sincronize em Configurações › Marketplaces › Assistente ML: integração.</p>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error || !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.rows.length ? (
        <EmptyState title="Nenhum anúncio sincronizado" description="Os anúncios da loja entram pela sincronização em Configurações › Marketplaces › Assistente ML: integração." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Anúncio</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Sincronizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="max-w-96 pl-4">
                    <a href={i.permalink ?? undefined} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:underline">
                      {i.title ?? i.id}
                    </a>
                    <p className="text-xs text-muted-foreground">{i.id}</p>
                  </TableCell>
                  <TableCell>{i.partNumber ?? '—'}</TableCell>
                  <TableCell>{i.sellerSku ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.availableQuantity ?? '—'}</TableCell>
                  <TableCell>{ITEM_STATUS[i.status ?? ''] ?? i.status ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(i.syncedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
    </>
  )
}
