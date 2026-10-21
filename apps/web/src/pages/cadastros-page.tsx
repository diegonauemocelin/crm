import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CombineIcon, FileSpreadsheetIcon, Loader2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { isDirty, useCloseGuard } from '@/components/confirm'
import { ImportDialog } from '@/components/atendimento/import-dialog'
import { MultiSelect } from '@/components/multi-select'
import { Can, EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, type Kind, UF_LIST, UF_NAMES, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import type { UserRow } from '@/lib/types'
import { FormError } from './auth/auth-layout'

const LISTS = [
  { type: 'origem', title: 'Origens', single: 'origem' },
  { type: 'tipo-cliente', title: 'Tipos de cliente', single: 'tipo de cliente' },
  { type: 'marca', title: 'Marcas da máquina', single: 'marca' },
  { type: 'tipo-peca', title: 'Tipos de peça', single: 'tipo de peça' },
  { type: 'motivo-perda', title: 'Motivos de perda', single: 'motivo' },
] as const

interface LookupRow {
  id: string
  name: string
  active: boolean
  usage: number
}

interface SellerRow {
  id: string
  name: string
  unitId: string | null
  unit: { id: string; name: string } | null
  email: string | null
  phone: string | null
  active: boolean
  usage: number
  userId: string | null
  user: { id: string; name: string; email: string } | null
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['cadastros'] })
  void qc.invalidateQueries({ queryKey: ['atendimento-options'] })
}

