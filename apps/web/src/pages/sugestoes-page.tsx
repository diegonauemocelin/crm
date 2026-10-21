import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, LightbulbIcon, Loader2Icon, MessageSquareReplyIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useCloseGuard } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { NAVIGATION } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { FormError } from './auth/auth-layout'

type Status = 'NOVA' | 'ANALISE' | 'PLANEJADA' | 'APLICADA' | 'RECUSADA'
const STATUS: Record<Status, { label: string; className: string }> = {
  NOVA: { label: 'Nova', className: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  ANALISE: { label: 'Em análise', className: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  PLANEJADA: { label: 'Planejada', className: 'border-violet-500/40 text-violet-700 dark:text-violet-300' },
  APLICADA: { label: 'Aplicada', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
  RECUSADA: { label: 'Não será feita', className: 'text-muted-foreground' },
}
const STATUSES = Object.keys(STATUS) as Status[]

interface Suggestion {
  id: string
  title: string
  description: string
  area: string | null
  imageUrl: string | null
  status: Status
  reply: string | null
  repliedByName: string | null
  repliedAt: string | null
  unread: boolean
  createdAt: string
  updatedAt: string
  userName?: string
}
interface ListData {
  total: number
  page: number
  pageSize: number
  counts: Record<Status, number>
  items: Suggestion[]
}

/** Telas do sistema (pelo menu) para a pessoa dizer onde é a sugestão. */
const AREAS = (() => {
  const seen = new Map<string, string>()
  for (const g of NAVIGATION) for (const i of g.items) if (i.module && !seen.has(i.module)) seen.set(i.module, i.title)
  return [...seen.entries()].map(([key, title]) => ({ key, title }))
})()
const areaTitle = (k: string | null) => (k ? (AREAS.find((a) => a.key === k)?.title ?? k) : null)
const ALL = '__all__'
const NONE = '__none__'

export function SugestoesPage() {
  return <Suggestions manager={false} />
}

export function SugestoesAnalisarPage() {
  return (
    <RequirePermission module="sugestoes">
      <Suggestions manager />
    </RequirePermission>
  )
}

function Suggestions({ manager }: { manager: boolean }) {
  const [status, setStatus] = useState<Status | null>(manager ? 'NOVA' : null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(manager ? { todas: 'true' } : {}), ...(status ? { situacao: status } : {}), ...(q ? { busca: q } : {}), pagina: String(page) }).toString()
  const list = useQuery({ queryKey: ['sugestoes', qs], queryFn: () => api.get<ListData>(`/sugestoes?${qs}`), placeholderData: keepPreviousData })
  const d = list.data
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1
  return (
    <div>
      <PageHeader
        title={manager ? 'Analisar sugestões' : 'Minhas sugestões'}
        description={manager ? 'Sugestões de melhoria de toda a equipe. Mude a situação e responda: quem enviou é avisado no menu e por e-mail.' : 'Viu algo que pode melhorar no sistema? Envie aqui. A administração analisa e responde, e você acompanha cada sugestão.'}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> Nova sugestão
          </Button>
        }
      />
      {creating && <NewSuggestion onClose={() => setCreating(false)} />}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={status ?? ALL} onValueChange={(v) => v && (setStatus(v === ALL ? null : (v as Status)), setPage(1))} aria-label="Situação">
            <ToggleGroupItem value={ALL} className="px-3">
              Todas
            </ToggleGroupItem>
            {STATUSES.map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-3">
                {STATUS[s].label}
                {d && d.counts[s] > 0 && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{d.counts[s]}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8" placeholder={manager ? 'Título, texto ou quem enviou' : 'Buscar'} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Buscar sugestão" />
          </div>
        </div>
        {list.isLoading && <TableSkeleton rows={4} />}
        {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {d && d.items.length === 0 && (
          <EmptyState
            icon={LightbulbIcon}
            title={status || q ? 'Nenhuma sugestão com esses filtros' : manager ? 'Nenhuma sugestão ainda' : 'Você ainda não enviou sugestões'}
            description={manager ? undefined : 'Clique em “Nova sugestão” e conte o que mudaria e por quê.'}
          />
        )}
        {d?.items.map((s) => <SuggestionCard key={s.id} s={s} manager={manager} />)}
        {d && pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {page} de {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionCard({ s, manager }: { s: Suggestion; manager: boolean }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canAnswer = manager && can('sugestoes', 'edit')
  const [status, setStatus] = useState<Status>(s.status)
  const [reply, setReply] = useState(s.reply ?? '')
  // Quem enviou viu a resposta: tira o aviso do menu.
  useEffect(() => {
    if (!manager && s.unread) {
      void api.post(`/sugestoes/${s.id}/vista`).then(() => qc.invalidateQueries({ queryKey: ['sugestoes-avisos'] }))
    }
  }, [manager, s.unread, s.id, qc])
  const save = useMutation({
    mutationFn: () => api.patch<Suggestion>(`/sugestoes/${s.id}`, { status, reply: reply.trim() || null }),
    onSuccess: () => {
      toast.success('Sugestão atualizada. Quem enviou foi avisado.')
      void qc.invalidateQueries({ queryKey: ['sugestoes'] })
      void qc.invalidateQueries({ queryKey: ['sugestoes-avisos'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const changed = status !== s.status || reply.trim() !== (s.reply ?? '')
  return (
    <Card className={cn(!manager && s.unread && 'border-primary/50 ring-1 ring-primary/20')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{s.title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {[manager ? s.userName : null, areaTitle(s.area), `enviada em ${formatDateTime(s.createdAt)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!manager && s.unread && <Badge>Novidade</Badge>}
          <Badge variant="outline" className={(STATUS[s.status] ?? STATUS.NOVA).className}>
            {(STATUS[s.status] ?? { label: s.status }).label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm break-words whitespace-pre-wrap">{s.description}</p>
        {s.imageUrl && (
          <a href={s.imageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ImageIcon className="size-4" /> Ver imagem anexada
          </a>
        )}
        {s.reply && !canAnswer && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquareReplyIcon className="size-3.5" /> Resposta{s.repliedByName ? ` de ${s.repliedByName}` : ''}
              {s.repliedAt ? ` · ${formatDateTime(s.repliedAt)}` : ''}
            </p>
            <p className="break-words whitespace-pre-wrap">{s.reply}</p>
          </div>
        )}
        {canAnswer && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`st-${s.id}`} className="text-sm">
                Situação
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger id={`st-${s.id}`} size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {STATUS[x].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {s.repliedByName && <span className="text-xs text-muted-foreground">Última resposta de {s.repliedByName}{s.repliedAt ? ` em ${formatDateTime(s.repliedAt)}` : ''}</span>}
            </div>
            <Textarea rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Resposta para quem enviou (ex.: obrigado, vai entrar na próxima versão)." aria-label="Resposta" />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => save.mutate()} disabled={!changed || save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />} Salvar e avisar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NewSuggestion({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState<string | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const guard = useCloseGuard(!!(title.trim() || description.trim() || area || image), onClose, 'a sugestão')
  const save = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('title', title.trim())
      form.append('description', description.trim())
      if (area) form.append('area', area)
      if (image) form.append('imagem', image)
      return api.post('/sugestoes', form)
    },
    onSuccess: () => {
      toast.success('Sugestão enviada. Obrigado! Você acompanha a resposta aqui.')
      void qc.invalidateQueries({ queryKey: ['sugestoes'] })
      void qc.invalidateQueries({ queryKey: ['sugestoes-avisos'] })
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Nova sugestão</DialogTitle>
            <DialogDescription>Conte o que mudaria e por quê. Quanto mais concreto, mais fácil de aplicar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sg-title" required>Título</Label>
            <Input id="sg-title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Filtrar leads pela marca da máquina" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sg-area">Tela do sistema (opcional)</Label>
            <Select value={area ?? NONE} onValueChange={(v) => setArea(v === NONE ? null : v)}>
              <SelectTrigger id="sg-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Geral / não sei</SelectItem>
                {AREAS.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sg-desc" required>Descrição</Label>
            <Textarea id="sg-desc" required minLength={5} maxLength={4000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que acontece hoje, o que você gostaria e como isso ajuda no dia a dia." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            <Button type="button" size="sm" variant="outline" onClick={() => file.current?.click()}>
              <ImageIcon /> {image ? 'Trocar imagem' : 'Anexar print (opcional)'}
            </Button>
            {image && (
              <span className="truncate text-xs text-muted-foreground">
                {image.name}{' '}
                <button type="button" className="underline" onClick={() => setImage(null)} aria-label={`Remover imagem ${image.name}`}>
                  remover
                </button>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Não coloque dados de clientes (CPF, telefone) na sugestão nem no print.</p>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Enviar sugestão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
