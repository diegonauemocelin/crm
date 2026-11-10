import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AwardIcon, CopyIcon, DownloadIcon, Loader2Icon, PencilIcon, PlayIcon, PlusIcon, SearchIcon, SendIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Kpi, TrendChart } from '@/components/marketing/ui'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateShort, money, num } from '@/lib/format'

// ---------- Tipos (iguais aos da API) ----------

export interface Level {
  key: string
  name: string
  min: number
  benefits: string
  color: string
}

interface Config {
  enabled: boolean
  since: string | null
  pointsPerReal: number
  rounding: 'baixo' | 'proximo' | 'cima'
  minOrderValue: number
  expireMonths: number
  onlySite: boolean
  reverseOnCancel: boolean
  bonusReview: number
  bonusFirstPurchase: number
  bonusBirthday: number
  birthdayField: string | null
  levelBasis: 'pontos' | 'gasto'
  levels: Level[]
  codeValidityDays: number
  giftHolder: string
  linkValidityDays: number
  loginEmail: boolean
  loginWhatsapp: boolean
  loginNumberId: string | null
  review: {
    enabled: boolean
    daysAfterDelivery: number
    daysAfterPayment: number
    maxAgeDays: number
    email: boolean
    whatsapp: boolean
    numberId: string | null
    gapMin: number
    gapMax: number
    aspects: boolean
    detractorNps: number
    detractorStars: number
    googleReviewUrl: string
    alertUserIds: string[]
    alertEmails: string[]
  }
  messages: Record<'inviteSubject' | 'inviteEmail' | 'inviteWhatsapp' | 'linkSubject' | 'linkEmail' | 'linkWhatsapp' | 'codeText' | 'thanks' | 'googleText', string>
  page: { title: string; intro: string; consent: string; rules: string; color: string }
}

interface ConfigView {
  config: Config
  options: {
    gifts: { id: string; name: string; stock: number }[]
    numbers: { id: string; name: string; status: string }[]
    users: { id: string; name: string }[]
    dateFields: { key: string; label: string }[]
    holders: { id: string; name: string }[]
    publicUrl: string
  }
}

interface Dashboard {
  enabled: boolean
  since: string | null
  members: number
  optedOut: number
  openBalance: number
  issued: number
  redeemed: number
  expired: number
  reversed: number
  redemptions: Record<string, number>
  reviews: number
  invited: number
  stars: number | null
  nps: { total: number; promoters: number; passives: number; detractors: number; nps: number | null }
  levels: { key: string; name: string; color: string; count: number }[]
  flow: { month: string; emitidos: number; resgatados: number; expirados: number; estornados: number }[]
  npsByMonth: { month: string; nps: number | null; total: number }[]
}

export interface Redemption {
  id: string
  code: string
  rewardName: string
  kind: string
  points: number
  discountType: string | null
  value: number | null
  status: string
  expiresAt: string | null
  usedAt: string | null
  usedOrderCode: string | null
  usedByName: string | null
  source: string
  createdByName: string | null
  cancelReason: string | null
  createdAt: string
  lead?: { id: string; name: string | null; email: string | null }
}

interface Reward {
  id: string
  name: string
  description: string | null
  kind: 'BRINDE' | 'DESCONTO' | 'CASHBACK' | 'BENEFICIO'
  pointsCost: number
  giftId: string | null
  giftName: string | null
  giftStock: number | null
  discountType: string | null
  value: number | null
  stock: number | null
  perCustomer: number | null
  minLevel: string | null
  validityDays: number | null
  active: boolean
  sort: number
  redemptions: number
}

export interface Summary {
  config: { enabled: boolean; levels: Level[]; levelBasis?: string }
  member: null | {
    balance: number
    joinedAt: string
    optedOut: boolean
    consentAt: string | null
    lastAccessAt: string | null
    levelValue: number
    level: Level | null
    nextLevel: Level | null
    missing: number
    expiring: { points: number; expiresAt: string }[]
  }
  ledger: { id: string; kind: string; points: number; reason: string; orderCode: string | null; expiresAt: string | null; userName: string | null; createdAt: string }[]
  redemptions: Redemption[]
  reviews: { id: string; orderCode: string; stars: number; nps: number; comment: string | null; detractor: boolean; followUpStatus: string | null; createdAt: string }[]
  orders: { orderId: string; code: string; total: number; orderedAt: string; status: string; points: number; reversed: boolean; deliveredAt: string | null; reviewed: boolean }[]
}

const KIND_LABEL: Record<string, string> = { GANHO: 'Compra', BONUS: 'Bônus', RESGATE: 'Resgate', EXPIRADO: 'Vencidos', AJUSTE: 'Ajuste', ESTORNO: 'Estorno' }
const REWARD_LABEL: Record<string, string> = { BRINDE: 'Brinde', DESCONTO: 'Desconto na próxima compra', CASHBACK: 'Cashback (R$)', BENEFICIO: 'Benefício do nível' }
const STATUS_LABEL: Record<string, string> = { PENDENTE: 'Pendente', USADO: 'Usado', ENTREGUE: 'Entregue', EXPIRADO: 'Vencido', CANCELADO: 'Cancelado' }
const shortMonth = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '')

export function rewardValue(r: { kind: string; discountType: string | null; value: number | null }) {
  if (r.value === null) return ''
  if (r.kind === 'DESCONTO' && r.discountType === 'PERCENTUAL') return `${r.value.toLocaleString('pt-BR')}%`
  return money(r.value)
}

export function StatusBadge({ status }: { status: string }) {
  const variant = status === 'PENDENTE' ? 'default' : status === 'CANCELADO' || status === 'EXPIRADO' ? 'outline' : 'secondary'
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>
}

export function LevelBadge({ level }: { level: { name: string; color: string } | null }) {
  if (!level) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="size-2 rounded-full" style={{ background: level.color }} aria-hidden />
      {level.name}
    </Badge>
  )
}

export function FidelidadePage() {
  return (
    <RequirePermission module="fidelidade">
      <Fidelidade />
    </RequirePermission>
  )
}

