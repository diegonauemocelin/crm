import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, Loader2Icon, MailIcon, PencilIcon, PlusIcon, Trash2Icon, UsersRoundIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, UF_LIST, UF_NAMES, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type Campaign, type EmailSettings, pct, type Segment, type SegmentFilters, STATUS_LABEL, STATUS_TONE } from '@/lib/email'
import { STAGES, useTags } from '@/lib/leads'
import { FormError } from './auth/auth-layout'

const ANY = '__any__'

export function EmailPage() {
  return (
    <RequirePermission module="email_marketing">
      <PageHeader title="Email marketing" description="Campanhas para os leads que autorizaram receber e-mails, com aberturas, cliques e descadastros." />
      <Tabs defaultValue="campanhas">
        <TabsList className="mb-4">
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="segmentos">Segmentos</TabsTrigger>
          <TabsTrigger value="configuracoes">Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="campanhas">
          <CampaignsTab />
        </TabsContent>
        <TabsContent value="segmentos">
          <SegmentsTab />
        </TabsContent>
        <TabsContent value="configuracoes">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

// ---------- Campanhas ----------

function CampaignsTab() {
  const q = useQuery({ queryKey: ['email-campaigns'], queryFn: () => api.get<Campaign[]>('/email/campanhas'), refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'ENVIANDO') ? 10_000 : false) })
  const { can } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/email/campanhas', { name: 'Nova campanha', subject: '', blocks: [{ type: 'titulo', text: 'Olá, {primeiro_nome}!' }, { type: 'texto', text: 'Escreva aqui a sua mensagem.' }] }),
    onSuccess: (c) => navigate(`/email-marketing/${c.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/email/campanhas/${id}/duplicar`),
    onSuccess: (r) => navigate(`/email-marketing/${r.id}`),
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
      <div className="mb-3 flex justify-end">
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
              {q.data.map((c) => (
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
                    <Button size="sm" variant="ghost" asChild aria-label={`Abrir ${c.name}`}>
                      <Link to={`/email-marketing/${c.id}`}>
                        <PencilIcon />
                      </Link>
                    </Button>
                    {can('email_marketing', 'create') && (
                      <Button size="sm" variant="ghost" onClick={() => duplicate.mutate(c.id)} aria-label={`Duplicar ${c.name}`}>
                        <CopyIcon />
                      </Button>
                    )}
                    {c.status === 'RASCUNHO' && can('email_marketing', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`Excluir o rascunho "${c.name}"?`) && remove.mutate(c.id)} aria-label={`Excluir ${c.name}`}>
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
          <Button onClick={() => setOpen('new')}>
            <PlusIcon /> Novo segmento
          </Button>
        )}
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={UsersRoundIcon} title="Nenhum segmento ainda" description="Ex.: Revenda do Sul, Clientes com nota A, Carrinho abandonado (tag)." />
      ) : (
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
              {q.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{describeFilters(s.filters)}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(s.eligible)}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    {can('email_marketing', 'edit') && (
                      <Button size="sm" variant="ghost" onClick={() => setOpen(s)} aria-label={`Editar ${s.name}`}>
                        <PencilIcon />
                      </Button>
                    )}
                    {can('email_marketing', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`Excluir o segmento "${s.name}"?`) && remove.mutate(s.id)} aria-label={`Excluir ${s.name}`}>
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
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
            <Label htmlFor="sg-name">Nome</Label>
            <Input id="sg-name" required maxLength={80} placeholder="Ex.: Revenda do Sul" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Pick label="Estágio" id="sg-stage" value={f.stage} onChange={(v) => set('stage', v)} items={STAGES.map((s) => ({ id: s.id, name: s.label }))} />
            <Pick label="Nota" id="sg-grade" value={f.grade} onChange={(v) => set('grade', v)} items={['A', 'B', 'C', 'D'].map((g) => ({ id: g, name: g }))} />
            <Pick label="Tag" id="sg-tag" value={f.tag} onChange={(v) => set('tag', v)} items={(tags.data ?? []).map((t) => ({ id: t.tag, name: `${t.tag} (${t.total})` }))} />
            <Pick label="Estado" id="sg-state" value={f.state} onChange={(v) => set('state', v)} items={UF_LIST.map((uf) => ({ id: uf, name: `${UF_NAMES[uf]} (${uf})` }))} />
            <Pick label="Responsável" id="sg-owner" value={f.ownerId} onChange={(v) => set('ownerId', v)} items={(o?.sellers ?? []).filter((s) => s.active)} />
            <Pick label="Unidade" id="sg-unit" value={f.unitId} onChange={(v) => set('unitId', v)} items={o?.units ?? []} />
            <Pick label="Origem" id="sg-origin" value={f.originId} onChange={(v) => set('originId', v)} items={o?.origins ?? []} />
            <div className="space-y-1.5">
              <Label htmlFor="sg-from">Cadastrados a partir de</Label>
              <Input id="sg-from" type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value || undefined)} />
            </div>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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

function SettingsTab() {
  const q = useQuery({ queryKey: ['email-settings'], queryFn: () => api.get<EmailSettings>('/email/configuracoes') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  return <SettingsEditor initial={q.data} />
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
    mutationFn: () => api.put<EmailSettings>('/email/configuracoes', { ...s }),
    onSuccess: (saved) => {
      qc.setQueryData(['email-settings'], saved)
      toast.success('Configurações salvas.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Card className="max-w-2xl">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError(null)
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Envio das campanhas</CardTitle>
          <CardDescription>O e-mail sai pelo servidor configurado em Configurações → E-mail (SMTP).</CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-4">
          <fieldset disabled={!can('email_marketing', 'edit')} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Nome do remetente" htmlFor="em-from" hint="Vazio = o nome do SMTP.">
                <Input id="em-from" maxLength={80} placeholder="USA Parts" value={s.fromName} onChange={(e) => setS({ ...s, fromName: e.target.value })} />
              </Row>
              <Row label="Responder para" htmlFor="em-reply" hint="Para onde vão as respostas dos clientes.">
                <Input id="em-reply" type="email" placeholder="comercial@usaparts.com.br" value={s.replyTo} onChange={(e) => setS({ ...s, replyTo: e.target.value })} />
              </Row>
            </div>
            <Row label="Rodapé (dados da empresa)" htmlFor="em-footer" hint="Razão social, endereço e telefone: os provedores de e-mail exigem e passa confiança.">
              <Textarea id="em-footer" rows={3} maxLength={500} placeholder={'USA Parts Importadora e Distribuidora\nMaravilha/SC · (49) 0000-0000'} value={s.footerText} onChange={(e) => setS({ ...s, footerText: e.target.value })} />
            </Row>
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
