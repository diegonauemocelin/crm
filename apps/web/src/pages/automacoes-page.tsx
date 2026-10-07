import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BotIcon, Loader2Icon, MailIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type AutomationListItem, TRIGGER_LABEL } from '@/lib/automacoes'

export function AutomacoesPage() {
  return (
    <RequirePermission module="automacoes">
      <AutomationList />
    </RequirePermission>
  )
}

function AutomationList() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const q = useQuery({ queryKey: ['automacoes'], queryFn: () => api.get<AutomationListItem[]>('/automacoes'), refetchInterval: 30_000 })
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/automacoes', { name: name.trim() }),
    onSuccess: (r) => navigate(`/automacoes/${r.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => api.post(`/automacoes/${v.id}/situacao`, { active: v.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automacoes'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <>
      <PageHeader
        title="Automações"
        description="Fluxos que rodam sozinhos: o lead entra por um gatilho e segue os passos que você montar (esperas, condições, e-mails, tags, avisos)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/email-marketing?aba=modelos">
                <MailIcon /> Modelos de e-mail
              </Link>
            </Button>
            {can('automacoes', 'create') && (
              <Button onClick={() => setOpen(true)}>
                <PlusIcon /> Novo fluxo
              </Button>
            )}
          </div>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={4} />
      ) : !q.data.length ? (
        <EmptyState
          icon={BotIcon}
          title="Nenhum fluxo ainda"
          description="Exemplo: carrinho abandonado → esperar 2 horas → se ainda não comprou, enviar e-mail com cupom → esperar 2 dias → se não abriu, criar atendimento no Pré-Vendas."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Fluxo</TableHead>
                <TableHead>Gatilho</TableHead>
                <TableHead className="text-right">Passos</TableHead>
                <TableHead className="text-right">No fluxo agora</TableHead>
                <TableHead className="text-right">Já entraram</TableHead>
                <TableHead className="pr-4">Ligado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-4">
                    <Link to={`/automacoes/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{a.activatedAt && a.active ? `Ligado desde ${formatDateTime(a.activatedAt)}` : `Atualizado em ${formatDateTime(a.updatedAt)}`}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{TRIGGER_LABEL[a.trigger.type] ?? a.trigger.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.stepCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(a.running)}</TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(a.entered)}</TableCell>
                  <TableCell className="pr-4">
                    <Switch checked={a.active} disabled={!can('automacoes', 'edit') || toggle.isPending} onCheckedChange={(active) => toggle.mutate({ id: a.id, active })} aria-label={`Ligar ${a.name}`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate()
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Novo fluxo</DialogTitle>
              <DialogDescription>Dê um nome; o gatilho e os passos você monta na próxima tela. O fluxo começa desligado.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="a-name">Nome</Label>
              <Input id="a-name" autoFocus minLength={2} maxLength={120} placeholder="Ex.: Recuperar carrinho abandonado" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending || name.trim().length < 2}>
                {create.isPending && <Loader2Icon className="animate-spin" />}
                Criar e montar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
