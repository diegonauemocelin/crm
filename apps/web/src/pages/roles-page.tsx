import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, LockIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, Fragment, useState } from 'react'
import { toast } from 'sonner'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import type { ModuleDef, PermissionEntry, RoleRow } from '@/lib/types'
import { FormError } from './auth/auth-layout'

const ACTIONS = [
  { key: 'view', label: 'Ver' },
  { key: 'create', label: 'Criar' },
  { key: 'edit', label: 'Editar' },
  { key: 'delete', label: 'Excluir' },
  { key: 'export', label: 'Exportar' },
] as const
type ActionKey = (typeof ACTIONS)[number]['key']

const EMPTY: PermissionEntry = { view: false, create: false, edit: false, delete: false, export: false, scope: 'ALL' }

/** Módulos em que faz sentido restringir a "somente os próprios registros". */
const SCOPED_MODULES = new Set(['leads', 'pre_vendas', 'pos_vendas', 'chat'])

export function RolesPage() {
  return (
    <RequirePermission module="perfis">
      <RolesContent />
    </RequirePermission>
  )
}

function RolesContent() {
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') })
  const modules = useQuery({ queryKey: ['modules'], queryFn: () => api.get<ModuleDef[]>('/roles/modules'), staleTime: Infinity })
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [removing, setRemoving] = useState<RoleRow | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Perfil excluído.')
      setRemoving(null)
    },
    onError: (err) => {
      toast.error(errorMessage(err))
      setRemoving(null)
    },
  })

  const moduleLabel = (key: string) => modules.data?.find((m) => m.key === key)?.label ?? key

  return (
    <>
      <PageHeader
        title="Perfis de acesso"
        description="Defina o que cada perfil pode ver e fazer em cada módulo. As permissões valem imediatamente para todos os usuários do perfil."
        actions={
          <Can module="perfis" action="create">
            <Button onClick={() => setEditing('new')}>
              <PlusIcon />
              Novo perfil
            </Button>
          </Can>
        }
      />
      {roles.isLoading && <TableSkeleton rows={4} />}
      {roles.error && <ErrorState error={roles.error} onRetry={() => roles.refetch()} />}
      {roles.data?.length === 0 && <EmptyState icon={ShieldCheckIcon} title="Nenhum perfil cadastrado" />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.data?.map((r) => {
          const allowed = r.permissions.filter((p) => p.view)
          return (
            <Card key={r.id} className={r.active ? undefined : 'opacity-60'}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {r.name}
                  {r.isSystem && (
                    <Badge variant="secondary" className="gap-1">
                      <LockIcon className="size-3" /> Sistema
                    </Badge>
                  )}
                  {!r.active && <Badge variant="outline">Inativo</Badge>}
                  {r.require2fa && <Badge variant="outline">2FA obrigatório</Badge>}
                </CardTitle>
                <CardDescription>{r.description || 'Sem descrição.'}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-sm">
                <p className="mb-2 text-muted-foreground">
                  {r.userCount} usuário(s) · {r.isSystem ? 'acesso total' : `${allowed.length} módulo(s) liberado(s)`}
                </p>
                {!r.isSystem && (
                  <div className="flex flex-wrap gap-1">
                    {allowed.slice(0, 8).map((p) => (
                      <Badge key={p.module} variant="outline" className="font-normal">
                        {moduleLabel(p.module)}
                      </Badge>
                    ))}
                    {allowed.length > 8 && <Badge variant="outline">+{allowed.length - 8}</Badge>}
                  </div>
                )}
              </CardContent>
              {!r.isSystem && (
                <CardFooter className="gap-2">
                  <Can module="perfis" action="edit">
                    <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                      <PencilIcon /> Editar
                    </Button>
                  </Can>
                  <Can module="perfis" action="delete">
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(r)} aria-label={`Excluir perfil ${r.name}`}>
                      <Trash2Icon />
                    </Button>
                  </Can>
                </CardFooter>
              )}
            </Card>
          )
        })}
      </div>

      {editing && modules.data && <RoleDialog role={editing === 'new' ? null : editing} modules={modules.data} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o perfil {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só é possível excluir perfis sem usuários. Se quiser apenas impedir novos usos, desative o perfil na edição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (removing) remove.mutate(removing.id)
              }}
            >
              {remove.isPending && <Loader2Icon className="animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RoleDialog({ role, modules, onClose }: { role: RoleRow | null; modules: ModuleDef[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [require2fa, setRequire2fa] = useState(role?.require2fa ?? false)
  const [active, setActive] = useState(role?.active ?? true)
  const [perms, setPerms] = useState<Record<string, PermissionEntry>>(() =>
    Object.fromEntries(modules.map((m) => [m.key, { ...EMPTY, ...role?.permissions.find((p) => p.module === m.key) }])),
  )
  const [error, setError] = useState<string | null>(null)

  const toggle = (module: string, action: ActionKey, value: boolean) =>
    setPerms((prev) => {
      const current = { ...prev[module]!, [action]: value }
      // Sem "ver" não há como usar as demais ações; marcar qualquer ação marca "ver".
      if (action === 'view' && !value) Object.assign(current, { create: false, edit: false, delete: false, export: false })
      if (action !== 'view' && value) current.view = true
      return { ...prev, [module]: current }
    })

  const setRow = (module: string, value: boolean) =>
    setPerms((prev) => ({ ...prev, [module]: { ...prev[module]!, view: value, create: value, edit: value, delete: value, export: value } }))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description: description || undefined,
        require2fa,
        active,
        permissions: Object.entries(perms)
          .filter(([, p]) => p.view)
          .map(([module, p]) => ({ module, ...p })),
      }
      return role ? api.put(`/roles/${role.id}`, body) : api.post('/roles', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['roles'] })
      void qc.invalidateQueries({ queryKey: ['role-options'] })
      toast.success(role ? 'Perfil atualizado.' : 'Perfil criado.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const groups = [...new Set(modules.map((m) => m.group))]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-4xl">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>{role ? `Editar perfil: ${role.name}` : 'Novo perfil de acesso'}</DialogTitle>
            <DialogDescription>Marque, módulo por módulo, o que este perfil pode fazer.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="r-name">Nome</Label>
              <Input id="r-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-3 sm:pt-6">
              <label className="flex items-center justify-between gap-3 text-sm">
                Exigir autenticação em dois fatores (2FA)
                <Switch checked={require2fa} onCheckedChange={setRequire2fa} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Perfil ativo
                <Switch checked={active} onCheckedChange={setActive} />
              </label>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="r-desc">Descrição</Label>
              <Textarea id="r-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Módulo</TableHead>
                  {ACTIONS.map((a) => (
                    <TableHead key={a.key} className="w-16 text-center">
                      {a.label}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-40">Registros visíveis</TableHead>
                  <TableHead className="w-16 text-center">Tudo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <Fragment key={group}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={ACTIONS.length + 3} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                      </TableCell>
                    </TableRow>
                    {modules
                      .filter((m) => m.group === group)
                      .map((m) => {
                        const p = perms[m.key]!
                        const all = ACTIONS.every((a) => p[a.key])
                        return (
                          <TableRow key={m.key}>
                            <TableCell className="font-medium">{m.label}</TableCell>
                            {ACTIONS.map((a) => (
                              <TableCell key={a.key} className="text-center">
                                <Checkbox
                                  checked={p[a.key]}
                                  onCheckedChange={(c) => toggle(m.key, a.key, c === true)}
                                  aria-label={`${a.label} em ${m.label}`}
                                />
                              </TableCell>
                            ))}
                            <TableCell>
                              {SCOPED_MODULES.has(m.key) ? (
                                <Select
                                  value={p.scope}
                                  onValueChange={(v) => setPerms((prev) => ({ ...prev, [m.key]: { ...prev[m.key]!, scope: v as 'OWN' | 'UNIT' | 'ALL' } }))}
                                  disabled={!p.view}
                                >
                                  <SelectTrigger size="sm" className="w-full" aria-label={`Registros visíveis em ${m.label}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ALL">Todos</SelectItem>
                                    <SelectItem value="UNIT">Somente da unidade</SelectItem>
                                    <SelectItem value="OWN">Somente os próprios</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-xs text-muted-foreground">Todos</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox checked={all} onCheckedChange={(c) => setRow(m.key, c === true)} aria-label={`Todas as ações em ${m.label}`} />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar perfil
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
