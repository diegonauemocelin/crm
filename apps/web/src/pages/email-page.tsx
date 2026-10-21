import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3Icon, SettingsIcon, CopyIcon, ImageIcon, Loader2Icon, MailIcon, MapIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon, UploadIcon, UsersRoundIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, UF_LIST, UF_NAMES, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type Campaign, type EmailSettings, newBlock, pct, type Segment, type SegmentFilters, STATUS_LABEL, STATUS_TONE, SOCIAL_LABEL, SOCIAL_NETWORKS, SOCIAL_PLACEHOLDER } from '@/lib/email'
import { STAGES, useTags } from '@/lib/leads'
import { FormError } from './auth/auth-layout'
import { LEAD_REGIONS } from '@/lib/automacoes'

const ANY = '__any__'

/** Busca simples pelo nome (sem acento e sem diferenciar maiúsculas). */
const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const byName = <T extends { name: string }>(items: T[], term: string) => (term.trim() ? items.filter((i) => norm(i.name).includes(norm(term.trim()))) : items)

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" className="pl-8" placeholder="Buscar…" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function EmailPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') ?? 'campanhas'
  // Os ajustes do e-mail (remetente, rodapé, logo, IA) ficam em Configurações.
  if (tab === 'configuracoes') return <Navigate to="/configuracoes?secao=email-marketing" replace />
  return (
    <RequirePermission module="email_marketing">
      <PageHeader
        title="Email marketing"
        description="Campanhas para os leads que autorizaram receber e-mails, com aberturas, cliques e descadastros."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/email-marketing/dashboard">
                <BarChart3Icon /> Dashboard
              </Link>
            </Button>
            <Can module="email_marketing" action="edit">
              <Button asChild variant="outline" size="sm">
                <Link to="/configuracoes?secao=email-marketing">
                  <SettingsIcon /> Configurações do e-mail
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'campanhas' ? {} : { aba: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="modelos">Modelos (automações)</TabsTrigger>
          <TabsTrigger value="segmentos">Segmentos</TabsTrigger>
        </TabsList>
        <TabsContent value="campanhas">
          <CampaignsTab />
        </TabsContent>
        <TabsContent value="modelos">
          <ModelsTab />
        </TabsContent>
        <TabsContent value="segmentos">
          <SegmentsTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

// ---------- Modelos (enviados pelas automações) ----------

function ModelsTab() {
  const q = useQuery({ queryKey: ['email-models'], queryFn: () => api.get<Campaign[]>('/email/campanhas?tipo=MODELO') })
  const { can } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/email/campanhas', { name: 'Novo modelo', subject: '', kind: 'MODELO', blocks: [newBlock('titulo'), newBlock('texto')] }),
    onSuccess: (c) => navigate(`/email-marketing/${c.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/email/campanhas/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-models'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Modelos são e-mails montados no mesmo editor e enviados pelas automações, um lead por vez, no passo “Enviar e-mail”.</p>
        {can('email_marketing', 'create') && (
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <PlusIcon /> Novo modelo
          </Button>
        )}
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={3} />
      ) : !q.data.length ? (
        <EmptyState icon={MailIcon} title="Nenhum modelo ainda" description="Crie um modelo (ex.: “Recuperação de carrinho com cupom”) e use no passo Enviar e-mail de uma automação." />
      ) : (
        <>
        <SearchBox value={search} onChange={setSearch} label="Buscar modelo pelo nome" />
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Modelo</TableHead>
                <TableHead className="text-right">Enviados</TableHead>
                <TableHead className="text-right">Aberturas</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {byName(q.data, search).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum modelo com “{search.trim()}”.
                  </TableCell>
                </TableRow>
              )}
              {byName(q.data, search).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link to={`/email-marketing/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.subject || '(sem assunto)'}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(c.sent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(c.opens, c.sent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(c.clicks, c.sent)}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    {can('email_marketing', 'create') && (
                      <DuplicateMenu id={c.id} name={c.name} />
                    )}
                    {can('email_marketing', 'delete') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Excluir o modelo ${c.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Excluir o modelo “${c.name}”?`, description: 'O modelo some da lista e as automações que o usam deixam de enviar este e-mail. Não dá para desfazer.', confirmLabel: 'Excluir modelo' })) remove.mutate(c.id)
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        </>
      )}
    </div>
  )
}

// ---------- Campanhas ----------

function CampaignsTab() {
  const q = useQuery({ queryKey: ['email-campaigns'], queryFn: () => api.get<Campaign[]>('/email/campanhas'), refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'ENVIANDO') ? 10_000 : false) })
  const { can } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/email/campanhas', { name: 'Nova campanha', subject: '', blocks: [newBlock('titulo'), newBlock('texto')] }),
    onSuccess: (c) => navigate(`/email-marketing/${c.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/email/campanhas/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-campaigns'] })
      toast.success('Rascunho excluído.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {q.data.length > 0 ? <SearchBox value={search} onChange={setSearch} label="Buscar campanha pelo nome" /> : <span />}
        {can('email_marketing', 'create') && (
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Nova campanha
          </Button>
        )}
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={MailIcon} title="Nenhuma campanha ainda" description="Crie um segmento (quem vai receber) e depois a campanha. Só recebem os leads que autorizaram e-mails." />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Campanha</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Enviados</TableHead>
                <TableHead className="text-right">Aberturas</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {byName(q.data, search).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhuma campanha com “{search.trim()}”.
                  </TableCell>
                </TableRow>
              )}
              {byName(q.data, search).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link to={`/email-marketing/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.segment?.name ?? 'Sem segmento'} · {c.finishedAt ? `enviada em ${formatDateTime(c.finishedAt)}` : c.scheduledAt ? `agendada para ${formatDateTime(c.scheduledAt)}` : `criada em ${formatDateTime(c.createdAt)}`}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_TONE[c.status]}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.total ? `${int.format(c.sent)} de ${int.format(c.total)}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.sent ? pct(c.opens, c.sent) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.sent ? pct(c.clicks, c.sent) : '—'}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" asChild aria-label={`Abrir a campanha ${c.name}`}>
                      <Link to={`/email-marketing/${c.id}`}>
                        <PencilIcon />
                      </Link>
                    </Button>
                    {can('email_marketing', 'create') && (
                      <DuplicateMenu id={c.id} name={c.name} />
                    )}
                    {c.status === 'RASCUNHO' && can('email_marketing', 'delete') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (await confirm({ title: `Excluir o rascunho “${c.name}”?`, description: 'A campanha ainda não foi enviada e será excluída com o conteúdo montado. Não dá para desfazer.', confirmLabel: 'Excluir rascunho' })) remove.mutate(c.id)
                        }}
                        aria-label={`Excluir o rascunho ${c.name}`}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}

// ---------- Segmentos ----------

function SegmentsTab() {
  const q = useQuery({ queryKey: ['email-segments'], queryFn: () => api.get<Segment[]>('/email/segmentos') })
  const { can } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState<Segment | 'new' | null>(null)
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const regions = useMutation({
    mutationFn: () => api.post<{ created: string[] }>('/email/segmentos/regioes'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['email-segments'] })
      toast.success(r.created.length ? `Criados: ${r.created.join(', ')}.` : 'Os segmentos por região já existem.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/email/segmentos/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-segments'] })
      toast.success('Segmento excluído.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Segmento = quem recebe. Usa os mesmos filtros da base de leads; só contam leads com e-mail e consentimento.</p>
        {can('email_marketing', 'create') && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => regions.mutate()} disabled={regions.isPending} title="Cria os segmentos Região Norte, Nordeste, Centro-Oeste, Sudeste, Sul e Internacional (os que ainda não existem)">
              <MapIcon /> Criar segmentos por região
            </Button>
            <Button onClick={() => setOpen('new')}>
              <PlusIcon /> Novo segmento
            </Button>
          </div>
        )}
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={UsersRoundIcon} title="Nenhum segmento ainda" description="Ex.: Revenda do Sul, Clientes com nota A, Carrinho abandonado (tag)." />
      ) : (
        <>
        <div className="mb-3">
          <SearchBox value={search} onChange={setSearch} label="Buscar segmento pelo nome" />
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Segmento</TableHead>
                <TableHead className="text-right">Podem receber agora</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {byName(q.data, search).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum segmento com “{search.trim()}”.
                  </TableCell>
                </TableRow>
              )}
              {byName(q.data, search).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{describeFilters(s.filters)}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(s.eligible)}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    {can('email_marketing', 'edit') && (
                      <Button size="sm" variant="ghost" onClick={() => setOpen(s)} aria-label={`Editar o segmento ${s.name}`}>
                        <PencilIcon />
                      </Button>
                    )}
                    {can('email_marketing', 'delete') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (await confirm({ title: `Excluir o segmento “${s.name}”?`, description: 'Campanhas e automações que usam este segmento ficam sem destinatários definidos. Os leads não são afetados. Não dá para desfazer.', confirmLabel: 'Excluir segmento' })) remove.mutate(s.id)
                        }}
                        aria-label={`Excluir o segmento ${s.name}`}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        </>
      )}
      {open && <SegmentDialog segment={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </>
  )
}

function describeFilters(f: SegmentFilters) {
  const parts = [
    f.stage && `estágio ${STAGES.find((s) => s.id === f.stage)?.label ?? f.stage}`,
    f.grade && `nota ${f.grade === 'none' ? 'sem nota' : f.grade}`,
    f.tag && `tag ${f.tag}`,
    f.state && `estado ${f.state}`,
    f.from && `cadastrados desde ${f.from.split('-').reverse().join('/')}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Todos os leads'
}

function Pick({ label, id, value, onChange, items }: { label: string; id: string; value: string | undefined; onChange: (v: string | undefined) => void; items: { id: string; name: string }[] }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Qualquer</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SegmentDialog({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const qc = useQueryClient()
  const options = useOptions()
  const tags = useTags()
  const [name, setName] = useState(segment?.name ?? '')
  const [f, setF] = useState<SegmentFilters>(segment?.filters ?? {})
  const [count, setCount] = useState<{ eligible: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof SegmentFilters>(k: K, v: SegmentFilters[K]) => setF((x) => ({ ...x, [k]: v }))
  const [initial] = useState(() => ({ name: segment?.name ?? '', f: segment?.filters ?? {} }))
  const guard = useCloseGuard(isDirty(initial, { name, f }), onClose, 'o segmento')

  // Contagem ao vivo de quem pode receber com estes filtros.
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<{ eligible: number; total: number }>('/email/publico/contar', { filters: f })
        .then(setCount)
        .catch(() => setCount(null))
    }, 300)
    return () => clearTimeout(t)
  }, [f])

  const save = useMutation({
    mutationFn: () => (segment ? api.put(`/email/segmentos/${segment.id}`, { name, filters: f }) : api.post('/email/segmentos', { name, filters: f })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-segments'] })
      toast.success('Segmento salvo.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const o = options.data
  return (
    <Dialog open onOpenChange={(v) => !v && void guard()}>
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{segment ? 'Editar segmento' : 'Novo segmento'}</DialogTitle>
            <DialogDescription>Os filtros são aplicados na hora do envio: leads novos que se encaixarem entram automaticamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sg-name" required>
              Nome
            </Label>
            <Input id="sg-name" autoFocus required maxLength={80} placeholder="Ex.: Revenda do Sul" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Pick label="Estágio" id="sg-stage" value={f.stage} onChange={(v) => set('stage', v)} items={STAGES.map((s) => ({ id: s.id, name: s.label }))} />
            <Pick label="Nota" id="sg-grade" value={f.grade} onChange={(v) => set('grade', v)} items={['A', 'B', 'C', 'D'].map((g) => ({ id: g, name: g }))} />
            <Pick label="Tag" id="sg-tag" value={f.tag} onChange={(v) => set('tag', v)} items={(tags.data ?? []).map((t) => ({ id: t.tag, name: `${t.tag} (${t.total})` }))} />
            <Pick label="Região" id="sg-region" value={f.region} onChange={(v) => set('region', v as SegmentFilters['region'])} items={LEAD_REGIONS.map((r) => ({ id: r.id, name: r.name }))} />
            <Pick label="Estado" id="sg-state" value={f.state} onChange={(v) => set('state', v)} items={UF_LIST.map((uf) => ({ id: uf, name: `${UF_NAMES[uf]} (${uf})` }))} />
            <Pick label="Responsável" id="sg-owner" value={f.ownerId} onChange={(v) => set('ownerId', v)} items={(o?.sellers ?? []).filter((s) => s.active)} />
            <Pick label="Unidade" id="sg-unit" value={f.unitId} onChange={(v) => set('unitId', v)} items={o?.units ?? []} />
            <Pick label="Origem" id="sg-origin" value={f.originId} onChange={(v) => set('originId', v)} items={o?.origins ?? []} />
            <div className="space-y-1.5">
              <Label htmlFor="sg-from">Cadastrados a partir de</Label>
              <Input id="sg-from" type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value || undefined)} />
            </div>
          </div>
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Pelo atendimento (Pré-Vendas e Pós-Vendas)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pick label="Resultado" id="sg-result" value={f.serviceResult} onChange={(v) => setF((x) => ({ ...x, serviceResult: v as SegmentFilters['serviceResult'], ...(v === 'SIM' ? { lostReasonId: undefined } : {}) }))} items={[{ id: 'NAO', name: 'Não vendeu' }, { id: 'SIM', name: 'Vendeu' }, { id: 'NEGOCIACAO', name: 'Em negociação' }]} />
              {f.serviceResult !== 'SIM' && <Pick label="Motivo da perda" id="sg-reason" value={f.lostReasonId} onChange={(v) => set('lostReasonId', v)} items={o?.lostReasons ?? []} />}
              <Pick label="Atendimento" id="sg-skind" value={f.serviceKind} onChange={(v) => set('serviceKind', v as SegmentFilters['serviceKind'])} items={[{ id: 'PRE_VENDAS', name: 'Pré-Vendas' }, { id: 'POS_VENDAS', name: 'Pós-Vendas' }]} />
              <div className="space-y-1.5">
                <Label htmlFor="sg-sdays">Atendidos nos últimos</Label>
                <div className="flex items-center gap-2">
                  <Input id="sg-sdays" type="number" min={1} max={730} className="w-24" placeholder="dias" value={f.serviceDays ?? ''} onChange={(e) => setF((x) => ({ ...x, serviceDays: e.target.value ? Number(e.target.value) : undefined, ...(e.target.value ? { serviceFrom: undefined, serviceTo: undefined } : {}) }))} />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              </div>
              {!f.serviceDays && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sg-sfrom">Atendidos de</Label>
                    <Input id="sg-sfrom" type="date" value={f.serviceFrom ?? ''} onChange={(e) => set('serviceFrom', e.target.value || undefined)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sg-sto">até</Label>
                    <Input id="sg-sto" type="date" value={f.serviceTo ?? ''} onChange={(e) => set('serviceTo', e.target.value || undefined)} />
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Ex.: não vendeu por preço nos últimos 30 dias. Com “últimos N dias”, o segmento acompanha a data: use em campanhas mensais ou num fluxo “Manual (por segmento)”.</p>
          </div>
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {count ? (
              <>
                <strong className="tabular-nums">{int.format(count.eligible)}</strong> lead(s) podem receber agora
                <span className="text-muted-foreground"> (de {int.format(count.total)} no filtro; os demais não têm e-mail ou não autorizaram).</span>
              </>
            ) : (
              'Contando…'
            )}
          </p>
          <FormError message={error} />
          {name.trim().length < 2 && <p className="text-xs text-muted-foreground">Dê um nome ao segmento (2 letras ou mais) para salvar.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Configurações ----------

export function SettingsTab() {
  const q = useQuery({ queryKey: ['email-settings'], queryFn: () => api.get<EmailSettings>('/email/configuracoes') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <SettingsEditor initial={q.data} />
      <LogoCard settings={q.data} />
      <AiCard />
    </div>
  )
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SettingsEditor({ initial }: { initial: EmailSettings }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [s, setS] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.put<EmailSettings>('/email/configuracoes', { fromName: s.fromName, replyTo: s.replyTo, footerText: s.footerText, ratePerMinute: s.ratePerMinute, social: s.social ?? {}, socialInFooter: s.socialInFooter ?? true }),
    onSuccess: (saved) => {
      qc.setQueryData(['email-settings'], saved)
      toast.success('Configurações salvas.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError(null)
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Envio das campanhas</CardTitle>
          <CardDescription>O e-mail sai pelo servidor configurado em Configurações → Servidor de e-mail (SMTP).</CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-4">
          <fieldset disabled={!can('email_marketing', 'edit')} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Nome do remetente" htmlFor="em-from" hint="Vazio = o nome do SMTP.">
                <Input id="em-from" maxLength={80} placeholder="Nome da empresa" value={s.fromName} onChange={(e) => setS({ ...s, fromName: e.target.value })} />
              </Row>
              <Row label="Responder para" htmlFor="em-reply" hint="Para onde vão as respostas dos clientes.">
                <Input id="em-reply" type="email" placeholder="comercial@usaparts.com.br" value={s.replyTo} onChange={(e) => setS({ ...s, replyTo: e.target.value })} />
              </Row>
            </div>
            <Row label="Rodapé (dados da empresa)" htmlFor="em-footer" hint="Razão social, endereço e telefone: os provedores de e-mail exigem e passa confiança.">
              <Textarea id="em-footer" rows={3} maxLength={500} placeholder={'Nome da empresa\nCidade/UF · (00) 0000-0000'} value={s.footerText} onChange={(e) => setS({ ...s, footerText: e.target.value })} />
            </Row>
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Redes sociais</p>
              <p className="text-xs text-muted-foreground">Cadastre uma vez: o bloco “Redes sociais” do editor já vem com estes endereços. Cada ícone abre a rede em nova aba.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SOCIAL_NETWORKS.map((n) => (
                  <Row key={n} label={SOCIAL_LABEL[n]} htmlFor={`em-${n}`}>
                    <Input id={`em-${n}`} type="url" placeholder={SOCIAL_PLACEHOLDER[n]} value={s.social?.[n] ?? ''} onChange={(e) => setS({ ...s, social: { ...s.social, [n]: e.target.value } })} />
                  </Row>
                ))}
              </div>
              <label className="flex items-center justify-between gap-3 pt-1 text-sm">
                <span>
                  Mostrar os ícones no rodapé de todo e-mail
                  <span className="block text-xs text-muted-foreground">Em cinza, discretos. Se o e-mail tiver o bloco de redes, o rodapé não repete.</span>
                </span>
                <Switch checked={s.socialInFooter ?? true} onCheckedChange={(c) => setS({ ...s, socialInFooter: c })} />
              </label>
            </div>
            <Row label="Envios por minuto" htmlFor="em-rate" hint="Envio gradual protege o domínio contra spam. 60/min = 3.600 por hora.">
              <Input id="em-rate" type="number" min={5} max={1000} className="w-28" value={s.ratePerMinute} onChange={(e) => setS({ ...s, ratePerMinute: Number(e.target.value) })} />
            </Row>
          </fieldset>
          <FormError message={error} />
        </CardContent>
        {can('email_marketing', 'edit') && (
          <CardFooter className="mt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

const AI_MODEL_LABEL: Record<string, string> = {
  rapido: 'Mais rápido (recomendado)',
  caprichado: 'Mais caprichado (um pouco mais lento)',
}

function AiCard() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['email-ia'], queryFn: () => api.get<{ configured: boolean; model: string; about: string; models: string[] }>('/email/ia') })
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [about, setAbout] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = (v: NonNullable<typeof q.data>) => {
    qc.setQueryData(['email-ia'], v)
    setApiKey('')
    setModel(null)
    setAbout(null)
  }
  const save = useMutation({
    mutationFn: (removeKey?: boolean) => api.put<NonNullable<typeof q.data>>('/email/ia', removeKey ? { removeKey: true } : { apiKey: apiKey.trim() || undefined, model: model ?? undefined, about: about ?? undefined }),
    onSuccess: (v, removeKey) => {
      done(v)
      toast.success(removeKey ? 'Chave do Gemini removida.' : 'Assistente de IA salvo.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const confirm = useConfirm()
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>('/email/ia/testar'),
    onSuccess: (r) => toast.success(r.message),
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!q.data) return null
  const editable = can('email_marketing', 'edit')
  return (
    <Card className="lg:col-span-2">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError(null)
          save.mutate(false)
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-violet-600" /> Assistente de texto (IA)
            <Badge variant={q.data.configured ? 'default' : 'secondary'}>{q.data.configured ? 'Ativo' : 'Sem chave'}</Badge>
          </CardTitle>
          <CardDescription>
            Usa o Google Gemini para escrever e melhorar textos, e sugerir assunto e pré-cabeçalho. A chave é gratuita: entre em aistudio.google.com com uma conta Google, clique em “Get API key” → “Create API key” e cole aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-4">
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Chave do Gemini" htmlFor="ia-key" hint={q.data.configured ? 'Já cadastrada (guardada criptografada). Preencha só para trocar.' : 'Começa com AQ. ou AIza. Use o botão “Copiar chave” do AI Studio.'}>
                <Input id="ia-key" type="password" autoComplete="off" placeholder={q.data.configured ? '••••••••••••' : 'AQ.…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </Row>
              <Row label="Velocidade" htmlFor="ia-model" hint="O CRM escolhe sozinho o modelo do Gemini mais novo disponível para a sua chave e troca se o Google aposentar algum.">
                <Select value={model ?? q.data.model} onValueChange={setModel}>
                  <SelectTrigger id="ia-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {q.data.models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {AI_MODEL_LABEL[m] ?? m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
            <Row label="Sobre a empresa" htmlFor="ia-about" hint="Ajuda a IA a escrever no tom certo: o que vende, para quem, diferenciais. Sem dados de clientes.">
              <Textarea id="ia-about" rows={2} maxLength={500} placeholder="Importadora de peças para máquinas pesadas (JCB, Case, Caterpillar), atende oficinas e frotistas de todo o Brasil." value={about ?? q.data.about} onChange={(e) => setAbout(e.target.value)} />
            </Row>
            <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              Privacidade: só o texto que você está escrevendo no e-mail vai para o Google, nunca dados de leads. No plano gratuito o Google pode usar esses textos para melhorar os modelos, então não escreva informações sigilosas no editor. O plano gratuito tem limite de pedidos por minuto e por dia.
            </p>
          </fieldset>
          <FormError message={error} />
        </CardContent>
        {editable && (
          <CardFooter className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
            {q.data.configured && (
              <>
                <Button type="button" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                  {test.isPending && <Loader2Icon className="animate-spin" />}
                  Testar conexão
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'Remover a chave do Gemini?', description: 'O assistente de texto (IA) para de funcionar no editor de e-mails até alguém cadastrar uma chave de novo.', confirmLabel: 'Remover chave' })) save.mutate(true)
                  }}
                  disabled={save.isPending}
                >
                  Remover chave do Gemini
                </Button>
              </>
            )}
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

function LogoCard({ settings }: { settings: EmailSettings }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const done = (v: EmailSettings) => {
    qc.setQueryData(['email-settings'], v)
    toast.success('Logo do e-mail atualizado.')
  }
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<EmailSettings>('/email/configuracoes/logo', form)
    },
    onSuccess: done,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({ mutationFn: () => api.post<EmailSettings>('/email/configuracoes/logo/remover'), onSuccess: done, onError: (err) => toast.error(errorMessage(err)) })
  const confirm = useConfirm()
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Logo dos e-mails</CardTitle>
        <CardDescription>Aparece no topo de toda campanha. Use a versão para fundo branco (PNG ou JPG, até 1 MB, com uns 400 px de largura).</CardDescription>
      </CardHeader>
      <CardContent className="mt-4 space-y-3">
        <div className="flex h-24 items-center justify-center rounded-md border bg-white p-3">
          {settings.logoUrl ? <img src={settings.logoUrl} alt="Logo dos e-mails" className="max-h-full max-w-full object-contain" /> : <span className="flex items-center gap-2 text-sm text-[#6b7280]"><ImageIcon className="size-4" /> Sem logo: vai o nome da empresa</span>}
        </div>
        <p className="text-xs text-muted-foreground">{settings.ownLogo ? 'Logo próprio dos e-mails.' : settings.logoUrl ? 'Usando o logo do sistema (Configurações → Identidade da empresa).' : ''}</p>
        {can('email_marketing', 'edit') && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar logo
            </Button>
            {settings.ownLogo && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (await confirm({ title: 'Remover o logo próprio dos e-mails?', description: 'Os e-mails passam a usar o logo do sistema (Configurações → Identidade da empresa). Para voltar ao atual, será preciso enviá-lo de novo.', confirmLabel: 'Remover logo' })) remove.mutate()
                }}
                disabled={remove.isPending}
              >
                Usar o do sistema
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Duplicar escolhendo o destino: campanha (envio para um segmento) ou e-mail de fluxo (modelo das automações).
 * Serve também para passar um e-mail criado no lugar errado para o certo, sem refazer.
 */
function DuplicateMenu({ id, name }: { id: string; name: string }) {
  const navigate = useNavigate()
  const run = useMutation({
    mutationFn: (kind: 'CAMPANHA' | 'MODELO') => api.post<{ id: string; kind: string }>(`/email/campanhas/${id}/duplicar`, { kind }),
    onSuccess: (r) => {
      toast.success(r.kind === 'MODELO' ? 'Cópia criada como e-mail de fluxo (Modelos).' : 'Cópia criada como campanha.')
      navigate(`/email-marketing/${r.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Duplicar ${name}`} disabled={run.isPending}>
          {run.isPending ? <Loader2Icon className="animate-spin" /> : <CopyIcon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Duplicar como</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run.mutate('CAMPANHA')}>Campanha (envio para um segmento)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run.mutate('MODELO')}>E-mail de fluxo (automações)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