function Fidelidade() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') ?? 'painel'
  // Ficha aberta fica no endereço (?lead=): a ficha do lead abre direto aqui.
  const open = params.get('lead')
  const setOpen = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('lead', id)
      else p.delete('lead')
      return p
    })
  const setTab = (v: string) =>
    setParams((p) => {
      p.set('aba', v)
      p.delete('lead')
      return p
    })
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelidade"
        description="Pontos pelas compras pagas da loja virtual, níveis, prêmios com código de resgate e a avaliação depois da compra. O cliente acompanha tudo numa página própria, sem senha."
        actions={<RunNow />}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="resgates">Resgates</TabsTrigger>
          <TabsTrigger value="premios">Prêmios</TabsTrigger>
          <TabsTrigger value="avaliacoes">Avaliações</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="mt-4">
          <Painel />
        </TabsContent>
        <TabsContent value="clientes" className="mt-4">
          <Clientes onOpen={setOpen} />
        </TabsContent>
        <TabsContent value="resgates" className="mt-4">
          <Resgates />
        </TabsContent>
        <TabsContent value="premios" className="mt-4">
          <Premios />
        </TabsContent>
        <TabsContent value="avaliacoes" className="mt-4">
          <Avaliacoes />
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          <Configuracoes />
        </TabsContent>
      </Tabs>
      {open && <ClienteDialog leadId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function RunNow() {
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: () => api.post<Record<string, number | boolean>>('/marketing/fidelidade/rodar'),
    onSuccess: (r) => {
      if (r.enabled === false) return toast.info('O programa está desligado (Configurações).')
      toast.success(`Pronto: ${r.ganhos ?? 0} pedido(s) com pontos, ${r.estornos ?? 0} estorno(s), ${(r.convitesEmail as number) + (r.convitesWhatsapp as number) || 0} convite(s).`)
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Can module="fidelidade" action="edit">
      <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
        {run.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
        Atualizar agora
      </Button>
    </Can>
  )
}

// ---------- Painel ----------

function Painel() {
  const q = useQuery({ queryKey: ['fidelidade', 'painel'], queryFn: () => api.get<Dashboard>('/marketing/fidelidade/painel?meses=12') })
  if (q.isLoading) return <TableSkeleton />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data!
  const totalLevels = d.levels.reduce((t, l) => t + l.count, 0)
  const redemptions = Object.values(d.redemptions).reduce((t, v) => t + v, 0)
  return (
    <div className="space-y-4">
      {!d.enabled && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 text-sm">O programa está desligado. Ligue em Configurações: só os pedidos pagos a partir da data de início ganham pontos.</CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Clientes no programa" value={num(d.members)} hint={d.optedOut ? `${num(d.optedOut)} saíram do programa` : d.since ? `Pedidos desde ${dateShort(`${d.since}T12:00:00Z`)}` : undefined} />
        <Kpi label="Pontos emitidos (12 meses)" value={num(d.issued)} spark={d.flow.map((f) => f.emitidos)} hint={`Saldo em aberto: ${num(d.openBalance)} pontos`} />
        <Kpi label="Pontos resgatados" value={num(d.redeemed)} spark={d.flow.map((f) => f.resgatados)} hint={`${num(redemptions)} resgate(s); ${num(d.redemptions.PENDENTE ?? 0)} pendente(s)`} />
        <Kpi label="Pontos vencidos e estornados" value={num(d.expired + d.reversed)} hint={`${num(d.expired)} vencidos, ${num(d.reversed)} estornados`} />
        <Kpi label="NPS" value={d.nps.nps === null ? '—' : String(d.nps.nps)} hint={`${num(d.nps.promoters)} promotores, ${num(d.nps.passives)} neutros, ${num(d.nps.detractors)} detratores`} />
        <Kpi label="Média de estrelas" value={d.stars === null ? '—' : d.stars.toLocaleString('pt-BR')} hint={`${num(d.reviews)} avaliação(ões) de ${num(d.invited)} convite(s)`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart
          title="Pontos mês a mês"
          description="Emitidos (compras, bônus e ajustes), resgatados e vencidos."
          kind="bar"
          data={d.flow.map((f) => ({ label: shortMonth(f.month), emitidos: f.emitidos, resgatados: f.resgatados, expirados: f.expirados }))}
          series={[
            { key: 'emitidos', label: 'Emitidos', color: 'var(--chart-1)' },
            { key: 'resgatados', label: 'Resgatados', color: 'var(--chart-2)' },
            { key: 'expirados', label: 'Vencidos', color: 'var(--chart-4)' },
          ]}
        />
        <TrendChart title="NPS mês a mês" description="Promotores menos detratores, em %, das avaliações do mês." data={d.npsByMonth.map((m) => ({ label: shortMonth(m.month), nps: m.nps }))} series={[{ key: 'nps', label: 'NPS', color: 'var(--chart-3)' }]} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes por nível</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.levels.map((l) => (
            <div key={l.key} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0">{l.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full rounded" style={{ width: `${totalLevels ? (l.count / totalLevels) * 100 : 0}%`, background: l.color }} />
              </div>
              <span className="w-16 text-right tabular-nums">{num(l.count)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Clientes ----------

interface CustomerRow {
  leadId: string
  name: string | null
  email: string | null
  phone: string | null
  customerCode: string | null
  balance: number
  level: string | null
  levelColor: string | null
  joinedAt: string
  lastSaleAt: string | null
  optedOut: boolean
}

function Clientes({ onOpen }: { onOpen: (leadId: string) => void }) {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [level, setLevel] = useState('todos')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ pagina: String(page), ...(term ? { busca: term } : {}), ...(level !== 'todos' ? { nivel: level } : {}) })
  const q = useQuery({ queryKey: ['fidelidade', 'clientes', qs.toString()], queryFn: () => api.get<{ total: number; page: number; pages: number; levels: { key: string; name: string }[]; items: CustomerRow[] }>(`/marketing/fidelidade/clientes?${qs}`) })
  const exportar = async () => {
    try {
      await api.download('/marketing/fidelidade/clientes/exportar', 'fidelidade-clientes.csv')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setTerm(search.trim())
        }}
      >
        <div className="min-w-56 flex-1">
          <Label htmlFor="fid-busca">Buscar cliente</Label>
          <Input id="fid-busca" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, e-mail, telefone ou código do cliente" />
        </div>
        <div className="w-44">
          <Label>Nível</Label>
          <Select value={level} onValueChange={(v) => (setLevel(v), setPage(1))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {q.data?.levels.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          <SearchIcon /> Buscar
        </Button>
        <Can module="fidelidade" action="export">
          <Button type="button" variant="outline" onClick={exportar}>
            <DownloadIcon /> Exportar
          </Button>
        </Can>
      </form>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState icon={AwardIcon} title="Nenhum cliente no programa" description="O cliente entra no programa com o primeiro pedido pago da loja virtual depois da data de início." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Última compra</TableHead>
                <TableHead>No programa desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.items.map((c) => (
                <TableRow key={c.leadId} className="cursor-pointer" onClick={() => onOpen(c.leadId)}>
                  <TableCell>
                    <div className="font-medium">{c.name ?? 'Sem nome'}</div>
                    <div className="text-xs text-muted-foreground">{[c.email, c.phone, c.customerCode && `cód. ${c.customerCode}`].filter(Boolean).join(' · ')}</div>
                    {c.optedOut && <Badge variant="outline">Saiu do programa</Badge>}
                  </TableCell>
                  <TableCell>
                    <LevelBadge level={c.level ? { name: c.level, color: c.levelColor ?? '#64748b' } : null} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{num(c.balance)}</TableCell>
                  <TableCell>{dateShort(c.lastSaleAt)}</TableCell>
                  <TableCell>{dateShort(c.joinedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {q.data && q.data.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span>
            Página {q.data.page} de {q.data.pages} ({num(q.data.total)} clientes)
          </span>
          <Button variant="outline" size="sm" disabled={page >= q.data.pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}

/** Ficha do cliente na Fidelidade (aberta pela lista ou pela ficha do lead). */
export function ClienteDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fidelidade', 'cliente', leadId], queryFn: () => api.get<Summary & { lead: { id: string; name: string | null; email: string | null; phone: string | null } }>(`/marketing/fidelidade/clientes/${leadId}`) })
  const [adjust, setAdjust] = useState(false)
  const [redeem, setRedeem] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['fidelidade'] })
  const send = useMutation({
    mutationFn: (channel: 'email' | 'whatsapp') => api.post(`/marketing/fidelidade/clientes/${leadId}/enviar-link`, { channel }),
    onSuccess: () => toast.success('Link enviado ao cliente.'),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = q.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{d?.lead.name ?? 'Cliente'}</DialogTitle>
          <DialogDescription>{d ? [d.lead.email, d.lead.phone].filter(Boolean).join(' · ') : 'Carregando…'}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <TableSkeleton rows={4} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d?.member ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Este cliente ainda não está no programa (entra com o primeiro pedido pago da loja virtual). Você pode dar pontos por ajuste manual.</p>
            <Can module="fidelidade" action="edit">
              <Button variant="outline" onClick={() => setAdjust(true)}>
                Ajustar pontos
              </Button>
            </Can>
          </div>
        ) : (
          <SummaryView s={d}>
            <div className="flex flex-wrap gap-2">
              <Can module="fidelidade" action="edit">
                <Button size="sm" variant="outline" onClick={() => setAdjust(true)}>
                  <PencilIcon /> Ajustar pontos
                </Button>
              </Can>
              <Can module="fidelidade" action="create">
                <Button size="sm" variant="outline" onClick={() => setRedeem(true)} disabled={d.member.optedOut}>
                  <AwardIcon /> Resgatar prêmio
                </Button>
              </Can>
              <Can module="fidelidade" action="edit">
                <Button size="sm" variant="outline" disabled={send.isPending || d.member.optedOut || !d.lead.email} onClick={() => send.mutate('email')}>
                  <SendIcon /> Link por e-mail
                </Button>
                <Button size="sm" variant="outline" disabled={send.isPending || d.member.optedOut || !d.lead.phone} onClick={() => send.mutate('whatsapp')}>
                  <SendIcon /> Link por WhatsApp
                </Button>
              </Can>
            </div>
          </SummaryView>
        )}
        {adjust && <AdjustDialog leadId={leadId} onClose={() => setAdjust(false)} onDone={refresh} />}
        {redeem && d?.member && <RedeemDialog leadId={leadId} balance={d.member.balance} onClose={() => setRedeem(false)} onDone={refresh} />}
      </DialogContent>
    </Dialog>
  )
}

/** Saldo, nível, extrato, resgates e avaliações (também usado na ficha do lead). */
export function SummaryView({ s, children, compact }: { s: Summary; children?: React.ReactNode; compact?: boolean }) {
  const m = s.member!
  const progress = m.nextLevel ? Math.min(100, Math.round(((m.levelValue - (m.level?.min ?? 0)) / Math.max(1, m.nextLevel.min - (m.level?.min ?? 0))) * 100)) : 100
  const basis = s.config.levelBasis === 'gasto' ? 'R$ comprados' : 'pontos ganhos'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Saldo</p>
          <p className="text-2xl font-semibold tabular-nums">{num(m.balance)}</p>
          <p className="text-xs text-muted-foreground">pontos</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Nível</p>
          <div className="mt-1">
            <LevelBadge level={m.level} />
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
            <div className="h-full rounded bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{m.nextLevel ? `Faltam ${num(m.missing)} ${basis} para ${m.nextLevel.name}` : 'Nível mais alto'}</p>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Situação</p>
          {m.optedOut ? <Badge variant="outline">Saiu do programa</Badge> : <Badge variant="secondary">Participando</Badge>}
          <p className="mt-1 text-xs text-muted-foreground">Desde {dateShort(m.joinedAt)}{m.lastAccessAt ? `; viu a página em ${dateShort(m.lastAccessAt)}` : ''}</p>
          {m.expiring.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{m.expiring.map((e) => `${num(e.points)} vencem em ${dateShort(e.expiresAt)}`).join('; ')}</p>}
        </div>
      </div>
      {m.level?.benefits && <p className="text-sm text-muted-foreground">Benefícios do nível: {m.level.benefits}</p>}
      {children}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Extrato</h3>
        {s.ledger.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Movimento</TableHead>
                <TableHead className="text-right">Pontos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.ledger.slice(0, compact ? 8 : undefined).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{dateShort(e.createdAt)}</TableCell>
                  <TableCell>
                    <span className="mr-2 text-xs text-muted-foreground">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    {e.reason}
                    {e.userName && <span className="text-xs text-muted-foreground"> — {e.userName}</span>}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${e.points < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {e.points > 0 ? '+' : ''}
                    {num(e.points)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">Sem movimentos.</p>
        )}
      </div>
      {s.redemptions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Resgates</h3>
          <ul className="space-y-1 text-sm">
            {s.redemptions.slice(0, compact ? 5 : undefined).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.code}</code>
                <span>{r.rewardName}</span>
                <span className="text-muted-foreground">{num(r.points)} pts</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.reviews.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Avaliações</h3>
          <ul className="space-y-1 text-sm">
            {s.reviews.map((r) => (
              <li key={r.id}>
                Pedido {r.orderCode}: <Stars n={r.stars} /> nota {r.nps}
                {r.detractor && (
                  <Badge variant="destructive" className="ml-2">
                    Detrator{r.followUpStatus === 'TRATADO' ? ' (tratado)' : ''}
                  </Badge>
                )}
                {r.comment && <span className="block text-muted-foreground">“{r.comment}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex align-middle" aria-label={`${n} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} className={`size-3.5 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
      ))}
    </span>
  )
}

function AdjustDialog({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone: () => void }) {
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => api.post<{ balance: number }>(`/marketing/fidelidade/clientes/${leadId}/ajuste`, { points: Number(points), reason }),
    onSuccess: (r) => {
      toast.success(`Ajuste lançado. Saldo: ${num(r.balance)} pontos.`)
      onDone()
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar pontos</DialogTitle>
          <DialogDescription>Positivo para dar, negativo para tirar. O motivo fica no extrato do cliente e na auditoria.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="fid-pts">Pontos</Label>
            <Input id="fid-pts" type="number" step={1} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="Ex.: 100 ou -50" />
          </div>
          <div>
            <Label htmlFor="fid-motivo">Motivo</Label>
            <Textarea id="fid-motivo" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex.: compra no balcão, compensação por atraso" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !Number.isInteger(Number(points)) || Number(points) === 0 || reason.trim().length < 3}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Lançar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RedeemDialog({ leadId, balance, onClose, onDone }: { leadId: string; balance: number; onClose: () => void; onDone: () => void }) {
  const rewards = useQuery({ queryKey: ['fidelidade', 'premios'], queryFn: () => api.get<Reward[]>('/marketing/fidelidade/premios') })
  const [rewardId, setRewardId] = useState('')
  const [done, setDone] = useState<Redemption | null>(null)
  const save = useMutation({
    mutationFn: () => api.post<{ redemption: Redemption; balance: number }>(`/marketing/fidelidade/clientes/${leadId}/resgatar`, { rewardId }),
    onSuccess: (r) => {
      setDone(r.redemption)
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const list = (rewards.data ?? []).filter((r) => r.active && r.kind !== 'BENEFICIO')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resgatar prêmio para o cliente</DialogTitle>
          <DialogDescription>Saldo: {num(balance)} pontos. Desconto e cashback geram um código para aplicar à mão na venda.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-2 text-sm">
            <p>Resgate feito: {done.rewardName}.</p>
            <CodeBox code={done.code} />
            {done.expiresAt && <p className="text-muted-foreground">Vale até {dateShort(done.expiresAt)}.</p>}
          </div>
        ) : (
          <Select value={rewardId} onValueChange={setRewardId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Escolha o prêmio" />
            </SelectTrigger>
            <SelectContent>
              {list.map((r) => (
                <SelectItem key={r.id} value={r.id} disabled={r.pointsCost > balance}>
                  {r.name} — {num(r.pointsCost)} pts {rewardValue(r) && `(${rewardValue(r)})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {done ? 'Fechar' : 'Cancelar'}
          </Button>
          {!done && (
            <Button onClick={() => save.mutate()} disabled={!rewardId || save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Resgatar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CodeBox({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-muted px-3 py-2 text-lg font-semibold tracking-wider">{code}</code>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Copiar código"
        onClick={() => {
          void navigator.clipboard?.writeText(code)
          toast.success('Código copiado.')
        }}
      >
        <CopyIcon />
      </Button>
    </div>
  )
}

// ---------- Resgates ----------

function Resgates() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [status, setStatus] = useState('PENDENTE')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [use, setUse] = useState<Redemption | null>(null)
  const [cancel, setCancel] = useState<Redemption | null>(null)
  const qs = new URLSearchParams({ ...(status !== 'todos' ? { status } : {}), ...(term ? { busca: term } : {}) })
  const q = useQuery({ queryKey: ['fidelidade', 'resgates', qs.toString()], queryFn: () => api.get<{ counts: Record<string, number>; items: Redemption[] }>(`/marketing/fidelidade/resgates?${qs}`) })
  const deliver = useMutation({
    mutationFn: (id: string) => api.post(`/marketing/fidelidade/resgates/${id}/usar`, {}),
    onSuccess: () => {
      toast.success('Brinde marcado como entregue.')
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setTerm(search.trim())
        }}
      >
        <div className="min-w-56 flex-1">
          <Label htmlFor="fid-resg">Código ou cliente</Label>
          <Input id="fid-resg" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="FID-XXXXX-XXXXX, nome ou e-mail" />
        </div>
        <div className="w-44">
          <Label>Situação</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v} {q.data?.counts[k] ? `(${q.data.counts[k]})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          <SearchIcon /> Buscar
        </Button>
      </form>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState icon={AwardIcon} title="Nenhum resgate" description="Os resgates pedidos pelos clientes (ou lançados aqui) aparecem nesta lista." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Prêmio</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code className="text-xs">{r.code}</code>
                    <div className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)} · {r.source === 'PAINEL' ? `pela equipe (${r.createdByName ?? '—'})` : 'pelo cliente'}</div>
                  </TableCell>
                  <TableCell>{r.lead?.name ?? r.lead?.email ?? '—'}</TableCell>
                  <TableCell>
                    {r.rewardName}
                    <div className="text-xs text-muted-foreground">
                      {num(r.points)} pts {rewardValue(r) && `· ${rewardValue(r)}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.usedOrderCode && <div className="text-xs text-muted-foreground">Pedido {r.usedOrderCode}</div>}
                    {r.usedByName && r.status !== 'PENDENTE' && <div className="text-xs text-muted-foreground">{r.usedByName}</div>}
                    {r.cancelReason && <div className="text-xs text-muted-foreground">{r.cancelReason}</div>}
                  </TableCell>
                  <TableCell>{r.expiresAt ? dateShort(r.expiresAt) : '—'}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can module="fidelidade" action="edit">
                      {r.status === 'PENDENTE' &&
                        (r.kind === 'BRINDE' ? (
                          <Button size="sm" variant="outline" onClick={async () => (await confirm({ title: 'Brinde entregue ao cliente?', description: `${r.rewardName} — ${r.lead?.name ?? ''}`, confirmLabel: 'Marcar entregue', destructive: false })) && deliver.mutate(r.id)}>
                            Entregue
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setUse(r)}>
                            Marcar usado
                          </Button>
                        ))}
                      {(r.status === 'PENDENTE' || r.status === 'EXPIRADO') && (
                        <Button size="sm" variant="ghost" onClick={() => setCancel(r)}>
                          Cancelar
                        </Button>
                      )}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {use && <UseDialog r={use} onClose={() => setUse(null)} />}
      {cancel && <CancelDialog r={cancel} onClose={() => setCancel(null)} />}
    </div>
  )
}

function UseDialog({ r, onClose }: { r: Redemption; onClose: () => void }) {
  const qc = useQueryClient()
  const [order, setOrder] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/marketing/fidelidade/resgates/${r.id}/usar`, { orderCode: order.trim() }),
    onSuccess: () => {
      toast.success('Código marcado como usado.')
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar {r.code} como usado</DialogTitle>
          <DialogDescription>
            {r.rewardName} ({rewardValue(r)}). Aplique o desconto ou o cashback à mão na venda e informe o pedido. O CRM não cria cupons na loja.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="fid-pedido">Número do pedido</Label>
          <Input id="fid-pedido" value={order} onChange={(e) => setOrder(e.target.value)} maxLength={60} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!order.trim() || save.isPending}>
            Marcar usado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({ r, onClose }: { r: Redemption; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/marketing/fidelidade/resgates/${r.id}/cancelar`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Resgate cancelado: os pontos voltaram para o cliente.')
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar o resgate {r.code}?</DialogTitle>
          <DialogDescription>Os {num(r.points)} pontos voltam ao cliente{r.kind === 'BRINDE' ? ' e a retirada do brinde é desfeita (volta ao estoque)' : ''}.</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="fid-cancel">Motivo</Label>
          <Textarea id="fid-cancel" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={() => save.mutate()} disabled={reason.trim().length < 2 || save.isPending}>
            Cancelar resgate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Prêmios ----------

function Premios() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const [edit, setEdit] = useState<Reward | 'novo' | null>(null)
  const q = useQuery({ queryKey: ['fidelidade', 'premios'], queryFn: () => api.get<Reward[]>('/marketing/fidelidade/premios') })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/fidelidade/premios/${id}`),
    onSuccess: () => {
      toast.success('Prêmio excluído.')
      void qc.invalidateQueries({ queryKey: ['fidelidade', 'premios'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can module="fidelidade" action="create">
          <Button onClick={() => setEdit('novo')}>
            <PlusIcon /> Novo prêmio
          </Button>
        </Can>
      </div>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.length ? (
        <EmptyState icon={AwardIcon} title="Nenhum prêmio" description="Cadastre brindes, descontos, cashback e benefícios de nível para os clientes trocarem pelos pontos." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prêmio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Pontos</TableHead>
                <TableHead>Limites</TableHead>
                <TableHead className="text-right">Resgates</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.map((r) => (
                <TableRow key={r.id} className={r.active ? '' : 'opacity-60'}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                    {!r.active && <Badge variant="outline">Inativo</Badge>}
                  </TableCell>
                  <TableCell>
                    {REWARD_LABEL[r.kind]}
                    <div className="text-xs text-muted-foreground">{r.kind === 'BRINDE' ? `${r.giftName ?? '—'} (estoque ${r.giftStock ?? 0})` : rewardValue(r)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.kind === 'BENEFICIO' ? '—' : num(r.pointsCost)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[r.stock !== null && `restam ${r.stock}`, r.perCustomer !== null && `${r.perCustomer} por cliente`, r.minLevel && `nível mínimo: ${r.minLevel}`].filter(Boolean).join(' · ') || 'Sem limite'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.redemptions)}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    {can('fidelidade', 'edit') && (
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit(r)}>
                        <PencilIcon />
                      </Button>
                    )}
                    {can('fidelidade', 'delete') && !r.redemptions && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={async () => (await confirm({ title: `Excluir ${r.name}?`, confirmLabel: 'Excluir' })) && remove.mutate(r.id)}>
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
      {edit && <RewardDialog reward={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function RewardDialog({ reward, onClose }: { reward: Reward | null; onClose: () => void }) {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['fidelidade', 'config'], queryFn: () => api.get<ConfigView>('/marketing/fidelidade/config') })
  const [f, setF] = useState({
    name: reward?.name ?? '',
    description: reward?.description ?? '',
    kind: reward?.kind ?? 'DESCONTO',
    pointsCost: String(reward?.pointsCost ?? ''),
    giftId: reward?.giftId ?? '',
    discountType: reward?.discountType ?? 'VALOR',
    value: reward?.value !== null && reward?.value !== undefined ? String(reward.value) : '',
    stock: reward?.stock !== null && reward?.stock !== undefined ? String(reward.stock) : '',
    perCustomer: reward?.perCustomer !== null && reward?.perCustomer !== undefined ? String(reward.perCustomer) : '',
    minLevel: reward?.minLevel ?? '',
    validityDays: reward?.validityDays ? String(reward.validityDays) : '',
    active: reward?.active ?? true,
    sort: String(reward?.sort ?? 0),
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const intOrNull = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: f.description.trim() || null,
        kind: f.kind,
        pointsCost: Math.round(Number(f.pointsCost) || 0),
        giftId: f.kind === 'BRINDE' ? f.giftId || null : null,
        discountType: f.kind === 'DESCONTO' ? f.discountType : null,
        value: f.kind === 'DESCONTO' || f.kind === 'CASHBACK' ? Number(f.value.replace(',', '.')) || null : null,
        stock: intOrNull(f.stock),
        perCustomer: intOrNull(f.perCustomer),
        minLevel: f.minLevel || null,
        validityDays: intOrNull(f.validityDays),
        active: f.active,
        sort: Math.round(Number(f.sort) || 0),
      }
      return reward ? api.put(`/marketing/fidelidade/premios/${reward.id}`, body) : api.post('/marketing/fidelidade/premios', body)
    },
    onSuccess: () => {
      toast.success('Prêmio salvo.')
      void qc.invalidateQueries({ queryKey: ['fidelidade', 'premios'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const opts = cfg.data?.options
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{reward ? 'Editar prêmio' : 'Novo prêmio'}</DialogTitle>
          <DialogDescription>Desconto e cashback geram um código (FID-…) que a equipe aplica à mão na venda. O CRM não cria cupons na loja virtual.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="rw-name">Nome</Label>
            <Input id="rw-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rw-desc">Descrição (aparece para o cliente)</Label>
            <Textarea id="rw-desc" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => set('kind', v as Reward['kind'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REWARD_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {f.kind !== 'BENEFICIO' && (
            <div>
              <Label htmlFor="rw-pts">Pontos</Label>
              <Input id="rw-pts" type="number" min={1} value={f.pointsCost} onChange={(e) => set('pointsCost', e.target.value)} />
            </div>
          )}
          {f.kind === 'BRINDE' && (
            <div className="sm:col-span-2">
              <Label>Brinde (Controle de brindes)</Label>
              <Select value={f.giftId} onValueChange={(v) => set('giftId', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha o brinde" />
                </SelectTrigger>
                <SelectContent>
                  {opts?.gifts.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} (estoque {g.stock})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">O resgate lança a retirada no Controle de brindes (baixa o estoque e a cota de quem entrega, definido em Configurações).</p>
            </div>
          )}
          {f.kind === 'DESCONTO' && (
            <div>
              <Label>Desconto em</Label>
              <Select value={f.discountType} onValueChange={(v) => set('discountType', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VALOR">R$</SelectItem>
                  <SelectItem value="PERCENTUAL">%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {(f.kind === 'DESCONTO' || f.kind === 'CASHBACK') && (
            <>
              <div>
                <Label htmlFor="rw-val">{f.kind === 'DESCONTO' && f.discountType === 'PERCENTUAL' ? 'Percentual' : 'Valor (R$)'}</Label>
                <Input id="rw-val" inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rw-days">Validade do código (dias)</Label>
                <Input id="rw-days" type="number" min={1} value={f.validityDays} onChange={(e) => set('validityDays', e.target.value)} placeholder={`Padrão: ${cfg.data?.config.codeValidityDays ?? 30}`} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="rw-stock">Quantidade disponível</Label>
            <Input id="rw-stock" type="number" min={0} value={f.stock} onChange={(e) => set('stock', e.target.value)} placeholder="Sem limite" />
          </div>
          <div>
            <Label htmlFor="rw-per">Resgates por cliente</Label>
            <Input id="rw-per" type="number" min={1} value={f.perCustomer} onChange={(e) => set('perCustomer', e.target.value)} placeholder="Sem limite" />
          </div>
          <div>
            <Label>Nível mínimo</Label>
            <Select value={f.minLevel || 'nenhum'} onValueChange={(v) => set('minLevel', v === 'nenhum' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Todos os níveis</SelectItem>
                {cfg.data?.config.levels.map((l) => (
                  <SelectItem key={l.key} value={l.key}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rw-sort">Ordem na página</Label>
            <Input id="rw-sort" type="number" min={0} value={f.sort} onChange={(e) => set('sort', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={f.active} onCheckedChange={(v) => set('active', v)} /> Ativo (aparece para os clientes)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!f.name.trim() || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Avaliações ----------

interface ReviewRow {
  id: string
  lead: { id: string; name: string | null; email: string | null; phone: string | null }
  orderCode: string
  stars: number
  nps: number
  npsClass: string
  comment: string | null
  aspects: Record<string, number> | null
  detractor: boolean
  followUpStatus: string | null
  followUpNote: string | null
  treatedAt: string | null
  treatedByName: string | null
  bonusPoints: number
  createdAt: string
}

function Avaliacoes() {
  const [filter, setFilter] = useState('todos')
  const [treat, setTreat] = useState<ReviewRow | null>(null)
  const q = useQuery({
    queryKey: ['fidelidade', 'avaliacoes', filter],
    queryFn: () => api.get<{ nps: Dashboard['nps']; stars: number | null; starsBreakdown: { stars: number; count: number }[]; aspects: Record<string, number>; pending: number; items: ReviewRow[] }>(`/marketing/fidelidade/avaliacoes?filtro=${filter}&meses=12`),
  })
  const d = q.data
  return (
    <div className="space-y-3">
      {d && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="NPS (12 meses)" value={d.nps.nps === null ? '—' : String(d.nps.nps)} hint={`${num(d.nps.total)} avaliação(ões)`} />
          <Kpi label="Promotores / neutros / detratores" value={`${num(d.nps.promoters)} / ${num(d.nps.passives)} / ${num(d.nps.detractors)}`} />
          <Kpi label="Média de estrelas" value={d.stars === null ? '—' : d.stars.toLocaleString('pt-BR')} hint={d.starsBreakdown.map((s) => `${s.stars}★ ${s.count}`).join(' · ')} />
          <Kpi label="Detratores a tratar" value={num(d.pending)} hint={Object.entries(d.aspects).map(([k, v]) => `${k}: ${v.toLocaleString('pt-BR')}`).join(' · ') || undefined} />
        </div>
      )}
      <div className="w-56">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas</SelectItem>
            <SelectItem value="pendentes">Detratores a tratar</SelectItem>
            <SelectItem value="detratores">Todos os detratores</SelectItem>
            <SelectItem value="neutros">Neutros (7 e 8)</SelectItem>
            <SelectItem value="promotores">Promotores (9 e 10)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d!.items.length ? (
        <EmptyState icon={StarIcon} title="Nenhuma avaliação" description="O convite para avaliar sai depois da entrega do pedido (ou X dias depois do pagamento), por e-mail e/ou WhatsApp." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente / pedido</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Comentário</TableHead>
                <TableHead>Acompanhamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d!.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.lead.name ?? r.lead.email ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      Pedido {r.orderCode} · {formatDateTime(r.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Stars n={r.stars} />
                    <div className="text-xs">
                      Nota {r.nps} · <span className={r.npsClass === 'detrator' ? 'text-red-600' : r.npsClass === 'promotor' ? 'text-emerald-700 dark:text-emerald-400' : ''}>{r.npsClass}</span>
                    </div>
                    {r.aspects && <div className="text-xs text-muted-foreground">{Object.entries(r.aspects).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-pre-wrap text-sm">{r.comment ?? '—'}</TableCell>
                  <TableCell>
                    {r.detractor ? (
                      r.followUpStatus === 'TRATADO' ? (
                        <div className="text-xs">
                          <Badge variant="secondary">Tratado</Badge>
                          <div className="text-muted-foreground">
                            {r.treatedByName} em {dateShort(r.treatedAt)}: {r.followUpNote}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="destructive">A tratar</Badge>
                          <Can module="fidelidade" action="edit">
                            <Button size="sm" variant="outline" className="block" onClick={() => setTreat(r)}>
                              Registrar contato
                            </Button>
                          </Can>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {treat && <TreatDialog r={treat} onClose={() => setTreat(null)} />}
    </div>
  )
}

function TreatDialog({ r, onClose }: { r: ReviewRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/marketing/fidelidade/avaliacoes/${r.id}/tratar`, { note: note.trim() }),
    onSuccess: () => {
      toast.success('Avaliação tratada.')
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tratar a avaliação do pedido {r.orderCode}</DialogTitle>
          <DialogDescription>
            {r.lead.name ?? ''} {r.lead.phone ? `· ${r.lead.phone}` : ''} — {r.stars} estrela(s), nota {r.nps}. O que foi feito fica no histórico do lead.
          </DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ex.: liguei para o cliente, troca da peça combinada com o vendedor" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={note.trim().length < 2 || save.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Configurações ----------

function Configuracoes() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['fidelidade', 'config'], queryFn: () => api.get<ConfigView>('/marketing/fidelidade/config') })
  const [c, setC] = useState<Config | null>(null)
  useEffect(() => {
    if (q.data) setC(structuredClone(q.data.config))
  }, [q.data])
  const save = useMutation({
    mutationFn: () => api.put<Config>('/marketing/fidelidade/config', { config: c }),
    onSuccess: () => {
      toast.success('Configurações salvas.')
      void qc.invalidateQueries({ queryKey: ['fidelidade'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isLoading || !c) return <TableSkeleton />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const o = q.data!.options
  const readOnly = !can('fidelidade', 'edit')
  const set = (patch: Partial<Config>) => setC({ ...c, ...patch })
  const setR = (patch: Partial<Config['review']>) => setC({ ...c, review: { ...c.review, ...patch } })
  const setM = (k: keyof Config['messages'], v: string) => setC({ ...c, messages: { ...c.messages, [k]: v } })
  const setP = (patch: Partial<Config['page']>) => setC({ ...c, page: { ...c.page, ...patch } })
  const numIn = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')))
  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Programa</CardTitle>
          <CardDescription>
            Só os pedidos <b>pagos</b> da loja virtual (Magazord) a partir da data de início dão pontos. Página do cliente: <code className="text-xs">{o.publicUrl}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
            <Switch checked={c.enabled} onCheckedChange={(v) => set({ enabled: v })} /> Programa ligado
          </label>
          <Field label="Pedidos pagos a partir de">
            <Input type="date" value={c.since ?? ''} onChange={(e) => set({ since: e.target.value || null })} />
          </Field>
          <Field label="Pontos por R$ 1,00">
            <Input type="number" step="0.01" min={0} value={c.pointsPerReal} onChange={(e) => set({ pointsPerReal: numIn(e.target.value) })} />
          </Field>
          <Field label="Arredondamento">
            <Select value={c.rounding} onValueChange={(v) => set({ rounding: v as Config['rounding'] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baixo">Para baixo</SelectItem>
                <SelectItem value="proximo">Mais próximo</SelectItem>
                <SelectItem value="cima">Para cima</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Pedido mínimo (R$)">
            <Input type="number" min={0} step="0.01" value={c.minOrderValue} onChange={(e) => set({ minOrderValue: numIn(e.target.value) })} />
          </Field>
          <Field label="Pontos vencem em (meses; 0 = não vencem)">
            <Input type="number" min={0} value={c.expireMonths} onChange={(e) => set({ expireMonths: numIn(e.target.value) })} />
          </Field>
          <Field label="Validade dos códigos de resgate (dias)">
            <Input type="number" min={1} value={c.codeValidityDays} onChange={(e) => set({ codeValidityDays: numIn(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.onlySite} onCheckedChange={(v) => set({ onlySite: v })} /> Só pedidos do site (sem marketplaces)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.reverseOnCancel} onCheckedChange={(v) => set({ reverseOnCancel: v })} /> Estornar pontos de pedido cancelado ou devolvido
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bônus</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Por avaliar a compra">
            <Input type="number" min={0} value={c.bonusReview} onChange={(e) => set({ bonusReview: numIn(e.target.value) })} />
          </Field>
          <Field label="Primeira compra">
            <Input type="number" min={0} value={c.bonusFirstPurchase} onChange={(e) => set({ bonusFirstPurchase: numIn(e.target.value) })} />
          </Field>
          <Field label="Aniversário">
            <Input type="number" min={0} value={c.bonusBirthday} onChange={(e) => set({ bonusBirthday: numIn(e.target.value) })} />
          </Field>
          <Field label="Campo com a data de aniversário">
            <Select value={c.birthdayField ?? 'nenhum'} onValueChange={(v) => set({ birthdayField: v === 'nenhum' ? null : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Nenhum</SelectItem>
                {o.dateFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {!o.dateFields.length && <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">O lead não tem data de nascimento padrão: crie um campo personalizado do tipo data em Leads › Configurações para usar o bônus de aniversário.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Níveis</CardTitle>
          <CardDescription>Calculados pelos últimos 12 meses. Os benefícios são informativos (aparecem para o cliente e a equipe).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Base do nível">
            <Select value={c.levelBasis} onValueChange={(v) => set({ levelBasis: v as Config['levelBasis'] })}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pontos">Pontos ganhos em 12 meses</SelectItem>
                <SelectItem value="gasto">Valor comprado (R$) em 12 meses</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {c.levels.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_8rem_4rem_2fr_auto]">
              <Input aria-label="Nome do nível" value={l.name} onChange={(e) => set({ levels: c.levels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input aria-label="A partir de" type="number" min={0} disabled={i === 0} value={l.min} onChange={(e) => set({ levels: c.levels.map((x, j) => (j === i ? { ...x, min: numIn(e.target.value) } : x)) })} />
              <Input aria-label="Cor" type="color" value={l.color} onChange={(e) => set({ levels: c.levels.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <Input aria-label="Benefícios" value={l.benefits} placeholder="Benefícios (ex.: frete grátis, atendimento prioritário)" onChange={(e) => set({ levels: c.levels.map((x, j) => (j === i ? { ...x, benefits: e.target.value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remover nível" disabled={c.levels.length <= 1} onClick={() => set({ levels: c.levels.filter((_, j) => j !== i) })}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={c.levels.length >= 10} onClick={() => set({ levels: [...c.levels, { key: `novo-${Date.now()}`, name: 'Novo nível', min: (c.levels[c.levels.length - 1]?.min ?? 0) + 1000, benefits: '', color: '#64748b' }] })}>
            <PlusIcon /> Adicionar nível
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resgate de brindes e acesso do cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Quem entrega o brinde resgatado">
            <Select value={c.giftHolder} onValueChange={(v) => set({ giftHolder: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendedor">Vendedor do cliente</SelectItem>
                {o.holders.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Validade do link enviado ao cliente (dias)">
            <Input type="number" min={1} max={30} value={c.linkValidityDays} onChange={(e) => set({ linkValidityDays: numIn(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.loginEmail} onCheckedChange={(v) => set({ loginEmail: v })} /> Cliente entra com código por e-mail
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.loginWhatsapp} onCheckedChange={(v) => set({ loginWhatsapp: v })} /> Cliente entra com código por WhatsApp
          </label>
          <Field label="Número do WhatsApp (links e códigos)">
            <NumberSelect value={c.loginNumberId} numbers={o.numbers} onChange={(v) => set({ loginNumberId: v })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Avaliação depois da compra</CardTitle>
          <CardDescription>O convite sai depois que a loja marca o pedido como entregue; se a loja não marcar, X dias depois do pagamento. Uma vez por pedido. WhatsApp: só no horário comercial, uma mensagem por vez com intervalo sorteado.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
            <Switch checked={c.review.enabled} onCheckedChange={(v) => setR({ enabled: v })} /> Enviar convite para avaliar
          </label>
          <Field label="Dias depois da entrega">
            <Input type="number" min={0} value={c.review.daysAfterDelivery} onChange={(e) => setR({ daysAfterDelivery: numIn(e.target.value) })} />
          </Field>
          <Field label="Sem entrega na loja: dias depois do pagamento">
            <Input type="number" min={1} value={c.review.daysAfterPayment} onChange={(e) => setR({ daysAfterPayment: numIn(e.target.value) })} />
          </Field>
          <Field label="Não convidar pedidos com mais de (dias)">
            <Input type="number" min={7} value={c.review.maxAgeDays} onChange={(e) => setR({ maxAgeDays: numIn(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.review.email} onCheckedChange={(v) => setR({ email: v })} /> Por e-mail
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.review.whatsapp} onCheckedChange={(v) => setR({ whatsapp: v })} /> Por WhatsApp
          </label>
          <Field label="Número do WhatsApp do convite">
            <NumberSelect value={c.review.numberId} numbers={o.numbers} onChange={(v) => setR({ numberId: v })} />
          </Field>
          <Field label="Intervalo entre mensagens (minutos)">
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={120} value={c.review.gapMin} onChange={(e) => setR({ gapMin: numIn(e.target.value) })} />a
              <Input type="number" min={1} max={120} value={c.review.gapMax} onChange={(e) => setR({ gapMax: numIn(e.target.value) })} />
            </div>
          </Field>
          <Field label="Detrator: nota até">
            <Input type="number" min={0} max={10} value={c.review.detractorNps} onChange={(e) => setR({ detractorNps: numIn(e.target.value) })} />
          </Field>
          <Field label="ou estrelas até">
            <Input type="number" min={1} max={5} value={c.review.detractorStars} onChange={(e) => setR({ detractorStars: numIn(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={c.review.aspects} onCheckedChange={(v) => setR({ aspects: v })} /> Perguntar produto, entrega e atendimento
          </label>
          <Field label="Link para avaliar no Google (convite aos promotores)" className="sm:col-span-2 lg:col-span-3">
            <Input value={c.review.googleReviewUrl} placeholder="https://g.page/r/..." onChange={(e) => setR({ googleReviewUrl: e.target.value })} />
          </Field>
          <Field label="Avisar no celular (app) quando houver detrator" className="sm:col-span-2 lg:col-span-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {o.users.map((u) => (
                <label key={u.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={c.review.alertUserIds.includes(u.id)} onChange={(e) => setR({ alertUserIds: e.target.checked ? [...c.review.alertUserIds, u.id] : c.review.alertUserIds.filter((x) => x !== u.id) })} />
                  {u.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="E-mails que recebem o aviso de detrator (separados por vírgula)" className="sm:col-span-2 lg:col-span-3">
            <Input value={c.review.alertEmails.join(', ')} onChange={(e) => setR({ alertEmails: e.target.value.split(/[,;\s]+/).filter(Boolean) })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensagens</CardTitle>
          <CardDescription>Variáveis: {'{nome}'}, {'{pedido}'}, {'{bonus}'}, {'{pontos}'}, {'{nivel}'}, {'{link}'}, {'{dias}'}, {'{codigo}'}, {'{empresa}'}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <Field label="Convite — assunto do e-mail">
            <Input value={c.messages.inviteSubject} onChange={(e) => setM('inviteSubject', e.target.value)} />
          </Field>
          <Field label="Link de acesso — assunto do e-mail">
            <Input value={c.messages.linkSubject} onChange={(e) => setM('linkSubject', e.target.value)} />
          </Field>
          <Field label="Convite — e-mail (o botão Avaliar vai embaixo)">
            <Textarea rows={4} value={c.messages.inviteEmail} onChange={(e) => setM('inviteEmail', e.target.value)} />
          </Field>
          <Field label="Link de acesso — e-mail">
            <Textarea rows={4} value={c.messages.linkEmail} onChange={(e) => setM('linkEmail', e.target.value)} />
          </Field>
          <Field label="Convite — WhatsApp (use {link})">
            <Textarea rows={3} value={c.messages.inviteWhatsapp} onChange={(e) => setM('inviteWhatsapp', e.target.value)} />
          </Field>
          <Field label="Link de acesso — WhatsApp (use {link})">
            <Textarea rows={3} value={c.messages.linkWhatsapp} onChange={(e) => setM('linkWhatsapp', e.target.value)} />
          </Field>
          <Field label="Código de acesso (use {codigo})">
            <Textarea rows={2} value={c.messages.codeText} onChange={(e) => setM('codeText', e.target.value)} />
          </Field>
          <Field label="Agradecimento depois da avaliação">
            <Textarea rows={2} value={c.messages.thanks} onChange={(e) => setM('thanks', e.target.value)} />
          </Field>
          <Field label="Convite ao promotor para avaliar no Google">
            <Textarea rows={2} value={c.messages.googleText} onChange={(e) => setM('googleText', e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Página do cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <Field label="Título">
            <Input value={c.page.title} onChange={(e) => setP({ title: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Cor (vazio = cor da marca)">
            <div className="flex gap-2">
              <Input type="color" className="w-16" value={c.page.color || '#1d4ed8'} onChange={(e) => setP({ color: e.target.value })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setP({ color: '' })}>
                Usar a da marca
              </Button>
            </div>
          </Field>
          <Field label="Apresentação">
            <Textarea rows={3} value={c.page.intro} onChange={(e) => setP({ intro: e.target.value })} />
          </Field>
          <Field label="Regulamento (opcional)">
            <Textarea rows={3} value={c.page.rules} onChange={(e) => setP({ rules: e.target.value })} />
          </Field>
          <Field label="Texto de consentimento (LGPD)" className="lg:col-span-2">
            <Textarea rows={3} value={c.page.consent} onChange={(e) => setP({ consent: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar configurações
          </Button>
        </div>
      )}
    </fieldset>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-sm">{label}</Label>
      {children}
    </div>
  )
}

function NumberSelect({ value, numbers, onChange }: { value: string | null; numbers: { id: string; name: string; status: string }[]; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? 'nenhum'} onValueChange={(v) => onChange(v === 'nenhum' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="nenhum">Nenhum</SelectItem>
        {numbers.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            {n.name} {n.status !== 'CONECTADO' ? '(desconectado)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
