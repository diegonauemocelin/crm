import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { type Col, SimpleTable } from '@/components/marketing/tabela'
import { Kpi, TrendChart } from '@/components/marketing/ui'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { money, num, pctOf, todaySP } from '@/lib/format'
import { BASE, customer, duration, ORIGIN_LABELS, QuestionLink, qs, StatusBadge } from './comum'

interface TimeStats {
  n: number
  avg: number | null
  median: number | null
}
interface OriginSales {
  perguntas: number
  com_venda: number
  vendas: number
  receita: number
  checkout: number
  desistiu: number
  perdido: number
}
interface SaleRow {
  id: number
  mlOrderId: string
  itemTitle: string | null
  total: number
  orderDate: string
  questionId: number
  questionText: string
  customerName: string | null
  customerNickname: string | null
  customerId: string | null
  origin: string
}
interface Dashboard {
  cards: { recebidasHoje: number; respondidasIaHoje: number; aguardando: number; revisao: number; conhecimentosAtivos: number; conhecimentosTotal: number; ultimaAtualizacaoBase: string | null }
  centrals: { enviadasHoje: number; falhasEnvio: number; pendentes24h: number; conhecimentoEmAprovacao: number; porMotivo: { reason: string; n: number }[] }
  charts: { perDay: { day: string; n: number }[]; outcome: { ia: number; atendente: number; encaminhadas: number }; brands: { label: string; n: number }[]; products: { label: string; n: number }[] }
  recent: { id: number; text: string; receivedAt: string; status: string; itemTitle: string | null; mlItemId: string | null; customerName: string | null; customerNickname: string | null; customerId: string | null; responsible: string | null }[]
  service: { periodo: { recebidas: number; atendidas: number }; tempos: Record<'ia' | 'iaAutomatica' | 'iaAprovada' | 'manual' | 'painel' | 'direto', TimeStats> }
  sales: {
    enabled: boolean
    lastSyncAt: string | null
    error: string | null
    total: { vendas: number; receita: number; perguntasComVenda: number; atendidas: number; atendidasComVenda: number; checkout: number; desistiu: number; perdido: number; aguardandoPagamento: number }
    porOrigem: Record<'ia' | 'atendente' | 'externa' | 'sem_resposta', OriginSales>
    recent: SaleRow[]
    abandoned: SaleRow[]
  }
}

const REASONS: Record<string, string> = { A: 'Falta de conhecimento técnico', B: 'Falta de dados do cliente', C: 'Informações conflitantes', D: 'Produto não localizado', E: 'Dúvida comercial', F: 'Falha de integração', G: 'Necessita de análise humana' }

export function AssistentePainelPage() {
  return (
    <RequirePermission module="assist_atendimento">
      <Painel />
    </RequirePermission>
  )
}

