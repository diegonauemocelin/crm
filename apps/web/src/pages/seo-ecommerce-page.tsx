import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon, RotateCcwIcon, SearchIcon, SendIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

type FieldKey = 'pageTitle' | 'seoTitle' | 'metaDescription' | 'url' | 'title' | 'description' | 'summary' | 'searchKeywords'
type Fields = Record<FieldKey, string>
interface FieldDef {
  key: FieldKey
  label: string
  group: 'seo' | 'descricao'
  max: number
  hint: string
}
interface Issue {
  field: string
  points: number
  text: string
}
interface Job {
  kind: 'analise' | 'ia' | 'envio'
  total: number
  done: number
  errors: number
  lastError: string | null
}
interface ListData {
  total: number
  page: number
  stats: { analyzed: number; catalog: number; avgScore: number | null; below60: number; pending: number }
  /** Tarefa de IA ou envio (uma por vez). */
  job: Job | null
  /** Análise do catálogo; roda junto com a IA e o envio. */
  analysis: Job | null
  popularDays: number
  fields: FieldDef[]
  items: { id: string; productCode: string; derivationCode: string; name: string; brand: string | null; image: string | null; score: number; issues: Issue[]; seoTitle: string; metaDescription: string; url: string; checkedAt: string; error: string | null; lastChange: { id: string; status: string } | null; sold: number; views: number }[]
}
interface Change {
  id: string
  before: Fields
  proposed: Fields
  sendFields: FieldKey[]
  status: 'SUGERIDA' | 'ENVIADA' | 'ERRO' | 'DESCARTADA' | 'DESFEITA'
  source: 'ia' | 'manual'
  error: string | null
  createdByName: string | null
  sentByName: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}
interface ProductDetail {
  id: string
  productCode: string
  derivationCode: string
  name: string
  brand: string | null
  image: string | null
  categories: string[]
  attributes: { name: string; value: string }[]
  pageId: number | null
  fields: Fields
  score: number
  issues: Issue[]
  checkedAt: string
  siteUrl: string | null
  aiAvailable: boolean
  changes: Change[]
}
type ReviewItem = Change & { product: { id: string; name: string; productCode: string; image: string | null; score: number }; scoreAfter: number }

const STATUS: Record<Change['status'], string> = { SUGERIDA: 'Para revisar', ENVIADA: 'Enviada', ERRO: 'Erro no envio', DESCARTADA: 'Descartada', DESFEITA: 'Desfeita' }
const scoreColor = (n: number) => (n >= 80 ? 'bg-green-600 text-white' : n >= 60 ? 'bg-amber-500 text-white' : 'bg-red-600 text-white')
const plain = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/h[2-4])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function Score({ n }: { n: number }) {
  return <span className={cn('inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', scoreColor(n))}>{n}</span>
}

