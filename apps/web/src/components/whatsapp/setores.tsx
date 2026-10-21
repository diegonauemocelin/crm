import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { MultiSelect } from '@/components/multi-select'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Visibility = 'PROPRIAS' | 'SETOR'

interface Sector {
  id: string
  name: string
  description: string | null
  numberIds: string[]
  userIds: string[]
  managerIds: string[]
  visibility: Visibility
}

interface Data {
  sectors: Sector[]
  users: { id: string; name: string; managerIds: string[] }[]
  numbers: { id: string; name: string; phone: string | null; splitAttendance: boolean }[]
}

const VISIBILITY: Record<Visibility, { label: string; help: string }> = {
  PROPRIAS: { label: 'Cada atendente vê só as conversas dele', help: 'Mais a fila do setor (clientes ainda sem atendente). As conversas não se misturam entre os atendentes.' },
  SETOR: { label: 'Todo o setor vê as conversas do setor', help: 'Caixa compartilhada: qualquer atendente do setor vê e responde as conversas do setor.' },
}

const KEY = ['whatsapp-setores']

/**
 * Setores de atendimento da empresa: em que números atendem, quem atende, quem gerencia e o que cada um vê.
 * E os gestores de cada pessoa: quem acompanha (monitora, só leitura) as conversas dela.
 */
