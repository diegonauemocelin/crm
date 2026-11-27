import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, DownloadIcon, FileCheck2Icon, FileTextIcon, LayoutListIcon, Loader2Icon, RefreshCwIcon, SearchIcon, SparklesIcon, StethoscopeIcon, TableIcon, UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { SefazNotice } from '@/components/fretes/aviso-sefaz'
import { NfeConfrontView } from '@/components/fretes/confronto-nfe'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { UF_LIST } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money } from '@/lib/format'
import { CONTEST, DECISION, fmtNum, formatCep, formatCnpj, formatKey, INVOICE_STATUS, NFE_CHECK_STATUS, type NfeConfront, REC_STATUS, REC_TYPE, SHIPMENT_STATUS, useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface RecLine {
  name: string
  expected: number | null
  charged: number | null
  difference: number
  status: 'OK' | 'DIFERENTE' | 'NAO_PREVISTA' | 'NAO_COBRADA' | 'DUPLICADA'
}

const ROLE_LABEL: Record<string, string> = { TOMADOR: 'Tomador (paga o frete)', REMETENTE: 'Remetente', DESTINATARIO: 'Destinatário', EXPEDIDOR: 'Expedidor', RECEBEDOR: 'Recebedor' }

interface Cte {
  id: string
  /** Vendedor dos dados adicionais da NF-e e frete destacado na nota (lista). */
  seller?: string | null
  nfeFreight?: number | null
  key: string
  number: string | null
  series: string | null
  issuedAt: string | null
  emitCnpj: string | null
  emitName: string | null
  carrierId: string | null
  carrierName: string | null
  unitId: string | null
  unitName?: string | null
  recipientName: string | null
  recipientDoc?: string | null
  /** Remetente (no frete de compra, o fornecedor). */
  senderName?: string | null
  senderDoc?: string | null
  ufIni: string | null
  ufFim: string | null
  cityIni: string | null
  cityFim: string | null
  destZip: string | null
  total: number
  cargoValue: number | null
  weight: number | null
  components?: { name: string; value: number }[]
  icms: { rate: number | null; value: number | null; base?: number | null } | null
  nfeKeys: string[]
  fiscalStatus: string
  /** Papel da empresa no CT-e (pela raiz do CNPJ). */
  companyRoles?: string[]
  /** MANUAL | SEFAZ */
  source?: string
  protocol: string | null
  shipmentId: string | null
  recStatus: string
  recTypes: string[]
  recSource: string | null
  expectedTotal: number | null
  difference: number | null
  recDetail?: { reference?: string; reason?: string; tables?: { table: string; reason: string }[]; allowed?: number; lines?: RecLine[]; notes?: string[] } | null
  recAt: string | null
  aiAnalysis?: CteAi | null
  aiAnalysisAt?: string | null
  decision: string | null
  approvedValue: number | null
  decisionNote: string | null
  decidedByName: string | null
  decidedAt: string | null
  contestStatus: string | null
  creditValue: number | null
  contestNote: string | null
  invoiceId: string | null
  importedByName: string
  createdAt: string
  shipment?: { id: string; code: number; orderNumber: string | null; invoiceNumber: string | null; status: string } | null
  invoice?: { id: string; number: string; status: string } | null
  volumes?: number | null
  /** Confronto com os XMLs das NF-e importados (detalhe) e o resumo (lista). */
  nfeConfront?: NfeConfront | null
  nfeCheck?: { status: NfeConfront['status']; divergences: string[] } | null
}

interface CteList {
  total: number
  pageSize: number
  counts: Record<string, number>
  sums: { charged: number; expected: number; difference: number; approved: number; credit: number }
  items: Cte[]
}

const LINE_STATUS: Record<RecLine['status'], { label: string; className: string }> = {
  OK: { label: 'Confere', className: 'text-[#006300] dark:text-[#0ca30c]' },
  DIFERENTE: { label: 'Diferente', className: 'text-destructive' },
  NAO_PREVISTA: { label: 'Não prevista', className: 'text-destructive' },
  DUPLICADA: { label: 'Duplicada', className: 'text-destructive' },
  NAO_COBRADA: { label: 'Não cobrada', className: 'text-muted-foreground' },
}

export function FretesCtesPage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteList pendingOnly={false} />
    </RequirePermission>
  )
}

/** Fila de conciliação: divergentes e sem referência sem decisão, e contestações abertas. */
export function FretesConciliacaoPage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteList pendingOnly />
    </RequirePermission>
  )
}

