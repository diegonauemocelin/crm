import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BanIcon, CheckCircle2Icon, SendIcon, ExternalLinkIcon, Loader2Icon, MailIcon, MapPinIcon, MessageCircleIcon, PhoneIcon, SearchIcon, SettingsIcon, UserPlusIcon, XIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ChamarDialog, EnvioDialog, EnviosPainel, SEND_LABEL, useCampaigns } from '@/components/prospeccao/envio'
import { Checkbox } from '@/components/ui/checkbox'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface Criteria {
  place: string
  radiusKm: number
  segment: string
  keywords: string[]
  notes: string
  limit: number
  onlyWithContact: boolean
}
interface Config {
  provider: 'claude' | 'gemini'
  claudeModel: string
  dailyLimit: number
  maxWebSearches: number
}
interface SearchMeta {
  id: string
  criteria: Criteria
  provider: string
  model: string | null
  status: 'GERANDO' | 'PRONTO' | 'ERRO'
  error: string | null
  centerLabel: string | null
  found: number
  costUsd: number
  createdBy: string | null
  createdAt: string
}
interface View {
  config: Config
  models: string[]
  keys: { claude: boolean; gemini: boolean }
  today: number
  canConfig: boolean
  searches: SearchMeta[]
}
interface Phone {
  value: string
  kind: 'celular' | 'fixo'
  source: string
  whatsapp: boolean | null
}
interface Email {
  value: string
  source: string
  mx: boolean | null
}
interface Prospect {
  id: string
  name: string
  cnpj: string | null
  segment: string | null
  city: string | null
  uf: string | null
  address: string | null
  site: string | null
  instagram: string | null
  phones: Phone[]
  emails: Email[]
  score: number
  reason: string | null
  sources: string[]
  distanceKm: number | null
  cnpjStatus: string | null
  status: 'NOVO' | 'LEAD' | 'DESCARTADO' | 'NAO_CONTATAR'
  leadId: string | null
}
interface SearchFull extends SearchMeta {
  prospects: Prospect[]
  whatsappRunning: boolean
}

const fmtPhone = (e164: string) => {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}
const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Busca de leads: empresas do segmento e da região, com contatos comerciais públicos conferidos. */
export function ProspeccaoPage() {
  const q = useQuery({ queryKey: ['prospeccao'], queryFn: () => api.get<View>('/prospeccao'), refetchInterval: (x) => (x.state.data?.searches.some((s) => s.status === 'GERANDO') ? 5000 : false) })
  const [selected, setSelected] = useState<string | null>(null)
  const current = selected ?? q.data?.searches[0]?.id ?? null
  return (
    <RequirePermission module="prospeccao">
      <PageHeader title="Busca de leads" description="Encontre empresas do seu segmento na região, com telefone, WhatsApp e e-mail comerciais conferidos. Só dados públicos de empresas (LGPD)." />
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <TableSkeleton />}
      {q.data && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <NovaBusca v={q.data} onStarted={setSelected} />
            <div className="space-y-4">
              <Historico v={q.data} current={current} onSelect={setSelected} />
              {q.data.canConfig && <Configuracao v={q.data} />}
            </div>
          </div>
          {current && <Resultado id={current} meta={q.data.searches.find((s) => s.id === current) ?? null} />}
        </div>
      )}
    </RequirePermission>
  )
}

