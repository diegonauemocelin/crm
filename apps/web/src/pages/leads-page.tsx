import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FilterXIcon, Loader2Icon, PlusIcon, SearchIcon, SettingsIcon, TagIcon, UploadIcon, UsersRoundIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { formatDay, formatPhone, int, namesOf, UF_LIST, UF_NAMES, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { GRADE_CLASS, type Lead, type LeadStage, STAGE_LABEL, STAGES, useTags } from '@/lib/leads'
import { cn } from '@/lib/utils'

const ALL = '__all__'
const FILTERS = ['search', 'stage', 'grade', 'tag', 'state', 'ownerId', 'unitId', 'originId', 'emailOptIn', 'hasPhone', 'from', 'to'] as const

interface Page {
  total: number
  page: number
  pageSize: number
  byStage: Partial<Record<LeadStage, number>>
  items: Lead[]
}

function Filter({ label, value, onChange, items, withNone }: { label: string; value: string | null; onChange: (v: string | null) => void; items: { id: string; name: string }[]; withNone?: boolean }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className={cn('w-full', value && 'border-[color:var(--brand)]')} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {withNone && <SelectItem value="none">Sem {label.toLowerCase()}</SelectItem>}
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function GradeBadge({ grade, total }: { grade: Lead['scoreGrade']; total?: number }) {
  if (!grade) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <Badge variant="outline" className={cn('gap-1 font-semibold', GRADE_CLASS[grade])} title={total !== undefined ? `${total} pontos` : undefined}>
      {grade}
      {total !== undefined && <span className="font-normal tabular-nums">{total}</span>}
    </Badge>
  )
}

export function LeadsPage() {
  return (
    <RequirePermission module="leads">
      <LeadsContent />
    </RequirePermission>
  )
}

function LeadsContent() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const options = useOptions()
  const tags = useTags()
  const names = useMemo(() => namesOf(options.data), [options.data])
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('search') ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<'addTag' | 'removeTag' | 'stage' | 'owner' | null>(null)
  const page = Number(params.get('page') ?? '1')
  const sort = params.get('sort') ?? 'recent'

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
    setSelected(new Set())
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== searchText.trim()) setFilter('search', searchText.trim() || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const query = new URLSearchParams({ page: String(page), pageSize: '50', sort })
  for (const k of FILTERS) {
    const v = params.get(k)
    if (v) query.set(k, v)
  }
  const active = FILTERS.filter((k) => params.get(k)).length

  const list = useQuery({ queryKey: ['leads', query.toString()], queryFn: () => api.get<Page>(`/leads?${query}`), placeholderData: keepPreviousData })
  const data = list.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const allOnPage = !!data?.items.length && data.items.every((l) => selected.has(l.id))
  const o = options.data

  const exportCsv = async () => {
    const q = new URLSearchParams(query)
    for (const k of ['page', 'pageSize', 'sort']) q.delete(k)
    const res = await fetch(`/api/leads/exportar?${q}`, { credentials: 'same-origin' })
    if (!res.ok) return toast.error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha ao exportar.')
    const url = URL.createObjectURL(await res.blob())
    Object.assign(document.createElement('a'), { href: url, download: `leads-${new Date().toISOString().slice(0, 10)}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Base de leads"
        description="Todas as pessoas identificadas: importadas do RD, vindas do WhatsApp/atendimentos e, nas próximas etapas, de formulários e landing pages."
        actions={
          <>
            <Can module="configuracoes" action="edit">
              <Button variant="outline" asChild>
                <Link to="/leads/configuracoes">
                  <SettingsIcon /> Configurar
                </Link>
              </Button>
            </Can>
            <Can module="leads" action="create">
              <Button variant="outline" asChild>
                <Link to="/leads/importar">
                  <UploadIcon /> Importar
                </Link>
              </Button>
              <Button asChild>
                <Link to="/leads/novo">
                  <PlusIcon /> Novo lead
                </Link>
              </Button>
            </Can>
          </>
        }
      />

      {/* Resumo do funil: cada estágio é um atalho de filtro. */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4" role="group" aria-label="Leads por estágio do funil">
        {STAGES.map((s) => {
          const selectedStage = params.get('stage') === s.id
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selectedStage}
              onClick={() => setFilter('stage', selectedStage ? null : s.id)}
              className={cn('rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/60', selectedStage && 'border-[color:var(--brand)] ring-1 ring-[color:var(--brand)]')}
            >
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-semibold tabular-nums">{data ? int.format(data.byStage[s.id] ?? 0) : '…'}</p>
            </button>
          )
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Buscar por nome, e-mail, telefone, empresa ou cidade" className="h-8 pl-8" aria-label="Buscar leads" />
        </div>
        <Select value={sort} onValueChange={(v) => setFilter('sort', v === 'recent' ? null : v)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Ordenar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Mais recentes</SelectItem>
            <SelectItem value="score">Maior nota (lead scoring)</SelectItem>
            <SelectItem value="activity">Atividade mais recente</SelectItem>
            <SelectItem value="name">Nome (A–Z)</SelectItem>
          </SelectContent>
        </Select>
        <Can module="leads" action="export">
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <DownloadIcon /> Exportar
          </Button>
        </Can>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Filter label="Nota" value={params.get('grade')} onChange={(v) => setFilter('grade', v)} items={['A', 'B', 'C', 'D'].map((g) => ({ id: g, name: `Nota ${g}` }))} />
        <Filter label="Tag" value={params.get('tag')} onChange={(v) => setFilter('tag', v)} items={(tags.data ?? []).map((t) => ({ id: t.tag, name: `${t.tag} (${int.format(t.total)})` }))} />
        <Filter label="Estado" value={params.get('state')} onChange={(v) => setFilter('state', v)} items={UF_LIST.map((uf) => ({ id: uf, name: `${UF_NAMES[uf]} (${uf})` }))} />
        <Filter label="Responsável" value={params.get('ownerId')} onChange={(v) => setFilter('ownerId', v)} items={o?.sellers ?? []} withNone />
        <Filter label="Unidade" value={params.get('unitId')} onChange={(v) => setFilter('unitId', v)} items={o?.units ?? []} withNone />
        <Filter label="Origem" value={params.get('originId')} onChange={(v) => setFilter('originId', v)} items={o?.origins ?? []} withNone />
        <Filter label="E-mail marketing" value={params.get('emailOptIn')} onChange={(v) => setFilter('emailOptIn', v)} items={[{ id: 'true', name: 'Aceita receber' }, { id: 'false', name: 'Não aceita' }]} />
        <Filter label="Telefone" value={params.get('hasPhone')} onChange={(v) => setFilter('hasPhone', v)} items={[{ id: 'true', name: 'Com telefone' }, { id: 'false', name: 'Sem telefone' }]} />
        <Input type="date" className="h-8" aria-label="Cadastrado a partir de" value={params.get('from') ?? ''} onChange={(e) => setFilter('from', e.target.value || null)} />
        <Input type="date" className="h-8" aria-label="Cadastrado até" value={params.get('to') ?? ''} onChange={(e) => setFilter('to', e.target.value || null)} />
        {active > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setSearchText('')
              setParams(new URLSearchParams(), { replace: true })
            }}
          >
            <FilterXIcon /> Limpar ({active})
          </Button>
        )}
      </div>

      {selected.size > 0 && can('leads', 'edit') && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>{int.format(selected.size)} selecionado(s)</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <TagIcon /> Ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setBulk('addTag')}>Adicionar tag</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setBulk('removeTag')}>Remover tag</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setBulk('stage')}>Alterar estágio</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setBulk('owner')}>Alterar responsável</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {list.isLoading && <TableSkeleton />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={UsersRoundIcon}
          title={active ? 'Nenhum lead com esses filtros' : 'Base de leads vazia'}
          description={active ? 'Ajuste ou limpe os filtros.' : 'Importe a base do RD Station ou cadastre o primeiro lead.'}
        />
      )}

      {data && data.items.length > 0 && (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {can('leads', 'edit') && (
                    <TableHead className="w-10">
                      <Checkbox checked={allOnPage} onCheckedChange={(c) => setSelected(new Set(c ? data.items.map((l) => l.id) : []))} aria-label="Selecionar todos desta página" />
                    </TableHead>
                  )}
                  <TableHead>Lead</TableHead>
                  <TableHead className="hidden md:table-cell">Estágio</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="hidden lg:table-cell">Tags</TableHead>
                  <TableHead className="hidden lg:table-cell">Local</TableHead>
                  <TableHead className="hidden xl:table-cell">Responsável</TableHead>
                  <TableHead className="hidden xl:table-cell">Cadastro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => navigate(`/leads/${l.id}`)}>
                    {can('leads', 'edit') && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={(c) =>
                            setSelected((s) => {
                              const n = new Set(s)
                              if (c) n.add(l.id)
                              else n.delete(l.id)
                              return n
                            })
                          }
                          aria-label={`Selecionar ${l.name ?? l.email ?? 'lead'}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="max-w-72">
                      <p className="truncate font-medium">{l.anonymizedAt ? 'Dados removidos (LGPD)' : (l.name ?? l.email ?? formatPhone(l.phone))}</p>
                      <p className="truncate text-xs text-muted-foreground">{[l.email, formatPhone(l.phone)].filter(Boolean).join(' · ') || '—'}</p>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{STAGE_LABEL[l.stage]}</TableCell>
                    <TableCell>
                      <GradeBadge grade={l.scoreGrade} total={l.scoreTotal} />
                    </TableCell>
                    <TableCell className="hidden max-w-48 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {l.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                        {l.tags.length > 3 && <span className="text-xs text-muted-foreground">+{l.tags.length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{[l.city, l.state].filter(Boolean).join('/') || '—'}</TableCell>
                    <TableCell className="hidden text-sm xl:table-cell">{l.ownerId ? names.get(l.ownerId) : '—'}</TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap tabular-nums xl:table-cell">{formatDay(l.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {int.format(data.total)} lead(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))} aria-label="Página anterior">
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => {
                  const n = new URLSearchParams(params)
                  n.set('page', String(page + 1))
                  setParams(n, { replace: true })
                }}
                aria-label="Próxima página"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {bulk && (
        <BulkDialog
          kind={bulk}
          ids={[...selected]}
          onClose={() => setBulk(null)}
          onDone={() => {
            setBulk(null)
            setSelected(new Set())
            void qc.invalidateQueries({ queryKey: ['leads'] })
            void qc.invalidateQueries({ queryKey: ['lead-tags'] })
          }}
        />
      )}
    </>
  )
}

function BulkDialog({ kind, ids, onClose, onDone }: { kind: 'addTag' | 'removeTag' | 'stage' | 'owner'; ids: string[]; onClose: () => void; onDone: () => void }) {
  const options = useOptions()
  const tags = useTags()
  const [value, setValue] = useState('')
  const run = useMutation({
    mutationFn: () => {
      const body =
        kind === 'addTag' ? { addTags: [value] } : kind === 'removeTag' ? { removeTags: [value] } : kind === 'stage' ? { stage: value } : { ownerId: value === 'none' ? null : value }
      return api.post<{ updated: number }>('/leads/massa', { ids, ...body })
    },
    onSuccess: (r) => {
      toast.success(`${int.format(r.updated)} lead(s) atualizado(s).`)
      onDone()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const title = { addTag: 'Adicionar tag', removeTag: 'Remover tag', stage: 'Alterar estágio', owner: 'Alterar responsável' }[kind]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (value) run.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Aplica a {int.format(ids.length)} lead(s) selecionado(s).</DialogDescription>
          </DialogHeader>
          {kind === 'addTag' && (
            <div className="space-y-2">
              <Label htmlFor="bulk-tag">Tag</Label>
              <Input id="bulk-tag" list="bulk-tags" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} autoFocus placeholder="ex.: vip, feira-2026" />
              <datalist id="bulk-tags">
                {tags.data?.map((t) => <option key={t.tag} value={t.tag} />)}
              </datalist>
            </div>
          )}
          {kind === 'removeTag' && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Tag">
                <SelectValue placeholder="Escolha a tag" />
              </SelectTrigger>
              <SelectContent>
                {tags.data?.map((t) => (
                  <SelectItem key={t.tag} value={t.tag}>
                    {t.tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {kind === 'stage' && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Estágio">
                <SelectValue placeholder="Escolha o estágio" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {kind === 'owner' && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Responsável">
                <SelectValue placeholder="Escolha o responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {options.data?.sellers.filter((s) => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!value || run.isPending}>
              {run.isPending && <Loader2Icon className="animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
