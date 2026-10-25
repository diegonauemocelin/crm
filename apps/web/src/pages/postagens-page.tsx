import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon, CalendarDaysIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, Loader2Icon, PlusIcon, PlugZapIcon, SendIcon, SparklesIcon, Trash2Icon, UndoIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { type Account, AccountPicker, AccountsTab, MetricsTab, NetBadge } from '@/components/postagens/contas'
import { type Frame } from '@/components/postagens/imagem'
import { LibraryTab, MediaPicker, mediaSrc, Thumb, useMediaLibrary } from '@/components/postagens/midias'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

type Network = 'instagram' | 'facebook'
type Format = 'FEED' | 'STORIES' | 'REELS'
type Status = 'RASCUNHO' | 'EM_APROVACAO' | 'APROVADO' | 'PUBLICANDO' | 'PUBLICADO' | 'ERRO'
interface Post {
  id: string
  title: string
  caption: string
  accountIds: string[]
  networks: Network[]
  format: Format
  mediaIds: string[]
  scheduledAt: string | null
  status: Status
  results: Record<string, { id?: string; permalink?: string | null; error?: string; network?: Network; name?: string }> | null
  error: string | null
  reviewNote: string | null
  createdByName: string | null
  approvedByName: string | null
  approvedAt: string | null
  publishedAt: string | null
  createdAt: string
}
interface Config {
  hasToken: boolean
  accounts: Account[]
  hasAi: boolean
  canApprove: boolean
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  RASCUNHO: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground' },
  EM_APROVACAO: { label: 'Aguardando aprovação', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200' },
  APROVADO: { label: 'Agendada', cls: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200' },
  PUBLICANDO: { label: 'Publicando', cls: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200' },
  PUBLICADO: { label: 'Publicada', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200' },
  ERRO: { label: 'Erro', cls: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200' },
}
const FORMAT: Record<Format, string> = { FEED: 'Feed', STORIES: 'Stories', REELS: 'Reels' }

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Valor do campo datetime-local (hora do navegador). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function PostagensPage() {
  usePageTitle('Postagens')
  const qc = useQueryClient()
  const [tab, setTab] = useState('calendario')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [open, setOpen] = useState<{ id: string | null; date?: string } | null>(null)
  const [plan, setPlan] = useState(false)
  const [test, setTest] = useState(false)
  const config = useQuery({ queryKey: ['postagens-config'], queryFn: () => api.get<Config>('/postagens/config') })
  const from = new Date(month.getFullYear(), month.getMonth(), 1 - 7)
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 7)
  const list = useQuery({
    queryKey: ['postagens', dayKey(month)],
    queryFn: () => api.get<{ items: Post[]; waiting: number; errors: number }>(`/postagens?de=${from.toISOString()}&ate=${to.toISOString()}`),
    refetchInterval: (q) => (q.state.data?.items.some((p) => p.status === 'PUBLICANDO' || (p.status === 'APROVADO' && (!p.scheduledAt || Date.parse(p.scheduledAt) < Date.now() + 120_000))) ? 10_000 : 60_000),
  })
  const waiting = useQuery({ queryKey: ['postagens', 'aprovar'], queryFn: () => api.get<{ items: Post[] }>('/postagens?situacao=EM_APROVACAO') })
  const c = config.data
  const missing = c && (!c.hasToken || !c.accounts.length)
  return (
    <RequirePermission module="postagens">
      <PageHeader
        title="Postagens"
        description="Planeje as postagens do Instagram e do Facebook: feed, Stories e Reels, com imagens próprias, artes com a marca e textos da IA gratuita. Depois de aprovadas, saem sozinhas no dia e na hora marcados."
        actions={
          <div className="flex flex-wrap gap-2">
            <Can module="postagens" action="edit">
              <Button variant="outline" onClick={() => setTest(true)}>
                <PlugZapIcon /> Testar publicação
              </Button>
            </Can>
            <Can module="postagens" action="create">
              <Button variant="outline" onClick={() => setPlan(true)}>
                <SparklesIcon /> Calendário com IA
              </Button>
              <Button onClick={() => setOpen({ id: null })}>
                <PlusIcon /> Nova postagem
              </Button>
            </Can>
          </div>
        }
      />
      {missing && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {!c.hasToken ? 'Para publicar, cadastre o token da Meta em Configurações › Marketing Inteligente' : 'Cadastre as contas do Instagram e do Facebook na aba Contas'}. O token precisa das permissões instagram_content_publish e pages_manage_posts.
          </span>
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="calendario">
            <CalendarDaysIcon /> Calendário
          </TabsTrigger>
          <TabsTrigger value="aprovar">Aguardando aprovação{waiting.data?.items.length ? ` (${waiting.data.items.length})` : ''}</TabsTrigger>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
          <TabsTrigger value="metricas">Métricas</TabsTrigger>
          <TabsTrigger value="contas">Contas{c ? ` (${c.accounts.length})` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="calendario">
          {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <Calendar month={month} setMonth={setMonth} posts={list.data?.items} onOpen={(id) => setOpen({ id })} onNew={(date) => setOpen({ id: null, date })} />}
        </TabsContent>
        <TabsContent value="aprovar">
          <ApprovalList posts={waiting.data?.items} loading={waiting.isLoading} onOpen={(id) => setOpen({ id })} />
        </TabsContent>
        <TabsContent value="biblioteca">
          <LibraryTab />
        </TabsContent>
        <TabsContent value="metricas">{tab === 'metricas' && <MetricsTab />}</TabsContent>
        <TabsContent value="contas">
          <AccountsTab accounts={c?.accounts ?? []} />
        </TabsContent>
      </Tabs>
      {open && (
        <PostSheet
          id={open.id}
          date={open.date}
          config={c}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['postagens'] })
          }}
        />
      )}
      <PlanDialog open={plan} onClose={() => setPlan(false)} accounts={c?.accounts ?? []} />
      <TestDialog open={test} onClose={() => setTest(false)} />
    </RequirePermission>
  )
}

function PostChip({ p, onOpen }: { p: Post; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn('flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight', STATUS[p.status].cls)} title={`${p.title} · ${STATUS[p.status].label}`}>
      {p.networks.map((n) => (
        <NetBadge key={n} n={n} className="size-3.5 text-[8px]" />
      ))}
      <span className="shrink-0 font-medium">{p.scheduledAt ? timeOf(p.scheduledAt) : '—'}</span>
      <span className="truncate">{p.title}</span>
    </button>
  )
}

function Calendar({ month, setMonth, posts, onOpen, onNew }: { month: Date; setMonth: (d: Date) => void; posts?: Post[]; onOpen: (id: string) => void; onNew: (date: string) => void }) {
  const { can } = useAuth()
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [month])
  const byDay = new Map<string, Post[]>()
  for (const p of posts ?? []) {
    const at = p.scheduledAt ?? p.publishedAt
    if (!at) continue
    const k = dayKey(new Date(at))
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }
  const undated = (posts ?? []).filter((p) => !p.scheduledAt && !p.publishedAt)
  const today = dayKey(new Date())
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior">
          <ChevronLeftIcon />
        </Button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())}</h2>
        <Button size="icon" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês">
          <ChevronRightIcon />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Hoje
        </Button>
        <span className="ml-auto flex flex-wrap gap-1.5 text-xs">
          {(['RASCUNHO', 'EM_APROVACAO', 'APROVADO', 'PUBLICADO', 'ERRO'] as Status[]).map((s) => (
            <span key={s} className={cn('rounded px-1.5 py-0.5', STATUS[s].cls)}>
              {STATUS[s].label}
            </span>
          ))}
        </span>
      </div>
      {undated.length > 0 && (
        <Card className="gap-1 p-3">
          <p className="text-xs font-medium text-muted-foreground">Sem data (saem assim que aprovadas)</p>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((p) => (
              <div key={p.id} className="w-56">
                <PostChip p={p} onOpen={() => onOpen(p.id)} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {!posts ? (
        <TableSkeleton rows={6} />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-lg border">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} className="border-b bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const k = dayKey(d)
              const list = byDay.get(k) ?? []
              const other = d.getMonth() !== month.getMonth()
              return (
                <div key={k} className={cn('group min-h-28 space-y-1 border-r border-b p-1 last:border-r-0', other && 'bg-muted/30')}>
                  <div className="flex items-center justify-between">
                    <span className={cn('flex size-6 items-center justify-center rounded-full text-xs', k === today ? 'bg-primary font-bold text-primary-foreground' : other ? 'text-muted-foreground' : '')}>{d.getDate()}</span>
                    {can('postagens', 'create') && k >= today && (
                      <button type="button" onClick={() => onNew(k)} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100" aria-label={`Nova postagem em ${d.toLocaleDateString('pt-BR')}`}>
                        <PlusIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {list.map((p) => (
                    <PostChip key={p.id} p={p} onOpen={() => onOpen(p.id)} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalList({ posts, loading, onOpen }: { posts?: Post[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading || !posts) return <TableSkeleton rows={4} />
  if (!posts.length) return <EmptyState icon={CheckIcon} title="Nada aguardando aprovação" description="As postagens enviadas para aprovação aparecem aqui." />
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {posts.map((p) => (
        <Card key={p.id} className="cursor-pointer gap-2 p-3 hover:shadow-md" onClick={() => onOpen(p.id)}>
          <div className="flex gap-3">
            {p.mediaIds[0] ? <img src={mediaSrc(p.mediaIds[0])} alt="" className="size-20 shrink-0 rounded-md object-cover" /> : <span className="size-20 shrink-0 rounded-md bg-muted" />}
            <div className="min-w-0 space-y-1">
              <p className="line-clamp-1 font-medium">{p.title}</p>
              <p className="text-xs text-muted-foreground">
                {p.accountIds.length} conta(s) · {FORMAT[p.format]} · {p.scheduledAt ? formatDateTime(p.scheduledAt) : 'assim que aprovada'}
              </p>
              <p className="line-clamp-2 text-xs">{p.caption}</p>
              <p className="text-xs text-muted-foreground">Por {p.createdByName ?? '—'}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------- Editar postagem ----------

function PostSheet({ id, date, config, onClose, onChanged }: { id: string | null; date?: string; config?: Config; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['postagem', id], queryFn: () => api.get<Post>(`/postagens/${id}`), enabled: !!id })
  const [postId, setPostId] = useState<string | null>(id)
  const [f, setF] = useState({ title: '', caption: '', accountIds: (config?.accounts ?? []).map((a) => a.id), format: 'FEED' as Format, mediaIds: [] as string[], scheduledAt: date ? `${date}T09:00` : '' })
  const [loaded, setLoaded] = useState(!id)
  useEffect(() => {
    if (q.data && !loaded) {
      setF({ title: q.data.title, caption: q.data.caption, accountIds: q.data.accountIds, format: q.data.format, mediaIds: q.data.mediaIds, scheduledAt: toLocalInput(q.data.scheduledAt) })
      setLoaded(true)
    }
  }, [q.data, loaded])
  const post = q.data
  const status: Status = post?.status ?? 'RASCUNHO'
  const locked = status === 'PUBLICADO' || status === 'PUBLICANDO' || !can('postagens', 'create')
  const library = useMediaLibrary()
  const media = f.mediaIds.map((m) => library.data?.items.find((x) => x.id === m)).filter((m) => !!m)
  const frame: Frame = f.format === 'FEED' ? 'quadrado' : 'stories'
  const body = () => ({ ...f, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null })
  const refresh = () => {
    onChanged()
    void q.refetch()
  }
  const save = async () => {
    if (postId) return api.put<Post & { message?: string }>(`/postagens/${postId}`, body())
    const r = await api.post<Post>('/postagens', body())
    setPostId(r.id)
    return r
  }
  const act = useMutation({
    mutationFn: async (a: 'salvar' | 'enviar' | 'aprovar' | 'publicar') => {
      const saved = locked ? null : await save()
      const target = saved?.id ?? postId
      if (a === 'salvar') return (saved as { message?: string } | null)?.message ?? 'Salvo.'
      if (a === 'enviar') return (await api.post<{ message: string }>(`/postagens/${target}/enviar-aprovacao`)).message
      if (a === 'aprovar') return (await api.post<{ message: string }>(`/postagens/${target}/aprovar`)).message
      return (await api.post<{ message: string }>(`/postagens/${target}/publicar`)).message
    },
    onSuccess: (msg, a) => {
      toast.success(msg)
      refresh()
      if (a !== 'salvar') onClose()
    },
    onError: (err) => {
      toast.error(errorMessage(err), { duration: 12_000 })
      refresh()
    },
  })
  const reject = useMutation({
    mutationFn: (nota: string) => api.post<{ message: string }>(`/postagens/${postId}/devolver`, { nota }),
    onSuccess: (r) => (toast.success(r.message), refresh(), onClose()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete<{ message: string }>(`/postagens/${postId}`),
    onSuccess: (r) => (toast.success(r.message), onChanged(), onClose()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [topic, setTopic] = useState('')
  const nets = [...new Set(f.accountIds.map((id) => config?.accounts.find((a) => a.id === id)?.network).filter((n): n is Network => !!n))]
  const ai = useMutation({
    mutationFn: (improve: boolean) => api.post<{ caption: string }>('/postagens/ia/legenda', { topic: topic || f.title, network: nets.length === 2 ? 'ambos' : (nets[0] ?? 'instagram'), format: f.format, ...(improve ? { current: f.caption } : {}) }),
    onSuccess: (r) => setF((x) => ({ ...x, caption: r.caption })),
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const hashtags = (f.caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length

  const busy = act.isPending || reject.isPending || remove.isPending

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {id ? 'Postagem' : 'Nova postagem'} <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS[status].cls)}>{STATUS[status].label}</span>
          </SheetTitle>
          <SheetDescription>
            {post ? `Criada por ${post.createdByName ?? '—'}${post.approvedByName ? ` · aprovada por ${post.approvedByName}` : ''}${post.publishedAt ? ` · publicada em ${formatDateTime(post.publishedAt)}` : ''}` : 'Monte a postagem, salve e mande para aprovação.'}
          </SheetDescription>
        </SheetHeader>
        {id && !loaded ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            {post?.reviewNote && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{post.reviewNote}</p>}
            {post?.error && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">{post.error}</p>}
            {post?.results && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(post.results).map(([id, r]) =>
                  r.id ? (
                    <a key={id} href={r.permalink ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:bg-muted">
                      <CheckIcon className="size-4 text-emerald-600" /> {r.network && <NetBadge n={r.network} />} {r.name ?? 'Ver'} <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : (
                    <span key={id} className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-2 py-1 text-sm text-red-800 dark:text-red-300" title={r.error}>
                      <AlertCircleIcon className="size-4" /> {r.network && <NetBadge n={r.network} />} {r.name ?? id}
                    </span>
                  ),
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-title">Título interno</Label>
                <Input id="p-title" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={locked} placeholder="Ex.: Promoção de filtros de novembro" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-date">Data e hora</Label>
                <Input id="p-date" type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} disabled={locked} />
                <p className="text-xs text-muted-foreground">Em branco: sai assim que for aprovada.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Onde publicar</Label>
              <AccountPicker accounts={config?.accounts ?? []} value={f.accountIds} onChange={(ids) => setF({ ...f, accountIds: ids })} disabled={locked} />
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                <Label>Formato</Label>
                <Select value={f.format} onValueChange={(v) => setF({ ...f, format: v as Format })} disabled={locked}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEED">Feed (imagem, carrossel ou vídeo)</SelectItem>
                    <SelectItem value="STORIES">Stories (1 imagem ou vídeo)</SelectItem>
                    <SelectItem value="REELS">Reels (vídeo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Imagens ou vídeo</Label>
              <MediaPicker value={f.mediaIds} onChange={(ids) => setF({ ...f, mediaIds: ids })} frame={frame} disabled={locked} />
              <p className="text-xs text-muted-foreground">Feed: 1 imagem, carrossel de até 10 ou 1 vídeo. Stories: 1 imagem ou vídeo (9:16). Reels: 1 vídeo vertical.</p>
            </div>
            {f.format !== 'STORIES' || f.caption ? (
              <div className="space-y-1.5">
                <div className="flex items-end justify-between gap-2">
                  <Label htmlFor="p-cap">Legenda</Label>
                  <span className={cn('text-xs tabular-nums', f.caption.length > 2200 || hashtags > 30 ? 'text-destructive' : 'text-muted-foreground')}>
                    {f.caption.length}/2200 · {hashtags}/30 hashtags
                  </span>
                </div>
                <Textarea id="p-cap" rows={8} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} disabled={locked} />
                {!locked && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tema para a IA (ex.: material rodante Komatsu PC200, pronta entrega)" className="min-w-60 flex-1" />
                    <Button type="button" size="sm" variant="outline" onClick={() => ai.mutate(false)} disabled={ai.isPending || !config?.hasAi || (!topic.trim() && !f.title.trim())}>
                      {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Escrever com IA
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => ai.mutate(true)} disabled={ai.isPending || !config?.hasAi || !f.caption.trim()}>
                      Melhorar
                    </Button>
                    {!config?.hasAi && <span className="text-xs text-muted-foreground">Cadastre a chave gratuita do Gemini em Configurações › E-mail marketing.</span>}
                  </div>
                )}
              </div>
            ) : null}
            {media.length > 0 && (
              <div className="space-y-1.5">
                <Label>Prévia</Label>
                <div className="flex gap-3 overflow-x-auto rounded-lg border bg-muted/30 p-3">
                  <div className={cn('shrink-0 overflow-hidden rounded-md bg-black', f.format === 'FEED' ? 'w-56' : 'w-40')}>
                    <Thumb m={media[0]!} className={cn('w-full', f.format === 'FEED' ? 'aspect-square' : 'aspect-[9/16]')} />
                  </div>
                  <p className="line-clamp-[12] text-sm whitespace-pre-wrap">{f.caption || <span className="text-muted-foreground">Sem legenda</span>}</p>
                </div>
              </div>
            )}
            {rejecting && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="p-note">O que ajustar (aparece para quem criou)</Label>
                <Textarea id="p-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => reject.mutate(note)} disabled={reject.isPending}>
                    <UndoIcon /> {status === 'APROVADO' ? 'Cancelar agendamento' : 'Devolver para ajustes'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                    Voltar
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {!locked && (
                <Button variant="outline" onClick={() => act.mutate('salvar')} disabled={busy}>
                  Salvar
                </Button>
              )}
              {!locked && (status === 'RASCUNHO' || status === 'ERRO') && !post?.approvedAt && (
                <Button onClick={() => act.mutate('enviar')} disabled={busy}>
                  {act.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar para aprovação
                </Button>
              )}
              {can('postagens', 'edit') && status === 'EM_APROVACAO' && (
                <Button onClick={() => act.mutate('aprovar')} disabled={busy}>
                  <CheckIcon /> Aprovar {f.scheduledAt ? 'e agendar' : 'e publicar'}
                </Button>
              )}
              {can('postagens', 'edit') && (status === 'APROVADO' || (status === 'ERRO' && !!post?.approvedAt)) && (
                <Button
                  onClick={async () => (await confirm({ title: 'Publicar agora?', description: status === 'ERRO' ? 'Tenta de novo só nas redes que falharam.' : 'A postagem sai agora, sem esperar a data marcada.', confirmLabel: 'Publicar agora' })) && act.mutate('publicar')}
                  disabled={busy}
                >
                  <SendIcon /> {status === 'ERRO' ? 'Tentar de novo' : 'Publicar agora'}
                </Button>
              )}
              {can('postagens', 'edit') && (status === 'EM_APROVACAO' || status === 'APROVADO') && !rejecting && (
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                  <UndoIcon /> {status === 'APROVADO' ? 'Cancelar agendamento' : 'Devolver'}
                </Button>
              )}
              {postId && can('postagens', 'delete') && status !== 'PUBLICANDO' && (
                <Button variant="ghost" className="ml-auto text-destructive" onClick={async () => (await confirm({ title: 'Apagar esta postagem?', description: status === 'PUBLICADO' ? 'Sai do CRM; a publicação continua no Instagram/Facebook.' : 'Não dá para desfazer.', confirmLabel: 'Apagar' })) && remove.mutate()} disabled={busy}>
                  <Trash2Icon /> Apagar
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------- Calendário com IA ----------

interface PlanItem {
  date: string
  time: string
  format: Format
  title: string
  caption: string
  imageIdea: string
}

function PlanDialog({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: Account[] }) {
  const qc = useQueryClient()
  const start = new Date()
  start.setDate(start.getDate() + 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 27)
  const [d, setD] = useState({ from: dayKey(start), to: dayKey(end), perWeek: 3, themes: '', accountIds: accounts.map((a) => a.id), formats: ['FEED', 'STORIES'] as Format[], times: '09:00, 12:00, 18:00' })
  useEffect(() => {
    if (open) setD((x) => ({ ...x, accountIds: x.accountIds.length ? x.accountIds : accounts.map((a) => a.id) }))
  }, [open, accounts])
  const [items, setItems] = useState<(PlanItem & { on: boolean })[]>([])
  const gen = useMutation({
    mutationFn: () => api.post<{ items: PlanItem[] }>('/postagens/ia/calendario', { ...d, times: d.times.split(/[,\s]+/).filter((t) => /^\d{2}:\d{2}$/.test(t)) }),
    onSuccess: (r) => setItems(r.items.map((i) => ({ ...i, on: true }))),
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const create = useMutation({
    mutationFn: () => api.post<{ message: string }>('/postagens/ia/rascunhos', { items: items.filter((i) => i.on).map(({ on: _on, ...i }) => i), accountIds: d.accountIds }),
    onSuccess: (r) => {
      toast.success(r.message)
      void qc.invalidateQueries({ queryKey: ['postagens'] })
      setItems([])
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const toggle = <T extends string>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Calendário com IA</DialogTitle>
          <DialogDescription>A IA gratuita (Gemini) sugere as postagens do período com legenda e ideia de imagem. Elas viram rascunhos: escolha as imagens e mande para aprovação.</DialogDescription>
        </DialogHeader>
        {!items.length ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pl-from">De</Label>
                <Input id="pl-from" type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-to">Até</Label>
                <Input id="pl-to" type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-w">Postagens por semana</Label>
                <Input id="pl-w" type="number" min={1} max={14} value={d.perWeek} onChange={(e) => setD({ ...d, perWeek: Number(e.target.value) || 3 })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-t">Temas e campanhas do período</Label>
              <Textarea id="pl-t" rows={3} maxLength={800} value={d.themes} onChange={(e) => setD({ ...d, themes: e.target.value })} placeholder="Ex.: material rodante para escavadeiras, filtros Komatsu e Caterpillar, dicas de manutenção, Black Friday de 27/11" />
            </div>
            <div className="space-y-1.5">
              <Label>Contas</Label>
              <AccountPicker accounts={accounts} value={d.accountIds} onChange={(ids) => setD({ ...d, accountIds: ids })} />
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                <Label>Formatos</Label>
                <div className="flex gap-3">
                  {(['FEED', 'STORIES', 'REELS'] as Format[]).map((fm) => (
                    <label key={fm} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={d.formats.includes(fm)} onCheckedChange={(v) => setD({ ...d, formats: toggle(d.formats, fm, !!v) })} /> {FORMAT[fm]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-h">Horários</Label>
                <Input id="pl-h" value={d.times} onChange={(e) => setD({ ...d, times: e.target.value })} className="w-48" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <label key={i} className="flex gap-3 rounded-md border p-2 text-sm">
                <Checkbox checked={it.on} onCheckedChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, on: !!v } : x)))} className="mt-1" />
                <span className="min-w-0 space-y-1">
                  <span className="block font-medium">
                    {new Date(`${it.date}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} {it.time} · {FORMAT[it.format]} · {it.title}
                  </span>
                  <span className="line-clamp-3 block whitespace-pre-wrap text-muted-foreground">{it.caption}</span>
                  {it.imageIdea && <span className="block text-xs text-muted-foreground">Imagem: {it.imageIdea}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          {items.length ? (
            <>
              <Button variant="outline" onClick={() => setItems([])}>
                Refazer
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending || !items.some((i) => i.on)}>
                {create.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Criar {items.filter((i) => i.on).length} rascunho(s)
              </Button>
            </>
          ) : (
            <Button onClick={() => gen.mutate()} disabled={gen.isPending || !d.accountIds.length || !d.formats.length}>
              {gen.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Sugerir calendário
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useMutation({ mutationFn: () => api.post<{ checks: { name: string; ok: boolean; message: string }[] }>('/postagens/testar') })
  useEffect(() => {
    if (open) t.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Testar publicação</DialogTitle>
          <DialogDescription>Confere as permissões do token da Meta, o Instagram e a página do Facebook. Nada é publicado.</DialogDescription>
        </DialogHeader>
        {t.isPending && <Loader2Icon className="mx-auto animate-spin" />}
        {t.error && <p className="text-sm text-destructive">{errorMessage(t.error)}</p>}
        <ul className="space-y-1.5">
          {t.data?.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-sm">
              {c.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <span>
                <span className="font-medium">{c.name}</span>: {c.message}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Badge variant="secondary" className="mr-auto">
            Instagram: até 50 publicações por dia
          </Badge>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