function NovaBusca({ v, onStarted }: { v: View; onStarted: (id: string) => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [f, setF] = useState({ place: '', radiusKm: '50', segment: '', keywords: '', notes: '', limit: '20', onlyWithContact: true })
  const keyOk = v.keys[v.config.provider]
  const start = useMutation({
    mutationFn: () => api.post<SearchMeta>('/prospeccao/buscar', { place: f.place, radiusKm: Number(f.radiusKm) || 0, segment: f.segment, keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean), notes: f.notes, limit: Number(f.limit) || 20, onlyWithContact: f.onlyWithContact }),
    onSuccess: (s) => {
      toast.success('Busca iniciada. Leva de 1 a 4 minutos; a tela atualiza sozinha.')
      onStarted(s.id)
      void qc.invalidateQueries({ queryKey: ['prospeccao'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (e: FormEvent) => (e.preventDefault(), start.mutate())
  const set = (k: keyof typeof f, val: string | boolean) => setF((x) => ({ ...x, [k]: val }))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SearchIcon className="size-4" aria-hidden /> Nova busca
        </CardTitle>
        <CardDescription>
          Com {v.config.provider === 'claude' ? 'Claude (crédito da Anthropic)' : 'Gemini (plano gratuito do Google)'} · {v.today} de {v.config.dailyLimit} buscas hoje
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!keyOk && <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Falta a chave do {v.config.provider === 'claude' ? 'Claude: cadastre em Atendimento Comercial › Análise das perdas (IA)' : 'Gemini: cadastre em Marketplaces › Assistente ML › Configurações'}.</p>}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-place">Cidade/UF ou CEP</Label>
            <Input id="pr-place" placeholder="Ex.: Chapecó, SC ou 89874-000" value={f.place} onChange={(e) => set('place', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-raio">Raio (km)</Label>
            <Input id="pr-raio" type="number" min={0} max={300} value={f.radiusKm} onChange={(e) => set('radiusKm', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-seg">Segmento</Label>
            <Input id="pr-seg" placeholder="Ex.: terraplenagem, construtora, locadora de máquinas" value={f.segment} onChange={(e) => set('segment', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-kw">Interesse / palavras-chave</Label>
            <Input id="pr-kw" placeholder="Ex.: escavadeira, pá carregadeira (separe por vírgula)" value={f.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pr-notes">Perfil ideal (opcional)</Label>
            <Textarea id="pr-notes" rows={2} placeholder="Ex.: empresas com frota própria de máquinas, porte médio, que atendem obras públicas" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-lim">Quantas empresas</Label>
            <Input id="pr-lim" type="number" min={5} max={40} value={f.limit} onChange={(e) => set('limit', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={f.onlyWithContact} onCheckedChange={(x) => set('onlyWithContact', x)} /> Só com contato válido
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={start.isPending || !keyOk || !can('prospeccao', 'create')}>
              {start.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SearchIcon aria-hidden />} Buscar empresas
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Historico({ v, current, onSelect }: { v: View; current: string | null; onSelect: (id: string) => void }) {
  if (!v.searches.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Buscas feitas</CardTitle>
      </CardHeader>
      <CardContent>
        <Select value={current ?? undefined} onValueChange={onSelect}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {v.searches.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.criteria.segment || s.criteria.keywords.join(', ')} · {s.criteria.place} · {s.status === 'GERANDO' ? 'buscando…' : s.status === 'ERRO' ? 'erro' : `${s.found} empresa(s)`} · {formatDateTime(s.createdAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

function Configuracao({ v }: { v: View }) {
  const qc = useQueryClient()
  const [c, setC] = useState(v.config)
  useEffect(() => setC(v.config), [v.config])
  const save = useMutation({ mutationFn: () => api.put('/prospeccao/config', { ...c }), onSuccess: () => (toast.success('Configuração salva.'), void qc.invalidateQueries({ queryKey: ['prospeccao'] })), onError: (e) => toast.error(errorMessage(e)) })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SettingsIcon className="size-4" aria-hidden /> Configuração
        </CardTitle>
        <CardDescription>Como a busca é feita (só gestores).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label>IA da busca</Label>
          <Select value={c.provider} onValueChange={(x) => setC({ ...c, provider: x as Config['provider'] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude (pesquisa na web, crédito da Anthropic)</SelectItem>
              <SelectItem value="gemini">Gemini (pesquisa do Google, plano gratuito)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {c.provider === 'claude' && (
          <>
            <div className="space-y-1.5">
              <Label>Modelo do Claude</Label>
              <Select value={c.claudeModel} onValueChange={(x) => setC({ ...c, claudeModel: x })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {v.models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === 'claude-opus-5-5' ? 'Opus 5.5 (mais completo)' : m === 'claude-sonnet-5-5' ? 'Sonnet 5.5 (equilibrado)' : 'Haiku 5.5 (mais barato)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-ws">Pesquisas na web por busca</Label>
              <Input id="pr-ws" type="number" min={2} max={20} value={c.maxWebSearches} onChange={(e) => setC({ ...c, maxWebSearches: Number(e.target.value) || 8 })} />
              <p className="text-xs text-muted-foreground">Cada pesquisa custa cerca de US$ 0,01, além dos tokens.</p>
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pr-dl">Buscas por dia (empresa)</Label>
          <Input id="pr-dl" type="number" min={1} max={200} value={c.dailyLimit} onChange={(e) => setC({ ...c, dailyLimit: Number(e.target.value) || 10 })} />
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          Salvar
        </Button>
      </CardContent>
    </Card>
  )
}

function Resultado({ id, meta }: { id: string; meta: SearchMeta | null }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const edit = can('prospeccao', 'edit')
  const [filter, setFilter] = useState<'NOVO' | 'TODOS'>('NOVO')
  const q = useQuery({ queryKey: ['prospeccao', id, meta?.status], queryFn: () => api.get<SearchFull>(`/prospeccao/buscas/${id}`), placeholderData: keepPreviousData, refetchInterval: (x) => (x.state.data?.whatsappRunning || x.state.data?.status === 'GERANDO' ? 5000 : false) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['prospeccao', id] })
  const act = useMutation({
    mutationFn: ({ pid, action }: { pid: string; action: 'lead' | 'descartar' | 'nao-contatar' }) => api.post<{ leadId?: string }>(`/prospeccao/empresas/${pid}/${action}`),
    onSuccess: (_r, x) => (toast.success(x.action === 'lead' ? 'Virou lead.' : x.action === 'descartar' ? 'Descartada.' : 'Marcada para não contatar: não volta em buscas futuras.'), void refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const wa = useMutation({ mutationFn: () => api.post<{ started: boolean; message: string }>(`/prospeccao/buscas/${id}/whatsapp`), onSuccess: (r) => ((r.started ? toast.success : toast.info)(r.message), void refresh()), onError: (e) => toast.error(errorMessage(e)) })
  const campaigns = useCampaigns(id)
  const chat = can('chat', 'create')
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [calling, setCalling] = useState<{ id: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  useEffect(() => setMarked(new Set()), [id])
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton />
  const d = q.data
  if (d.status === 'GERANDO')
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2Icon className="animate-spin" aria-hidden /> Buscando empresas{d.centerLabel ? ` perto de ${d.centerLabel}` : ''}… leva de 1 a 4 minutos.
        </CardContent>
      </Card>
    )
  if (d.status === 'ERRO')
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">Não foi possível fazer a busca: {d.error}</CardContent>
      </Card>
    )
  const rows = d.prospects.filter((p) => filter === 'TODOS' || p.status === 'NOVO')
  // Situação do envio de cada empresa (o mais recente).
  const sendOf = new Map<string, NonNullable<typeof campaigns.data>[number]['sends'][number]>()
  for (const c of [...(campaigns.data ?? [])].reverse()) for (const x of c.sends) if (x.status !== 'CANCELADA') sendOf.set(x.prospectId, x)
  const hasMobile = (p: Prospect) => p.phones.some((x) => x.whatsapp === true || (x.kind === 'celular' && x.whatsapp !== false))
  const sendable = (p: Prospect) => (p.status === 'NOVO' || p.status === 'LEAD') && hasMobile(p) && !sendOf.has(p.id)
  const canSend = edit && chat
  const toggle = (pid: string) => setMarked((m) => (m.has(pid) ? (m.delete(pid), new Set(m)) : new Set(m.add(pid))))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {d.found} empresa(s) · {d.criteria.segment || d.criteria.keywords.join(', ')} · {d.centerLabel ?? d.criteria.place}
          {d.criteria.radiusKm ? ` (${d.criteria.radiusKm} km)` : ''}
        </h2>
        <span className="text-sm text-muted-foreground">
          {d.provider === 'gemini' ? 'Gemini' : 'Claude'}
          {d.costUsd ? ` · custo aproximado ${usd(d.costUsd)}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          <Select value={filter} onValueChange={(x) => setFilter(x as typeof filter)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NOVO">A abordar</SelectItem>
              <SelectItem value="TODOS">Todas</SelectItem>
            </SelectContent>
          </Select>
          {edit && (
            <Button variant="outline" disabled={wa.isPending || d.whatsappRunning} onClick={() => wa.mutate()}>
              {d.whatsappRunning ? <Loader2Icon className="animate-spin" aria-hidden /> : <MessageCircleIcon aria-hidden />} Conferir WhatsApp
            </Button>
          )}
        </div>
      </div>
      {canSend && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
          <Checkbox
            id="pe-all"
            checked={rows.some(sendable) && rows.filter(sendable).every((p) => marked.has(p.id))}
            onCheckedChange={(v) => setMarked(v ? new Set(rows.filter(sendable).map((p) => p.id)) : new Set())}
            aria-label="Marcar todas as empresas com celular"
          />
          <Label htmlFor="pe-all" className="font-normal">
            Marcar todas com celular ({rows.filter(sendable).length})
          </Label>
          <span className="text-xs text-muted-foreground">Confira o WhatsApp antes: só vai para quem tem.</span>
          <Button size="sm" className="ml-auto" disabled={!marked.size} onClick={() => setSending(true)}>
            <SendIcon aria-hidden /> Enviar mensagem ({marked.size})
          </Button>
        </div>
      )}
      <EnviosPainel searchId={id} edit={edit} />
      {calling && <ChamarDialog prospect={calling} onClose={() => setCalling(null)} />}
      {sending && (
        <EnvioDialog
          searchId={id}
          prospectIds={[...marked]}
          onClose={() => setSending(false)}
          onDone={() => {
            setSending(false)
            setMarked(new Set())
            void qc.invalidateQueries({ queryKey: ['prospeccao-envios', id] })
            void refresh()
          }}
        />
      )}
      {!rows.length && <EmptyState icon={SearchIcon} title="Nenhuma empresa a abordar nesta busca" description="Mude para Todas ou faça outra busca (outro raio ou segmento)." />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((p) => (
          <Card key={p.id} className={p.status !== 'NOVO' ? 'opacity-60' : ''}>
            <CardContent className="space-y-2 py-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                {canSend && sendable(p) && <Checkbox className="mt-1" checked={marked.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Marcar ${p.name} para o envio`} />}
                <div className="mr-auto">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[p.segment, [p.city, p.uf].filter(Boolean).join('/'), p.distanceKm !== null ? `${p.distanceKm} km` : null, p.cnpj ? `CNPJ ${fmtCnpj(p.cnpj)}${p.cnpjStatus ? ` (${p.cnpjStatus.toLowerCase()})` : ''}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge variant={p.score >= 70 ? 'default' : 'secondary'} title="Quanto combina com o perfil buscado">
                  {p.score}
                </Badge>
              </div>
              {p.reason && <p className="text-muted-foreground">{p.reason}</p>}
              {sendOf.get(p.id) && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant={sendOf.get(p.id)!.status === 'ENVIADA' ? 'default' : 'outline'}>{SEND_LABEL[sendOf.get(p.id)!.status]}</Badge>
                  {sendOf.get(p.id)!.repliedAt && <Badge className="bg-emerald-600 text-white">{sendOf.get(p.id)!.optedOut ? 'pediu para sair' : 'respondeu'}</Badge>}
                  {sendOf.get(p.id)!.error && <span className="text-muted-foreground">{sendOf.get(p.id)!.error}</span>}
                  {sendOf.get(p.id)!.conversationId && (
                    <Link to={`/chat?conversa=${sendOf.get(p.id)!.conversationId}`} className="underline">
                      abrir a conversa
                    </Link>
                  )}
                </p>
              )}
              <div className="space-y-1">
                {p.phones.map((x) => (
                  <p key={x.value} className="flex flex-wrap items-center gap-1.5">
                    <PhoneIcon className="size-3.5" aria-hidden /> {fmtPhone(x.value)} <span className="text-xs text-muted-foreground">({x.kind} · {x.source})</span>
                    {x.whatsapp === true && <Badge className="bg-emerald-600 text-white">WhatsApp ✓</Badge>}
                    {x.whatsapp === false && <Badge variant="outline">sem WhatsApp</Badge>}
                  </p>
                ))}
                {p.emails.map((x) => (
                  <p key={x.value} className="flex flex-wrap items-center gap-1.5">
                    <MailIcon className="size-3.5" aria-hidden /> {x.value} <span className="text-xs text-muted-foreground">({x.source})</span>
                    {x.mx && <CheckCircle2Icon className="size-3.5 text-emerald-600" aria-label="domínio recebe e-mail" />}
                  </p>
                ))}
                {p.address && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPinIcon className="size-3.5" aria-hidden /> {p.address}
                  </p>
                )}
                <p className="flex flex-wrap gap-3 text-xs">
                  {p.site && (
                    <a href={p.site} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                      site <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  )}
                  {p.instagram && (
                    <a href={p.instagram} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                      Instagram <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  )}
                  {p.sources.slice(0, 3).map((s, i) => (
                    <a key={s} href={s} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-muted-foreground underline">
                      fonte {i + 1} <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  ))}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {canSend && (p.status === 'NOVO' || p.status === 'LEAD') && hasMobile(p) && (
                  <Button size="sm" variant="outline" onClick={() => setCalling({ id: p.id, name: p.name })}>
                    <MessageCircleIcon aria-hidden /> Chamar no WhatsApp
                  </Button>
                )}
                {p.status === 'LEAD' && p.leadId ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/leads/${p.leadId}`}>Abrir o lead</Link>
                  </Button>
                ) : p.status === 'NOVO' && edit ? (
                  <>
                    <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ pid: p.id, action: 'lead' })}>
                      <UserPlusIcon aria-hidden /> Virar lead
                    </Button>
                    <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ pid: p.id, action: 'descartar' })}>
                      <XIcon aria-hidden /> Descartar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={async () => {
                        if (await confirm({ title: `Não contatar ${p.name}?`, description: 'A empresa (CNPJ, telefones, e-mails e site) não volta em nenhuma busca futura.', confirmLabel: 'Não contatar' })) act.mutate({ pid: p.id, action: 'nao-contatar' })
                      }}
                    >
                      <BanIcon aria-hidden /> Não contatar
                    </Button>
                  </>
                ) : (
                  <Badge variant="outline">{p.status === 'DESCARTADO' ? 'descartada' : p.status === 'NAO_CONTATAR' ? 'não contatar' : 'lead'}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
