import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeftIcon, BookUserIcon, MessageCircleIcon, ChevronDownIcon, ContactIcon, FileUpIcon, Loader2Icon, PlusIcon, SmartphoneIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, InlineError, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router'
import { StartDialog } from './chat-page'

type Cat = 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
const CATS: Cat[] = ['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']
const CAT_LABEL: Record<Cat, string> = { CLIENTE: 'Cliente', COLEGA: 'Colega', FORNECEDOR: 'Fornecedor', OUTRO: 'Outro' }
const CAT_PLURAL: Record<Cat, string> = { CLIENTE: 'Clientes', COLEGA: 'Colegas', FORNECEDOR: 'Fornecedores', OUTRO: 'Outros' }
const CAT_HELP: Record<Cat, string> = {
  CLIENTE: 'Conversa de venda: vira lead e pré-venda conforme as regras do WhatsApp.',
  COLEGA: 'Colega de trabalho: fica só no chat, sem lead nem pré-venda.',
  FORNECEDOR: 'Fornecedor: fica só no chat, sem lead nem pré-venda.',
  OUTRO: 'Não é venda: fica só no chat, sem lead nem pré-venda.',
}

interface Contact {
  id: string
  name: string | null
  phone: string | null
  category: Cat
}
/** Uma agenda por número de WhatsApp, mais a geral (scope vazio: vale para todos os números). */
interface AgendaRef {
  scope: string
  name: string
  phone: string | null
  total: number
}
interface ListData {
  total: number
  page: number
  scope: string
  agendas: AgendaRef[]
  counts: Partial<Record<Cat, number>>
  items: Contact[]
}
interface PreviewRow {
  name: string | null
  phone: string
  current: Cat | null
  lead: string | null
  suggested: Cat | null
}
interface Preview {
  items: PreviewRow[]
  invalid: number
  skipped: number
  /** Só na importação pelo WhatsApp: contatos com o número escondido (@lid) e de onde vieram. */
  hidden?: number
  fromWhatsapp?: number
  fromChat?: number
  /** Agenda em que os contatos serão gravados (a do número, na importação pelo WhatsApp). */
  scope?: string
}

export function AgendaPage() {
  return (
    <RequirePermission module="whatsapp">
      <Agenda />
    </RequirePermission>
  )
}

