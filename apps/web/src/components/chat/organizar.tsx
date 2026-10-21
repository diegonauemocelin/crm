import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon, PaperclipIcon, PencilIcon, PlusIcon, SettingsIcon, TagIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { InlineError } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/** Etiquetas e respostas rápidas do chat: padrão da empresa (todos veem) ou pessoais (cada usuário cria as suas). */

export interface ChatLabel {
  id: string
  name: string
  color: string
  standard?: boolean
  mine?: boolean
}
export interface QuickReply {
  id: string
  title: string
  text: string
  preview?: string
  standard: boolean
  mine: boolean
  /** Arquivo que vai junto (o texto vira a legenda). */
  fileName?: string | null
}

const REPLY_FILE_TYPES = 'application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp,video/mp4'

/**
 * Arquivo da resposta rápida (catálogo em PDF, tabela, foto): escolhe um novo (vai junto ao salvar) ou tira o atual.
 * Quem chama envia o arquivo com saveReplyFile depois de salvar o texto.
 */
export function ReplyFileField({ current, picked, removed, onPick, onRemove }: { current?: string | null; picked: File | null; removed: boolean; onPick: (f: File | null) => void; onRemove: (v: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const name = picked?.name ?? (removed ? null : current)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={REPLY_FILE_TYPES}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          if (f && f.size > 64 * 1024 * 1024) return void toast.error('Arquivo maior que 64 MB.')
          onPick(f)
          onRemove(false)
        }}
      />
      <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
        <PaperclipIcon /> {name ? 'Trocar arquivo' : 'Anexar arquivo (PDF, catálogo...)'}
      </Button>
      {name && (
        <>
          <span className="min-w-0 max-w-56 truncate text-xs text-muted-foreground" title={name}>
            {name}
          </span>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => (onPick(null), onRemove(true))} aria-label={`Remover o arquivo ${name}`}>
            Remover
          </Button>
        </>
      )}
    </div>
  )
}

/** Depois de salvar a resposta: manda o arquivo escolhido ou tira o que tinha. */
export async function saveReplyFile(replyId: string, picked: File | null, removed: boolean) {
  if (picked) {
    const fd = new FormData()
    fd.append('file', picked)
    await api.post(`/chat/respostas/${replyId}/arquivo`, fd)
  } else if (removed) await api.delete(`/chat/respostas/${replyId}/arquivo`)
}

