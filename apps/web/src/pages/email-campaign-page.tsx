import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, CopyIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type Campaign, type CampaignReport, pct, STATUS_LABEL, STATUS_TONE } from '@/lib/email'
import { Editor } from './email-editor'

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