function CteList({ pendingOnly }: { pendingOnly: boolean }) {
  const active = useActiveUnit()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const status = params.get('situacao') ?? ''
  const decision = params.get('decisao') ?? ''
  const carrier = params.get('transportadora') ?? ''
  const kind = params.get('tipo') ?? ''
  const uf = params.get('uf') ?? ''
  // Período: atalhos (hoje, 7, 30 e 60 dias) ou datas informadas.
  const period = params.get('periodo') ?? (params.get('de') || params.get('ate') ? 'data' : '')
  const preset = PERIODS.find((x) => x.value === period)?.days
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const from = preset ? shiftDay(today, -(preset - 1)) : period === 'data' ? (params.get('de') ?? '') : ''
  const to = preset ? today : period === 'data' ? (params.get('ate') ?? '') : ''
  const [view, setView] = useState<'cartoes' | 'tabela'>(() => {
    try {
      return localStorage.getItem('ctes-visao') === 'tabela' ? 'tabela' : 'cartoes'
    } catch {
      return 'cartoes'
    }
  })
  const changeView = (v: 'cartoes' | 'tabela') => {
    setView(v)
    try {
      localStorage.setItem('ctes-visao', v)
    } catch {
      // navegador sem armazenamento: vale só nesta tela
    }
  }
  const setPeriod = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('periodo', v)
    else next.delete('periodo')
    if (v !== 'data') {
      next.delete('de')
      next.delete('ate')
    }
    setParams(next)
    setPage(1)
  }
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next)
    setPage(1)
  }
  const qs = new URLSearchParams({ pagina: String(page) })
  if (pendingOnly) qs.set('pendentes', '1')
  if (q) qs.set('busca', q)
  if (status) qs.set('situacao', status)
  if (decision) qs.set('decisao', decision)
  if (carrier) qs.set('transportadora', carrier)
  if (kind) qs.set('tipo', kind)
  if (from) qs.set('de', from)
  if (to) qs.set('ate', to)
  if (uf) qs.set('uf', uf)
  if (active.unitId) qs.set('filial', active.unitId)
  const list = useQuery({
    queryKey: ['fretes', 'ctes', qs.toString()],
    queryFn: () => api.get<CteList>(`/fretes/ctes?${qs}`),
    placeholderData: keepPreviousData,
    enabled: !!active.ctx.data,
  })
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const carriers = active.ctx.data?.carriers ?? []
  const qc = useQueryClient()
  const redo = useMutation({
    mutationFn: () => api.post<{ total: number; resolved: number; still: number }>('/fretes/ctes/reconciliar-sem-referencia'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['fretes', 'ctes'] })
      toast.success(r.total ? `${r.total} CT-e(s) pendente(s) conferido(s) de novo: ${r.resolved} resolvido(s) (conciliados ou de compra), ${r.still} ainda pendente(s).` : 'Nenhum CT-e pendente.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-4">
      <PageHeader
        title={pendingOnly ? 'Conciliação de fretes' : 'CT-e'}
        description={
          pendingOnly
            ? 'CT-es que precisam de decisão: divergentes, sem referência para comparar e contestações abertas. Os que conferem são aprovados sozinhos.'
            : 'Importe os XMLs dos CT-es: o sistema identifica transportadora, filial e pedido, e compara o cobrado com a cotação escolhida ou com a tabela vigente na data.'
        }
        actions={
          <>
            <FilialSwitch active={active} />
            <Button variant="outline" asChild title="Padrões que se repetem nos CT-es: o que ajustar nas tabelas e o que pedir à transportadora">
              <Link to="/fretes/diagnostico">
                <StethoscopeIcon aria-hidden /> Diagnóstico das tabelas
              </Link>
            </Button>
            <Can module="fretes_cte" action="edit">
              <Button variant="outline" disabled={redo.isPending} onClick={() => redo.mutate()} title="Depois de cadastrar ou corrigir tabelas: compara de novo os CT-es sem referência e divergentes sem decisão">
                {redo.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />} Conciliar pendentes de novo
              </Button>
            </Can>
            <Can module="fretes_cte" action="create">
              <Button onClick={() => setImporting(true)}>
                <UploadIcon aria-hidden /> Importar XML
              </Button>
            </Can>
          </>
        }
      />
      <SefazNotice />
      {!pendingOnly && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={!status ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', '')}>
            Todos
          </Button>
          {Object.entries(REC_STATUS).map(([k, v]) => (
            <Button key={k} size="sm" variant={status === k ? 'secondary' : 'ghost'} onClick={() => setParam('situacao', k)}>
              {v.label}
              <span className="ml-1 text-xs text-muted-foreground">{list.data?.counts[k] ?? 0}</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(search.trim())
            setPage(1)
          }}
        >
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Nº do CT-e ou da NF, nome ou CNPJ do destinatário/remetente, cidade, chave do CT-e ou da NF-e" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select value={carrier || '__all__'} onValueChange={(v) => setParam('transportadora', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-52" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as transportadoras</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind || '__all__'} onValueChange={(v) => setParam('tipo', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-56" aria-label="Compra e venda">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Compra e venda</SelectItem>
            <SelectItem value="VENDA">Venda (saída da filial)</SelectItem>
            <SelectItem value="COMPRA">Compra (entrada)</SelectItem>
          </SelectContent>
        </Select>
        {!pendingOnly && (
          <Select value={decision || '__all__'} onValueChange={(v) => setParam('decisao', v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-56" aria-label="Decisão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Qualquer decisão</SelectItem>
              <SelectItem value="SEM_DECISAO">Sem decisão</SelectItem>
              {Object.entries(DECISION).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
              <SelectItem value="CONTESTACAO_ABERTA">Contestação aberta</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={uf || '__all__'} onValueChange={(v) => setParam('uf', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-44" aria-label="Estado do cliente ou fornecedor" title="Venda: estado de destino (cliente). Compra: estado de origem (fornecedor).">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os estados</SelectItem>
            {UF_LIST.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period || '__all__'} onValueChange={(v) => setPeriod(v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-40" aria-label="Período de emissão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Qualquer data</SelectItem>
            {PERIODS.map((x) => (
              <SelectItem key={x.value} value={x.value}>
                {x.label}
              </SelectItem>
            ))}
            <SelectItem value="data">Informar data</SelectItem>
          </SelectContent>
        </Select>
        {period === 'data' && (
          <>
            <Input type="date" className="w-40" aria-label="Emitidos desde" value={from} onChange={(e) => setParam('de', e.target.value)} />
            <Input type="date" className="w-40" aria-label="Emitidos até" value={to} onChange={(e) => setParam('ate', e.target.value)} />
          </>
        )}
        <div className="ml-auto flex rounded-md border p-0.5" role="group" aria-label="Visualização">
          <Button size="sm" variant={view === 'cartoes' ? 'secondary' : 'ghost'} onClick={() => changeView('cartoes')} aria-pressed={view === 'cartoes'} title="Cartões">
            <LayoutListIcon aria-hidden />
          </Button>
          <Button size="sm" variant={view === 'tabela' ? 'secondary' : 'ghost'} onClick={() => changeView('tabela')} aria-pressed={view === 'tabela'} title="Tabela">
            <TableIcon aria-hidden />
          </Button>
        </div>
      </div>
      {list.data && (
        <div className="grid gap-2 sm:grid-cols-5">
          <Sum label="Cobrado" value={list.data.sums.charged} />
          <Sum label="Esperado" value={list.data.sums.expected} />
          <Sum label="Diferença" value={list.data.sums.difference} danger={list.data.sums.difference > 0.009} />
          <Sum label="Aprovado" value={list.data.sums.approved} />
          <Sum label="Créditos obtidos" value={list.data.sums.credit} />
        </div>
      )}
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={FileCheck2Icon} title={pendingOnly ? 'Nada para conciliar' : 'Nenhum CT-e'} description={pendingOnly ? 'Todos os CT-es do filtro conferem ou já têm decisão.' : 'Importe os XMLs dos CT-es (um a um ou num .zip).'} />
      ) : (
        <>
          {view === 'cartoes' ? (
            <div className="space-y-3">
              {list.data.items.map((c) => (
                <CteCard key={c.id} c={c} />
              ))}
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CT-e</TableHead>
                <TableHead>Transportadora</TableHead>
                <TableHead className="hidden md:table-cell">Rota</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Na nota</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead>Conciliação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-2 hover:underline" to={`/fretes/ctes/${c.id}`}>
                      {c.number ?? '—'}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">{c.issuedAt ? dayBr(c.issuedAt) : '—'}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.carrierName ?? c.emitName ?? '—'}
                    {c.seller && <span className="block text-xs text-muted-foreground">Vendedor: {c.seller}</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {c.cityIni}/{c.ufIni} → {c.cityFim}/{c.ufFim}
                    {c.weight !== null && <span className="block text-xs text-muted-foreground">{fmtNum(c.weight)} kg</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.expectedTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums" title="Frete destacado na NF-e">{c.nfeFreight === null || c.nfeFreight === undefined ? '—' : money(c.nfeFreight)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', (c.difference ?? 0) > 0.009 && 'text-destructive')}>{c.difference === null ? '—' : money(c.difference)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                      {REC_STATUS[c.recStatus]?.label ?? c.recStatus}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">{c.contestStatus ? CONTEST[c.contestStatus] : c.decision ? DECISION[c.decision] : c.recTypes.map((t) => REC_TYPE[t] ?? t).join(', ')}</span>
                    {c.nfeCheck && (c.nfeCheck.status === 'DIVERGENTE' || c.nfeCheck.status === 'OK') && (
                      <span className={cn('mt-0.5 block text-xs', c.nfeCheck.status === 'DIVERGENTE' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')} title={c.nfeCheck.divergences.join(' · ')}>
                        {c.nfeCheck.status === 'DIVERGENTE' ? `NF-e: ${c.nfeCheck.divergences.join(', ')}` : NFE_CHECK_STATUS.OK.label}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{list.data.total} CT-e(s)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="self-center">
                {page} de {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
      {importing && <ImportCtes onClose={() => setImporting(false)} />}
    </div>
  )
}

const PERIODS = [
  { value: 'hoje', label: 'Hoje', days: 1 },
  { value: '7', label: '7 dias', days: 7 },
  { value: '30', label: '30 dias', days: 30 },
  { value: '60', label: '60 dias', days: 60 },
]

/** Data AAAA-MM-DD somando dias (meio-dia em UTC evita virar o dia no horário de verão). */
function shiftDay(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const SHIPPER = ['REMETENTE', 'EXPEDIDOR']

/** Cartão do CT-e, no estilo de leitura rápida: quem, de onde para onde, realizado × previsto e a divergência. */
function CteCard({ c }: { c: Cte }) {
  const sale = (c.companyRoles ?? []).some((r) => SHIPPER.includes(r)) || !c.companyRoles?.length
  const other = sale ? { label: 'Cliente · destino', name: c.recipientName, doc: c.recipientDoc, city: c.cityFim, uf: c.ufFim } : { label: 'Fornecedor · origem', name: c.senderName, doc: c.senderDoc, city: c.cityIni, uf: c.ufIni }
  const pct = c.cargoValue && c.cargoValue > 0 ? (c.total / c.cargoValue) * 100 : null
  const diff = c.difference
  const rec = REC_STATUS[c.recStatus]
  const sub = c.contestStatus ? CONTEST[c.contestStatus] : c.decision ? DECISION[c.decision] : c.recTypes.map((t) => REC_TYPE[t] ?? t).join(', ')
  return (
    <Link to={`/fretes/ctes/${c.id}`} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">CT-e {c.number ?? '—'}</span>
          <Badge variant="outline" className={rec?.className}>
            {rec?.label ?? c.recStatus}
          </Badge>
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </div>
        <span className="text-sm text-muted-foreground">
          Emitido em {c.issuedAt ? dateTime(c.issuedAt) : '—'} · {sale ? 'Venda' : 'Compra'}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-start">
        <div>
          <p className="text-xs text-muted-foreground">Transportadora</p>
          <p className="font-medium">{c.carrierName ?? c.emitName ?? '—'}</p>
          {c.seller && <p className="text-xs text-muted-foreground">Vendedor: {c.seller}</p>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{other.label}</p>
          <p className="font-medium">{other.name || '—'}</p>
          <p className="text-xs text-muted-foreground">
            {[other.city && `${other.city}/${other.uf ?? ''}`, other.doc && formatCnpj(other.doc), c.weight !== null && `${fmtNum(c.weight)} kg`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="grid min-w-72 grid-cols-3 gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <div>
            <p className="text-xs text-muted-foreground">Realizado</p>
            <p className="font-semibold tabular-nums">{money(c.total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Previsto</p>
            <p className="font-semibold tabular-nums">{c.expectedTotal === null ? '—' : money(c.expectedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Divergência</p>
            <p className={cn('font-semibold tabular-nums', diff !== null && diff > 0.009 ? 'text-destructive' : diff !== null && diff < -0.009 ? 'text-[#006300] dark:text-[#0ca30c]' : '')}>{diff === null ? '—' : money(diff)}</p>
          </div>
          <p className="col-span-3 -mt-1 text-xs text-muted-foreground">
            {pct === null ? 'Sem valor da carga' : `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% da mercadoria`}
            {c.nfeFreight !== null && c.nfeFreight !== undefined && ` · na nota ${money(c.nfeFreight)}`}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn('text-xs', c.nfeCheck?.status === 'DIVERGENTE' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {c.nfeCheck?.status === 'DIVERGENTE' ? `NF-e: ${c.nfeCheck.divergences.join(', ')}` : c.nfeCheck?.status === 'OK' ? NFE_CHECK_STATUS.OK.label : ''}
        </span>
        <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
    </Link>
  )
}

function Sum({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-semibold tabular-nums', danger && 'text-destructive')}>{money(value)}</p>
    </div>
  )
}

interface ImportResult {
  imported: number
  /** Transportadoras novas cadastradas pelos CT-es. */
  carriersCreated?: number
  duplicated: number
  cancelled: number
  linked: number
  ignored: { file: string; reason: string }[]
  icmsUpdated: { uf: string; to: number }[]
}

function ImportCtes({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      for (const f of files) fd.append('arquivos', f)
      return api.post<ImportResult>('/fretes/ctes/importar', fd)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(`${r.imported} CT-e(s) importado(s), ${r.linked} ligado(s) a pedidos.${r.carriersCreated ? ` ${r.carriersCreated} transportadora(s) nova(s) cadastrada(s): configure em Fretes › Transportadoras.` : ''}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const r = m.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar CT-e</DialogTitle>
          <DialogDescription>XMLs dos CT-es ou um .zip com eles (até 500). Eventos de cancelamento também são aceitos. CT-e já importado é pulado pela chave.</DialogDescription>
        </DialogHeader>
        <Input type="file" multiple accept=".xml,.zip,.gz" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        {r && (
          <div className="space-y-2 text-sm">
            <p>
              {r.imported} novo(s) · {r.duplicated} já importados antes (descartados) · {r.cancelled} cancelamento(s) · {r.linked} ligado(s) a pedidos
            </p>
            {r.icmsUpdated.length > 0 && <p>Alíquota interna de ICMS atualizada: {r.icmsUpdated.map((i) => `${i.uf} ${fmtNum(i.to, 2)}%`).join(', ')}.</p>}
            {r.ignored.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
                {r.ignored.map((i, k) => (
                  <p key={k}>
                    {i.file}: {i.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!files.length || m.isPending}>
            {m.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type CteAiAction = 'OK' | 'AJUSTAR_CRM' | 'CONTESTAR' | 'PERGUNTAR' | 'CONFERIR'
type CteAi = {
  veredito: string
  resumo: string
  itens: { componente: string; tabela: string | null; cobrado: string | null; explicacao: string; acao: CteAiAction }[]
  acoes: { tipo: CteAiAction; texto: string }[]
  perguntasTransportadora: string[]
  model?: string
  by?: string
}
const AI_ACTION: Record<CteAiAction, { label: string; cls: string }> = {
  OK: { label: 'Confere', cls: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300' },
  AJUSTAR_CRM: { label: 'Ajustar no CRM', cls: 'border-sky-500/50 text-sky-700 dark:text-sky-300' },
  CONTESTAR: { label: 'Contestar', cls: 'border-destructive/50 text-destructive' },
  PERGUNTAR: { label: 'Perguntar à transportadora', cls: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  CONFERIR: { label: 'Conferir', cls: 'border-muted-foreground/40 text-muted-foreground' },
}
const AI_VERDICT: Record<string, string> = { CONFERE: 'Confere', COBRADO_A_MAIS: 'Cobrado a mais', COBRADO_A_MENOR: 'Cobrado a menos', TABELA_DESATUALIZADA: 'Tabela do CRM desatualizada', INCONCLUSIVO: 'Inconclusivo' }

/** Análise inteligente (Gemini): o motivo de cada diferença, o que ajustar no CRM e o que contestar ou perguntar. */
function CteAiPanel({ c, onDone }: { c: Cte; onDone: (d: Partial<Cte>) => void }) {
  const run = useMutation({
    mutationFn: () => api.post<{ aiAnalysis: CteAi; aiAnalysisAt: string }>(`/fretes/ctes/${c.id}/analise-ia`),
    onSuccess: (d) => onDone(d),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const a = c.aiAnalysis
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            <SparklesIcon className="size-4 text-primary" aria-hidden /> Análise inteligente
          </p>
          <p className="text-xs text-muted-foreground">
            {a ? `Gerada em ${dateTime(c.aiAnalysisAt ?? null)}${a.by ? ` por ${a.by}` : ''} · IA (Gemini). Confira as contas antes de contestar.` : 'A IA compara o CT-e (com pesos e observações do XML) com a tabela do destino e explica o motivo de cada diferença.'}
          </p>
        </div>
        <Button size="sm" variant={a ? 'outline' : 'default'} disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />} {a ? 'Analisar de novo' : 'Analisar com IA'}
        </Button>
      </div>
      {run.isPending && <p className="text-sm text-muted-foreground">Analisando o CT-e e a tabela… pode levar até um minuto.</p>}
      {a && (
        <>
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <Badge variant="outline" className="mb-1.5">
              {AI_VERDICT[a.veredito] ?? a.veredito}
            </Badge>
            <p className="whitespace-pre-line">{a.resumo}</p>
          </div>
          {a.itens.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Componente</TableHead>
                    <TableHead>Pela tabela</TableHead>
                    <TableHead>Cobrado</TableHead>
                    <TableHead className="min-w-72">Motivo</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {a.itens.map((i, k) => (
                    <TableRow key={k}>
                      <TableCell className="font-medium">{i.componente}</TableCell>
                      <TableCell className="text-sm">{i.tabela ?? '—'}</TableCell>
                      <TableCell className="text-sm">{i.cobrado ?? '—'}</TableCell>
                      <TableCell className="whitespace-normal text-sm">{i.explicacao}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('whitespace-nowrap', AI_ACTION[i.acao]?.cls)}>
                          {AI_ACTION[i.acao]?.label ?? i.acao}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {a.acoes.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">O que fazer</p>
              {a.acoes.map((x, k) => (
                <p key={k} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className={cn('shrink-0', AI_ACTION[x.tipo]?.cls)}>
                    {AI_ACTION[x.tipo]?.label ?? x.tipo}
                  </Badge>
                  <span>{x.texto}</span>
                </p>
              ))}
            </div>
          )}
          {a.perguntasTransportadora.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Perguntar à transportadora</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {a.perguntasTransportadora.map((p, k) => (
                  <li key={k}>{p}</li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(a.perguntasTransportadora.map((p, k) => `${k + 1}. ${p}`).join('\n')).then(() => toast.success('Perguntas copiadas.'))
                }}
              >
                Copiar perguntas
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function FretesCteDetalhePage() {
  return (
    <RequirePermission module="fretes_cte">
      <CteDetail />
    </RequirePermission>
  )
}

function CteDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['fretes', 'cte', id], queryFn: () => api.get<Cte>(`/fretes/ctes/${id}`) })
  const done = (d: Cte, msg: string) => {
    qc.setQueryData(['fretes', 'cte', id], d)
    qc.invalidateQueries({ queryKey: ['fretes', 'ctes'] })
    toast.success(msg)
  }
  const reprocess = useMutation({ mutationFn: () => api.post<Cte>(`/fretes/ctes/${id}/reconciliar`), onSuccess: (d) => done(d, 'Conciliação refeita.'), onError: (e) => toast.error(errorMessage(e)) })
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const c = q.data
  const editable = can('fretes_cte', 'edit') && c.fiscalStatus !== 'CANCELADO'
  const lines = c.recDetail?.lines ?? []
  return (
    <div className="space-y-4">
      <PageHeader
        title={`CT-e ${c.number ?? ''}${c.series ? ` série ${c.series}` : ''}`}
        description={`${c.carrierName ?? c.emitName ?? 'Transportadora não cadastrada'} · emitido em ${dateTime(c.issuedAt)} · ${c.unitName ?? 'filial não identificada'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button variant="outline" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}>
                {reprocess.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />} Conciliar de novo
              </Button>
            )}
            <Can module="fretes_cte" action="export">
              <Button variant="outline" asChild>
                <a href={`/fretes/ctes/${c.id}/dacte?completo=1`} target="_blank" rel="noopener" title="DACTE para imprimir ou salvar em PDF">
                  <FileTextIcon aria-hidden /> PDF (DACTE)
                </a>
              </Button>
              <Button variant="outline" onClick={() => api.download(`/fretes/ctes/${c.id}/xml`, `CTe${c.key}.xml`).catch((e) => toast.error(errorMessage(e)))}>
                <DownloadIcon aria-hidden /> XML
              </Button>
            </Can>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Conciliação
              <Badge variant="outline" className={REC_STATUS[c.recStatus]?.className}>
                {REC_STATUS[c.recStatus]?.label ?? c.recStatus}
              </Badge>
              {c.recTypes.map((t) => (
                <Badge key={t} variant="outline" className="border-destructive/50 text-destructive">
                  {REC_TYPE[t] ?? t}
                </Badge>
              ))}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.recDetail?.reason && <p className="text-sm text-amber-700 dark:text-amber-300">{c.recDetail.reason}</p>}
            {!!c.recDetail?.tables?.length && (
              <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium">Por que cada tabela não calculou</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {c.recDetail.tables.map((t, i) => (
                    <li key={i}>
                      <span className="font-medium">{t.table}</span>: {t.reason}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Depois de ajustar a tabela, clique em Conciliar de novo.</p>
              </div>
            )}
            {c.recDetail?.reference && (
              <p className="text-sm text-muted-foreground">
                Referência: {c.recDetail.reference}
                {c.recDetail.allowed !== undefined && ` · tolerância ${money(c.recDetail.allowed)}`}
              </p>
            )}
            {lines.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Componente</TableHead>
                    <TableHead className="text-right">Esperado (tabela do CRM)</TableHead>
                    <TableHead className="text-right">Cobrado (CT-e)</TableHead>
                    <TableHead className="text-right">Na nota fiscal</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.expected === null ? '—' : money(l.expected)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.charged === null ? '—' : money(l.charged)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.difference)}</TableCell>
                      <TableCell className={cn('text-sm', LINE_STATUS[l.status].className)}>{LINE_STATUS[l.status].label}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.expectedTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.total)}</TableCell>
                    <TableCell className="text-right tabular-nums" title="Frete destacado no XML da nota (vFrete); importe o XML em Fretes › Pedidos">
                      {(() => {
                        const v = c.nfeConfront?.checks.find((k) => k.code === 'FRETE')?.nfe
                        return typeof v === 'number' && v > 0 ? money(v) : '—'
                      })()}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', (c.difference ?? 0) > 0.009 && 'text-destructive')}>{money(c.difference)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
            {!lines.length && c.components && c.components.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Componentes cobrados</p>
                {c.components.map((x, i) => (
                  <p key={i}>
                    {x.name}: {money(x.value)}
                  </p>
                ))}
              </div>
            )}
            {c.recDetail?.notes?.map((n, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {n}
              </p>
            ))}
            {c.recStatus !== 'FORA' && c.recStatus !== 'COMPRA' && c.recStatus !== 'CONCILIADO' && <CteAiPanel c={c} onDone={(d) => qc.setQueryData(['fretes', 'cte', id], { ...c, ...d })} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dados do CT-e</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Info label="Chave" value={formatKey(c.key)} />
            <Info label="Emitente" value={`${c.emitName ?? '—'} · ${formatCnpj(c.emitCnpj)}`} />
            <Info label="Origem" value={`${c.cityIni ?? '—'}/${c.ufIni ?? ''}`} />
            <Info label="Destino" value={`${c.cityFim ?? '—'}/${c.ufFim ?? ''} · CEP ${formatCep(c.destZip)}`} />
            <Info label="Destinatário" value={c.recipientName ?? '—'} />
            <Info label="Valor da carga" value={money(c.cargoValue)} />
            <Info label="Peso" value={c.weight === null ? '—' : `${fmtNum(c.weight)} kg`} />
            {c.volumes != null && <Info label="Volumes" value={fmtNum(c.volumes, 0)} />}
            <Info label="ICMS" value={c.icms ? `${c.icms.rate === null ? '—' : `${fmtNum(c.icms.rate, 2)}%`} · ${money(c.icms.value)}` : '—'} />
            <Info label="NF-e" value={c.nfeKeys.length ? c.nfeKeys.map(formatKey).join(', ') : '—'} />
            <Info label="Situação fiscal" value={c.fiscalStatus === 'CANCELADO' ? 'Cancelado' : c.source === 'SEFAZ' ? `Capturado na SEFAZ${c.protocol ? ` · protocolo ${c.protocol}` : ''}` : `Não conferido na SEFAZ${c.protocol ? ` · protocolo ${c.protocol}` : ''}`} />
            <Info label="Papel da empresa" value={c.companyRoles?.length ? c.companyRoles.map((r) => ROLE_LABEL[r] ?? r).join(', ') : 'Não identificado'} />
            <Info label="Importado" value={`${dateTime(c.createdAt)} por ${c.importedByName}`} />
            {c.invoice && (
              <Info
                label="Fatura"
                value={
                  <Link className="underline underline-offset-2" to={`/fretes/faturas/${c.invoice.id}`}>
                    {c.invoice.number} · {INVOICE_STATUS[c.invoice.status]?.label}
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
      {c.nfeConfront && (
        <Card>
          <CardHeader>
            <CardTitle>Confronto com a NF-e</CardTitle>
          </CardHeader>
          <CardContent>
            <NfeConfrontView c={c.nfeConfront} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ShipmentLink cte={c} editable={editable} onDone={(d) => done(d, 'Pedido atualizado e conciliação refeita.')} />
        <DecisionCard cte={c} editable={editable} onDone={done} />
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[7.5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </p>
  )
}

function ShipmentLink({ cte, editable, onDone }: { cte: Cte; editable: boolean; onDone: (d: Cte) => void }) {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const found = useQuery({
    queryKey: ['fretes', 'pedidos', 'vincular', term],
    queryFn: () => api.get<{ items: { id: string; code: number; orderNumber: string | null; invoiceNumber: string | null; customerName: string | null; destCity: string | null; status: string }[] }>(`/fretes/pedidos?busca=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  })
  const link = useMutation({ mutationFn: (shipmentId: string | null) => api.post<Cte>(`/fretes/ctes/${cte.id}/pedido`, { shipmentId }), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cte.shipment ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link className="font-medium underline underline-offset-2" to={`/fretes/pedidos?busca=${cte.shipment.code}`}>
              Pedido nº {cte.shipment.code}
            </Link>
            <span>
              {cte.shipment.orderNumber ?? '—'} · NF {cte.shipment.invoiceNumber ?? '—'}
            </span>
            <Badge variant="outline" className={SHIPMENT_STATUS[cte.shipment.status]?.className}>
              {SHIPMENT_STATUS[cte.shipment.status]?.label}
            </Badge>
            {editable && (
              <Button size="sm" variant="ghost" onClick={() => link.mutate(null)} disabled={link.isPending}>
                Desligar
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Sem pedido. Sem ele, o CT-e é comparado com a tabela vigente na data de emissão.</p>
        )}
        {editable && (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setTerm(search.trim())
              }}
            >
              <Input placeholder="Buscar pedido por nº, NF, cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button type="submit" variant="outline">
                Buscar
              </Button>
            </form>
            {found.data?.items.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span>
                  Nº {s.code} · {s.orderNumber ?? '—'} · NF {s.invoiceNumber ?? '—'} · {s.customerName ?? ''} {s.destCity ?? ''}
                </span>
                <Button size="sm" onClick={() => link.mutate(s.id)} disabled={link.isPending || s.id === cte.shipmentId}>
                  Ligar
                </Button>
              </div>
            ))}
            {found.data && !found.data.items.length && <p className="text-muted-foreground">Nenhum pedido encontrado.</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function DecisionCard({ cte, editable, onDone }: { cte: Cte; editable: boolean; onDone: (d: Cte, msg: string) => void }) {
  const [decision, setDecision] = useState<'APROVADO' | 'APROVADO_COTADO' | 'CONTESTADO' | ''>('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<'ACEITA' | 'RECUSADA' | ''>('')
  const [credit, setCredit] = useState<number | null>(cte.expectedTotal !== null ? Math.max(0, Math.round((cte.total - (cte.approvedValue ?? cte.expectedTotal)) * 100) / 100) : null)
  const [contestNote, setContestNote] = useState('')
  const decide = useMutation({
    mutationFn: () => api.post<Cte>(`/fretes/ctes/${cte.id}/decisao`, { decision, note: note || null }),
    onSuccess: (d) => (onDone(d, 'Decisão registrada.'), setDecision(''), setNote('')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const contest = useMutation({
    mutationFn: () => api.post<Cte>(`/fretes/ctes/${cte.id}/contestacao`, { result, creditValue: result === 'ACEITA' ? credit : null, note: contestNote || null }),
    onSuccess: (d) => (onDone(d, 'Resultado da contestação registrado.'), setResult('')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisão</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cte.decision ? (
          <div className="space-y-1">
            <p className="font-medium">{DECISION[cte.decision]}</p>
            <p>
              Cobrado {money(cte.total)} · aprovado {money(cte.approvedValue)}
              {cte.creditValue !== null && ` · crédito ${money(cte.creditValue)}`}
            </p>
            {cte.decisionNote && <p className="text-muted-foreground">{cte.decisionNote}</p>}
            <p className="text-xs text-muted-foreground">
              {cte.decidedByName} · {dateTime(cte.decidedAt)}
            </p>
            {cte.contestStatus && (
              <p>
                <Badge variant="outline">{CONTEST[cte.contestStatus]}</Badge> {cte.contestNote}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Sem decisão. CT-e que confere é aprovado sozinho; os demais esperam aqui.</p>
        )}
        {editable && cte.contestStatus === 'ABERTA' && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="font-medium">Resultado da contestação</p>
            <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
              <SelectTrigger className="w-full" aria-label="Resultado">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACEITA">Aceita pela transportadora (crédito ou abatimento)</SelectItem>
                <SelectItem value="RECUSADA">Recusada (paga o cobrado)</SelectItem>
              </SelectContent>
            </Select>
            {result === 'ACEITA' && (
              <div className="space-y-1.5">
                <Label htmlFor="ct-credit">Crédito obtido</Label>
                <MoneyInput id="ct-credit" value={credit} onChange={setCredit} />
              </div>
            )}
            <Input aria-label="Observação" placeholder="Observação (nº do protocolo, carta de correção...)" value={contestNote} onChange={(e) => setContestNote(e.target.value)} />
            <Button onClick={() => contest.mutate()} disabled={!result || contest.isPending}>
              {contest.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Registrar
            </Button>
          </div>
        )}
        {editable && cte.contestStatus !== 'ABERTA' && !cte.invoiceId && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="font-medium">{cte.decision ? 'Mudar a decisão' : 'Decidir'}</p>
            <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
              <SelectTrigger className="w-full" aria-label="Decisão">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APROVADO">Aprovar o cobrado ({money(cte.total)})</SelectItem>
                {cte.expectedTotal !== null && <SelectItem value="APROVADO_COTADO">Aprovar o esperado ({money(cte.expectedTotal)}) e contestar a diferença</SelectItem>}
                <SelectItem value="CONTESTADO">Contestar o CT-e inteiro</SelectItem>
              </SelectContent>
            </Select>
            <Textarea rows={2} aria-label="Motivo" placeholder={decision && decision !== 'APROVADO' ? 'Motivo (obrigatório): ex. frete peso acima da tabela' : 'Observação'} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button onClick={() => decide.mutate()} disabled={!decision || decide.isPending}>
              {decide.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Registrar decisão
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