export function SeoEcommercePage() {
  usePageTitle('SEO do e-commerce')
  const qc = useQueryClient()
  const [tab, setTab] = useState('produtos')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [issue, setIssue] = useState('todos')
  const [maxScore, setMaxScore] = useState('todas')
  const [order, setOrder] = useState('nota')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => (setQ(search), setPage(1)), 350)
    return () => clearTimeout(t)
  }, [search])
  const params = new URLSearchParams({ pagina: String(page), ordem: order, ...(q ? { busca: q } : {}), ...(issue !== 'todos' ? { problema: issue } : {}), ...(maxScore !== 'todas' ? { notaAte: maxScore } : {}) })
  const list = useQuery({
    queryKey: ['seo-produtos', params.toString()],
    queryFn: () => api.get<ListData>(`/seo-ecommerce/produtos?${params}`),
    placeholderData: keepPreviousData,
    // Enquanto há tarefa (análise, IA ou envio), atualiza a cada 3 segundos.
    refetchInterval: (query) => (query.state.data?.job || query.state.data?.analysis ? 3000 : false),
  })
  const job = list.data?.job
  const analysis = list.data?.analysis
  useEffect(() => {
    if (!job) {
      void qc.invalidateQueries({ queryKey: ['seo-revisao'] })
    }
  }, [job, qc])
  const analyze = useMutation({
    mutationFn: () => api.post<{ message: string }>('/seo-ecommerce/analisar'),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['seo-produtos'] })),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const suggest = useMutation({
    mutationFn: (ids: string[]) => api.post<{ message?: string }>('/seo-ecommerce/sugerir', { ids }),
    onSuccess: (r) => {
      toast.success(r.message ?? 'Sugestão pronta em "Para revisar".')
      setSelected([])
      void qc.invalidateQueries({ queryKey: ['seo-produtos'] })
      void qc.invalidateQueries({ queryKey: ['seo-revisao'] })
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const d = list.data
  const items = d?.items ?? []
  const allOn = items.length > 0 && items.every((i) => selected.includes(i.id))
  return (
    <RequirePermission module="seo_ecommerce">
      <PageHeader
        title="SEO do e-commerce"
        description="Produtos da loja virtual (Magazord) com a nota de SEO. A IA sugere título SEO, meta-description e descrição a partir dos dados do produto; você revisa e envia para a loja."
        actions={
          <Button variant="outline" onClick={() => analyze.mutate()} disabled={analyze.isPending || !!analysis}>
            {analyze.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Analisar catálogo
          </Button>
        }
      />
      {d && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Produtos analisados', `${d.stats.analyzed.toLocaleString('pt-BR')}${d.stats.catalog ? ` de ${d.stats.catalog.toLocaleString('pt-BR')} SKUs` : ''}`],
            ['Nota média', d.stats.avgScore === null ? '—' : String(d.stats.avgScore)],
            ['Abaixo de 60', d.stats.below60.toLocaleString('pt-BR')],
            ['Sugestões para revisar', d.stats.pending.toLocaleString('pt-BR')],
          ].map(([k, v]) => (
            <Card key={k} className="gap-1 px-4 py-3">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-xl font-semibold tabular-nums">{v}</p>
            </Card>
          ))}
        </div>
      )}
      {[analysis, job].map(
        (j) =>
          j && (
            <p key={j.kind} className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
              <span>
                {j.kind === 'analise' ? 'Analisando o catálogo na Magazord (mais vendidos e mais vistos primeiro)' : j.kind === 'ia' ? 'A IA está escrevendo as sugestões' : 'Enviando para a loja'}: {j.done} de {j.total}
                {j.errors ? ` · ${j.errors} com erro (${j.lastError ?? ''})` : ''}
              </span>
            </p>
          ),
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="revisar">Para revisar{d?.stats.pending ? ` (${d.stats.pending})` : ''}</TabsTrigger>
          <TabsTrigger value="enviadas">Enviadas</TabsTrigger>
        </TabsList>
        <TabsContent value="produtos" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, código ou marca" className="pl-8" aria-label="Buscar produtos" />
            </div>
            <Select value={issue} onValueChange={(v) => (setIssue(v), setPage(1))}>
              <SelectTrigger className="w-56" aria-label="Problema">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os problemas</SelectItem>
                {(d?.fields ?? []).map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    Problema em: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={maxScore} onValueChange={(v) => (setMaxScore(v), setPage(1))}>
              <SelectTrigger className="w-40" aria-label="Nota">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Qualquer nota</SelectItem>
                <SelectItem value="59">Nota abaixo de 60</SelectItem>
                <SelectItem value="79">Nota abaixo de 80</SelectItem>
              </SelectContent>
            </Select>
            <Select value={order} onValueChange={(v) => (setOrder(v), setPage(1))}>
              <SelectTrigger className="w-48" aria-label="Ordem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nota">Pior nota primeiro</SelectItem>
                <SelectItem value="nota_desc">Melhor nota primeiro</SelectItem>
                <SelectItem value="vendidos">Mais vendidos ({d?.popularDays ?? 90} dias)</SelectItem>
                <SelectItem value="vistos">Mais vistos ({d?.popularDays ?? 90} dias)</SelectItem>
                <SelectItem value="nome">Nome</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
              <span>{selected.length} selecionado(s)</span>
              <Can module="seo_ecommerce" action="create">
                <Button size="sm" onClick={() => suggest.mutate(selected)} disabled={suggest.isPending || !!job || selected.length > 50}>
                  {suggest.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Gerar sugestões com IA
                </Button>
              </Can>
              {selected.length > 50 && <span className="text-xs text-destructive">No máximo 50 por vez.</span>}
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Limpar seleção
              </Button>
            </div>
          )}
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !d ? (
            <TableSkeleton rows={6} />
          ) : !items.length ? (
            <EmptyState icon={SearchIcon} title={d.stats.analyzed ? 'Nenhum produto com esses filtros' : 'Nenhum produto analisado ainda'} description={d.stats.analyzed ? 'Mude os filtros.' : 'Clique em Analisar catálogo: o CRM lê os textos de SEO de cada produto na Magazord e dá a nota.'} />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? [...new Set([...selected, ...items.map((i) => i.id)])] : selected.filter((s) => !items.some((i) => i.id === s)))} aria-label="Selecionar todos da página" />
                    </TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="w-16">Nota</TableHead>
                    <TableHead>O que melhorar</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpen(p.id)}>
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((s) => s !== p.id))} aria-label={`Selecionar ${p.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">{p.image && <img src={p.image} alt="" className="size-full object-contain" loading="lazy" />}</span>
                          <span className="min-w-0">
                            <span className="line-clamp-1 font-medium">{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.derivationCode}
                              {p.brand ? ` · ${p.brand}` : ''}
                              {p.sold ? ` · ${p.sold.toLocaleString('pt-BR')} vendido(s)` : ''}
                              {p.views ? ` · ${p.views.toLocaleString('pt-BR')} visita(s)` : ''}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Score n={p.score} />
                      </TableCell>
                      <TableCell className="max-w-md">
                        <span className="line-clamp-2 text-sm text-muted-foreground">{p.issues.length ? p.issues.map((i) => i.text).join(' ') : 'Tudo certo.'}</span>
                      </TableCell>
                      <TableCell>{p.lastChange ? <Badge variant={p.lastChange.status === 'ERRO' ? 'destructive' : 'secondary'}>{STATUS[p.lastChange.status as Change['status']]}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          {d && d.total > 50 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span>
                Página {page} de {Math.ceil(d.total / 50)}
              </span>
              <Button size="sm" variant="outline" disabled={page * 50 >= d.total} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="revisar">
          <ReviewList status="SUGERIDA" fields={d?.fields ?? []} onOpen={setOpen} busy={!!job} />
        </TabsContent>
        <TabsContent value="enviadas">
          <ReviewList status="ENVIADA" fields={d?.fields ?? []} onOpen={setOpen} busy={!!job} />
        </TabsContent>
      </Tabs>
      {open && d && <ProductSheet id={open} fields={d.fields} onClose={() => setOpen(null)} />}
    </RequirePermission>
  )
}

function ReviewList({ status, fields, onOpen, busy }: { status: 'SUGERIDA' | 'ENVIADA'; fields: FieldDef[]; onOpen: (id: string) => void; busy: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const [selected, setSelected] = useState<string[]>([])
  const q = useQuery({ queryKey: ['seo-revisao', status], queryFn: () => api.get<ReviewItem[]>(`/seo-ecommerce/revisao?status=${status}`) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['seo-revisao'] })
    void qc.invalidateQueries({ queryKey: ['seo-produtos'] })
  }
  const send = useMutation({
    mutationFn: (ids: string[]) => api.post<{ message: string }>('/seo-ecommerce/enviar', { ids }),
    onSuccess: (r) => (toast.success(r.message), setSelected([]), refresh()),
    onError: (err) => (toast.error(errorMessage(err), { duration: 10000 }), refresh()),
  })
  const discard = useMutation({ mutationFn: (id: string) => api.post(`/seo-ecommerce/alteracoes/${id}/descartar`), onSuccess: refresh, onError: (err) => toast.error(errorMessage(err)) })
  const undo = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/seo-ecommerce/alteracoes/${id}/desfazer`),
    onSuccess: (r) => (toast.success(r.message), refresh()),
    onError: (err) => toast.error(errorMessage(err), { duration: 10000 }),
  })
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  if (!q.data.length) return <EmptyState icon={status === 'SUGERIDA' ? SparklesIcon : SendIcon} title={status === 'SUGERIDA' ? 'Nada para revisar' : 'Nada enviado ainda'} description={status === 'SUGERIDA' ? 'Selecione produtos na aba Produtos e clique em Gerar sugestões com IA, ou abra um produto e escreva os textos.' : 'O que for enviado para a loja aparece aqui, com o botão para desfazer.'} />
  const sendable = q.data.filter((c) => c.status === 'SUGERIDA' || c.status === 'ERRO')
  return (
    <div className="space-y-3">
      {status === 'SUGERIDA' && can('seo_ecommerce', 'edit') && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelected(selected.length === sendable.length ? [] : sendable.map((c) => c.id))}>
            {selected.length === sendable.length ? 'Desmarcar todas' : 'Marcar todas'}
          </Button>
          <Button
            size="sm"
            disabled={!selected.length || send.isPending || busy}
            onClick={async () => {
              if (await confirm({ title: `Enviar ${selected.length} alteração(ões) para a loja?`, description: 'Os textos escolhidos em cada produto são gravados na Magazord. O texto anterior fica guardado aqui para desfazer.', confirmLabel: 'Enviar para a loja' })) send.mutate(selected)
            }}
          >
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar marcadas ({selected.length})
          </Button>
        </div>
      )}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {status === 'SUGERIDA' && <TableHead className="w-10 pl-4" />}
              <TableHead className={status === 'SUGERIDA' ? '' : 'pl-4'}>Produto</TableHead>
              <TableHead>Nota</TableHead>
              <TableHead>Campos</TableHead>
              <TableHead>{status === 'SUGERIDA' ? 'Sugerida por' : 'Enviada'}</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((c) => (
              <TableRow key={c.id}>
                {status === 'SUGERIDA' && (
                  <TableCell className="pl-4">
                    <Checkbox checked={selected.includes(c.id)} onCheckedChange={(v) => setSelected(v ? [...selected, c.id] : selected.filter((s) => s !== c.id))} aria-label={`Marcar ${c.product.name}`} />
                  </TableCell>
                )}
                <TableCell className={status === 'SUGERIDA' ? '' : 'pl-4'}>
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(c.product.id)}>
                    {c.product.name}
                  </button>
                  {c.error && <p className="text-xs text-destructive">{c.error}</p>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Score n={seoScoreOf(c.before)} /> → <Score n={c.scoreAfter} />
                </TableCell>
                <TableCell className="max-w-sm text-sm">{c.sendFields.map(label).join(', ') || '—'}</TableCell>
                <TableCell className="text-sm">
                  {status === 'SUGERIDA' ? (c.source === 'ia' ? 'IA' : (c.createdByName ?? 'Manual')) : `${c.sentByName ?? ''} · ${c.sentAt ? formatDateTime(c.sentAt) : ''}`}
                  {c.status === 'DESFEITA' && (
                    <Badge variant="secondary" className="ml-1">
                      Desfeita
                    </Badge>
                  )}
                  {c.status === 'ERRO' && (
                    <Badge variant="destructive" className="ml-1">
                      Erro
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="space-x-1 pr-4 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => onOpen(c.product.id)}>
                    Revisar
                  </Button>
                  {status === 'SUGERIDA' && can('seo_ecommerce', 'create') && (
                    <Button size="icon-sm" variant="ghost" onClick={() => discard.mutate(c.id)} aria-label="Descartar sugestão">
                      <XIcon />
                    </Button>
                  )}
                  {c.status === 'ENVIADA' && can('seo_ecommerce', 'edit') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={undo.isPending}
                      onClick={async () => {
                        if (await confirm({ title: 'Desfazer este envio?', description: 'Os campos enviados voltam ao texto que estava na loja antes.', confirmLabel: 'Desfazer' })) undo.mutate(c.id)
                      }}
                    >
                      <RotateCcwIcon /> Desfazer
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

/** Nota rápida do "antes" (mesma régua do servidor, só para a coluna Antes → Depois). */
function seoScoreOf(f: Partial<Fields>) {
  let n = 100
  const t = (f.seoTitle ?? '').trim()
  const m = (f.metaDescription ?? '').trim()
  const d = plain(f.description ?? '')
  if (!t) n -= 25
  else {
    if (t.length < 30) n -= 10
    if (t.length > 65) n -= 5
    if (t.length > 12 && t === t.toUpperCase() && /[A-Z]/.test(t)) n -= 5
  }
  if (!m) n -= 20
  else if (m.length < 70) n -= 8
  else if (m.length > 160) n -= 4
  if (!d) n -= 25
  else if (d.length < 300) n -= 15
  else if (d.length < 600) n -= 5
  if (!(f.summary ?? '').trim()) n -= 5
  return Math.max(0, n)
}

/** Produto: textos atuais x proposta, prévia do Google, IA, rascunho, envio e histórico. */
function ProductSheet({ id, fields, onClose }: { id: string; fields: FieldDef[]; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const canCreate = can('seo_ecommerce', 'create')
  const canSend = can('seo_ecommerce', 'edit')
  const q = useQuery({ queryKey: ['seo-produto', id], queryFn: () => api.get<ProductDetail>(`/seo-ecommerce/produtos/${id}`) })
  const p = q.data
  const draft = p?.changes.find((c) => c.status === 'SUGERIDA' || c.status === 'ERRO') ?? null
  const [proposed, setProposed] = useState<Fields | null>(null)
  const [send, setSend] = useState<FieldKey[]>([])
  const [instruction, setInstruction] = useState('')
  useEffect(() => {
    if (!p) return
    setProposed(draft ? { ...p.fields, ...draft.proposed } : { ...p.fields })
    setSend(draft ? draft.sendFields : [])
    // Só quando muda a sugestão em revisão ou o produto (não a cada digitação).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, draft?.id, draft?.updatedAt])
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['seo-produto', id] })
    void qc.invalidateQueries({ queryKey: ['seo-produtos'] })
    void qc.invalidateQueries({ queryKey: ['seo-revisao'] })
  }
  const reload = useMutation({ mutationFn: () => api.post(`/seo-ecommerce/produtos/${id}/atualizar`), onSuccess: (r) => (qc.setQueryData(['seo-produto', id], r), toast.success('Textos lidos de novo da loja.')), onError: (err) => toast.error(errorMessage(err)) })
  const ai = useMutation({
    mutationFn: () => api.post('/seo-ecommerce/sugerir', { ids: [id], instrucao: instruction || undefined }),
    onSuccess: () => (toast.success('Sugestão da IA pronta: confira cada campo antes de enviar.'), refreshAll()),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const save = useMutation({
    mutationFn: () => api.put<Change>(`/seo-ecommerce/produtos/${id}/rascunho`, { changeId: draft?.id, proposed, sendFields: send }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const sendNow = useMutation({
    mutationFn: async () => {
      const c = await save.mutateAsync()
      return api.post<{ message: string }>('/seo-ecommerce/enviar', { ids: [c.id] })
    },
    onSuccess: (r) => (toast.success(r.message), refreshAll()),
    onError: (err) => (toast.error(errorMessage(err), { duration: 10000 }), refreshAll()),
  })
  const undo = useMutation({
    mutationFn: (cid: string) => api.post<{ message: string }>(`/seo-ecommerce/alteracoes/${cid}/desfazer`),
    onSuccess: (r) => (toast.success(r.message), refreshAll()),
    onError: (err) => toast.error(errorMessage(err), { duration: 10000 }),
  })
  const set = (k: FieldKey, v: string) => {
    setProposed((x) => (x ? { ...x, [k]: v } : x))
    if (!send.includes(k) && v.trim() !== (p?.fields[k] ?? '').trim()) setSend([...send, k])
  }
  const host = p?.siteUrl ? p.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'sua-loja.com.br'
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {!p || !proposed ? (
          <div className="p-6">{q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <TableSkeleton rows={6} />}</div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">{p.name}</SheetTitle>
              <SheetDescription>
                {p.derivationCode} · produto {p.productCode}
                {p.brand ? ` · ${p.brand}` : ''} · nota atual <Score n={p.score} /> · lido em {formatDateTime(p.checkedAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => reload.mutate()} disabled={reload.isPending}>
                  {reload.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Ler de novo da loja
                </Button>
                {p.siteUrl && p.fields.url && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={`${p.siteUrl.replace(/\/$/, '')}/${p.fields.url}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon /> Ver na loja
                    </a>
                  </Button>
                )}
              </div>
              {p.issues.length > 0 && (
                <ul className="space-y-0.5 rounded-md border bg-muted/30 p-3 text-sm">
                  {p.issues.map((i) => (
                    <li key={i.text}>• {i.text}</li>
                  ))}
                </ul>
              )}
              {/* Como aparece no Google */}
              <div className="rounded-md border p-3">
                <p className="mb-1 text-xs text-muted-foreground">Prévia no Google (com os textos propostos)</p>
                <p className="truncate text-xs text-[#202124]">
                  {host} › {proposed.url || '…'}
                </p>
                <p className="line-clamp-1 text-lg text-[#1a0dab]">{proposed.seoTitle || proposed.pageTitle || p.name}</p>
                <p className="line-clamp-2 text-sm text-[#4d5156]">{proposed.metaDescription || plain(proposed.description).slice(0, 160) || 'Sem meta-description: o Google escolhe um trecho da página.'}</p>
              </div>
              {canCreate && p.aiAvailable && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
                  <div className="min-w-60 flex-1 space-y-1">
                    <Label htmlFor="seo-instr" className="text-xs">
                      <SparklesIcon className="size-3.5" /> Pedido para a IA (opcional)
                    </Label>
                    <Input id="seo-instr" value={instruction} maxLength={300} onChange={(e) => setInstruction(e.target.value)} placeholder="Ex.: destacar que serve na PC200-6 e PC200-7" />
                  </div>
                  <Button onClick={() => ai.mutate()} disabled={ai.isPending}>
                    {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Sugerir com IA
                  </Button>
                  <p className="w-full text-xs text-muted-foreground">A IA usa só os dados do produto (nome, marca, categorias, características e a descrição atual). Onde faltar dado, ela marca [conferir: …].</p>
                </div>
              )}
              {!p.aiAvailable && <p className="text-xs text-muted-foreground">Para a IA sugerir os textos, cadastre a chave gratuita do Gemini em Configurações › E-mail marketing.</p>}
              {draft && <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{draft.source === 'ia' ? 'Sugestão da IA' : 'Rascunho'} de {formatDateTime(draft.createdAt)}. Marque os campos que vão para a loja.{draft.error ? ` Último envio: ${draft.error}` : ''}</p>}
              {(['seo', 'descricao'] as const).map((group) => (
                <div key={group} className="space-y-3">
                  <p className="text-sm font-semibold">{group === 'seo' ? 'Aba SEO (Magazord)' : 'Aba Descrição Geral (Magazord)'}</p>
                  {group === 'seo' && !p.pageId && <p className="text-xs text-amber-700">Este produto ainda não tem a página de SEO criada na Magazord: abra o produto no painel e salve a aba SEO uma vez.</p>}
                  {fields
                    .filter((f) => f.group === group)
                    .map((f) => {
                      const now = p.fields[f.key] ?? ''
                      const val = proposed[f.key] ?? ''
                      const len = f.key === 'description' ? plain(val).length : val.length
                      const changed = val.trim() !== now.trim()
                      return (
                        <div key={f.key} className={cn('space-y-1.5 rounded-md border p-3', changed && 'border-primary/40')}>
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <Checkbox checked={send.includes(f.key)} disabled={!canCreate || (!changed && f.key !== 'searchKeywords')} onCheckedChange={(v) => setSend(v ? [...send, f.key] : send.filter((k) => k !== f.key))} aria-label={`Enviar ${f.label}`} />
                              {f.label}
                            </label>
                            <span className={cn('text-xs tabular-nums', len > f.max ? 'text-destructive' : 'text-muted-foreground')}>
                              {len}/{f.max}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{f.hint}</p>
                          {f.key !== 'searchKeywords' && (
                            <p className="rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                              <b>Atual:</b> {f.key === 'description' ? plain(now).slice(0, 300) || '(vazio)' : now || '(vazio)'}
                            </p>
                          )}
                          {f.key === 'description' ? (
                            <>
                              <Textarea rows={8} value={val} onChange={(e) => set(f.key, e.target.value)} disabled={!canCreate} className="font-mono text-xs" aria-label={f.label} />
                              {val && <iframe title="Prévia da descrição" sandbox="" srcDoc={`<style>body{font:14px/1.5 system-ui,sans-serif;margin:8px;color:#111}</style>${val}`} className="h-48 w-full rounded border bg-white" />}
                            </>
                          ) : f.max > 160 ? (
                            <Textarea rows={3} value={val} onChange={(e) => set(f.key, e.target.value)} disabled={!canCreate} aria-label={f.label} />
                          ) : (
                            <Input value={val} onChange={(e) => set(f.key, e.target.value)} disabled={!canCreate} aria-label={f.label} />
                          )}
                          {changed && canCreate && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => (setProposed({ ...proposed, [f.key]: now }), setSend(send.filter((k) => k !== f.key)))}>
                              <RotateCcwIcon /> Voltar ao atual
                            </Button>
                          )}
                        </div>
                      )
                    })}
                </div>
              ))}
              {canCreate && (
                <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3">
                  <Button variant="outline" onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success('Rascunho salvo em "Para revisar".'), refreshAll()) })} disabled={save.isPending}>
                    {save.isPending && !sendNow.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Salvar para revisar
                  </Button>
                  {canSend && (
                    <Button
                      disabled={!send.length || sendNow.isPending}
                      onClick={async () => {
                        const labels = send.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')
                        if (await confirm({ title: 'Enviar para a loja?', description: `Vai gravar na Magazord: ${labels}. O texto anterior fica guardado para desfazer.${send.includes('url') ? ' Atenção: mudar a URL pode perder posição no Google.' : ''}`, confirmLabel: 'Enviar' })) sendNow.mutate()
                      }}
                    >
                      {sendNow.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar {send.length ? `${send.length} campo(s)` : ''} para a loja
                    </Button>
                  )}
                </div>
              )}
              {p.changes.some((c) => c.status === 'ENVIADA' || c.status === 'DESFEITA') && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Histórico</p>
                  {p.changes
                    .filter((c) => c.status === 'ENVIADA' || c.status === 'DESFEITA')
                    .map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                        <span>
                          {c.sentAt ? formatDateTime(c.sentAt) : ''} · {c.sentByName} · {c.sendFields.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')}
                          {c.status === 'DESFEITA' && (
                            <Badge variant="secondary" className="ml-1">
                              Desfeita
                            </Badge>
                          )}
                        </span>
                        {c.status === 'ENVIADA' && canSend && (
                          <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(c.id)}>
                            <RotateCcwIcon /> Desfazer
                          </Button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
