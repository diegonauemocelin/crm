import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, Loader2Icon, LockOpenIcon, MailIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, PowerIcon, SearchIcon, ShieldOffIcon, UsersIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { UserAvatar } from '@/components/layout/user-menu'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
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
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import type { UserRow } from '@/lib/types'
import { FormError } from './auth/auth-layout'

type Confirm = { title: string; description: string; label: string; run: () => Promise<unknown> } | null

export function UsersPage() {
  return (
    <RequirePermission module="usuarios">
      <UsersContent />
    </RequirePermission>
  )
}

function UsersContent() {
  const qc = useQueryClient()
  const { me, can } = useAuth()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const params = new URLSearchParams()
  if (debounced) params.set('search', debounced)
  if (status !== 'all') params.set('status', status)
  const users = useQuery({ queryKey: ['users', debounced, status], queryFn: () => api.get<UserRow[]>(`/users?${params}`) })

  const action = useMutation({
    mutationFn: (c: NonNullable<Confirm>) => c.run(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      setConfirm(null)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const ask = (title: string, description: string, label: string, run: () => Promise<unknown>, success: string) =>
    setConfirm({ title, description, label, run: async () => (await run(), toast.success(success)) })

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Quem acessa o sistema e com qual perfil. Usuários não são apagados: são desativados, preservando o histórico."
        actions={
          <Can module="usuarios" action="create">
            <Button onClick={() => setEditing('new')}>
              <PlusIcon />
              Novo usuário
            </Button>
          </Can>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" aria-label="Buscar usuários" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="sm:w-40" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {users.isLoading && <TableSkeleton />}
      {users.error && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
      {users.data?.length === 0 && <EmptyState icon={UsersIcon} title="Nenhum usuário encontrado" description="Ajuste a busca ou o filtro." />}

      {!!users.data?.length && (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead className="hidden md:table-cell">2FA</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="hidden lg:table-cell">Último acesso</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((u) => (
                <TableRow key={u.id} className={u.active ? undefined : 'opacity-60'}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} url={u.avatarUrl} className="size-8 rounded-full" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {u.name} {u.id === me?.id && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{u.role.name}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{u.unit?.name ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {u.totpEnabled ? <Badge variant="secondary">Ativo</Badge> : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {u.locked ? (
                      <Badge variant="destructive">Bloqueado</Badge>
                    ) : u.active ? (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell>
                    {can('usuarios', 'edit') && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações para ${u.name}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(u)}>
                            <PencilIcon /> Editar
                          </DropdownMenuItem>
                          {u.locked && (
                            <DropdownMenuItem
                              onSelect={() => ask('Desbloquear usuário?', `${u.name} poderá tentar entrar novamente.`, 'Desbloquear', () => api.post(`/users/${u.id}/unlock`), 'Usuário desbloqueado.')}
                            >
                              <LockOpenIcon /> Desbloquear
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() =>
                              ask(
                                'Enviar link de senha?',
                                `${u.name} receberá por e-mail um link (válido por 72 h) para criar uma nova senha.`,
                                'Enviar',
                                () => api.post(`/users/${u.id}/send-password-link`),
                                'Link enviado.',
                              )
                            }
                          >
                            <MailIcon /> Enviar link de senha
                          </DropdownMenuItem>
                          {u.totpEnabled && (
                            <DropdownMenuItem
                              onSelect={() =>
                                ask(
                                  'Zerar o 2FA?',
                                  `Use quando ${u.name} perder o celular. As sessões abertas serão encerradas e o 2FA precisará ser configurado de novo.`,
                                  'Zerar 2FA',
                                  () => api.post(`/users/${u.id}/reset-2fa`),
                                  '2FA zerado.',
                                )
                              }
                            >
                              <ShieldOffIcon /> Zerar 2FA
                            </DropdownMenuItem>
                          )}
                          {u.id !== me?.id && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant={u.active ? 'destructive' : 'default'}
                                onSelect={() =>
                                  ask(
                                    u.active ? 'Desativar usuário?' : 'Reativar usuário?',
                                    u.active
                                      ? `${u.name} perde o acesso imediatamente e as sessões abertas são encerradas. O histórico é mantido.`
                                      : `${u.name} volta a ter acesso com o perfil ${u.role.name}.`,
                                    u.active ? 'Desativar' : 'Reativar',
                                    () => api.patch(`/users/${u.id}`, { active: !u.active }),
                                    u.active ? 'Usuário desativado.' : 'Usuário reativado.',
                                  )
                                }
                              >
                                <PowerIcon /> {u.active ? 'Desativar' : 'Reativar'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={action.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (confirm) action.mutate(confirm)
              }}
            >
              {action.isPending && <Loader2Icon className="animate-spin" />}
              {confirm?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function UserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const roles = useQuery({ queryKey: ['role-options'], queryFn: () => api.get<{ id: string; name: string }[]>('/roles/options') })
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [roleId, setRoleId] = useState(user?.role.id ?? '')
  const [unitId, setUnitId] = useState<string | null>(user?.unit?.id ?? null)
  const options = useOptions()
  const [sendInvite, setSendInvite] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { name, email, roleId, unitId })
        : api.post('/users', { name, email, roleId, unitId, sendInvite, ...(sendInvite ? {} : { password }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(user ? 'Usuário atualizado.' : sendInvite ? 'Usuário criado e convite enviado por e-mail.' : 'Usuário criado.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  const isSelf = user?.id === me?.id

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{user ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
            <DialogDescription>
              {user ? 'Altere os dados de acesso.' : 'O usuário recebe um convite por e-mail ou entra com uma senha provisória.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="u-name">Nome</Label>
            <Input id="u-name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-email">E-mail</Label>
            <Input id="u-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-role">Perfil de acesso</Label>
            <Select value={roleId} onValueChange={setRoleId} disabled={isSelf}>
              <SelectTrigger id="u-role" className="w-full">
                <SelectValue placeholder={roles.isLoading ? 'Carregando…' : 'Selecione'} />
              </SelectTrigger>
              <SelectContent>
                {roles.data?.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground">Você não pode trocar o próprio perfil.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-unit">Unidade</Label>
            <Select value={unitId ?? '__none__'} onValueChange={(v) => setUnitId(v === '__none__' ? null : v)}>
              <SelectTrigger id="u-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem unidade</SelectItem>
                {options.data?.units.filter((u) => u.active || u.id === unitId).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Usada nos perfis com acesso “somente da unidade”.</p>
          </div>
          {!user && (
            <div className="space-y-3 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={sendInvite} onCheckedChange={(c) => setSendInvite(c === true)} className="mt-0.5" />
                <span>
                  Enviar convite por e-mail
                  <span className="block text-xs text-muted-foreground">O usuário cria a própria senha pelo link (exige o e-mail configurado em Configurações).</span>
                </span>
              </label>
              {!sendInvite && (
                <div className="space-y-2">
                  <Label htmlFor="u-pass">Senha provisória</Label>
                  <Input id="u-pass" type="text" autoComplete="off" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <KeyRoundIcon className="size-3" /> Mínimo de 12 caracteres. A troca é obrigatória no primeiro acesso.
                  </p>
                </div>
              )}
            </div>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !name || !email || !roleId}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