export const LABEL_COLORS = ['cinza', 'vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa'] as const
const LABEL_STYLE: Record<string, { chip: string; dot: string; name: string }> = {
  cinza: { chip: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-200', dot: 'bg-zinc-500', name: 'Cinza' },
  vermelho: { chip: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300', dot: 'bg-red-600', name: 'Vermelho' },
  laranja: { chip: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300', dot: 'bg-orange-500', name: 'Laranja' },
  amarelo: { chip: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300', dot: 'bg-amber-400', name: 'Amarelo' },
  verde: { chip: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300', dot: 'bg-green-600', name: 'Verde' },
  azul: { chip: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300', dot: 'bg-sky-600', name: 'Azul' },
  roxo: { chip: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300', dot: 'bg-violet-600', name: 'Roxo' },
  rosa: { chip: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300', dot: 'bg-pink-500', name: 'Rosa' },
}
const styleOf = (c: string) => LABEL_STYLE[c] ?? LABEL_STYLE.cinza!

export function LabelChip({ label, className }: { label: Pick<ChatLabel, 'name' | 'color'>; className?: string }) {
  return <span className={cn('inline-flex max-w-full items-center truncate rounded px-1.5 text-xs leading-[18px] font-medium', styleOf(label.color).chip, className)}>{label.name}</span>
}

export function useLabels() {
  return useQuery({ queryKey: ['chat-etiquetas'], queryFn: () => api.get<ChatLabel[]>('/chat/etiquetas'), staleTime: 60_000 })
}

/** Etiquetas da conversa: marcar e desmarcar (só as que este usuário vê). */
export function LabelPicker({ conversationId, value }: { conversationId: string; value: ChatLabel[] }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const labels = useLabels()
  const [managing, setManaging] = useState(false)
  const selected = new Set(value.map((l) => l.id))
  const save = useMutation({
    mutationFn: (ids: string[]) => api.put(`/chat/conversas/${conversationId}/etiquetas`, { labelIds: ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const toggle = (id: string) => save.mutate(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id])
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" title="Etiquetas da conversa" aria-label="Etiquetas">
            <TagIcon /> <span className="hidden @4xl/head:inline">Etiquetas</span>
            {value.length > 0 && <span className="rounded bg-muted px-1 text-xs tabular-nums">{value.length}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          {labels.error && !labels.data && (
            <div className="px-2 py-2">
              <InlineError error={labels.error} onRetry={() => void labels.refetch()} />
            </div>
          )}
          {labels.data?.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Nenhuma etiqueta ainda. Crie as suas em “Gerenciar etiquetas”.</p>}
          <ul className="max-h-72 overflow-y-auto">
            {labels.data?.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  disabled={!can('chat', 'edit') || save.isPending}
                  onClick={() => toggle(l.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60"
                  aria-pressed={selected.has(l.id)}
                >
                  <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', selected.has(l.id) && 'border-primary bg-primary text-primary-foreground')}>{selected.has(l.id) && <CheckIcon className="size-3" />}</span>
                  <span className={cn('size-2.5 shrink-0 rounded-full', styleOf(l.color).dot)} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  {l.standard && <span className="text-xs text-muted-foreground">padrão</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t pt-1">
            <button type="button" onClick={() => setManaging(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <SettingsIcon className="size-4" /> Gerenciar etiquetas
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {managing && <ManageLabelsDialog onClose={() => setManaging(false)} />}
    </>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={styleOf(c).name}
          title={styleOf(c).name}
          onClick={() => onChange(c)}
          className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background', styleOf(c).dot, value === c && 'ring-2 ring-foreground')}
        >
          {value === c && <CheckIcon className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}

/** Criar, renomear, trocar a cor e excluir etiquetas (as pessoais de cada um; as padrão, quem administra o WhatsApp). */
export function ManageLabelsDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAuth()
  const admin = can('whatsapp', 'edit')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Etiquetas do chat</DialogTitle>
          <DialogDescription>Organize as conversas com etiquetas coloridas. As pessoais só você vê; as padrão aparecem para todos{admin ? ' (só administradores criam)' : ''}.</DialogDescription>
        </DialogHeader>
        <LabelsManager />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A lista de etiquetas com o formulário (na janela do chat e em Configurações › Etiquetas do chat). */
export function LabelsManager() {
  const { can } = useAuth()
  const admin = can('whatsapp', 'edit')
  const qc = useQueryClient()
  const labels = useLabels()
  const [editing, setEditing] = useState<ChatLabel | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>('azul')
  const [standard, setStandard] = useState(false)
  const reset = () => (setEditing(null), setName(''), setColor('azul'), setStandard(false))
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-etiquetas'] })
    void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
  }
  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/chat/etiquetas/${editing.id}`, { name, color }) : api.post('/chat/etiquetas', { name, color, standard })),
    onSuccess: () => {
      refresh()
      reset()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/etiquetas/${id}`),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const confirm = useConfirm()
  const canEdit = (l: ChatLabel) => (l.standard ? admin : l.mine)
  const remove = async (l: ChatLabel) => {
    if (await confirm({ title: `Excluir a etiqueta “${l.name}”?`, description: 'Ela sai de todas as conversas. Não dá para desfazer.', confirmLabel: 'Excluir etiqueta' })) del.mutate(l.id)
  }
  return (
    <div className="max-w-xl space-y-3">
      <form
        className="space-y-3 rounded-md border p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="lb-name" required>{editing ? 'Editar etiqueta' : 'Nova etiqueta'}</Label>
          <Input id="lb-name" maxLength={30} placeholder="Ex.: Orçamento enviado" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ColorPicker value={color} onChange={setColor} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!editing && admin ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={standard} onCheckedChange={setStandard} aria-label="Etiqueta padrão para todos" /> Padrão para todos
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {editing && (
              <Button type="button" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : editing ? <CheckIcon /> : <PlusIcon />}
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </div>
        </div>
        {name.trim() && <LabelChip label={{ name: name.trim(), color }} />}
      </form>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {labels.error && !labels.data && (
          <li className="p-4">
            <InlineError error={labels.error} onRetry={() => void labels.refetch()} />
          </li>
        )}
        {labels.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhuma etiqueta ainda.</li>}
        {labels.data?.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <LabelChip label={l} />
            <span className="flex-1 text-xs text-muted-foreground">{l.standard ? 'Padrão (todos)' : 'Pessoal'}</span>
            {canEdit(l) && (
              <>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => (setEditing(l), setName(l.name), setColor(l.color))} aria-label={`Editar etiqueta ${l.name}`}>
                  <PencilIcon />
                </Button>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => void remove(l)} disabled={del.isPending} aria-label={`Excluir etiqueta ${l.name}`}>
                  <Trash2Icon />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Respostas rápidas: cada usuário cria as suas; as padrão (para todos) só quem administra o WhatsApp. */
export function ManageRepliesDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAuth()
  const admin = can('whatsapp', 'edit')
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['chat-respostas-gerenciar'], queryFn: () => api.get<QuickReply[]>('/chat/respostas') })
  const [editing, setEditing] = useState<QuickReply | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [standard, setStandard] = useState(false)
  const [picked, setPicked] = useState<File | null>(null)
  const [removed, setRemoved] = useState(false)
  const reset = () => (setEditing(null), setTitle(''), setText(''), setStandard(false), setPicked(null), setRemoved(false))
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-respostas-gerenciar'] })
    void qc.invalidateQueries({ queryKey: ['chat-respostas'] })
    void qc.invalidateQueries({ queryKey: ['chat-respostas-admin'] })
  }
  const save = useMutation({
    mutationFn: async () => {
      const saved = await (editing ? api.put<{ id: string }>(`/chat/respostas/${editing.id}`, { title, text }) : api.post<{ id: string }>('/chat/respostas', { title, text, standard }))
      await saveReplyFile(saved.id, picked, removed)
    },
    onSuccess: () => {
      refresh()
      reset()
      toast.success('Resposta salva.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/respostas/${id}`),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const confirm = useConfirm()
  const canEdit = (r: QuickReply) => (r.standard ? admin : r.mine)
  const remove = async (r: QuickReply) => {
    if (await confirm({ title: `Excluir a resposta rápida “${r.title}”?`, description: 'Ela some da lista de respostas de todos que a usam. Não dá para desfazer.', confirmLabel: 'Excluir resposta rápida' })) del.mutate(r.id)
  }
  // Texto digitado e ainda não salvo: pergunta antes de fechar a janela.
  const dirty = editing ? isDirty({ t: editing.title, x: editing.text }, { t: title, x: text }) || !!picked || removed : !!(title.trim() || text.trim() || picked)
  const guard = useCloseGuard(dirty, onClose, 'a resposta')
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Respostas rápidas</DialogTitle>
          <DialogDescription>
            Textos prontos para mandar com um clique. Use {'{nome}'} para o nome do cliente e {'{vendedor}'} para o seu. As pessoais só você vê; as padrão aparecem para todos.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 rounded-md border p-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (title.trim() && text.trim()) save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="qr-title" required>{editing ? 'Editar resposta' : 'Nova resposta'}</Label>
            <Input id="qr-title" autoFocus maxLength={60} placeholder="Título (ex.: Saudação)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Textarea aria-label="Texto da resposta" rows={4} maxLength={2000} placeholder="Olá {nome}, aqui é {vendedor}. Como posso ajudar?" value={text} onChange={(e) => setText(e.target.value)} />
          <ReplyFileField current={editing?.fileName} picked={picked} removed={removed} onPick={setPicked} onRemove={setRemoved} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!editing && admin ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={standard} onCheckedChange={setStandard} aria-label="Resposta padrão para todos" /> Padrão para todos
              </label>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {editing && (
                <Button type="button" variant="ghost" onClick={reset}>
                  Cancelar
                </Button>
              )}
              <Button type="submit" disabled={!title.trim() || !text.trim() || save.isPending}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : editing ? <CheckIcon /> : <PlusIcon />}
                {editing ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
          {!title.trim() !== !text.trim() && <p className="text-xs text-muted-foreground">Preencha o título e o texto para salvar.</p>}
        </form>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {list.error && !list.data && (
            <li className="p-4">
              <InlineError error={list.error} onRetry={() => void list.refetch()} />
            </li>
          )}
          {list.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhuma resposta ainda.</li>}
          {list.data?.map((r) => (
            <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {r.title}
                  <Badge variant="outline" className="font-normal">
                    {r.standard ? 'Padrão' : 'Pessoal'}
                  </Badge>
                </p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{r.text}</p>
                {r.fileName && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <PaperclipIcon className="size-3" /> {r.fileName}
                  </p>
                )}
              </div>
              {canEdit(r) && (
                <>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => (setEditing(r), setTitle(r.title), setText(r.text), setPicked(null), setRemoved(false))} aria-label={`Editar resposta rápida ${r.title}`}>
                    <PencilIcon />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => void remove(r)} disabled={del.isPending} aria-label={`Excluir resposta rápida ${r.title}`}>
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => void guard()}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
