import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PlusIcon, SearchIcon, Trash2Icon, TruckIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
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
      const body = { ...f, quoteName: f.quoteName || null, zip: f.zip || null, address: f.address || null, city: f.city || null, state: f.state || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null, externalCodes, contacts: contacts.filter((c) => c.name.trim()) }
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
