import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CombineIcon, FileSpreadsheetIcon, Loader2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { ImportDialog } from '@/components/atendimento/import-dialog'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export function CadastrosPage() {
  const { me } = useAuth()
  return (
    <RequirePermission module="cadastros">
      <PageHeader
        title="Cadastros de atendimento"
        description="Vendedores e listas usadas em Pré-Vendas e Pós-Vendas. Itens são desativados, nunca apagados, para não perder o histórico."
      />
      <Tabs defaultValue="unidades">
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="unidades">Unidades</TabsTrigger>
          <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
          {LISTS.map((l) => (
            <TabsTrigger key={l.type} value={l.type}>
              {l.title}
            </TabsTrigger>
          ))}
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
          {me?.role.isSystem && <TabsTrigger value="importar">Importar</TabsTrigger>}
        </TabsList>
        <TabsContent value="unidades">
          <UnitsTab />
        </TabsContent>
        <TabsContent value="vendedores">
          <SellersTab />
        </TabsContent>
        {LISTS.map((l) => (
          <TabsContent key={l.type} value={l.type}>
            <LookupTab type={l.type} title={l.title} single={l.single} />
          </TabsContent>
        ))}
        <TabsContent value="alertas">
          <AlertsTab />
        </TabsContent>
        {me?.role.isSystem && (
          <TabsContent value="importar">
            <ImportTab />
          </TabsContent>
        )}
      </Tabs>
    </RequirePermission>
  )
}

function LookupTab({ type, title, single }: { type: string; title: string; single: string }) {
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
            <Button type="button" variant="outline" onClick={onClose}>
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

function SellersTab() {
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
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
            <Label htmlFor="s-name">Nome</Label>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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

function UnitsTab() {
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
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
            <Label htmlFor="u-name">Nome</Label>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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

function AlertsTab() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['cadastros', 'alertas'], queryFn: () => api.get<{ alertHours: number }>('/cadastros/alertas') })
  const [hours, setHours] = useState<number | null>(null)
  const save = useMutation({
    mutationFn: (h: number) => api.put('/cadastros/alertas', { alertHours: h }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cadastros', 'alertas'] })
      void qc.invalidateQueries({ queryKey: ['atendimento-alertas'] })
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      toast.success('Prazo do alerta salvo.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.isLoading || !q.data) return <TableSkeleton rows={2} />
  const value = hours ?? q.data.alertHours
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Alerta de retorno do vendedor</CardTitle>
        <CardDescription>
          Atendimentos repassados ao vendedor e ainda “Pendentes” depois deste prazo ficam destacados na lista, entram no filtro “Sem retorno” e aparecem no sino de notificações.
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
          <Button onClick={() => save.mutate(value)} disabled={save.isPending || !(value >= 1 && value <= 720)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function ImportTab() {
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