export function LookupTab({ type, title, single }: { type: string; title: string; single: string }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['cadastros', type], queryFn: () => api.get<LookupRow[]>(`/cadastros/listas/${type}`) })
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<LookupRow | null>(null)

  const create = useMutation({
    mutationFn: () => api.post(`/cadastros/listas/${type}`, { name: newName.trim() }),
    onSuccess: () => {
      setNewName('')
      invalidateAll(qc)
      toast.success('Item incluído.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; active?: boolean } }) => api.patch(`/cadastros/listas/item/${id}`, data),
    onSuccess: () => {
      setEditing(null)
      invalidateAll(qc)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (q.isLoading) return <TableSkeleton rows={5} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Ao desativar, o item some das opções de novos atendimentos, mas continua nos registros antigos e nos relatórios.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Can module="cadastros" action="create">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) create.mutate()
            }}
          >
            <Input placeholder={`Incluir ${single}…`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} aria-label={`Incluir ${single}`} />
            <Button type="submit" disabled={create.isPending || !newName.trim()}>
              <PlusIcon /> Incluir
            </Button>
          </form>
        </Can>
        {q.data?.length === 0 && <EmptyState title="Lista vazia" />}
        <ul className="divide-y rounded-md border">
          {q.data?.map((i) => (
            <li key={i.id} className={`flex items-center gap-3 px-3 py-2 ${i.active ? '' : 'opacity-60'}`}>
              <span className="flex-1 truncate">{i.name}</span>
              {!i.active && <Badge variant="outline">Inativo</Badge>}
              <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">{int.format(i.usage)} atendimento(s)</span>
              {can('cadastros', 'edit') && (
                <>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(i)} aria-label={`Renomear ${i.name}`}>
                    <PencilIcon />
                  </Button>
                  <Switch checked={i.active} onCheckedChange={(c) => update.mutate({ id: i.id, data: { active: c } })} aria-label={`${i.active ? 'Desativar' : 'Ativar'} ${i.name}`} />
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      {editing && (
        <RenameDialog
          name={editing.name}
          busy={update.isPending}
          onClose={() => setEditing(null)}
          onSave={(name) => update.mutate({ id: editing.id, data: { name } })}
        />
      )}
    </Card>
  )
}

function RenameDialog({ name, busy, onClose, onSave }: { name: string; busy: boolean; onClose: () => void; onSave: (n: string) => void }) {
  const [value, setValue] = useState(name)
  const guard = useCloseGuard(value.trim() !== name.trim(), onClose, 'o novo nome')
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) onSave(value.trim())
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Renomear</DialogTitle>
            <DialogDescription>O novo nome aparece em todos os atendimentos que já usam este item.</DialogDescription>
          </DialogHeader>
          <Input value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Nome" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SellersTab() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['cadastros', 'vendedores'], queryFn: () => api.get<SellerRow[]>('/cadastros/vendedores') })
  const [editing, setEditing] = useState<SellerRow | 'new' | null>(null)
  const [merging, setMerging] = useState<SellerRow | null>(null)

  if (q.isLoading) return <TableSkeleton rows={5} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Vendedores</CardTitle>
          <CardDescription className="mt-1.5">
            Vincule o vendedor a um usuário com perfil Vendedor para que ele veja somente os próprios atendimentos.
          </CardDescription>
        </div>
        <Can module="cadastros" action="create">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon /> Novo vendedor
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Nome</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Acesso ao sistema</TableHead>
              <TableHead className="text-right">Atendimentos</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24 pr-6">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data?.map((s) => (
              <TableRow key={s.id} className={s.active ? undefined : 'opacity-60'}>
                <TableCell className="pl-6 font-medium">{s.name}</TableCell>
                <TableCell className="text-sm">{s.unit?.name ?? <span className="text-amber-700 dark:text-amber-400">Sem unidade</span>}</TableCell>
                <TableCell className="text-sm">{s.user ? s.user.email : <span className="text-muted-foreground">Sem login</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{int.format(s.usage)}</TableCell>
                <TableCell>{s.active ? <Badge variant="outline">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                <TableCell className="pr-6">
                  {can('cadastros', 'edit') && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(s)} aria-label={`Editar vendedor ${s.name}`}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setMerging(s)} aria-label={`Mesclar ${s.name} com outro vendedor`}>
                        <CombineIcon />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {editing && <SellerDialog seller={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {merging && q.data && (
        <MergeDialog
          source={merging}
          sellers={q.data.filter((s) => s.id !== merging.id)}
          onClose={() => setMerging(null)}
          onDone={() => {
            setMerging(null)
            invalidateAll(qc)
            void qc.invalidateQueries({ queryKey: ['atendimentos'] })
          }}
        />
      )}
    </Card>
  )
}

const NONE = '__none__'

function SellerDialog({ seller, onClose }: { seller: SellerRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users', '', 'active'], queryFn: () => api.get<UserRow[]>('/users?status=active') })
  const [name, setName] = useState(seller?.name ?? '')
  const [unitId, setUnitId] = useState<string | null>(seller?.unitId ?? null)
  const options = useOptions()
  const [email, setEmail] = useState(seller?.email ?? '')
  const [phone, setPhone] = useState(seller?.phone ?? '')
  const [userId, setUserId] = useState<string | null>(seller?.userId ?? null)
  const [active, setActive] = useState(seller?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [initial] = useState(() => ({ name, unitId, email, phone, userId, active }))
  const guard = useCloseGuard(isDirty(initial, { name, unitId, email, phone, userId, active }), onClose, 'os dados do vendedor')

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const body = { name, unitId, email: email || null, phone: phone || null, userId, active }
      return seller ? api.put(`/cadastros/vendedores/${seller.id}`, body) : api.post('/cadastros/vendedores', body)
    },
    onSuccess: (r) => {
      invalidateAll(qc)
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      const n = (r as { backfilled?: number }).backfilled ?? 0
      toast.success(seller ? (n ? `Vendedor atualizado. ${int.format(n)} atendimento(s) dele passaram a ser da unidade.` : 'Vendedor atualizado.') : 'Vendedor incluído.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{seller ? 'Editar vendedor' : 'Novo vendedor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="s-name" required>Nome</Label>
            <Input id="s-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-unit">Unidade</Label>
              <Select value={unitId ?? NONE} onValueChange={(v) => setUnitId(v === NONE ? null : v)}>
                <SelectTrigger id="s-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem unidade</SelectItem>
                  {options.data?.units.filter((u) => u.active || u.id === unitId).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-phone">Telefone</Label>
              <Input id="s-phone" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-email">E-mail</Label>
            <Input id="s-email" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-user">Usuário do sistema (opcional)</Label>
            <Select value={userId ?? NONE} onValueChange={(v) => setUserId(v === NONE ? null : v)}>
              <SelectTrigger id="s-user" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem login</SelectItem>
                {users.data?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Crie antes o usuário em Usuários, com o perfil Vendedor.</p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Vendedor ativo
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <FormError message={error} />
          {name.trim().length < 2 && <p className="text-right text-xs text-muted-foreground">Informe o nome (mínimo 2 caracteres).</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
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

function MergeDialog({ source, sellers, onClose, onDone }: { source: SellerRow; sellers: SellerRow[]; onClose: () => void; onDone: () => void }) {
  const [targetId, setTargetId] = useState<string>('')
  const merge = useMutation({
    mutationFn: () => api.post<{ moved: number }>(`/cadastros/vendedores/${source.id}/mesclar`, { targetId }),
    onSuccess: (r) => {
      toast.success(`${int.format(r.moved)} atendimento(s) transferido(s). "${source.name}" foi desativado.`)
      onDone()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mesclar "{source.name}"</DialogTitle>
          <DialogDescription>
            Use quando o mesmo vendedor aparece com dois nomes. Os {int.format(source.usage)} atendimento(s) de "{source.name}" passam para o vendedor escolhido, e "{source.name}" é desativado.
          </DialogDescription>
        </DialogHeader>
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger className="w-full" aria-label="Vendedor de destino">
            <SelectValue placeholder="Escolha o vendedor de destino" />
          </SelectTrigger>
          <SelectContent>
            {sellers.filter((s) => s.active).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => merge.mutate()} disabled={!targetId || merge.isPending}>
            {merge.isPending && <Loader2Icon className="animate-spin" />}
            Mesclar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface UnitRow {
  id: string
  name: string
  city: string | null
  state: string | null
  isHeadquarters: boolean
  active: boolean
  sellers: number
  users: number
  records: number
}

export function UnitsTab() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['cadastros', 'unidades'], queryFn: () => api.get<UnitRow[]>('/cadastros/unidades') })
  const [editing, setEditing] = useState<UnitRow | 'new' | null>(null)

  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Unidades</CardTitle>
          <CardDescription className="mt-1.5">
            Matriz e filiais. Vendedores, usuários e atendimentos são vinculados a uma unidade, e os relatórios podem ser filtrados por ela.
          </CardDescription>
        </div>
        <Can module="cadastros" action="create">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon /> Nova unidade
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Unidade</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead className="text-right">Vendedores</TableHead>
              <TableHead className="text-right">Usuários</TableHead>
              <TableHead className="text-right">Atendimentos</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-16 pr-6">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data?.map((u) => (
              <TableRow key={u.id} className={u.active ? undefined : 'opacity-60'}>
                <TableCell className="pl-6 font-medium">
                  {u.name} {u.isHeadquarters && <Badge variant="secondary" className="ml-1">Matriz</Badge>}
                </TableCell>
                <TableCell className="text-sm">{[u.city, u.state].filter(Boolean).join('/') || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{int.format(u.sellers)}</TableCell>
                <TableCell className="text-right tabular-nums">{int.format(u.users)}</TableCell>
                <TableCell className="text-right tabular-nums">{int.format(u.records)}</TableCell>
                <TableCell>{u.active ? <Badge variant="outline">Ativa</Badge> : <Badge variant="secondary">Inativa</Badge>}</TableCell>
                <TableCell className="pr-6">
                  {can('cadastros', 'edit') && (
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(u)} aria-label={`Editar unidade ${u.name}`}>
                      <PencilIcon />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {editing && <UnitDialog unit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function UnitDialog({ unit, onClose }: { unit: UnitRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(unit?.name ?? '')
  const [city, setCity] = useState(unit?.city ?? '')
  const [state, setState] = useState<string | null>(unit?.state ?? null)
  const [hq, setHq] = useState(unit?.isHeadquarters ?? false)
  const [active, setActive] = useState(unit?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [initial] = useState(() => ({ name, city, state, hq, active }))
  const guard = useCloseGuard(isDirty(initial, { name, city, state, hq, active }), onClose, 'os dados da unidade')

  const save = useMutation({
    mutationFn: () => {
      const body = { name, city: city || null, state, isHeadquarters: hq, active }
      return unit ? api.put(`/cadastros/unidades/${unit.id}`, body) : api.post('/cadastros/unidades', body)
    },
    onSuccess: () => {
      invalidateAll(qc)
      toast.success(unit ? 'Unidade atualizada.' : 'Unidade incluída.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{unit ? 'Editar unidade' : 'Nova unidade'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="u-name" required>Nome</Label>
            <Input id="u-name" required minLength={2} maxLength={80} placeholder="Ex.: Filial Cascavel" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-2">
              <Label htmlFor="u-city">Cidade</Label>
              <Input id="u-city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-state">Estado</Label>
              <Select value={state ?? NONE} onValueChange={(v) => setState(v === NONE ? null : v)}>
                <SelectTrigger id="u-state" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {UF_LIST.map((uf) => (
                    <SelectItem key={uf} value={uf}>
                      {uf} — {UF_NAMES[uf]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            É a matriz
            <Switch checked={hq} onCheckedChange={setHq} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Unidade ativa
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <FormError message={error} />
          {name.trim().length < 2 && <p className="text-right text-xs text-muted-foreground">Informe o nome (mínimo 2 caracteres).</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
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

interface AlertConfig {
  alertHours: number
  newRecordMinutes?: number
  postSaleHours: number
  postSaleOwnerId: string | null
  postSaleOwnerByUnit: Record<string, string>
  callHours?: number
  nextDayMessage?: NextDayMessage
  sellerDigest?: SellerDigest
}

interface SellerDigest extends NextDayMessage {
  split: boolean
  allSellers: boolean
  sellerIds: string[]
}

interface NextDayMessage {
  enabled: boolean
  time: string
  text: string
  numberId: string | null
  /** Só a mensagem do dia seguinte: só repassadas ao vendedor e as situações da venda que recebem. */
  onlyForwarded?: boolean
  saleStatuses?: SaleKey[]
  numberIds?: string[]
  withoutChat?: boolean
  gapMin?: number
  gapMax?: number
}

type SaleKey = 'NEGOCIACAO' | 'SIM' | 'NAO'
const SALE_OPTIONS: { key: SaleKey; label: string }[] = [
  { key: 'NEGOCIACAO', label: 'Em negociação' },
  { key: 'SIM', label: 'Venda realizada' },
  { key: 'NAO', label: 'Venda não realizada' },
]

/** Prazos e avisos do atendimento, ou as mensagens automáticas de WhatsApp (dia seguinte e resumo dos vendedores). */
export function AlertsTab({ only }: { only?: 'prazos' | 'mensagens' }) {
  const q = useQuery({ queryKey: ['cadastros', 'alertas'], queryFn: () => api.get<AlertConfig>('/cadastros/alertas') })
  if (q.isLoading || !q.data) return <TableSkeleton rows={2} />
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {only !== 'mensagens' && (
        <>
          <NewRecordAlertCard config={q.data} />
          <ReturnAlertCard config={q.data} />
          <CallAlertCard config={q.data} />
          <PostSaleCard config={q.data} />
        </>
      )}
      {only !== 'prazos' && (
        <>
          <NextDayMessageCard config={q.data} />
          <SellerDigestCard config={q.data} />
        </>
      )}
    </div>
  )
}

/** Listas auxiliares do atendimento (origens, tipos de cliente, marcas, tipos de peça, motivos de perda). */
export function ListsTab() {
  return (
    <Tabs defaultValue={LISTS[0].type}>
      <TabsList className="mb-4 flex h-auto flex-wrap">
        {LISTS.map((l) => (
          <TabsTrigger key={l.type} value={l.type}>
            {l.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {LISTS.map((l) => (
        <TabsContent key={l.type} value={l.type}>
          <LookupTab type={l.type} title={l.title} single={l.single} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function useSaveAlerts(message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: AlertConfig) => api.put<AlertConfig>('/cadastros/alertas', { ...c }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cadastros', 'alertas'] })
      void qc.invalidateQueries({ queryKey: ['atendimento-alertas'] })
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      toast.success(message)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

const NO_OWNER = '__none__'

/** Pré-venda com resultado gera o pós-venda: aqui se define quem recebe e o prazo do primeiro contato. */
export function PostSaleCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const options = useOptions()
  const canEdit = can('cadastros', 'edit')
  const [hours, setHours] = useState(config.postSaleHours)
  const [owner, setOwner] = useState<string | null>(config.postSaleOwnerId)
  const [byUnit, setByUnit] = useState<Record<string, string>>(config.postSaleOwnerByUnit)
  const save = useSaveAlerts('Pós-venda salvo.')
  const sellers = (options.data?.sellers ?? []).filter((s) => s.active)
  const units = (options.data?.units ?? []).filter((u) => u.active)
  const pick = (id: string, value: string | null, onChange: (v: string | null) => void, empty: string) => (
    <Select value={value ?? NO_OWNER} onValueChange={(v) => onChange(v === NO_OWNER ? null : v)} disabled={!canEdit}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_OWNER}>{empty}</SelectItem>
        {sellers.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pós-venda automático</CardTitle>
        <CardDescription>
          Quando a pré-venda é marcada como “Vendeu” ou “Perdida”, o cliente entra no Pós-Vendas para outra pessoa acompanhar. Ela precisa registrar o contato (com observação) dentro do prazo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ps-hours">Prazo para o primeiro contato (horas)</Label>
          <Input id="ps-hours" type="number" min={1} max={720} className="w-28" value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!canEdit} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ps-owner">Responsável padrão</Label>
          {pick('ps-owner', owner, setOwner, 'Sem responsável (fila do pós-venda)')}
        </div>
        {units.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Responsável por unidade (opcional)</p>
            <p className="text-xs text-muted-foreground">Vale para a unidade da pré-venda. Sem responsável na unidade, usa o padrão.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {units.map((u) => (
                <div key={u.id} className="space-y-1">
                  <Label htmlFor={`ps-unit-${u.id}`} className="text-xs text-muted-foreground">
                    {u.name}
                  </Label>
                  {pick(
                    `ps-unit-${u.id}`,
                    byUnit[u.id] ?? null,
                    (v) =>
                      setByUnit((m) => {
                        const n = { ...m }
                        if (v) n[u.id] = v
                        else delete n[u.id]
                        return n
                      }),
                    'Usar o padrão',
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      {canEdit && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, postSaleHours: hours, postSaleOwnerId: owner, postSaleOwnerByUnit: byUnit })} disabled={save.isPending || !(hours >= 1 && hours <= 720)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function NewRecordAlertCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const [minutes, setMinutes] = useState<number | null>(null)
  const save = useSaveAlerts('Prazo da pré-venda nova salvo.')
  const value = minutes ?? config.newRecordMinutes ?? 10
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Aviso de pré-venda nova</CardTitle>
        <CardDescription>
          Toda pré-venda que entra (formulário, botão de WhatsApp, chat) avisa na hora quem atende, com som e notificação. Se ninguém mexer nela neste prazo, ela fica em vermelho como “aguardando atendimento” e entra no sino.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="new-minutes">Prazo para o primeiro atendimento (minutos)</Label>
        <div className="mt-2 flex items-center gap-2">
          <Input id="new-minutes" type="number" min={1} max={1440} className="w-28" value={value} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!can('cadastros', 'edit')} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Conta como atendida quando alguém altera a pré-venda ou responde o cliente pelo chat do CRM.</p>
      </CardContent>
      {can('cadastros', 'edit') && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, newRecordMinutes: value })} disabled={save.isPending || !(value >= 1 && value <= 1440)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function ReturnAlertCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const [hours, setHours] = useState<number | null>(null)
  const save = useSaveAlerts('Prazo do alerta salvo.')
  const value = hours ?? config.alertHours
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Alerta de retorno do vendedor</CardTitle>
        <CardDescription>
          Atendimentos repassados ao vendedor e ainda “Pendentes” depois deste prazo ficam destacados na lista, entram no filtro “Sem retorno” e aparecem no sino, com o nome e o telefone do vendedor para o Pré-Vendas ligar e conferir se ele falou com o cliente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="alert-hours">Prazo (horas)</Label>
        <div className="mt-2 flex items-center gap-2">
          <Input id="alert-hours" type="number" min={1} max={720} className="w-28" value={value} onChange={(e) => setHours(Number(e.target.value))} disabled={!can('cadastros', 'edit')} />
          <span className="text-sm text-muted-foreground">{value >= 24 ? `= ${(value / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia(s)` : ''}</span>
        </div>
      </CardContent>
      {can('cadastros', 'edit') && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, alertHours: value })} disabled={save.isPending || !(value >= 1 && value <= 720)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

/** Pré-venda em negociação: prazo para chamar o cliente, renovado a cada "Chamei o cliente". */
export function CallAlertCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const [hours, setHours] = useState<number | null>(null)
  const save = useSaveAlerts('Prazo para chamar o cliente salvo.')
  const value = hours ?? config.callHours ?? 24
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Prazo para chamar o cliente (em negociação)</CardTitle>
        <CardDescription>
          Toda pré-venda repassada ao vendedor e ainda “Em negociação” ganha o prazo “Chamar o cliente até”. Passou do prazo, avisa quem atende (sino, som e notificação) e a pré-venda entra no filtro “Chamar cliente”. Ao clicar em “Chamei o cliente” (ou responder pelo chat do CRM), o prazo recomeça.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="call-hours">Prazo (horas)</Label>
        <div className="mt-2 flex items-center gap-2">
          <Input id="call-hours" type="number" min={1} max={720} className="w-28" value={value} onChange={(e) => setHours(Number(e.target.value))} disabled={!can('cadastros', 'edit')} />
          <span className="text-sm text-muted-foreground">{value >= 24 ? `= ${(value / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia(s)` : ''}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">O novo prazo vale para os próximos repasses e contatos. Na ficha dá para escolher outra data (ex.: o cliente pediu retorno na segunda).</p>
      </CardContent>
      {can('cadastros', 'edit') && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, callHours: value })} disabled={save.isPending || !(value >= 1 && value <= 720)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

const FIRST_CONNECTED = '__first__'

/** Mensagem de WhatsApp enviada sozinha no dia seguinte para quem abriu pré-venda. */
export function NextDayMessageCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const canEdit = can('cadastros', 'edit')
  const saved = config.nextDayMessage ?? { enabled: false, time: '09:00', text: '', numberId: null }
  const initial = { onlyForwarded: true, saleStatuses: SALE_OPTIONS.map((o) => o.key), withoutChat: false, gapMin: 3, gapMax: 20, ...saved, numberIds: saved.numberIds ?? (saved.numberId ? [saved.numberId] : []) }
  const [m, setM] = useState<NextDayMessage>(initial)
  const statuses = m.saleStatuses ?? []
  const chosen = m.numberIds ?? []
  const gapOk = [m.gapMin, m.gapMax].every((v) => Number.isInteger(v) && v! >= 1 && v! <= 120) && m.gapMin! <= m.gapMax!
  const numbers = useQuery({ queryKey: ['cadastros', 'alertas', 'numeros'], queryFn: () => api.get<{ id: string; name: string; phone: string | null; status: string }[]>('/cadastros/alertas/numeros') })
  const save = useSaveAlerts(m.enabled ? 'Mensagem do dia seguinte ligada.' : 'Mensagem do dia seguinte salva (desligada).')
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) && m.text.trim().length > 0 && m.text.length <= 1000 && statuses.length > 0 && chosen.length > 0 && gapOk
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Mensagem automática no dia seguinte</CardTitle>
        <CardDescription>
          Todo dia, a partir do horário escolhido, o sistema manda esta mensagem pelo WhatsApp para os clientes da pré-venda do dia anterior que seguem as regras abaixo. Vai uma vez só. Fica registrada na conversa e no histórico da pré-venda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Enviar a mensagem
          <Switch checked={m.enabled} onCheckedChange={(enabled) => setM({ ...m, enabled })} disabled={!canEdit} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nd-time">A partir de (horário de Brasília)</Label>
            <Input id="nd-time" type="time" className="w-32" value={m.time} onChange={(e) => setM({ ...m, time: e.target.value })} disabled={!canEdit} />
          </div>
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Para quem vai</p>
          <div className="space-y-1.5">
            <p className="text-sm">Atendimentos destes números de WhatsApp</p>
            <div className="flex flex-col gap-2">
              {(numbers.data ?? []).map((n) => (
                <label key={n.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={chosen.includes(n.id)}
                    onCheckedChange={(on) => setM({ ...m, numberIds: on ? [...chosen, n.id] : chosen.filter((x) => x !== n.id) })}
                    disabled={!canEdit}
                  />
                  {n.name}
                  {n.status !== 'CONECTADO' && <span className="text-xs text-muted-foreground">(desconectado)</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">A mensagem sai pelo mesmo número em que o cliente foi atendido. Atendimento de número não marcado (ex.: e-commerce) não recebe.</p>
            {!chosen.length && <p className="text-xs text-destructive">Marque ao menos um número.</p>}
          </div>
          <label className="flex items-start justify-between gap-3 text-sm">
            <span>
              Também para quem não chamou por WhatsApp
              <span className="block text-xs text-muted-foreground">Cliente que veio de formulário, sem conversa no chat.</span>
            </span>
            <Switch checked={m.withoutChat === true} onCheckedChange={(withoutChat) => setM({ ...m, withoutChat })} disabled={!canEdit} />
          </label>
          {m.withoutChat && (
          <div className="space-y-2 pl-1">
            <Label htmlFor="nd-number">Número que envia para quem não chamou por WhatsApp</Label>
            <Select value={m.numberId ?? FIRST_CONNECTED} onValueChange={(v) => setM({ ...m, numberId: v === FIRST_CONNECTED ? null : v })} disabled={!canEdit}>
              <SelectTrigger id="nd-number" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIRST_CONNECTED}>O primeiro dos números marcados</SelectItem>
                {(numbers.data ?? []).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                    {n.status !== 'CONECTADO' && ' (desconectado)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          <label className="flex items-start justify-between gap-3 text-sm">
            <span>
              Só pré-venda com <strong>Repassou ao vendedor</strong>
              <span className="block text-xs text-muted-foreground">Sai no dia seguinte ao repasse. Desligado: no dia seguinte ao contato, repassada ou não.</span>
            </span>
            <Switch checked={m.onlyForwarded !== false} onCheckedChange={(onlyForwarded) => setM({ ...m, onlyForwarded })} disabled={!canEdit} />
          </label>
          <div className="space-y-1.5">
            <p className="text-sm">Situação da venda</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {SALE_OPTIONS.map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={statuses.includes(o.key)}
                    onCheckedChange={(on) => setM({ ...m, saleStatuses: on ? SALE_OPTIONS.map((x) => x.key).filter((k) => k === o.key || statuses.includes(k)) : statuses.filter((k) => k !== o.key) })}
                    disabled={!canEdit}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            {!statuses.length && <p className="text-xs text-destructive">Marque ao menos uma situação.</p>}
          </div>
          <p className="text-xs text-muted-foreground">Conversa finalizada ou arquivada nunca recebe: fica anotado na pré-venda que não foi enviada.</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Intervalo entre as mensagens</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            de
            <Input aria-label="Intervalo mínimo (minutos)" type="number" min={1} max={120} className="w-20" value={m.gapMin ?? ''} onChange={(e) => setM({ ...m, gapMin: e.target.value === '' ? undefined : Number(e.target.value) })} disabled={!canEdit} />
            a
            <Input aria-label="Intervalo máximo (minutos)" type="number" min={1} max={120} className="w-20" value={m.gapMax ?? ''} onChange={(e) => setM({ ...m, gapMax: e.target.value === '' ? undefined : Number(e.target.value) })} disabled={!canEdit} />
            minutos
          </div>
          <p className="text-xs text-muted-foreground">Cada número manda uma mensagem por vez, com uma espera sorteada nesse intervalo até a próxima, para o WhatsApp não bloquear o número. Ex.: 3 a 20 minutos dá umas 4 por hora; o que não sair até a meia-noite não é mais enviado.</p>
          {!gapOk && <p className="text-xs text-destructive">Use de 1 a 120 minutos, com o mínimo menor ou igual ao máximo.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="nd-text">Mensagem</Label>
          <Textarea id="nd-text" rows={5} maxLength={1000} value={m.text} onChange={(e) => setM({ ...m, text: e.target.value })} disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">
            Use {'{nome}'} para o primeiro nome do cliente e {'{vendedor}'} para o primeiro nome do vendedor da pré-venda. Não vai para pré-vendas importadas da planilha nem sem telefone. Se nenhum número estiver conectado, espera reconectar (no mesmo dia).
          </p>
        </div>
      </CardContent>
      {canEdit && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, nextDayMessage: { ...m, text: m.text.trim() } })} disabled={save.isPending || !valid}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

/** Resumo do dia para cada vendedor: os clientes da pré-venda repassados a ele, pelo WhatsApp, a partir das 18h. */
export function SellerDigestCard({ config }: { config: AlertConfig }) {
  const { can } = useAuth()
  const sellerRows = useQuery({ queryKey: ['cadastros', 'vendedores'], queryFn: () => api.get<SellerRow[]>('/cadastros/vendedores') })
  const canEdit = can('cadastros', 'edit')
  const initial = config.sellerDigest ?? { enabled: false, time: '18:00', text: '', numberId: null, split: true, allSellers: true, sellerIds: [] }
  const [d, setD] = useState<SellerDigest>(initial)
  const numbers = useQuery({ queryKey: ['cadastros', 'alertas', 'numeros'], queryFn: () => api.get<{ id: string; name: string; phone: string | null; status: string }[]>('/cadastros/alertas/numeros') })
  const save = useSaveAlerts(d.enabled ? 'Resumo do dia para os vendedores ligado.' : 'Resumo do dia salvo (desligado).')
  const sellers = (sellerRows.data ?? []).filter((s) => s.active || d.sellerIds.includes(s.id))
  const noPhone = sellers.filter((s) => !s.phone && (d.allSellers || d.sellerIds.includes(s.id)))
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) && d.text.trim().length > 0 && (d.allSellers || d.sellerIds.length > 0)
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Resumo do dia para os vendedores</CardTitle>
        <CardDescription>
          Todo dia, a partir do horário escolhido, cada vendedor recebe no WhatsApp dele os clientes da pré-venda repassados a ele naquele dia (telefone e nome), em vez de copiar e colar um por um. Quem não teve repasse no dia não recebe nada. O mesmo resumo fica em Pré-Vendas › Resumo do dia, para copiar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Enviar o resumo
          <Switch checked={d.enabled} onCheckedChange={(enabled) => setD({ ...d, enabled })} disabled={!canEdit} />
        </label>
        <div className="space-y-2">
          <Label>Para quem</Label>
          <Select value={d.allSellers ? 'todos' : 'escolhidos'} onValueChange={(v) => setD({ ...d, allSellers: v === 'todos' })} disabled={!canEdit}>
            <SelectTrigger className="w-full" aria-label="Para quem">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              <SelectItem value="escolhidos">Só os vendedores escolhidos</SelectItem>
            </SelectContent>
          </Select>
          {!d.allSellers && <MultiSelect id="dg-sellers" items={sellers} value={d.sellerIds} onChange={(sellerIds) => setD({ ...d, sellerIds })} placeholder="Escolha os vendedores" disabled={!canEdit} />}
          {noPhone.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Sem telefone no cadastro (não recebem): {noPhone.map((s) => s.name).join(', ')}. Preencha em Configurações › Vendedores.
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dg-time">A partir de (horário de Brasília)</Label>
            <Input id="dg-time" type="time" className="w-32" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} disabled={!canEdit} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dg-number">Número que envia</Label>
            <Select value={d.numberId ?? FIRST_CONNECTED} onValueChange={(v) => setD({ ...d, numberId: v === FIRST_CONNECTED ? null : v })} disabled={!canEdit}>
              <SelectTrigger id="dg-number" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIRST_CONNECTED}>O primeiro número conectado</SelectItem>
                {(numbers.data ?? []).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                    {n.status !== 'CONECTADO' && ' (desconectado)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Um cliente por mensagem
            <span className="block text-xs text-muted-foreground">Como hoje, colando um número por vez: cada telefone fica clicável. Desligado, vai uma lista só.</span>
          </span>
          <Switch checked={d.split} onCheckedChange={(split) => setD({ ...d, split })} disabled={!canEdit} />
        </label>
        <div className="space-y-2">
          <Label htmlFor="dg-text">Abertura da mensagem</Label>
          <Textarea id="dg-text" rows={3} maxLength={1000} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">Use {'{vendedor}'}, {'{data}'} e {'{quantidade}'}. Os clientes (telefone e nome) vêm logo depois, sozinhos.</p>
        </div>
      </CardContent>
      {canEdit && (
        <CardFooter>
          <Button onClick={() => save.mutate({ ...config, sellerDigest: { ...d, text: d.text.trim() } })} disabled={save.isPending || !valid}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function ImportTab() {
  const [kind, setKind] = useState<Kind | null>(null)
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Importar planilha de atendimentos</CardTitle>
        <CardDescription>
          Importe a planilha atual (Google Planilhas ou CSV) quantas vezes precisar: o sistema reconhece as linhas já importadas e só traz as novas. Antes de gravar, mostra um resumo para conferência.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-wrap gap-2">
        <Button onClick={() => setKind('PRE_VENDAS')}>
          <FileSpreadsheetIcon /> Importar para Pré-Vendas
        </Button>
        <Button variant="outline" onClick={() => setKind('POS_VENDAS')}>
          <FileSpreadsheetIcon /> Importar para Pós-Vendas
        </Button>
      </CardFooter>
      {kind && <ImportDialog kind={kind} onClose={() => setKind(null)} />}
    </Card>
  )
}
