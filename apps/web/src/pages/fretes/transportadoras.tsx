import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PlusIcon, SearchIcon, Trash2Icon, TruckIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayBr, money, num } from '@/lib/format'
import { formatCnpj, maskCep, maskCnpj, STATUS_LABEL, useFreightContext } from '@/lib/fretes'

interface Contact {
  name: string
  role: string | null
  phone: string | null
  email: string | null
}
interface Carrier {
  id: string
  cnpj: string
  legalName: string
  name: string
  quoteName: string | null
  zip: string | null
  address: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  contacts: Contact[]
  modes: string[]
  unitIds: string[]
  useReceiverAsRecipient: boolean
  externalCodes: Record<string, string>
  notes: string | null
  pickups?: PickupForm[]
  active: boolean
  tables?: number
  activeTables?: number
}
interface CarrierDetail extends Omit<Carrier, 'tables'> {
  tables: { id: string; name: string; status: string; validTo: string }[]
  stats: { quotes: number; chosen: number; chosenTotal: number; chosenAverage: number | null }
}

export function FretesTransportadorasPage() {
  return (
    <RequirePermission module="fretes_transportadoras">
      <CarrierList />
    </RequirePermission>
  )
}

function CarrierList() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [open, setOpen] = useState<Carrier | 'nova' | null>(null)
  const list = useQuery({ queryKey: ['fretes', 'transportadoras', q, status], queryFn: () => api.get<Carrier[]>(`/fretes/transportadoras?${new URLSearchParams({ ...(q ? { busca: q } : {}), ...(status !== 'all' ? { situacao: status } : {}) })}`) })
  // ?abrir=<id> (link da tela da tabela): abre a transportadora direto.
  const [params, setParams] = useSearchParams()
  const openId = params.get('abrir')
  useEffect(() => {
    if (!openId || !list.data) return
    const c = list.data.find((x) => x.id === openId)
    if (c) setOpen(c)
    setParams((p) => (p.delete('abrir'), p), { replace: true })
  }, [openId, list.data, setParams])
  return (
    <div className="space-y-4">
      <PageHeader
        title="Transportadoras"
        description="Cadastro das transportadoras parceiras, filiais atendidas, contatos e tabelas vinculadas."
        actions={
          <Can module="fretes_transportadoras" action="create">
            <Button onClick={() => setOpen('nova')}>
              <PlusIcon aria-hidden /> Nova transportadora
            </Button>
          </Can>
        }
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(search.trim())
        }}
      >
        <div className="relative min-w-60 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="CNPJ, razão social ou nome" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="inactive">Inativas</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={TruckIcon} title="Nenhuma transportadora" description="Cadastre a transportadora e depois a tabela de frete dela." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transportadora</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead className="hidden md:table-cell">Contato</TableHead>
              <TableHead>Tabelas</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpen(c)}>
                <TableCell>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.legalName}</p>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{formatCnpj(c.cnpj)}</TableCell>
                <TableCell className="hidden text-sm md:table-cell">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell className="text-sm">
                  <Link to={`/fretes/tabelas?transportadora=${c.id}`} onClick={(e) => e.stopPropagation()} className="underline-offset-2 hover:underline">
                    {c.activeTables ?? 0} vigente(s) de {c.tables ?? 0}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={c.active ? '' : 'text-muted-foreground'}>
                    {c.active ? 'Ativa' : 'Inativa'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {open && <CarrierSheet carrier={open === 'nova' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  )
}

interface PickupForm {
  unitId: string | null
  days: number[]
  cutoff: string
  pickup: string
  minutes: number
  note: string | null
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Coletas na empresa: até que horas tirar pedido (ponto de corte) e a hora da coleta, por filial e dia (painel de TV). */
function PickupsEditor({ value, onChange, units }: { value: PickupForm[]; onChange: (v: PickupForm[]) => void; units: { id: string; name: string }[] }) {
  const patch = (i: number, p: Partial<PickupForm>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>Coletas (painel de TV)</Label>
          <p className="text-xs text-muted-foreground">Até que horas o comercial pode tirar pedido para ir nesta coleta e a hora em que a transportadora chega. Aparece em Fretes › Painel de coletas (TV).</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { unitId: null, days: [1, 2, 3, 4, 5], cutoff: '15:00', pickup: '16:00', minutes: 30, note: null }])}>
          <PlusIcon aria-hidden /> Coleta
        </Button>
      </div>
      {value.map((p, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_auto]">
            <Select value={p.unitId ?? '__todas'} onValueChange={(v) => patch(i, { unitId: v === '__todas' ? null : v })}>
              <SelectTrigger aria-label="Filial da coleta" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todas">Todas as filiais</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="text-xs">
              Pedido até
              <Input type="time" value={p.cutoff} onChange={(e) => patch(i, { cutoff: e.target.value })} />
            </label>
            <label className="text-xs">
              Coleta às
              <Input type="time" value={p.pickup} onChange={(e) => patch(i, { pickup: e.target.value })} />
            </label>
            <label className="text-xs">
              Carrega (min)
              <Input type="number" min={5} max={600} value={p.minutes} onChange={(e) => patch(i, { minutes: Number(e.target.value) || 30 })} />
            </label>
            <Button type="button" size="icon" variant="ghost" className="self-end" aria-label="Remover coleta" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2Icon aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DAY_LABELS.map((d, n) => (
              <button
                key={d}
                type="button"
                aria-pressed={p.days.includes(n)}
                onClick={() => patch(i, { days: p.days.includes(n) ? p.days.filter((x) => x !== n) : [...p.days, n].sort() })}
                className={p.days.includes(n) ? 'min-h-9 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground' : 'min-h-9 rounded-full border px-3 text-xs'}
              >
                {d}
              </button>
            ))}
            <Input className="h-9 min-w-0 flex-1" placeholder="Observação (ex.: segunda coleta, só volumes pequenos)" value={p.note ?? ''} onChange={(e) => patch(i, { note: e.target.value || null })} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CarrierSheet({ carrier, onClose }: { carrier: Carrier | null; onClose: () => void }) {
  const qc = useQueryClient()
  const ctx = useFreightContext()
  const { can } = useAuth()
  const editable = carrier ? can('fretes_transportadoras', 'edit') : can('fretes_transportadoras', 'create')
  const detail = useQuery({ queryKey: ['fretes', 'transportadora', carrier?.id], queryFn: () => api.get<CarrierDetail>(`/fretes/transportadoras/${carrier!.id}`), enabled: !!carrier })
  const [f, setF] = useState(() => ({
    cnpj: carrier ? maskCnpj(carrier.cnpj) : '',
    legalName: carrier?.legalName ?? '',
    name: carrier?.name ?? '',
    quoteName: carrier?.quoteName ?? '',
    zip: carrier?.zip ? maskCep(carrier.zip) : '',
    address: carrier?.address ?? '',
    city: carrier?.city ?? '',
    state: carrier?.state ?? '',
    phone: carrier?.phone ?? '',
    email: carrier?.email ?? '',
    modes: carrier?.modes ?? ['RODOVIARIO'],
    unitIds: carrier?.unitIds ?? [],
    useReceiverAsRecipient: carrier?.useReceiverAsRecipient ?? false,
    externalCodes: Object.entries(carrier?.externalCodes ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    notes: carrier?.notes ?? '',
    active: carrier?.active ?? true,
  }))
  const [contacts, setContacts] = useState<Contact[]>(carrier?.contacts ?? [])
  const [pickups, setPickups] = useState<PickupForm[]>(carrier?.pickups ?? [])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const externalCodes = Object.fromEntries(
        f.externalCodes
          .split('\n')
          .map((l) => l.split('='))
          .filter((p) => p.length >= 2 && p[0]!.trim())
          .map(([k, ...v]) => [k!.trim(), v.join('=').trim()]),
      )
      const body = { ...f, quoteName: f.quoteName || null, zip: f.zip || null, address: f.address || null, city: f.city || null, state: f.state || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null, externalCodes, contacts: contacts.filter((c) => c.name.trim()), pickups }
      return carrier ? api.put(`/fretes/transportadoras/${carrier.id}`, body) : api.post('/fretes/transportadoras', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success('Transportadora salva.')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const tables = detail.data?.tables ?? []
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{carrier ? carrier.name : 'Nova transportadora'}</SheetTitle>
          {carrier && <SheetDescription>{formatCnpj(carrier.cnpj)}</SheetDescription>}
        </SheetHeader>
        {detail.data && (
          <div className="grid grid-cols-3 gap-2 px-4 text-center text-sm">
            <div className="rounded-md border p-2">
              <p className="text-lg font-semibold">{num(detail.data.stats.quotes)}</p>
              <p className="text-xs text-muted-foreground">cotações em que apareceu</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-lg font-semibold">{num(detail.data.stats.chosen)}</p>
              <p className="text-xs text-muted-foreground">vezes escolhida</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-lg font-semibold">{money(detail.data.stats.chosenAverage)}</p>
              <p className="text-xs text-muted-foreground">frete médio escolhido</p>
            </div>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4 px-4 pb-6">
          <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-cnpj">CNPJ *</Label>
              <Input id="c-cnpj" required value={f.cnpj} onChange={(e) => set('cnpj', maskCnpj(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-legal">Razão social *</Label>
              <Input id="c-legal" required value={f.legalName} onChange={(e) => set('legalName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Nome de exibição</Label>
              <Input id="c-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Vazio = razão social" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-quote">Nome na cotação</Label>
              <Input id="c-quote" value={f.quoteName} onChange={(e) => set('quoteName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-zip">CEP</Label>
              <Input id="c-zip" value={f.zip} onChange={(e) => set('zip', maskCep(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-addr">Endereço</Label>
              <Input id="c-addr" value={f.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-city">Cidade</Label>
              <Input id="c-city" value={f.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-uf">UF</Label>
              <Input id="c-uf" maxLength={2} className="uppercase" value={f.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Telefone</Label>
              <Input id="c-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">E-mail</Label>
              <Input id="c-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-modes">Modalidades</Label>
              <MultiSelect id="c-modes" items={(ctx.data?.catalog.modals ?? []).map((m) => ({ id: m.value, name: m.label }))} value={f.modes} onChange={(v) => set('modes', v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-units">Filiais atendidas</Label>
              <MultiSelect id="c-units" items={(ctx.data?.units ?? []).map((u) => ({ id: u.id, name: u.name, active: u.active }))} value={f.unitIds} onChange={(v) => set('unitIds', v)} placeholder="Todas as filiais" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={f.useReceiverAsRecipient} onCheckedChange={(c) => set('useReceiverAsRecipient', c === true)} /> Usar recebedor como destinatário do frete
            </label>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Contatos comerciais e operacionais</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setContacts((c) => [...c, { name: '', role: null, phone: null, email: null }])}>
                  <PlusIcon aria-hidden /> Contato
                </Button>
              </div>
              {contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                  {(['name', 'role', 'phone', 'email'] as const).map((k) => (
                    <Input key={k} aria-label={k} placeholder={{ name: 'Nome', role: 'Função', phone: 'Telefone', email: 'E-mail' }[k]} value={c[k] ?? ''} onChange={(e) => setContacts((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                  ))}
                  <Button type="button" size="icon" variant="ghost" aria-label="Remover contato" onClick={() => setContacts((p) => p.filter((_, j) => j !== i))}>
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <PickupsEditor value={pickups} onChange={setPickups} units={(ctx.data?.units ?? []).map((u) => ({ id: u.id, name: u.name }))} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-ext">Códigos nos sistemas externos (um por linha: sistema=código)</Label>
              <Textarea id="c-ext" rows={2} value={f.externalCodes} onChange={(e) => set('externalCodes', e.target.value)} placeholder={'tcar=123\nmercadolivre=ME1'} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-notes">Observações internas e negociações</Label>
              <Textarea id="c-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.active} onCheckedChange={(v) => set('active', v)} /> Ativa
            </label>
          </fieldset>
          {carrier && <RecipientFees carrierId={carrier.id} editable={can('fretes_transportadoras', 'edit')} />}
          {carrier && <CarrierRegions carrierId={carrier.id} editable={can('fretes_transportadoras', 'edit')} />}
          {tables.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Tabelas</p>
              {tables.map((t) => (
                <p key={t.id}>
                  <Link className="underline underline-offset-2" to={`/fretes/tabelas/${t.id}`}>
                    {t.name}
                  </Link>{' '}
                  · {STATUS_LABEL[t.status]} · até {dayBr(String(t.validTo).slice(0, 10))}
                </p>
              ))}
            </div>
          )}
          {editable && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
              </Button>
            </div>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}

interface RegionsInfo {
  site: { citiesUrl: string | null; citiesSyncedAt: string | null; citiesSyncError: string | null } | null
  total: number
  importedAt: string | null
  regions: { code: string; cities: number; ufs: string[]; deadlines: number[]; sample: string[] }[]
}

/** Regiões da transportadora (planilha "Regiões": código, cidades, prazo e dias de entrega). */
export function CarrierRegions({ carrierId, editable }: { carrierId: string; editable: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const info = useQuery({ queryKey: ['fretes', 'regioes', carrierId], queryFn: () => api.get<RegionsInfo>(`/fretes/transportadoras/${carrierId}/regioes`) })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('arquivo', file)
      return api.post<{ regions: number; cities: number; invalid: number }>(`/fretes/transportadoras/${carrierId}/regioes`, fd)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes', 'regioes', carrierId] })
      toast.success(`${r.regions} região(ões) com ${r.cities.toLocaleString('pt-BR')} cidade(s) importada(s)${r.invalid ? `; ${r.invalid} linha(s) sem código ou cidade reconhecível` : ''}.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const [url, setUrl] = useState<string | null>(null)
  const site = useMutation({
    mutationFn: (kind: 'salvar' | 'atualizar') =>
      kind === 'salvar'
        ? api.put<{ cities?: number; withIbge?: number }>(`/fretes/transportadoras/${carrierId}/regioes/site`, { url: url ?? '' })
        : api.post<{ cities?: number; withIbge?: number }>(`/fretes/transportadoras/${carrierId}/regioes/site/atualizar`, {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes', 'regioes', carrierId] })
      setUrl(null)
      toast.success(r.cities !== undefined ? `Lista do site lida: ${r.cities.toLocaleString('pt-BR')} cidade(s), ${(r.withIbge ?? 0).toLocaleString('pt-BR')} com código do IBGE.` : 'Endereço retirado: as cidades não serão mais buscadas no site.')
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['fretes', 'regioes', carrierId] })
      toast.error(errorMessage(e))
    },
  })
  const d = info.data
  const prazo = (list: number[]) => (!list.length ? 'sem prazo' : list.length === 1 ? `${list[0]} dia(s)` : `${list[0]} a ${list[list.length - 1]} dias`)
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p className="font-medium">Regiões (bases de entrega) e prazos</p>
      <p className="text-xs text-muted-foreground">
        Planilha Regiões da transportadora: o código da região, que é a base (unidade) da transportadora que faz a entrega (PR1, SC3…), as cidades que ela atende pelo código do IBGE e o prazo. Na tabela de preço, a coluna Região vira uma regra por cidade, com o prazo da região quando a tabela não traz.
      </p>
      {d && (
        <p>
          {d.total ? `${d.regions.length} região(ões), ${d.total.toLocaleString('pt-BR')} cidade(s)` : 'Nenhuma região importada.'}
          {d.importedAt && <span className="text-xs text-muted-foreground"> (importadas em {new Date(d.importedAt).toLocaleDateString('pt-BR')})</span>}
          {d.total > 0 && (
            <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={() => setOpen((o) => !o)}>
              {open ? 'Esconder' : 'Ver regiões'}
            </Button>
          )}
        </p>
      )}
      {open && d && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs">
          {d.regions.map((r) => (
            <li key={r.code}>
              <span className="font-semibold">{r.code}</span> · {r.cities} cidade(s) ({r.ufs.join(', ')}) · {prazo(r.deadlines)} · {r.sample.join(', ')}
              {r.cities > r.sample.length ? '…' : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5 border-t pt-2">
        <p className="text-xs text-muted-foreground">
          Lista do site da transportadora (relida todo dia): o endereço do arquivo de cidades atendidas, como o “Baixar cidades atendidas” do site. O código do IBGE de cada cidade é completado pelo nome e pela UF.
        </p>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-[1_1_16rem]" aria-label="Endereço da lista de cidades no site" placeholder="https://… (vazio = não buscar no site)" value={url ?? d?.site?.citiesUrl ?? ''} onChange={(e) => setUrl(e.target.value)} />
            <Button type="button" size="sm" variant="outline" disabled={site.isPending || url === null} onClick={() => site.mutate('salvar')}>
              Salvar e buscar
            </Button>
            {d?.site?.citiesUrl && (
              <Button type="button" size="sm" disabled={site.isPending} onClick={() => site.mutate('atualizar')}>
                {site.isPending && <Loader2Icon className="size-4 animate-spin" aria-hidden />} Buscar do site agora
              </Button>
            )}
          </div>
        ) : (
          d?.site?.citiesUrl && <p className="truncate text-xs">{d.site.citiesUrl}</p>
        )}
        {d?.site?.citiesSyncedAt && (
          <p className={d.site.citiesSyncError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {d.site.citiesSyncError ? `Última tentativa em ${new Date(d.site.citiesSyncedAt).toLocaleString('pt-BR')}: ${d.site.citiesSyncError}` : `Lida do site em ${new Date(d.site.citiesSyncedAt).toLocaleString('pt-BR')}.`}
          </p>
        )}
      </div>
      {editable && (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm underline underline-offset-2">
          {upload.isPending && <Loader2Icon className="size-4 animate-spin" aria-hidden />} Importar regiões ou lista de cidades (substitui as atuais)
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,.xls,.csv,.html"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) upload.mutate(f)
            }}
          />
        </label>
      )}
    </div>
  )
}

interface FeesInfo {
  counts: Record<string, number>
  total: number
  importedAt: string | null
  matches: { code: string; fixed: number; percent: number | null; city: string | null; uf: string | null }[]
}

/** Listas de TDA/TDE/TDC/TVD que a transportadora cobra só de destinatários específicos. */
export function RecipientFees({ carrierId, editable }: { carrierId: string; editable: boolean }) {
  const qc = useQueryClient()
  const [doc, setDoc] = useState('')
  const [checked, setChecked] = useState('')
  const info = useQuery({ queryKey: ['fretes', 'taxas', carrierId, checked], queryFn: () => api.get<FeesInfo>(`/fretes/transportadoras/${carrierId}/taxas${checked ? `?documento=${checked}` : ''}`) })
  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData()
      for (const f of files) fd.append('arquivo', f)
      return api.post<{ total: number; invalid: number; sheets: string[] }>(`/fretes/transportadoras/${carrierId}/taxas`, fd)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes', 'taxas', carrierId] })
      toast.success(`${r.total.toLocaleString('pt-BR')} destinatário(s) importado(s) de ${r.sheets.join(', ')}${r.invalid ? `; ${r.invalid} linha(s) sem documento ou taxa reconhecível` : ''}.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = info.data
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p className="font-medium">Taxas por destinatário (TDA, TDE, TDC, TVD)</p>
      <p className="text-xs text-muted-foreground">
        Listas que a transportadora manda com os clientes que pagam taxa extra. Na cotação, a taxa entra quando o CPF/CNPJ do destinatário está na lista. Só o documento, a cidade e a taxa são guardados.
      </p>
      {d && (
        <p>
          {d.total ? `${d.total.toLocaleString('pt-BR')} destinatário(s): ${Object.entries(d.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n.toLocaleString('pt-BR')}`).join(' · ')}` : 'Nenhuma lista importada.'}
          {d.importedAt && <span className="text-xs text-muted-foreground"> (importada em {new Date(d.importedAt).toLocaleDateString('pt-BR')})</span>}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setChecked(doc.replace(/\D/g, ''))
        }}
      >
        <Input aria-label="CPF ou CNPJ para conferir" placeholder="Conferir um CPF/CNPJ" value={doc} onChange={(e) => setDoc(e.target.value)} />
        <Button type="submit" variant="outline" size="sm">
          Conferir
        </Button>
      </form>
      {checked && d && (d.matches.length ? d.matches.map((m) => <p key={m.code}>{m.code}: {money(m.fixed)}{m.percent ? ` ou ${m.percent}% do frete (o maior)` : ''} · {m.city}/{m.uf}</p>) : <p className="text-muted-foreground">Não está nas listas.</p>)}
      {editable && (
        <p className="text-xs text-muted-foreground">Arquivos “Planilha Restrições” (colunas CNPJ, CPF, TIPO VALOR, VALOR e VALOR MINIMO) também valem: a taxa vem do nome do arquivo (…_TDE.xlsx). Cada lista enviada substitui só a mesma lista que já existia.</p>
      )}
      {editable && (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm underline underline-offset-2">
          {upload.isPending && <Loader2Icon className="size-4 animate-spin" aria-hidden />} Importar listas (um Excel com as abas TDA, TDE, TDC e TVD, ou um arquivo por taxa, até 8 de uma vez)
          <input
            type="file"
            multiple
            className="sr-only"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) upload.mutate(files)
            }}
          />
        </label>
      )}
    </div>
  )
}

