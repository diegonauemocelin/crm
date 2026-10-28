import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon, SendIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money, num } from '@/lib/format'
import { BASE, customer, Facts, FINAL, KNOWLEDGE_LABELS, Pager, PriorityBadge, QuestionLink, qs, SendBadge, STATUS_LABELS, StatusBadge } from './comum'

interface QuestionRow {
  id: number
  text: string
  receivedAt: string
  status: string
  pendingReason: string | null
  mlItemId: string | null
  itemTitle: string | null
  itemPermalink: string | null
  customerName: string | null
  customerNickname: string | null
  customerId: string | null
  assignedToName: string | null
  partCode: string | null
  brand: string | null
  model: string | null
  attemptId: number | null
  attemptText: string | null
  attemptStatus: string | null
  attemptOrigin: string | null
  salesCount: number
  salesTotal: number | null
  abandonCount: number
  checkoutPending: number
  priority?: { score: number; level: string; ageHours: number }
}
interface ListResponse {
  rows: QuestionRow[]
  total: number
  page: number
  pageSize: number
  counts: Record<string, number>
}
interface PendingResponse {
  rows: QuestionRow[]
  total: number
  page: number
  pageSize: number
  stats: { semResposta: number; aguardandoAnalise: number; conhecimentoTecnico: number; encaminhadas: number; resolvidasHoje: number; mais24h: number }
  reasons: Record<string, string>
}
interface Meta {
  statuses: string[]
  reasons: Record<string, string>
  users: { id: string; name: string }[]
}

const VIEWS: [string, string][] = [
  ['todas', 'Todas'],
  ['aguardando', 'Aguardando'],
  ['encaminhadas', 'Encaminhadas'],
  ['revisao', 'Para revisar'],
  ['respondidas', 'Respondidas'],
  ['erro', 'Falha de integração'],
  ['com_venda', 'Com venda'],
  ['desistiu_checkout', 'Desistiu no checkout'],
]

const useMeta = () => useQuery({ queryKey: ['assist-meta'], queryFn: () => api.get<Meta>('/assistente/perguntas/meta'), staleTime: 300_000 })

export function AssistentePerguntasPage() {
  return (
    <RequirePermission module="assist_atendimento">
      <Perguntas />
    </RequirePermission>
  )
}