export function SectorsSettings() {
  const { can } = useAuth()
  const editable = can('whatsapp', 'edit')
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<Data>('/whatsapp/setores') })
  const [editing, setEditing] = useState<Sector | 'novo' | null>(null)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  const d = q.data
  const name = (id: string) => d.users.find((u) => u.id === id)?.name ?? 'pessoa removida'
  const numberName = (id: string) => d.numbers.find((n) => n.id === id)?.name ?? 'número removido'
  const splitNumbers = d.numbers.filter((n) => n.splitAttendance)
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold">Setores</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Ex.: Vendas, Pós-venda, Financeiro. A conversa transferida para um setor vai para a fila dele; os atendentes do setor assumem. Vale nos números com “atendimento dividido” ligado ({splitNumbers.length ? splitNumbers.map((n) => n.name).join(', ') : 'nenhum ainda: ligue em Números de WhatsApp'}).
            </p>
          </div>
          {editable && (
            <Button onClick={() => setEditing('novo')}>
              <PlusIcon /> Novo setor
            </Button>
          )}
        </div>
        {d.sectors.length === 0 ? (
          <EmptyState icon={UsersIcon} title="Nenhum setor ainda" description="Crie os setores da empresa e escolha quem atende e quem gerencia cada um." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {d.sectors.map((s) => (
              <Card key={s.id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    {s.name}
                    {editable && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        <PencilIcon /> Editar
                      </Button>
                    )}
                  </CardTitle>
                  {s.description && <CardDescription>{s.description}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-1.5 px-4 text-sm">
                  <p>
                    <span className="text-muted-foreground">Números: </span>
                    {s.numberIds.length ? s.numberIds.map(numberName).join(', ') : 'todos com atendimento dividido'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Atendentes: </span>
                    {s.userIds.length ? s.userIds.map(name).join(', ') : <span className="text-amber-700 dark:text-amber-400">ninguém ainda</span>}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Gestores: </span>
                    {s.managerIds.length ? s.managerIds.map(name).join(', ') : '—'}
                  </p>
                  <Badge variant="outline" className="font-normal">
                    <EyeIcon className="size-3" /> {VISIBILITY[s.visibility].label}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <ManagersTable data={d} editable={editable} />

      {editing && <SectorDialog sector={editing === 'novo' ? null : editing} data={d} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SectorDialog({ sector, data, onClose }: { sector: Sector | null; data: Data; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => ({
    name: sector?.name ?? '',
    description: sector?.description ?? '',
    numberIds: sector?.numberIds ?? [],
    userIds: sector?.userIds ?? [],
    managerIds: sector?.managerIds ?? [],
    visibility: sector?.visibility ?? ('PROPRIAS' as Visibility),
  }))
  const [initial] = useState(f)
  const confirm = useConfirm()
  const guard = useCloseGuard(isDirty(initial, f), onClose, 'o setor')
  const canSave = f.name.trim().length >= 2
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: KEY })
    void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    toast.success(msg)
    onClose()
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, name: f.name.trim(), description: f.description.trim() || null }
      return sector ? api.put(`/whatsapp/setores/${sector.id}`, body) : api.post('/whatsapp/setores', body)
    },
    onSuccess: () => done(sector ? 'Setor atualizado.' : 'Setor criado.'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/whatsapp/setores/${sector!.id}`),
    onSuccess: () => done('Setor excluído. As conversas na fila dele voltaram para a fila geral.'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const people = data.users.map((u) => ({ id: u.id, name: u.name }))
  const askRemove = async () => {
    if (await confirm({ title: `Excluir o setor “${sector!.name}”?`, description: 'As conversas na fila dele voltam para a fila geral. Não dá para desfazer.', confirmLabel: 'Excluir setor' })) remove.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sector ? `Setor ${sector.name}` : 'Novo setor'}</DialogTitle>
          <DialogDescription>Quem atende, quem gerencia e o que cada um vê das conversas do setor.</DialogDescription>
        </DialogHeader>
        <form
          id="sector-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave && !save.isPending) save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sec-name" required>Nome</Label>
            <Input id="sec-name" maxLength={40} placeholder="Ex.: Vendas" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            {!canSave && <p className="text-xs text-muted-foreground">Mínimo 2 caracteres.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-desc">Descrição (opcional)</Label>
            <Input id="sec-desc" maxLength={200} placeholder="Ex.: orçamentos e pedidos de peças" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-numbers">Números em que atende</Label>
            <MultiSelect id="sec-numbers" items={data.numbers.map((n) => ({ id: n.id, name: n.splitAttendance ? n.name : `${n.name} (sem atendimento dividido)` }))} value={f.numberIds} onChange={(numberIds) => setF({ ...f, numberIds })} placeholder="Todos os números" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-users">Atendentes</Label>
            <MultiSelect id="sec-users" items={people} value={f.userIds} onChange={(userIds) => setF({ ...f, userIds })} placeholder="Quem atende neste setor" />
            <p className="text-xs text-muted-foreground">Recebem a fila do setor e passam a atender nos números dele.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-managers">Gestores</Label>
            <MultiSelect id="sec-managers" items={people} value={f.managerIds} onChange={(managerIds) => setF({ ...f, managerIds })} placeholder="Quem acompanha o setor" />
            <p className="text-xs text-muted-foreground">Acompanham (só leitura, em “Monitorar equipe” no chat) todas as conversas do setor e de quem atende nele.</p>
          </div>
          <div className="space-y-2">
            <Label>O que os atendentes veem</Label>
            <RadioGroup value={f.visibility} onValueChange={(v) => setF({ ...f, visibility: v as Visibility })}>
              {(Object.keys(VISIBILITY) as Visibility[]).map((v) => (
                <label key={v} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[[data-state=checked]]:border-[color:var(--brand)]">
                  <RadioGroupItem value={v} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{VISIBILITY[v].label}</span>
                    <span className="block text-xs text-muted-foreground">{VISIBILITY[v].help}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {sector ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => void askRemove()} disabled={remove.isPending}>
              {remove.isPending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Excluir setor
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" form="sector-form" disabled={save.isPending || !canSave}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Gestores de cada pessoa: quem acompanha as conversas dela (além dos gestores dos setores). */
function ManagersTable({ data, editable }: { data: Data; editable: boolean }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (d: { userId: string; managerIds: string[] }) => api.put(`/whatsapp/setores/gestores/${d.userId}`, { managerIds: d.managerIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      toast.success('Gestores atualizados.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const sectorsOf = (userId: string) => data.sectors.filter((s) => s.userIds.includes(userId)).map((s) => s.name)
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Gestores de cada pessoa</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ligue cada vendedor ou atendente a um ou mais gestores. O gestor acompanha as conversas da equipe dele em Chat WhatsApp › Monitorar equipe (só leitura, sem marcar como lida), mesmo sem a permissão de monitorar todas as conversas.
        </p>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead className="hidden md:table-cell">Setores</TableHead>
              <TableHead className="w-[45%]">Gestores</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{sectorsOf(u.id).join(', ') || '—'}</TableCell>
                <TableCell>
                  <MultiSelect
                    id={`mgr-${u.id}`}
                    items={data.users.filter((x) => x.id !== u.id).map((x) => ({ id: x.id, name: x.name }))}
                    value={u.managerIds}
                    onChange={(managerIds) => save.mutate({ userId: u.id, managerIds })}
                    placeholder="Sem gestor"
                    disabled={!editable || save.isPending}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}
