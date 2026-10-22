import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { num } from '@/lib/format'
import { customer, Pager, QuestionLink, qs, SendBadge } from './comum'

interface AnswerRow {
  id: number
  origin: string
  kind: string
  text: string
  sendStatus: string
  sentAt: string | null
  createdAt: string
  reviewed: boolean
  flaggedForReview: boolean
  error: string | null
  authorName: string | null
  questionId: number
  questionText: string
  customerNickname: string | null
  customerName: string | null
  customerId: string | null
  mlItemId: string | null
  itemTitle: string | null
}
interface AnswersResponse {
  rows: AnswerRow[]
  total: number
  page: number
  pageSize: number
  stats: { hoje: number; mes: number; sucesso: number; falhas: number; revisadas: number; aguardandoAprovacao: number }
}

export function AssistenteRespostasPage() {
  return (
    <RequirePermission module="assist_atendimento">
      <Respostas />
    </RequirePermission>
  )
}

function Respostas() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const f = { status: params.get('status') ?? '', origin: params.get('origin') ?? '', reviewed: params.get('reviewed') ?? '', flagged: params.get('flagged') ?? '', q: params.get('q') ?? '' }
  const [search, setSearch] = useState(f.q)
  const list = useQuery({ queryKey: ['assist-respostas', f, page], queryFn: () => api.get<AnswersResponse>(`/assistente/respostas${qs({ ...f, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
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
      <PageHeader title="Respostas enviadas" description="O que foi respondido aos clientes no Mercado Livre, pela IA ou por atendentes, com a confirmação do Mercado Livre." />
      {s && (
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['Enviadas hoje', s.hoje],
              ['No mês', s.mes],
              ['Total enviadas', s.sucesso],
              ['Falhas', s.falhas],
              ['Revisadas por atendente', s.revisadas],
              ['Aguardando aprovação', s.aguardandoAprovacao],
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Enviadas e com falha</SelectItem>
            <SelectItem value="enviada">Enviadas</SelectItem>
            <SelectItem value="falha">Falha no envio</SelectItem>
            <SelectItem value="pendente">Aguardando confirmação</SelectItem>
            <SelectItem value="preparada">Aguardando aprovação</SelectItem>
          </SelectContent>
        </Select>
        <Select value={f.origin || 'todas'} onValueChange={(v) => set('origin', v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">IA e atendente</SelectItem>
            <SelectItem value="ia">IA</SelectItem>
            <SelectItem value="atendente">Atendente</SelectItem>
          </SelectContent>
        </Select>
        <Select value={f.reviewed || 'todas'} onValueChange={(v) => set('reviewed', v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Revisadas ou não</SelectItem>
            <SelectItem value="sim">Revisadas</SelectItem>
            <SelectItem value="nao">Não revisadas</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="h-9" variant={f.flagged ? 'default' : 'outline'} onClick={() => set('flagged', f.flagged ? '' : 'sim')}>
          Marcadas para revisão
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set('q', search.trim())
          }}
        >
          <Input className="w-64" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error || !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.rows.length ? (
        <EmptyState title="Nenhuma resposta" description="Nada encontrado com estes filtros." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Pergunta</TableHead>
                <TableHead>Resposta</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Por</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-72 pl-4">
                    <QuestionLink id={r.questionId} className="line-clamp-2 font-medium">
                      {r.questionText}
                    </QuestionLink>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{r.itemTitle ?? r.mlItemId}</p>
                  </TableCell>
                  <TableCell className="max-w-96">
                    <p className="line-clamp-3 whitespace-pre-wrap">{r.text}</p>
                    {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                  </TableCell>
                  <TableCell>{customer(r)}</TableCell>
                  <TableCell>
                    {r.origin === 'ia' ? 'IA' : (r.authorName ?? 'Atendente')}
                    {r.reviewed && r.origin === 'ia' && <p className="text-xs text-muted-foreground">aprovada</p>}
                  </TableCell>
                  <TableCell>
                    <SendBadge status={r.sendStatus} />
                    {r.flaggedForReview && (
                      <Badge variant="outline" className="mt-1">
                        Revisar
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.sentAt ?? r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
    </div>
  )
}