function Perguntas() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? 'todas'
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [page, setPage] = useState(1)
  const q = params.get('q') ?? ''
  const list = useQuery({ queryKey: ['assist-perguntas', view, q, page], queryFn: () => api.get<ListResponse>(`/assistente/perguntas${qs({ view, q, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    setPage(1)
  }
  return (
    <div>
      <PageHeader title="Perguntas e respostas" description="Todas as perguntas do Mercado Livre, com a resposta enviada e as vendas ligadas a cada pergunta." />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {VIEWS.map(([k, label]) => (
          <Button key={k} size="sm" variant={view === k ? 'default' : 'outline'} onClick={() => set('view', k === 'todas' ? '' : k)}>
            {label}
            {list.data?.counts[k] !== undefined && <span className="ml-1 tabular-nums opacity-70">{num(list.data.counts[k])}</span>}
          </Button>
        ))}
      </div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          set('q', search.trim())
        }}
      >
        <Input className="max-w-md" placeholder="Buscar pergunta, cliente, anúncio ou código" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      <QuestionsTable query={list} page={page} onPage={setPage} />
    </div>
  )
}

function QuestionsTable({ query, page, onPage, showPriority }: { query: { data?: { rows: QuestionRow[]; total: number; pageSize: number }; isLoading: boolean; error: unknown; refetch: () => unknown }; page: number; onPage: (p: number) => void; showPriority?: boolean }) {
  if (query.isLoading) return <TableSkeleton />
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!query.data.rows.length) return <EmptyState title="Nenhuma pergunta" description="Nada encontrado com estes filtros." />
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            {showPriority && <TableHead className="pl-4">Prioridade</TableHead>}
            <TableHead className={showPriority ? '' : 'pl-4'}>Pergunta</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Resposta</TableHead>
            <TableHead>Recebida</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.rows.map((r) => (
            <TableRow key={r.id}>
              {showPriority && <TableCell className="pl-4">{r.priority && <PriorityBadge level={r.priority.level} />}</TableCell>}
              <TableCell className={showPriority ? 'max-w-96' : 'max-w-96 pl-4'}>
                <QuestionLink id={r.id} className="line-clamp-2 font-medium">
                  {r.text}
                </QuestionLink>
                <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
                  {r.assignedToName && <span>Com {r.assignedToName}</span>}
                  {r.salesCount > 0 && <Badge variant="secondary">Comprou {r.salesTotal ? money(r.salesTotal) : ''}</Badge>}
                  {r.abandonCount > 0 && r.salesCount === 0 && <Badge variant="outline">Desistiu no checkout</Badge>}
                  {r.checkoutPending > 0 && <Badge variant="outline">Aguardando pagamento</Badge>}
                </div>
              </TableCell>
              <TableCell>{customer(r)}</TableCell>
              <TableCell className="max-w-60">
                <span className="line-clamp-2">{r.itemTitle ?? r.mlItemId ?? '—'}</span>
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
                {r.pendingReason && !FINAL.includes(r.status) && <p className="mt-0.5 text-xs text-muted-foreground">Motivo {r.pendingReason}</p>}
              </TableCell>
              <TableCell>{r.attemptStatus ? <SendBadge status={r.attemptStatus} /> : '—'}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDateTime(r.receivedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onPage={onPage} />
    </Card>
  )
}

// ---------- Pendentes ----------

export function AssistentePendentesPage() {
  return (
    <RequirePermission module="assist_atendimento">
      <Pendentes />
    </RequirePermission>
  )
}

function Pendentes() {
  const [params, setParams] = useSearchParams()
  const meta = useMeta()
  const [page, setPage] = useState(1)
  const f = { status: params.get('status') ?? '', reason: params.get('reason') ?? '', priority: params.get('priority') ?? '', assigned: params.get('assigned') ?? '', q: params.get('q') ?? '' }
  const [search, setSearch] = useState(f.q)
  const list = useQuery({ queryKey: ['assist-pendentes', f, page], queryFn: () => api.get<PendingResponse>(`/assistente/perguntas/pendentes${qs({ ...f, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v && v !== 'todas') p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    setPage(1)
  }
  const s = list.data?.stats
  return (
    <div>
      <PageHeader title="Perguntas pendentes" description="Fila do que a IA não respondeu sozinha, das mais urgentes para as menos: idade da pergunta, intenção de compra, dúvida técnica e relevância comercial." />
      {s && (
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['Sem resposta', s.semResposta],
              ['Aguardando análise', s.aguardandoAnalise],
              ['Dúvida técnica', s.conhecimentoTecnico],
              ['Encaminhadas', s.encaminhadas],
              ['Há mais de 24 h', s.mais24h],
              ['Resolvidas hoje', s.resolvidasHoje],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-md border p-3">
              <p className="text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{num(v)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={f.status || 'todas'} onValueChange={(v) => set('status', v)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {(meta.data?.statuses ?? []).map((st) => (
              <SelectItem key={st} value={st}>
                {STATUS_LABELS[st] ?? st}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.reason || 'todas'} onValueChange={(v) => set('reason', v)}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Motivo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os motivos</SelectItem>
            {Object.entries(meta.data?.reasons ?? {}).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {k}. {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.priority || 'todas'} onValueChange={(v) => set('priority', v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda prioridade</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
          </SelectContent>
        </Select>
        <Select value={f.assigned || 'todas'} onValueChange={(v) => set('assigned', v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Qualquer responsável</SelectItem>
            <SelectItem value="none">Sem responsável</SelectItem>
            {(meta.data?.users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            set('q', search.trim())
          }}
        >
          <Input className="w-64" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </div>
      <QuestionsTable query={list} page={page} onPage={setPage} showPriority />
    </div>
  )
}

// ---------- Detalhe ----------

interface Attempt {
  id: number
  origin: string
  kind: string
  authorName: string | null
  text: string
  confidence: number | null
  sendStatus: string
  createdAt: string
  sentAt: string | null
  error: string | null
  reviewed: boolean
  flaggedForReview: boolean
  ai: { model?: string; decision?: string } | null
  knowledge: { id: number; version: number; title: string | null; currentVersion: number | null; status: string | null }[]
}
interface Detail {
  question: QuestionRow & { mlQuestionId: string; relevance: number; purchaseIntent: boolean; processingState: string; answeredAt: string | null; assignedToId: string | null; priority: { score: number; level: string; ageHours: number } }
  item: { id: string; title: string | null; permalink: string | null; price: number | null; status: string | null; partNumber: string | null; sellerSku: string | null; availableQuantity: number | null } | null
  attempts: Attempt[]
  events: { id: number; type: string; fromStatus: string | null; toStatus: string | null; userName: string | null; note: string | null; createdAt: string }[]
  notes: { id: number; userName: string; note: string; createdAt: string }[]
  linkedKnowledge: { id: number; title: string; status: string; version: number }[]
  sales: { id: number; mlOrderId: string; itemTitle: string | null; total: number | null; orderDate: string; outcomeLabel: string; statusLabel: string | null; sold: boolean; permalink: string | null; matchType: string; hoursAfterQuestion: number | null }[]
  analysis: { found?: string[]; missing?: string[]; explanation?: string; routing?: string; decision?: string; confidence?: number; model?: string; freight?: unknown } | null
  reasons: Record<string, string>
}

const MODEL_LABEL = (m?: string) => (!m ? '' : m.startsWith('sem-ia') ? 'Sem IA (regras)' : m === 'frete-magazord' ? 'Frete pela Magazord' : m)

export function AssistentePerguntaPage() {
  return (
    <RequirePermission module="assist_atendimento">
      <Pergunta />
    </RequirePermission>
  )
}

function Pergunta() {
  const { id } = useParams()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const meta = useMeta()
  const q = useQuery({ queryKey: ['assist-pergunta', id], queryFn: () => api.get<Detail>(`/assistente/perguntas/${id}`) })
  const [busy, setBusy] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState<Record<number, string>>({})
  const d = q.data
  useEffect(() => {
    setAnswer('')
    setEdit({})
  }, [id])
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['assist-pergunta', id] })
    void qc.invalidateQueries({ queryKey: ['assist-perguntas'] })
    void qc.invalidateQueries({ queryKey: ['assist-pendentes'] })
    void qc.invalidateQueries({ queryKey: ['assist-pendentes-contagem'] })
  }
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      const r = (await fn()) as { sent?: boolean; reason?: string; pendingConfirmation?: boolean; error?: string } | undefined
      if (r && r.sent === false) toast.warning(r.pendingConfirmation ? 'Enviada; aguardando a confirmação do Mercado Livre.' : r.error ? `Não foi enviada: ${r.error}` : `Não foi enviada (pergunta ${r.reason ?? 'fechada'} no Mercado Livre).`)
      else if (ok) toast.success(ok)
      refresh()
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    } finally {
      setBusy(null)
    }
  }
  if (q.isLoading) return <TableSkeleton rows={8} />
  if (q.error || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const qq = d.question
  const final = FINAL.includes(qq.status)
  const canSend = can('assist_atendimento', 'create')
  const canEdit = can('assist_atendimento', 'edit')
  const statuses = (meta.data?.statuses ?? []).filter((s) => s !== 'respondida')
  return (
    <div>
      <Link to={`${BASE}/perguntas`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" /> Perguntas
      </Link>
      <PageHeader
        title={`Pergunta #${qq.id}`}
        description={`${customer(qq)} · recebida em ${formatDateTime(qq.receivedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={qq.status} />
            <PriorityBadge level={qq.priority.level} />
            <Can module="assist_atendimento" action="edit">
              <Button size="sm" variant="outline" disabled={!!busy || final} onClick={() => run('reanalisar', () => api.post(`/assistente/perguntas/${qq.id}/reanalisar`), 'Pergunta reanalisada.')}>
                {busy === 'reanalisar' ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Reanalisar
              </Button>
            </Can>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-3">
              <p className="text-lg">{qq.text}</p>
              {d.item ? (
                <p className="text-sm text-muted-foreground">
                  Anúncio:{' '}
                  {d.item.permalink ? (
                    <a href={d.item.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                      {d.item.title ?? d.item.id} <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : (
                    (d.item.title ?? d.item.id)
                  )}
                  {d.item.price !== null && ` · ${money(d.item.price)}`}
                  {d.item.availableQuantity !== null && ` · estoque ${d.item.availableQuantity}`}
                  {(d.item.partNumber || d.item.sellerSku) && ` · código ${d.item.partNumber ?? d.item.sellerSku}`}
                </p>
              ) : qq.mlItemId ? (
                <p className="text-sm text-muted-foreground">Anúncio {qq.mlItemId} (não sincronizado)</p>
              ) : null}
            </CardContent>
          </Card>

          {d.analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Análise do assistente</CardTitle>
                <CardDescription>
                  {MODEL_LABEL(d.analysis.model)}
                  {d.analysis.confidence !== undefined && ` · confiança ${Math.round((d.analysis.confidence ?? 0) * 100)}%`}
                  {qq.pendingReason && ` · motivo ${qq.pendingReason}. ${d.reasons[qq.pendingReason] ?? ''}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {d.analysis.explanation && <p>{d.analysis.explanation}</p>}
                {!!d.analysis.found?.length && <p className="text-muted-foreground">Encontrado: {d.analysis.found.join('; ')}</p>}
                {!!d.analysis.missing?.length && <p className="text-muted-foreground">Faltou: {d.analysis.missing.join('; ')}</p>}
                {d.analysis.routing && <p className="text-muted-foreground">Encaminhar para: {d.analysis.routing}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Respostas</CardTitle>
              <CardDescription>Sugestões da IA e respostas de atendentes. O Mercado Livre não aceita telefone, e-mail ou link de fora do Mercado Livre.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {d.attempts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma resposta ainda.</p>}
              {d.attempts.map((a) => {
                const waiting = ['pendente_aprovacao', 'preparada'].includes(a.sendStatus)
                const text = edit[a.id] ?? a.text
                return (
                  <div key={a.id} className="space-y-2 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <SendBadge status={a.sendStatus} />
                      <span className="text-muted-foreground">
                        {a.origin === 'ia' ? `IA${a.ai?.model ? ` (${MODEL_LABEL(a.ai.model)})` : ''}` : (a.authorName ?? 'Atendente')} · {formatDateTime(a.sentAt ?? a.createdAt)}
                        {a.confidence !== null && a.origin === 'ia' && ` · confiança ${Math.round(a.confidence * 100)}%`}
                        {a.kind === 'solicitar_info' && ' · pede informação ao cliente'}
                      </span>
                      {a.flaggedForReview && <Badge variant="outline">Marcada para revisão</Badge>}
                    </div>
                    {waiting && canSend && !final ? <Textarea rows={5} maxLength={2000} value={text} onChange={(e) => setEdit({ ...edit, [a.id]: e.target.value })} /> : <p className="whitespace-pre-wrap">{a.text}</p>}
                    {a.error && <p className="text-destructive">{a.error}</p>}
                    {a.knowledge.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Base usada:{' '}
                        {a.knowledge.map((k, i) => (
                          <span key={k.id}>
                            {i > 0 && ', '}
                            <Link className="underline" to={`${BASE}/conhecimento?id=${k.id}`}>
                              #{k.id} {k.title}
                            </Link>{' '}
                            (versão {k.version}
                            {k.currentVersion && k.currentVersion !== k.version ? `, hoje ${k.currentVersion}` : ''})
                          </span>
                        ))}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {waiting && canSend && !final && (
                        <Button size="sm" disabled={!!busy || !text.trim()} onClick={() => run(`ap${a.id}`, () => api.post(`/assistente/respostas/${a.id}/aprovar`, { text }), 'Resposta enviada ao cliente.')}>
                          {busy === `ap${a.id}` ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {text !== a.text ? 'Enviar a versão editada' : 'Aprovar e enviar'}
                        </Button>
                      )}
                      {a.sendStatus === 'falha' && canSend && (
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`re${a.id}`, () => api.post(`/assistente/respostas/${a.id}/reenviar`), 'Resposta reenviada.')}>
                          Reenviar
                        </Button>
                      )}
                      {(waiting || a.sendStatus === 'falha') && canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!busy}
                          onClick={async () => {
                            if (await confirm({ title: 'Descartar esta resposta?', description: 'Ela não será enviada ao cliente. Fica no histórico da pergunta.', confirmLabel: 'Descartar resposta' })) await run(`de${a.id}`, () => api.post(`/assistente/respostas/${a.id}/descartar`), 'Resposta descartada.')
                          }}
                        >
                          Descartar
                        </Button>
                      )}
                      {a.sendStatus === 'enviada' && canEdit && (
                        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(`fl${a.id}`, () => api.post(`/assistente/respostas/${a.id}/revisao`, { flagged: !a.flaggedForReview }), a.flaggedForReview ? 'Revisão desmarcada.' : 'Marcada para revisão.')}>
                          {a.flaggedForReview ? 'Desmarcar revisão' : 'Marcar para revisão'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {canSend && !final && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Responder</p>
                  <Textarea rows={5} maxLength={2000} placeholder="Escreva a resposta para o cliente" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!!busy || !answer.trim()}
                      onClick={async () => {
                        if (await run('responder', () => api.post(`/assistente/perguntas/${qq.id}/responder`, { text: answer }), 'Resposta enviada ao cliente.')) setAnswer('')
                      }}
                    >
                      {busy === 'responder' ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar resposta
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={async () => {
                        try {
                          setAnswer((await api.get<{ text: string }>(`/assistente/perguntas/${qq.id}/rascunho-pedido-info`)).text)
                        } catch (err) {
                          toast.error(errorMessage(err))
                        }
                      }}
                    >
                      Rascunho pedindo informações
                    </Button>
                    <span className="text-xs text-muted-foreground">{answer.length}/2000</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trajetória</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3">
                    <p>
                      {e.note ?? e.type.replace(/_/g, ' ')}
                      {e.toStatus && e.fromStatus !== e.toStatus && <span className="text-muted-foreground"> → {STATUS_LABELS[e.toStatus] ?? e.toStatus}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                      {e.userName && ` · ${e.userName}`}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Atendimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Facts
                items={[
                  ['Cliente', customer(qq)],
                  ['Marca', qq.brand],
                  ['Modelo', qq.model],
                  ['Código', qq.partCode],
                  ['Intenção de compra', qq.purchaseIntent ? 'Sim' : 'Não'],
                  ['Responsável', qq.assignedToName],
                ]}
              />
              {canEdit && (
                <>
                  <div className="space-y-1.5">
                    <p className="font-medium">Encaminhar para</p>
                    <Select value={qq.assignedToId ?? (qq.assignedToName ? 'painel' : 'none')} onValueChange={(v) => run('encaminhar', () => api.post(`/assistente/perguntas/${qq.id}/encaminhar`, { userId: v === 'none' ? null : v }), v === 'none' ? 'Responsável removido.' : 'Pergunta encaminhada.')}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ninguém</SelectItem>
                        {!qq.assignedToId && qq.assignedToName && (
                          <SelectItem value="painel" disabled>
                            {qq.assignedToName} (do painel antigo)
                          </SelectItem>
                        )}
                        {(meta.data?.users ?? []).map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-medium">Situação</p>
                    <Select value={qq.status} onValueChange={(v) => run('situacao', () => api.post(`/assistente/perguntas/${qq.id}/situacao`, { status: v, reason: qq.pendingReason ?? undefined }), 'Situação alterada.')}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {qq.status === 'respondida' && <SelectItem value="respondida">Respondida</SelectItem>}
                        {statuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s] ?? s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!final && (
                    <div className="space-y-1.5">
                      <p className="font-medium">Motivo da pendência</p>
                      <Select value={qq.pendingReason ?? ''} onValueChange={(v) => run('motivo', () => api.post(`/assistente/perguntas/${qq.id}/situacao`, { status: qq.status === 'nova' ? 'aguardando_analise' : qq.status, reason: v }), 'Motivo alterado.')}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Sem motivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(d.reasons).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {k}. {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <p className="font-medium">Relevância comercial</p>
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((n) => (
                        <Button key={n} size="sm" variant={qq.relevance === n ? 'default' : 'outline'} disabled={!!busy} onClick={() => run('relevancia', () => api.post(`/assistente/perguntas/${qq.id}/relevancia`, { relevance: n }))}>
                          {n}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Sobe a pergunta na fila de pendentes.</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Base de conhecimento</CardTitle>
              <CardDescription>Transforme a resposta em conhecimento para a IA usar nas próximas perguntas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {d.linkedKnowledge.map((k) => (
                <p key={k.id}>
                  <Link className="underline" to={`${BASE}/conhecimento?id=${k.id}`}>
                    #{k.id} {k.title}
                  </Link>{' '}
                  <span className="text-muted-foreground">({KNOWLEDGE_LABELS[k.status] ?? k.status})</span>
                </p>
              ))}
              <Can module="assist_conhecimento" action="create">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`${BASE}/conhecimento?novo=1&pergunta=${qq.id}`}>Cadastrar conhecimento</Link>
                </Button>
              </Can>
            </CardContent>
          </Card>

          {d.sales.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vendas depois da pergunta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {d.sales.map((s) => (
                  <div key={s.id} className="rounded-md border p-2">
                    <p className="font-medium">
                      {s.outcomeLabel} · {s.total !== null ? money(s.total) : '—'}
                    </p>
                    <p className="text-muted-foreground">
                      Pedido {s.mlOrderId} · {formatDateTime(s.orderDate)}
                      {s.hoursAfterQuestion !== null && ` · ${Math.round(s.hoursAfterQuestion)} h depois`} · {s.matchType === 'mesmo_anuncio' ? 'mesmo anúncio' : 'outro anúncio da loja'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Observações internas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {canEdit && (
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (await run('obs', () => api.post(`/assistente/perguntas/${qq.id}/observacoes`, { note }), 'Observação registrada.')) setNote('')
                  }}
                >
                  <Textarea rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Só a equipe vê." />
                  <Button size="sm" type="submit" disabled={!note.trim() || !!busy}>
                    Registrar
                  </Button>
                </form>
              )}
              {d.notes.map((n) => (
                <div key={n.id} className="border-l-2 pl-3">
                  <p className="whitespace-pre-wrap">{n.note}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.userName} · {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
