import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, FileClockIcon, Loader2Icon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { AuditRow } from '@/lib/types'

/** Tradução das ações registradas para leitura humana. Ações novas aparecem com o código original. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.login_recovery_code': 'Entrou com código de recuperação',
  'auth.login_failed': 'Tentativa de login falhou',
  'auth.account_locked': 'Conta bloqueada por tentativas',
  'auth.logout': 'Saiu do sistema',
  'auth.refresh_reuse_detected': 'Reuso de sessão detectado (sessão encerrada)',
  'auth.password_reset_requested': 'Pediu recuperação de senha',
  'auth.password_reset': 'Redefiniu a senha pelo link',
  'auth.2fa_enabled': 'Ativou o 2FA',
  'auth.2fa_disabled': 'Desativou o 2FA',
  'me.password_changed': 'Trocou a própria senha',
  'me.profile_updated': 'Atualizou o próprio perfil',
  'user.created': 'Criou usuário',
  'user.updated': 'Alterou usuário',
  'user.unlocked': 'Desbloqueou usuário',
  'user.2fa_reset': 'Zerou o 2FA de usuário',
  'user.password_link_sent': 'Enviou link de senha',
  'role.created': 'Criou perfil de acesso',
  'role.updated': 'Alterou perfil de acesso',
  'role.deleted': 'Excluiu perfil de acesso',
  'settings.branding_updated': 'Alterou a identidade visual',
  'settings.branding_image_updated': 'Enviou imagem da marca',
  'settings.branding_image_removed': 'Removeu imagem da marca',
  'settings.smtp_updated': 'Alterou o servidor de e-mail',
  'settings.smtp_test_sent': 'Enviou e-mail de teste',
}

const SECURITY_ACTIONS = new Set(['auth.login_failed', 'auth.account_locked', 'auth.refresh_reuse_detected', 'user.2fa_reset', 'auth.2fa_disabled'])

interface Page {
  total: number
  page: number
  pageSize: number
  items: AuditRow[]
}

export function AuditPage() {
  return (
    <RequirePermission module="auditoria">
      <AuditContent />
    </RequirePermission>
  )
}

function AuditContent() {
  const [user, setUser] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<AuditRow | null>(null)
  const [filters, setFilters] = useState({ user: '', action: '', from: '', to: '' })

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters({ user: user.trim(), action: action.trim(), from, to })
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [user, action, from, to])

  const params = new URLSearchParams({ page: String(page), pageSize: '50' })
  if (filters.user) params.set('user', filters.user)
  if (filters.action) params.set('action', filters.action)
  // Datas do filtro são dias inteiros no fuso de São Paulo.
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00:00-03:00`).toISOString())
  if (filters.to) params.set('to', new Date(`${filters.to}T23:59:59-03:00`).toISOString())

  const query = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api.get<Page>(`/audit?${params}`), placeholderData: keepPreviousData })
  const verify = useMutation({ mutationFn: () => api.get<{ ok: boolean; checked: number; brokenAtId: string | null }>('/audit/verify') })

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro imutável de quem fez o quê, quando e de onde. Os registros não podem ser alterados nem apagados."
        actions={
          <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
            Verificar integridade
          </Button>
        }
      />

      {verify.data && (
        <p
          role="status"
          className={`mb-4 flex items-center gap-2 rounded-md border p-3 text-sm ${verify.data.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-destructive/40 bg-destructive/10'}`}
        >
          {verify.data.ok ? <ShieldCheckIcon className="size-4 text-emerald-600" /> : <ShieldAlertIcon className="size-4 text-destructive" />}
          {verify.data.ok
            ? `Integridade confirmada: ${verify.data.checked} registros verificados, nenhuma alteração encontrada.`
            : `Atenção: a cadeia de registros foi quebrada a partir do registro #${verify.data.brokenAtId}. Houve alteração direta no banco.`}
        </p>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="a-user" className="text-xs">Usuário (e-mail)</Label>
          <Input id="a-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="nome@empresa.com.br" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-action" className="text-xs">Ação (código)</Label>
          <Input id="a-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="ex.: auth.login" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-from" className="text-xs">De</Label>
          <Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-to" className="text-xs">Até</Label>
          <Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {query.isLoading && <TableSkeleton />}
      {query.error && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState icon={FileClockIcon} title="Nenhum registro no período" />}

      {!!query.data?.items.length && (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Data e hora</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead className="hidden md:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{r.userEmail ?? '—'}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-sm">
                      {SECURITY_ACTIONS.has(r.action) && (
                        <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                          Segurança
                        </Badge>
                      )}
                      {ACTION_LABELS[r.action] ?? r.action}
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{r.ip ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {query.data.total} registro(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Próxima página">
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail && (ACTION_LABELS[detail.action] ?? detail.action)}</DialogTitle>
            <DialogDescription>Registro #{detail?.id}</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Data e hora</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
              <dt className="text-muted-foreground">Usuário</dt>
              <dd className="break-all">{detail.userEmail ?? '—'}</dd>
              <dt className="text-muted-foreground">Código da ação</dt>
              <dd className="font-mono text-xs">{detail.action}</dd>
              <dt className="text-muted-foreground">Objeto</dt>
              <dd className="break-all">{detail.entity ? `${detail.entity} ${detail.entityId ?? ''}` : '—'}</dd>
              <dt className="text-muted-foreground">IP</dt>
              <dd className="font-mono text-xs">{detail.ip ?? '—'}</dd>
              <dt className="text-muted-foreground">Navegador</dt>
              <dd className="text-xs break-all">{detail.userAgent ?? '—'}</dd>
              {detail.data && (
                <>
                  <dt className="text-muted-foreground">Detalhes</dt>
                  <dd>
                    <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(detail.data, null, 2)}</pre>
                  </dd>
                </>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
