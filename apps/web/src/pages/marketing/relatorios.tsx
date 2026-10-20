import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClockIcon, EyeIcon, Loader2Icon, MailIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useMktOptions } from '@/lib/marketing'

type Frequency = 'diario' | 'semanal' | 'mensal'
interface Schedule {
  id: string
  name: string
  active: boolean
  emails: string[]
  frequency: Frequency
  weekday: number
  monthDay: number
  hour: number
  period: string
  sections: string[]
  filters: Record<string, string>
  lastSentAt: string | null
  lastError: string | null
  when: string
  nextAt: string | null
}
interface ReportsView {
  schedules: Schedule[]
  runs: { at: string; scheduleId: string; name: string; ok: boolean; to: number; message: string; manual: boolean }[]
  sections: { key: string; label: string }[]
  periods: { key: string; label: string }[]
  smtpReady: boolean
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DEFAULT_SECTIONS = ['kpis', 'plataformas', 'campanhas', 'funil', 'recomendacoes']

export function RelatoriosMktPage() {
  return (
    <RequirePermission module="mi_relatorios">
      <Relatorios />
    </RequirePermission>
  )
}

function Relatorios() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['mkt-relatorios'], queryFn: () => api.get<ReportsView>('/marketing/relatorios') })
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null)
  const [removing, setRemoving] = useState<Schedule | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['mkt-relatorios'] })
  const send = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/marketing/relatorios/${id}/enviar`),
    onSuccess: (r) => (toast.success(r.message), refresh()),
    onError: (err) => (toast.error(errorMessage(err), { duration: 8000 }), refresh()),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/relatorios/${id}`),
    onSuccess: () => (toast.success('Relatório removido.'), setRemoving(null), refresh()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const toggle = useMutation({
    mutationFn: (s: Schedule) => api.put(`/marketing/relatorios/${s.id}`, { ...s, active: !s.active }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  return (
    <div>
      <PageHeader
        title="Relatórios automáticos"
        description="Relatórios por e-mail: quem recebe, em que dia e horário, de qual período e com quais informações."
        actions={
          can('mi_relatorios', 'create') && (
            <Button onClick={() => setEditing({ frequency: 'semanal', weekday: 1, monthDay: 1, hour: 8, period: 'semana_anterior', sections: DEFAULT_SECTIONS, active: true, emails: [], filters: {} })}>
              <PlusIcon /> Novo relatório
            </Button>
          )
        }
      />
      <div className="space-y-4">
        {q.isLoading && <TableSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && !d.smtpReady && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            O servidor de e-mail ainda não está configurado: os relatórios só são enviados depois de configurar em{' '}
            <Link className="font-medium underline" to="/configuracoes?secao=smtp">
              Configurações › Servidor de e-mail
            </Link>
            .
          </p>
        )}
        {d && d.schedules.length === 0 && (
          <EmptyState icon={CalendarClockIcon} title="Nenhum relatório agendado" description="Crie um relatório: por exemplo, o resumo semanal da diretoria toda segunda às 8h, ou o diário da equipe de marketing." />
        )}
        {d && d.schedules.length > 0 && (
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Relatório</TableHead>
                    <TableHead>Quando</TableHead>
                    <TableHead>Destinatários</TableHead>
                    <TableHead>Último envio</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="pr-6 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="pl-6">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.periods.find((p) => p.key === s.period)?.label} · {s.sections.length} informação(ões)
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>{s.when}</p>
                        {s.nextAt && <p className="text-xs text-muted-foreground">Próximo: {formatDateTime(s.nextAt)}</p>}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate text-sm" title={s.emails.join(', ')}>
                          {s.emails.join(', ')}
                        </p>
                      </TableCell>
                      <TableCell>
                        {s.lastSentAt ? formatDateTime(s.lastSentAt) : '—'}
                        {s.lastError && <p className="max-w-56 text-xs text-red-600">{s.lastError}</p>}
                      </TableCell>
                      <TableCell>
                        <Switch checked={s.active} onCheckedChange={() => toggle.mutate(s)} disabled={!can('mi_relatorios', 'edit') || toggle.isPending} aria-label={`Ligar ${s.name}`} />
                      </TableCell>
                      <TableCell className="pr-6 text-right whitespace-nowrap">
                        {can('mi_relatorios', 'edit') && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => send.mutate(s.id)} disabled={send.isPending || !d.smtpReady} title="Enviar agora">
                              {send.isPending && send.variables === s.id ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(s)} title="Editar">
                              <PencilIcon />
                            </Button>
                          </>
                        )}
                        {can('mi_relatorios', 'delete') && (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(s)} title="Remover">
                            <Trash2Icon />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {d && d.runs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimos envios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {d.runs.slice(0, 15).map((r) => (
                <p key={`${r.at}-${r.scheduleId}`} className={r.ok ? '' : 'text-red-600'}>
                  {formatDateTime(r.at)} · {r.name} · {r.manual ? 'enviado agora' : 'agendado'} · {r.message}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      {editing && d && <ScheduleDialog initial={editing} view={d} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} />}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>O relatório para de ser enviado. Os envios já feitos continuam no histórico.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing.id)}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ScheduleDialog({ initial, view, onClose, onSaved }: { initial: Partial<Schedule>; view: ReportsView; onClose: () => void; onSaved: () => void }) {
  const opts = useMktOptions()
  const [s, setS] = useState<Partial<Schedule>>(initial)
  const [emails, setEmails] = useState((initial.emails ?? []).join('\n'))
  const [preview, setPreview] = useState<string | null>(null)
  const body = () => ({ ...s, emails: emails.split(/[\s,;]+/).filter(Boolean) })
  const save = useMutation({
    mutationFn: () => (s.id ? api.put(`/marketing/relatorios/${s.id}`, body()) : api.post('/marketing/relatorios', body())),
    onSuccess: () => (toast.success('Relatório salvo.'), onSaved()),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const prev = useMutation({
    mutationFn: () => api.post<{ html: string }>('/marketing/relatorios/previa', body()),
    onSuccess: (r) => setPreview(r.html),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const set = (patch: Partial<Schedule>) => setS((x) => ({ ...x, ...patch }))
  const toggleSection = (k: string, on: boolean) => set({ sections: on ? [...(s.sections ?? []), k] : (s.sections ?? []).filter((x) => x !== k) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{s.id ? 'Editar relatório' : 'Novo relatório'}</DialogTitle>
          <DialogDescription>O e-mail sai no horário de Brasília, com o período escolhido e só as informações marcadas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rep-name">Nome</Label>
            <Input id="rep-name" maxLength={80} placeholder="Ex.: Resumo semanal da diretoria" value={s.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-emails">
              <MailIcon className="size-4" /> E-mails que recebem
            </Label>
            <Textarea id="rep-emails" rows={3} placeholder={'diretoria@usaparts.com.br\nmarketing@usaparts.com.br'} value={emails} onChange={(e) => setEmails(e.target.value)} />
            <p className="text-xs text-muted-foreground">Um por linha (ou separados por vírgula). Até 20.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Frequência</Label>
              <Select value={s.frequency} onValueChange={(v) => set({ frequency: v as Frequency, period: v === 'mensal' ? 'mes_anterior' : v === 'semanal' ? 'semana_anterior' : 'ontem' })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diario">Todo dia</SelectItem>
                  <SelectItem value="semanal">Toda semana</SelectItem>
                  <SelectItem value="mensal">Todo mês</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {s.frequency === 'semanal' && (
              <div className="space-y-1.5">
                <Label>Dia da semana</Label>
                <Select value={String(s.weekday ?? 1)} onValueChange={(v) => set({ weekday: Number(v) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((w, i) => (
                      <SelectItem key={w} value={String(i)}>
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {s.frequency === 'mensal' && (
              <div className="space-y-1.5">
                <Label>Dia do mês</Label>
                <Select value={String(s.monthDay ?? 1)} onValueChange={(v) => set({ monthDay: Number(v) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => (
                      <SelectItem key={i} value={String(i + 1)}>
                        Dia {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Select value={String(s.hour ?? 8)} onValueChange={(v) => set({ hour: Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, '0')}h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Período do relatório</Label>
              <Select value={s.period} onValueChange={(v) => set({ period: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.periods.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filtrar por plataforma</Label>
              <Select value={s.filters?.platform ?? 'todas'} onValueChange={(v) => set({ filters: { ...(s.filters ?? {}), platform: v === 'todas' ? '' : v } })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as plataformas</SelectItem>
                  {opts.data?.platforms.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filtrar por filial</Label>
              <Select value={s.filters?.unitId ?? 'todas'} onValueChange={(v) => set({ filters: { ...(s.filters ?? {}), unitId: v === 'todas' ? '' : v } })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as filiais</SelectItem>
                  {opts.data?.units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filtrar por vendedor</Label>
              <Select value={s.filters?.sellerId ?? 'todos'} onValueChange={(v) => set({ filters: { ...(s.filters ?? {}), sellerId: v === 'todos' ? '' : v } })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os vendedores</SelectItem>
                  {opts.data?.sellers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">O que vai no relatório</legend>
            {view.sections.map((x) => (
              <label key={x.key} className="flex items-start gap-2 text-sm">
                <Checkbox checked={(s.sections ?? []).includes(x.key)} onCheckedChange={(v) => toggleSection(x.key, !!v)} className="mt-0.5" />
                {x.label}
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <Switch id="rep-active" checked={s.active ?? true} onCheckedChange={(v) => set({ active: v })} />
            <Label htmlFor="rep-active">Enviar automaticamente</Label>
          </div>
          {preview && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Prévia (com os dados de hoje)</p>
              <iframe title="Prévia do relatório" srcDoc={preview} sandbox="" className="h-96 w-full rounded-md border bg-white" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => prev.mutate()} disabled={prev.isPending}>
            {prev.isPending ? <Loader2Icon className="animate-spin" /> : <EyeIcon />} Prévia
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