function Agenda() {
  const { can } = useAuth()
  const editable = can('whatsapp', 'edit')
  const qc = useQueryClient()
  const navigate = useNavigate()
  /** Conversar: abre (ou continua) a conversa com o contato, pelo número da agenda aberta. */
  const [talking, setTalking] = useState<{ phone: string; name: string | null } | null>(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Cat | null>(null)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [preview, setPreview] = useState<{ source: string; data: Preview } | null>(null)
  const [fromWhatsapp, setFromWhatsapp] = useState(false)
  /** Agenda aberta: id do número ou vazio (geral). Começa na do primeiro número. */
  const [agenda, setAgenda] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ pagina: String(page), ...(q ? { busca: q } : {}), ...(cat ? { tipo: cat } : {}), ...(agenda ? { agenda } : {}) }).toString()
  const list = useQuery({ queryKey: ['whatsapp-contatos', qs], queryFn: () => api.get<ListData>(`/whatsapp/contatos?${qs}`) })
  const agendas = list.data?.agendas ?? []
  const current = agenda ?? ''
  useEffect(() => {
    // Primeira abertura: a agenda do primeiro número (a geral só se não houver número).
    if (agenda === null && list.data) setAgenda(list.data.agendas[0]?.scope ?? '')
  }, [agenda, list.data])
  const currentName = agendas.find((a) => a.scope === current)?.name ?? 'Todos os números'
  const openAgenda = (scope: string) => {
    setAgenda(scope)
    setPage(1)
  }
  const refresh = () => void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] })
  const update = useMutation({
    mutationFn: (d: { id: string; category?: Cat; agenda?: string }) => api.patch(`/whatsapp/contatos/${d.id}`, { category: d.category, agenda: d.agenda }),
    onSuccess: (_r, d) => {
      refresh()
      toast.success(d.agenda !== undefined ? `Contato movido para a agenda ${agendas.find((a) => a.scope === d.agenda)?.name ?? ''}.` : 'Tipo do contato alterado. As conversas dele seguem o tipo novo.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/whatsapp/contatos/${id}`),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const confirm = useConfirm()
  const remove = async (c: { id: string; name: string | null; phone: string | null }) => {
    const who = c.name ?? (c.phone ? formatPhone(c.phone) : 'este contato')
    if (await confirm({ title: `Remover “${who}” da agenda?`, description: `O contato sai da agenda ${currentName} e as conversas dele voltam a seguir a regra de contato comum.`, confirmLabel: 'Remover contato' })) del.mutate(c.id)
  }
  const fileRun = useMutation({
    mutationFn: (text: string) => api.post<Preview>('/whatsapp/contatos/previa', { text, agenda: current }),
    onSuccess: (data) => setPreview({ source: 'arquivo', data }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const counts = list.data?.counts ?? {}
  const all = CATS.reduce((s, c) => s + (counts[c] ?? 0), 0)

  async function pickFile(f: File | undefined) {
    if (!f) return
    if (f.size > 30_000_000) return void toast.error('Arquivo grande demais.')
    const text = stripPhotos(await f.text())
    if (text.length > 1_900_000) return void toast.error('Arquivo grande demais mesmo sem as fotos (máximo ~1,9 MB). Exporte em partes.')
    fileRun.mutate(text)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda de contatos"
        description="Quem é cliente, colega, fornecedor ou outro. Cada número de WhatsApp tem a sua agenda (um telefone aparece uma vez só em cada uma); a agenda “Todos os números” vale para os números que não têm o contato na própria. Só cliente vira lead e pré-venda."
        actions={
          editable && (
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept=".vcf,.csv,.txt,text/vcard,text/x-vcard,text/csv,text/plain" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={fileRun.isPending}>
                    {fileRun.isPending ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />} Importar contatos <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>De onde vêm os contatos?</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()} className="flex-col items-start gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      <ContactIcon className="size-4" /> Arquivo do Google Contatos (.csv)
                    </span>
                    <span className="text-xs text-muted-foreground">Em contacts.google.com: Exportar › Google CSV. Os marcadores Cliente, Fornecedor ou Colega já definem o tipo.</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()} className="flex-col items-start gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      <FileUpIcon className="size-4" /> Arquivo de contatos do celular (.vcf)
                    </span>
                    <span className="text-xs text-muted-foreground">Android: Contatos › Exportar. iPhone: selecione os contatos › Exportar vCard.</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setFromWhatsapp(true)} className="flex-col items-start gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      <SmartphoneIcon className="size-4" /> Do WhatsApp conectado
                    </span>
                    <span className="text-xs text-muted-foreground">Um clique, sem arquivo: os contatos do número escolhido.</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setAdding(true)}>
                <PlusIcon /> Novo contato
              </Button>
            </div>
          )
        }
      />
      {agendas.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Agenda de qual número">
          {agendas.map((a) => (
            <button
              key={a.scope || 'geral'}
              type="button"
              role="tab"
              aria-selected={a.scope === current}
              onClick={() => openAgenda(a.scope)}
              className={cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap', a.scope === current ? 'border-[color:var(--brand)] font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {a.scope ? <SmartphoneIcon className="size-4" /> : <UsersIcon className="size-4" />}
              <span>{a.name}</span>
              {a.phone && <span className="font-normal text-muted-foreground">{formatPhone(a.phone)}</span>}
              <span className="rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums">{a.total}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={cat === null} onClick={() => (setCat(null), setPage(1))} label="Todos" count={all} />
        {CATS.map((c) => (
          <FilterChip key={c} active={cat === c} onClick={() => (setCat(c), setPage(1))} label={CAT_PLURAL[c]} count={counts[c] ?? 0} />
        ))}
        <Input placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar contato" className="ml-auto w-full sm:w-72" />
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data!.items.length === 0 ? (
        <EmptyState
          icon={BookUserIcon}
          title={q || cat ? 'Nenhum contato com esses filtros' : `Agenda vazia (${currentName})`}
          description={q || cat ? undefined : 'Importe os contatos do Google Contatos (CSV), do celular (arquivo .vcf) ou do WhatsApp conectado e escolha o tipo de cada um.'}
          action={
            editable &&
            !q &&
            !cat && (
              <Button onClick={() => setAdding(true)}>
                <PlusIcon /> Novo contato
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {list.data!.items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name ?? <span className="font-normal text-muted-foreground">Sem nome</span>}</span>
                  <span className="text-muted-foreground tabular-nums">{c.phone ? formatPhone(c.phone) : '—'}</span>
                  {editable ? (
                    <CatSelect id={`cat-${c.id}`} value={c.category} onChange={(v) => update.mutate({ id: c.id, category: v })} className="w-36" />
                  ) : (
                    <Badge variant="outline" className="font-normal">
                      {CAT_LABEL[c.category] ?? c.category}
                    </Badge>
                  )}
                  {can('chat', 'create') && c.phone && (
                    <Button size="sm" variant="outline" onClick={() => setTalking({ phone: c.phone!, name: c.name })} aria-label={`Conversar com ${c.name ?? c.phone}`} title="Abrir conversa no chat">
                      <MessageCircleIcon /> <span className="hidden sm:inline">Conversar</span>
                    </Button>
                  )}
                  {editable && agendas.length > 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={`Mover ${c.name ?? c.phone} para outra agenda`} title="Mover para a agenda de outro número">
                          <ArrowRightLeftIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Mover para a agenda</DropdownMenuLabel>
                        {agendas
                          .filter((a) => a.scope !== current)
                          .map((a) => (
                            <DropdownMenuItem key={a.scope || 'geral'} onSelect={() => update.mutate({ id: c.id, agenda: a.scope })}>
                              {a.name}
                              {a.phone ? ` · ${formatPhone(a.phone)}` : ''}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(c)} disabled={del.isPending} aria-label={`Remover ${c.name ?? c.phone} da agenda`} title="Remover da agenda (volta a valer a regra de contato comum)">
                      <Trash2Icon />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {list.data && list.data.total > 50 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {(page - 1) * 50 + 1}–{Math.min(page * 50, list.data.total)} de {list.data.total}
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
      {talking && (
        <StartDialog
          phone={talking.phone}
          name={talking.name}
          numberId={current || null}
          onClose={() => setTalking(null)}
          onStarted={(cid) => {
            setTalking(null)
            navigate(`/chat?conversa=${cid}`)
          }}
        />
      )}
      {adding && <AddDialog scope={current} agendaName={currentName} onClose={() => setAdding(false)} />}
      {fromWhatsapp && <WhatsappSourceDialog initial={current || null} onClose={() => setFromWhatsapp(false)} onPreview={(data) => (setFromWhatsapp(false), setPreview({ source: 'WhatsApp', data }))} />}
      {preview && (
        <ReviewDialog
          source={preview.source}
          data={preview.data}
          scope={preview.data.scope ?? current}
          agendaName={agendas.find((a) => a.scope === (preview.data.scope ?? current))?.name ?? currentName}
          onSaved={(scope) => openAgenda(scope)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

/** Fotos do vCard (base64) deixam o arquivo enorme e não servem para a agenda: saem antes de enviar. */
function stripPhotos(text: string) {
  const out: string[] = []
  let inPhoto = false
  for (const line of text.split(/\r?\n/)) {
    if (/^(item\d+\.)?PHOTO[;:]/i.test(line)) {
      inPhoto = true
      continue
    }
    if (inPhoto && (/^[ \t]/.test(line) || line === '')) continue
    inPhoto = false
    out.push(line)
  }
  return out.join('\n')
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('rounded-full border px-3 py-1 text-sm transition-colors', active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label} <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>{count}</span>
    </button>
  )
}

function CatSelect({ id, value, onChange, className, allowNone }: { id: string; value: Cat | null; onChange: (v: Cat) => void; className?: string; allowNone?: boolean }) {
  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => v !== '__none__' && onChange(v as Cat)}>
      <SelectTrigger id={id} className={cn('h-8', className)} aria-label="Tipo do contato">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value="__none__" disabled>
            Não importar
          </SelectItem>
        )}
        {CATS.map((k) => (
          <SelectItem key={k} value={k}>
            {CAT_LABEL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddDialog({ scope, agendaName, onClose }: { scope: string; agendaName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [category, setCategory] = useState<Cat>('COLEGA')
  const [error, setError] = useState<string | null>(null)
  const guard = useCloseGuard(!!(name.trim() || phone.trim()), onClose, 'o contato')
  const save = useMutation({
    mutationFn: () => api.post('/whatsapp/contatos/salvar', { rows: [{ name, phone, category }], agenda: scope }),
    onSuccess: (r) => {
      if (!(r as { saved: number }).saved) return void setError('Telefone inválido. Use DDD + número (ou + e o código do país).')
      void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] })
      toast.success('Contato salvo na agenda.')
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
            <DialogTitle>Novo contato · {agendaName}</DialogTitle>
            <DialogDescription>{CAT_HELP[category]} Se o telefone já estiver nesta agenda, o contato que existe é atualizado (não duplica).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ag-name">Nome</Label>
            <Input id="ag-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-phone" required>Telefone</Label>
            <Input id="ag-phone" required inputMode="tel" placeholder="(49) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-cat">Tipo</Label>
            <CatSelect id="ag-cat" value={category} onChange={setCategory} className="h-9 w-full" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !phone.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WhatsappSourceDialog({ initial, onClose, onPreview }: { initial: string | null; onClose: () => void; onPreview: (d: Preview) => void }) {
  const numbers = useQuery({ queryKey: ['whatsapp-numeros'], queryFn: () => api.get<{ numbers: { id: string; name: string; phone: string | null; status: string }[] }>('/whatsapp/numeros') })
  const connected = (numbers.data?.numbers ?? []).filter((n) => n.status === 'CONECTADO')
  const [numberId, setNumberId] = useState<string | null>(initial)
  const run = useMutation({
    mutationFn: (id: string) => api.post<Preview>(`/whatsapp/contatos/previa-whatsapp/${id}`),
    onSuccess: onPreview,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const selected = (numberId && connected.some((n) => n.id === numberId) ? numberId : null) ?? connected[0]?.id ?? null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar do WhatsApp conectado</DialogTitle>
          <DialogDescription>O CRM busca os contatos que o WhatsApp do número conhece (agenda sincronizada e quem já conversou). Eles vão para a agenda desse número. Nada é gravado antes de você escolher o tipo de cada um.</DialogDescription>
        </DialogHeader>
        {numbers.isLoading ? (
          <TableSkeleton rows={2} />
        ) : numbers.error ? (
          <InlineError error={numbers.error} onRetry={() => void numbers.refetch()} />
        ) : connected.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum número conectado. Conecte em Configurações → Números de WhatsApp.</p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="ag-num">Número</Label>
            <Select value={selected ?? undefined} onValueChange={setNumberId}>
              <SelectTrigger id="ag-num" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connected.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                    {n.phone ? ` · ${formatPhone(n.phone)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => selected && run.mutate(selected)} disabled={!selected || run.isPending}>
            {run.isPending && <Loader2Icon className="animate-spin" />}
            Buscar contatos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ReviewFilter = 'todos' | 'sem' | 'agenda' | 'leads'
const PAGE = 100

/** Prévia: cada contato com o tipo sugerido (já na agenda, é lead = cliente, ou sem classificação = não importa). */
function ReviewDialog({ source, data, scope, agendaName, onSaved, onClose }: { source: string; data: Preview; scope: string; agendaName: string; onSaved: (scope: string) => void; onClose: () => void }) {
  const qc = useQueryClient()
  const [cats, setCats] = useState<Map<string, Cat | null>>(() => new Map(data.items.map((r) => [r.phone, r.suggested])))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<ReviewFilter>('todos')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  // Tipos já escolhidos e não salvos: pergunta antes de fechar.
  const [initialCats] = useState(() => [...cats])
  const guard = useCloseGuard(isDirty(initialCats, [...cats]), onClose, 'os tipos escolhidos')
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    return data.items.filter((r) => {
      if (filter === 'sem' && cats.get(r.phone)) return false
      if (filter === 'agenda' && !r.current) return false
      if (filter === 'leads' && !r.lead) return false
      if (s && !(r.name ?? '').toLowerCase().includes(s) && !(digits.length >= 3 && r.phone.replace(/\D/g, '').includes(digits))) return false
      return true
    })
  }, [data.items, filter, search, cats])
  const toSave = data.items.filter((r) => cats.get(r.phone))
  const unclassified = data.items.length - toSave.length
  const allVisibleChecked = visible.length > 0 && visible.every((r) => checked.has(r.phone))
  const setCat = (phone: string, c: Cat | null) => setCats((m) => new Map(m).set(phone, c))
  const bulk = (c: Cat | null) => {
    setCats((m) => {
      const next = new Map(m)
      for (const p of checked) next.set(p, c)
      return next
    })
    setChecked(new Set())
  }
  const save = useMutation({
    mutationFn: () => api.post<{ saved: number; invalid: number }>('/whatsapp/contatos/salvar', { rows: toSave.map((r) => ({ name: r.name, phone: r.phone, category: cats.get(r.phone)! })), agenda: scope }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] })
      onSaved(scope)
      toast.success(`${r.saved} contato(s) salvo(s) na agenda ${agendaName}.${r.invalid ? ` ${r.invalid} telefone(s) inválido(s).` : ''}`, { duration: 8000 })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Escolha o tipo de cada contato ({source} → agenda {agendaName})
          </DialogTitle>
          <DialogDescription>
            {data.items.length} contato(s) com telefone{data.skipped ? ` · ${data.skipped} sem telefone` : ''}
            {data.invalid ? ` · ${data.invalid} telefone(s) inválido(s)` : ''}
            {data.fromChat !== undefined ? ` (${data.fromWhatsapp ?? 0} da agenda do WhatsApp e ${data.fromChat} de conversas no CRM)` : ''}
            {data.hidden ? ` · ${data.hidden} com o número escondido pelo WhatsApp ficaram de fora (para esses, use o arquivo .vcf)` : ''}. Já vêm marcados: quem está nesta agenda (o tipo atual) e quem é lead (cliente). Os “sem tipo” não são importados. Telefone repetido não duplica: o contato que já existe na agenda é atualizado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['todos', 'Todos'],
              ['sem', 'Sem tipo'],
              ['agenda', 'Já na agenda'],
              ['leads', 'São leads'],
            ] as [ReviewFilter, string][]
          ).map(([k, l]) => (
            <FilterChip key={k} active={filter === k} onClick={() => (setFilter(k), setLimit(PAGE))} label={l} count={k === 'todos' ? data.items.length : k === 'sem' ? unclassified : k === 'agenda' ? data.items.filter((r) => r.current).length : data.items.filter((r) => r.lead).length} />
          ))}
          <Input placeholder="Buscar" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} aria-label="Buscar na lista" className="ml-auto h-8 w-full sm:w-48" />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Checkbox
            checked={allVisibleChecked}
            onCheckedChange={(v) => setChecked(v ? new Set([...checked, ...visible.map((r) => r.phone)]) : new Set([...checked].filter((p) => !visible.some((r) => r.phone === p))))}
            aria-label="Selecionar todos os da lista"
          />
          <span className="text-muted-foreground">{checked.size ? `${checked.size} selecionado(s): marcar como` : 'Selecione para marcar vários de uma vez'}</span>
          {checked.size > 0 && (
            <>
              {CATS.map((c) => (
                <Button key={c} size="sm" variant="outline" className="h-7" onClick={() => bulk(c)}>
                  {CAT_LABEL[c]}
                </Button>
              ))}
              <Button size="sm" variant="ghost" className="h-7" onClick={() => bulk(null)}>
                Não importar
              </Button>
            </>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
          {visible.slice(0, limit).map((r) => {
            const c = cats.get(r.phone) ?? null
            return (
              <li key={r.phone} className={cn('flex flex-wrap items-center gap-3 px-3 py-2 text-sm', !c && 'bg-muted/30')}>
                <Checkbox
                  checked={checked.has(r.phone)}
                  onCheckedChange={(v) =>
                    setChecked((s) => {
                      const n = new Set(s)
                      if (v) n.add(r.phone)
                      else n.delete(r.phone)
                      return n
                    })
                  }
                  aria-label={`Selecionar ${r.name ?? r.phone}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name ?? <span className="font-normal text-muted-foreground">Sem nome</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(r.phone)}
                    {r.current ? ` · na agenda como ${CAT_LABEL[r.current].toLowerCase()}` : ''}
                    {r.lead ? ` · é lead: ${r.lead}` : ''}
                  </p>
                </div>
                <CatSelect id={`rv-${r.phone}`} value={c} onChange={(v) => setCat(r.phone, v)} className="w-36" allowNone />
                {c && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCat(r.phone, null)} aria-label={`Não importar ${r.name ?? formatPhone(r.phone)}`}>
                    Não importar
                  </Button>
                )}
              </li>
            )
          })}
          {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhum contato com esses filtros.</li>}
          {visible.length > limit && (
            <li className="p-2 text-center">
              <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                Mostrar mais ({visible.length - limit})
              </Button>
            </li>
          )}
        </ul>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {toSave.length} para salvar · {unclassified} sem tipo (não entram)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={!toSave.length || save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar {toSave.length} na agenda
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
