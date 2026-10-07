import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CalendarClockIcon, CopyIcon, Loader2Icon, PauseIcon, PlayIcon, PlusIcon, SendIcon, Trash2Icon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type Block, BLOCK_LABEL, type Campaign, type CampaignReport, newBlock, pct, type Segment, STATUS_LABEL, STATUS_TONE } from '@/lib/email'
import { FormError } from './auth/auth-layout'

const NONE = '__none__'

export function EmailCampaignPage() {
  return (
    <RequirePermission module="email_marketing">
      <CampaignLoader />
    </RequirePermission>
  )
}

function CampaignLoader() {
  const { id } = useParams()
  const q = useQuery({
    queryKey: ['email-campaign', id],
    queryFn: () => api.get<Campaign>(`/email/campanhas/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'ENVIANDO' ? 5_000 : false),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  const editable = ['RASCUNHO', 'AGENDADA', 'PAUSADA'].includes(q.data.status) && q.data.total === 0
  return editable || q.data.status === 'RASCUNHO' ? <Editor key={q.data.id} campaign={q.data} /> : <Report campaign={q.data} />
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ---------- Editor ----------

function Editor({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const canEdit = can('email_marketing', 'edit')
  const segments = useQuery({ queryKey: ['email-segments'], queryFn: () => api.get<Segment[]>('/email/segmentos') })
  const [c, setC] = useState(campaign)
  const [blocks, setBlocks] = useState<Block[]>(campaign.blocks)
  const [html, setHtml] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testTo, setTestTo] = useState(me?.email ?? '')
  const [confirmSend, setConfirmSend] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const set = <K extends keyof Campaign>(k: K, v: Campaign[K]) => setC((x) => ({ ...x, [k]: v }))
  const segment = segments.data?.find((s) => s.id === c.segmentId)

  // Pré-visualização montada pelo servidor (o mesmo HTML que vai no e-mail).
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<{ html: string }>('/email/previa', { subject: c.subject, preheader: c.preheader, blocks })
        .then((r) => {
          setHtml(r.html)
          setError(null)
        })
        .catch((err) => setError(errorMessage(err)))
    }, 400)
    return () => clearTimeout(t)
  }, [blocks, c.subject, c.preheader])

  const body = () => ({ name: c.name, subject: c.subject, preheader: c.preheader || null, fromName: c.fromName || null, replyTo: c.replyTo || null, segmentId: c.segmentId, blocks })
  const save = useMutation({
    mutationFn: () => api.put<Campaign>(`/email/campanhas/${campaign.id}`, body()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-campaigns'] })
      toast.success('Campanha salva.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const test = useMutation({
    mutationFn: async () => {
      await api.put(`/email/campanhas/${campaign.id}`, body())
      return api.post(`/email/campanhas/${campaign.id}/teste`, { to: testTo })
    },
    onSuccess: () => toast.success(`Teste enviado para ${testTo}.`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const start = useMutation({
    mutationFn: async (when: string | null) => {
      await api.put(`/email/campanhas/${campaign.id}`, body())
      return api.post<{ total: number; status: string }>(`/email/campanhas/${campaign.id}/enviar`, { scheduledAt: when ? new Date(when).toISOString() : null })
    },
    onSuccess: (r) => {
      toast.success(r.status === 'AGENDADA' ? `Agendada para ${int.format(r.total)} destinatário(s).` : `Envio iniciado para ${int.format(r.total)} destinatário(s).`)
      void qc.invalidateQueries({ queryKey: ['email-campaign', campaign.id] })
      void qc.invalidateQueries({ queryKey: ['email-campaigns'] })
      setConfirmSend(false)
    },
    onError: (err) => {
      setConfirmSend(false)
      toast.error(errorMessage(err))
    },
  })

  const update = (i: number, b: Block) => setBlocks((x) => x.map((y, j) => (j === i ? b : y)))
  const move = (i: number, d: -1 | 1) =>
    setBlocks((x) => {
      const n = [...x]
      const [b] = n.splice(i, 1)
      n.splice(i + d, 0, b!)
      return n
    })

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/email-marketing">
          <ArrowLeftIcon /> Campanhas
        </Link>
      </Button>
      <PageHeader
        title={c.name || 'Campanha'}
        description={campaign.status === 'AGENDADA' && campaign.scheduledAt ? `Agendada para ${formatDateTime(campaign.scheduledAt)}` : 'Rascunho: monte o e-mail, envie um teste e depois envie para o segmento.'}
        actions={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
              <Button onClick={() => setConfirmSend(true)} disabled={!c.segmentId || !c.subject.trim()}>
                <SendIcon /> Enviar
              </Button>
            </div>
          )
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome interno" htmlFor="c-name">
                <Input id="c-name" maxLength={120} value={c.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Segmento (quem recebe)" htmlFor="c-seg" hint={segment ? `${int.format(segment.eligible)} podem receber agora.` : 'Crie segmentos na aba Segmentos.'}>
                <Select value={c.segmentId ?? NONE} onValueChange={(v) => set('segmentId', v === NONE ? null : v)} disabled={!canEdit}>
                  <SelectTrigger id="c-seg" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Escolha o segmento</SelectItem>
                    {(segments.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({int.format(s.eligible)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Assunto" htmlFor="c-subject" hint="Use {primeiro_nome} para personalizar.">
                <Input id="c-subject" maxLength={200} placeholder="Ex.: {primeiro_nome}, peças JCB com frete grátis" value={c.subject} onChange={(e) => set('subject', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Pré-cabeçalho" htmlFor="c-pre" hint="Texto que aparece ao lado do assunto na caixa de entrada.">
                <Input id="c-pre" maxLength={200} value={c.preheader ?? ''} onChange={(e) => set('preheader', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Nome do remetente (opcional)" htmlFor="c-from">
                <Input id="c-from" maxLength={80} placeholder="Padrão das configurações" value={c.fromName ?? ''} onChange={(e) => set('fromName', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Responder para (opcional)" htmlFor="c-reply">
                <Input id="c-reply" type="email" placeholder="Padrão das configurações" value={c.replyTo ?? ''} onChange={(e) => set('replyTo', e.target.value)} disabled={!canEdit} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Conteúdo</CardTitle>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <PlusIcon /> Adicionar bloco
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(Object.keys(BLOCK_LABEL) as Block['type'][]).map((t) => (
                      <DropdownMenuItem key={t} onSelect={() => setBlocks((x) => [...x, newBlock(t)])}>
                        {BLOCK_LABEL[t]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {blocks.map((b, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{BLOCK_LABEL[b.type]}</span>
                    {canEdit && (
                      <div className="flex">
                        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                          <ArrowUpIcon />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
                          <ArrowDownIcon />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))} aria-label="Remover bloco">
                          <XIcon />
                        </Button>
                      </div>
                    )}
                  </div>
                  <BlockFields block={b} onChange={(nb) => update(i, nb)} disabled={!canEdit} />
                </div>
              ))}
              {blocks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Adicione blocos para montar o e-mail.</p>}
            </CardContent>
          </Card>

          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Enviar um teste</CardTitle>
                <CardDescription>Confira no seu e-mail antes de enviar para o segmento (assunto com [TESTE]).</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input type="email" aria-label="E-mail para o teste" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !testTo}>
                  {test.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar teste
                </Button>
              </CardContent>
            </Card>
          )}
          <FormError message={error} />
        </div>

        <Card className="h-fit overflow-hidden py-0 xl:sticky xl:top-4">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Pré-visualização (com os seus dados)</div>
          {html ? <iframe title="Pré-visualização do e-mail" srcDoc={html} sandbox="" className="h-[75vh] w-full bg-white" /> : <div className="p-6 text-sm text-muted-foreground">Montando…</div>}
        </Card>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar “{c.subject || c.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai para <strong>{segment ? int.format(segment.eligible) : '—'}</strong> lead(s) do segmento “{segment?.name ?? '—'}” que autorizaram receber e-mails. Depois de começar, dá para pausar, mas não para desfazer o que já saiu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="c-when" className="flex items-center gap-1">
              <CalendarClockIcon className="size-4" /> Agendar (opcional)
            </Label>
            <Input id="c-when" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                start.mutate(scheduleAt || null)
              }}
              disabled={start.isPending}
            >
              {start.isPending && <Loader2Icon className="animate-spin" />}
              {scheduleAt ? 'Agendar envio' : 'Enviar agora'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BlockFields({ block: b, onChange, disabled }: { block: Block; onChange: (b: Block) => void; disabled: boolean }) {
  switch (b.type) {
    case 'titulo':
      return <Input aria-label="Título" maxLength={200} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} disabled={disabled} />
    case 'texto':
      return <Textarea aria-label="Texto" rows={4} maxLength={5000} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} disabled={disabled} />
    case 'imagem':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Endereço da imagem" placeholder="https://... (imagem)" value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} disabled={disabled} />
          <Input aria-label="Link ao clicar" placeholder="Link ao clicar (opcional)" value={b.link ?? ''} onChange={(e) => onChange({ ...b, link: e.target.value })} disabled={disabled} />
        </div>
      )
    case 'botao':
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Input aria-label="Texto do botão" maxLength={60} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} disabled={disabled} />
          <Input aria-label="Link do botão" placeholder="https://..." value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} disabled={disabled} />
          <Input aria-label="Cor do botão" type="color" className="h-9 w-14 p-1" value={b.color ?? '#1d4ed8'} onChange={(e) => onChange({ ...b, color: e.target.value })} disabled={disabled} />
        </div>
      )
    case 'produtos':
      return (
        <div className="space-y-2">
          {b.items.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_2fr_auto]">
              <Input aria-label="Nome do produto" placeholder="Nome" value={it.name} onChange={(e) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} disabled={disabled} />
              <Input aria-label="Preço" placeholder="R$" value={it.price ?? ''} onChange={(e) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} disabled={disabled} />
              <Input aria-label="Imagem do produto" placeholder="Imagem https://" value={it.image ?? ''} onChange={(e) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, image: e.target.value } : x)) })} disabled={disabled} />
              <Input aria-label="Link do produto" placeholder="Link https://" value={it.url ?? ''} onChange={(e) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} disabled={disabled} />
              <Button type="button" size="icon" variant="ghost" onClick={() => onChange({ ...b, items: b.items.filter((_, j) => j !== i) })} aria-label="Remover produto" disabled={disabled}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          {b.items.length < 12 && (
            <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...b, items: [...b.items, { name: '', price: '', url: '', image: '' }] })} disabled={disabled}>
              <PlusIcon /> Produto
            </Button>
          )}
        </div>
      )
    default:
      return null
  }
}

// ---------- Relatório ----------

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="py-4">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Report({ campaign: c }: { campaign: Campaign }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const r = useQuery({ queryKey: ['email-report', c.id], queryFn: () => api.get<CampaignReport>(`/email/campanhas/${c.id}/relatorio`), refetchInterval: c.status === 'ENVIANDO' ? 5_000 : false })
  const status = useMutation({
    mutationFn: (action: 'pausar' | 'retomar' | 'cancelar') => api.post(`/email/campanhas/${c.id}/situacao`, { action }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-campaign', c.id] })
      void qc.invalidateQueries({ queryKey: ['email-report', c.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/email/campanhas/${c.id}/duplicar`),
    onSuccess: (x) => navigate(`/email-marketing/${x.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = r.data
  const progress = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0
  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/email-marketing">
          <ArrowLeftIcon /> Campanhas
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={`Assunto: ${c.subject}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STATUS_TONE[c.status]}>
              {STATUS_LABEL[c.status]}
            </Badge>
            {can('email_marketing', 'edit') && c.status === 'ENVIANDO' && (
              <Button variant="outline" size="sm" onClick={() => status.mutate('pausar')}>
                <PauseIcon /> Pausar
              </Button>
            )}
            {can('email_marketing', 'edit') && c.status === 'PAUSADA' && (
              <Button size="sm" onClick={() => status.mutate('retomar')}>
                <PlayIcon /> Retomar
              </Button>
            )}
            {can('email_marketing', 'edit') && ['ENVIANDO', 'PAUSADA', 'AGENDADA'].includes(c.status) && (
              <Button variant="ghost" size="sm" onClick={() => confirm('Cancelar o envio? Quem ainda não recebeu não vai receber.') && status.mutate('cancelar')}>
                Cancelar envio
              </Button>
            )}
            {can('email_marketing', 'create') && (
              <Button variant="outline" size="sm" onClick={() => duplicate.mutate()}>
                <CopyIcon /> Duplicar
              </Button>
            )}
          </div>
        }
      />
      {(c.status === 'ENVIANDO' || c.status === 'PAUSADA') && (
        <div className="mb-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemax={100}>
            <div className="h-full bg-[color:var(--brand)] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {int.format(c.sent + c.failed)} de {int.format(c.total)} processados{d ? ` · ${int.format(d.pending)} na fila` : ''}
          </p>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Enviados" value={int.format(c.sent)} hint={`de ${int.format(c.total)}`} />
        <Stat label="Aberturas" value={pct(c.opens, c.sent)} hint={`${int.format(c.opens)} pessoas`} />
        <Stat label="Cliques" value={pct(c.clicks, c.sent)} hint={`${int.format(c.clicks)} pessoas`} />
        <Stat label="Descadastros" value={int.format(c.unsubscribes)} />
        <Stat label="Não entregues" value={int.format(c.failed)} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">Aberturas são estimadas: alguns programas de e-mail bloqueiam imagens (não contam) e outros abrem automaticamente (contam a mais). Cliques são exatos.</p>
      {r.error ? (
        <ErrorState error={r.error} onRetry={() => r.refetch()} />
      ) : !d ? (
        <TableSkeleton rows={3} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Links mais clicados</CardTitle>
            </CardHeader>
            <CardContent>
              {d.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem links no e-mail.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {d.links.map((l) => (
                    <li key={l.url} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate" title={l.url}>
                        {l.url}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{int.format(l.clicks)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card className="overflow-hidden py-0">
            <CardHeader className="pt-6">
              <CardTitle className="text-base">Quem clicou, descadastrou ou não recebeu</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">E-mail</TableHead>
                  <TableHead className="pr-4">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.recipients.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="pl-4">
                      <Link to={`/leads/${x.leadId}`} className="hover:underline">
                        {x.email}
                      </Link>
                    </TableCell>
                    <TableCell className="pr-4 text-sm">
                      {x.status === 'ERRO' ? <span className="text-destructive">Não entregue: {x.error}</span> : x.unsubscribedAt ? 'Descadastrou' : `Clicou ${x.clicks}x`}
                    </TableCell>
                  </TableRow>
                ))}
                {d.recipients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                      Ninguém ainda.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  )
}