function Painel() {
  const [from, setFrom] = useState(todaySP(-13))
  const [to, setTo] = useState(todaySP())
  const q = useQuery({ queryKey: ['assist-painel', from, to], queryFn: () => api.get<Dashboard>(`/assistente/painel${qs({ from, to })}`), placeholderData: keepPreviousData })
  const d = q.data
  const saleCols: Col<SaleRow>[] = [
    { label: 'Pergunta', value: (r) => <QuestionLink id={r.questionId}>{r.questionText}</QuestionLink> },
    { label: 'Cliente', value: (r) => customer(r) },
    { label: 'Produto', value: (r) => r.itemTitle ?? '—' },
    { label: 'Respondida por', value: (r) => ORIGIN_LABELS[r.origin] ?? r.origin },
    { label: 'Pedido', value: (r) => formatDateTime(r.orderDate) },
    { label: 'Valor', value: (r) => money(r.total), right: true },
  ]
  return (
    <div>
      <PageHeader
        title="Assistente do Mercado Livre"
        description="Perguntas dos clientes no Mercado Livre respondidas com a base de conhecimento, a IA e o frete da Magazord."
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" className="w-38" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="De" />
            <Input type="date" className="w-38" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Até" />
          </div>
        }
      />
      {q.isLoading ? (
        <TableSkeleton rows={8} />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Recebidas hoje" value={num(d.cards.recebidasHoje)} to={`${BASE}/perguntas`} />
            <Kpi label="Respondidas pela IA hoje" value={num(d.cards.respondidasIaHoje)} />
            <Kpi label="Aguardando atendimento" value={num(d.cards.aguardando)} hint={d.centrals.pendentes24h ? `${d.centrals.pendentes24h} há mais de 24 h` : undefined} to={`${BASE}/pendentes`} />
            <Kpi label="Para revisar" value={num(d.cards.revisao)} hint="Sugestões aguardando aprovação ou marcadas" to={`${BASE}/perguntas?view=revisao`} />
            <Kpi label="Base de conhecimento" value={`${num(d.cards.conhecimentosAtivos)} ativos`} hint={`${num(d.cards.conhecimentosTotal)} no total${d.centrals.conhecimentoEmAprovacao ? `, ${d.centrals.conhecimentoEmAprovacao} em aprovação` : ''}`} to={`${BASE}/conhecimento`} />
          </div>
          {d.centrals.falhasEnvio > 0 && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {d.centrals.falhasEnvio} resposta(s) com falha ou sem confirmação do Mercado Livre. <Link className="underline" to={`${BASE}/respostas?status=falha`}>Ver respostas</Link>
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart title="Perguntas por dia" data={d.charts.perDay.map((p) => ({ label: `${p.day.slice(8, 10)}/${p.day.slice(5, 7)}`, n: p.n }))} series={[{ key: 'n', label: 'Perguntas', color: 'var(--chart-1)' }]} kind="bar" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quem respondeu</CardTitle>
                <CardDescription>Perguntas recebidas no período.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Line label="Respondidas pela IA" value={num(d.charts.outcome.ia)} />
                <Line label="Respondidas por atendente" value={num(d.charts.outcome.atendente)} />
                <Line label="Encaminhadas para análise" value={num(d.charts.outcome.encaminhadas)} />
                <p className="pt-2 font-medium">Pendentes por motivo</p>
                {d.centrals.porMotivo.length === 0 ? <p className="text-muted-foreground">Nenhuma pendente.</p> : d.centrals.porMotivo.map((m) => <Line key={m.reason} label={`${m.reason}. ${REASONS[m.reason] ?? ''}`} value={num(m.n)} to={`${BASE}/pendentes?reason=${m.reason}`} />)}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tempo de resposta</CardTitle>
              <CardDescription>
                {num(d.service.periodo.atendidas)} de {num(d.service.periodo.recebidas)} perguntas do período respondidas. Mediana: metade das respostas saiu antes desse tempo.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              <Tempo label="IA automática" t={d.service.tempos.iaAutomatica} />
              <Tempo label="IA aprovada por atendente" t={d.service.tempos.iaAprovada} />
              <Tempo label="Atendente no CRM" t={d.service.tempos.painel} />
              <Tempo label="Direto no Mercado Livre" t={d.service.tempos.direto} />
              <Tempo label="Todas as manuais" t={d.service.tempos.manual} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">Perguntas que viraram venda {!d.sales.enabled && <Badge variant="outline">Ligação com vendas desligada</Badge>}</CardTitle>
              <CardDescription>
                Pedidos do mesmo cliente depois da pergunta. {d.sales.lastSyncAt ? `Vendas atualizadas em ${formatDateTime(d.sales.lastSyncAt)}.` : 'As vendas são buscadas depois que o CRM assume o atendimento.'}
                {d.sales.error ? ` Último erro: ${d.sales.error}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Vendas" value={num(d.sales.total.vendas)} hint={money(d.sales.total.receita)} />
                <Kpi label="Perguntas respondidas com venda" value={pctOf(d.sales.total.atendidasComVenda, d.sales.total.atendidas)} hint={`${num(d.sales.total.atendidasComVenda)} de ${num(d.sales.total.atendidas)}`} />
                <Kpi label="Desistiram no checkout" value={num(d.sales.total.desistiu)} hint={money(d.sales.total.perdido)} to={`${BASE}/perguntas?view=desistiu_checkout`} />
                <Kpi label="Aguardando pagamento" value={num(d.sales.total.aguardandoPagamento)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {(['ia', 'atendente', 'externa', 'sem_resposta'] as const).map((o) => {
                  const s = d.sales.porOrigem[o]
                  return (
                    <div key={o} className="rounded-md border p-3">
                      <p className="font-medium">{ORIGIN_LABELS[o]}</p>
                      <p className="text-muted-foreground">
                        {num(s.perguntas)} perguntas · {num(s.com_venda)} com venda ({pctOf(s.com_venda, s.perguntas)}) · {money(s.receita)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleTable title="Vendas recentes" rows={d.sales.recent} cols={saleCols} rowKey={(r) => String(r.id)} empty="Nenhuma venda ligada a perguntas no período." />
            <SimpleTable title="Desistências no checkout" rows={d.sales.abandoned} cols={saleCols} rowKey={(r) => String(r.id)} empty="Nenhuma desistência no período." />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleTable title="Marcas mais perguntadas" rows={d.charts.brands} cols={[{ label: 'Marca', value: (r) => r.label }, { label: 'Perguntas', value: (r) => num(r.n), right: true }]} rowKey={(r) => r.label} />
            <SimpleTable title="Produtos mais perguntados" rows={d.charts.products} cols={[{ label: 'Produto', value: (r) => r.label }, { label: 'Perguntas', value: (r) => num(r.n), right: true }]} rowKey={(r) => r.label} />
          </div>
          <SimpleTable
            title="Últimas perguntas"
            rows={d.recent}
            rowKey={(r) => String(r.id)}
            cols={[
              { label: 'Pergunta', value: (r) => <QuestionLink id={r.id}>{r.text}</QuestionLink> },
              { label: 'Cliente', value: (r) => customer(r) },
              { label: 'Produto', value: (r) => r.itemTitle ?? r.mlItemId ?? '—' },
              { label: 'Situação', value: (r) => <StatusBadge status={r.status} /> },
              { label: 'Responsável', value: (r) => r.responsible ?? '—' },
              { label: 'Recebida', value: (r) => formatDateTime(r.receivedAt) },
            ]}
          />
        </div>
      )}
    </div>
  )
}

function Line({ label, value, to }: { label: string; value: string; to?: string }) {
  return (
    <div className="flex justify-between gap-2">
      {to ? (
        <Link to={to} className="text-muted-foreground hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-muted-foreground">{label}</span>
      )}
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function Tempo({ label, t }: { label: string; t: TimeStats }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{duration(t.median)}</p>
      <p className="text-xs text-muted-foreground">
        média {duration(t.avg)} · {num(t.n)} resposta(s)
      </p>
    </div>
  )
}
