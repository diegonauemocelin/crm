import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClockIcon, EyeIcon, Loader2Icon, MailIcon, MessageCircleIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, InlineError, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useAuth } from '@/lib/auth'
import { ResumoVendedorCard } from '@/components/marketing/resumo-vendedor'
import { downloadReport, MktFilters } from '@/components/marketing/ui'
import { useMktFilters, useMktOptions } from '@/lib/marketing'

type Frequency = 'diario' | 'semanal' | 'mensal'
interface Schedule {
  id: string
  name: string
  active: boolean
  emails: string[]
  /** Celulares que recebem pelo WhatsApp (resumo + PDF). */
  whatsapp: string[]
  whatsappNumberId: string | null
  frequency: Frequency
  weekday: number
  monthDay: number
  hour: number
  period: string
  sections: string[]
  filters: Record<string, string>
  attach: 'none' | 'pdf' | 'xlsx'
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
  whatsappNumbers: { id: string; name: string; status: string }[]
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DEFAULT_SECTIONS = ['kpis', 'plataformas', 'campanhas', 'funil', 'recomendacoes']

export function RelatoriosMktPage() {
  return (
    <RequirePermission module="mi_relatorios">
      <div>
        <PageHeader title="Relatórios e alertas" description="Relatórios por e-mail (quem recebe, quando e o quê), arquivos em PDF e Excel na hora e alertas automáticos." />
        <Tabs defaultValue="agendados">
          <TabsList className="mb-4">
            <TabsTrigger value="agendados">Relatórios agendados</TabsTrigger>
            <TabsTrigger value="baixar">Baixar agora (PDF ou Excel)</TabsTrigger>
            <TabsTrigger value="alertas">Alertas</TabsTrigger>
          </TabsList>
          <TabsContent value="agendados">
            <Relatorios />
          </TabsContent>
          <TabsContent value="baixar">
            <Baixar />
          </TabsContent>
          <TabsContent value="alertas">
            <Alertas />
          </TabsContent>
        </Tabs>
      </div>
    </RequirePermission>
  )
}

function Relatorios() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['mkt-relatorios'], queryFn: () => api.get<ReportsView>('/marketing/relatorios') })
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null)
  const confirm = useConfirm()
  const refresh = () => qc.invalidateQueries({ queryKey: ['mkt-relatorios'] })
  const send = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/marketing/relatorios/${id}/enviar`),
    onSuccess: (r) => (toast.success(r.message), refresh()),
    onError: (err) => (toast.error(errorMessage(err), { duration: 8000 }), refresh()),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/relatorios/${id}`),
    onSuccess: () => (toast.success('Relatório excluído.'), refresh()),
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
      <div className="space-y-4">
        {can('mi_relatorios', 'create') && (
          <div className="flex justify-end">
            <Button onClick={() => setEditing({ frequency: 'semanal', weekday: 1, monthDay: 1, hour: 8, period: 'semana_anterior', sections: DEFAULT_SECTIONS, active: true, emails: [], whatsapp: [], whatsappNumberId: null, filters: {}, attach: 'pdf' })}>
              <PlusIcon /> Novo relatório
            </Button>
          </div>
        )}
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
                        {(s.whatsapp ?? []).length > 0 && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground" title={s.whatsapp.join(', ')}>
                            <MessageCircleIcon className="size-3" /> WhatsApp: {s.whatsapp.length} celular(es)
                          </p>
                        )}
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
                            <Button size="icon-sm" variant="ghost" onClick={() => send.mutate(s.id)} disabled={send.isPending || (!d.smtpReady && !(s.whatsapp ?? []).length)} aria-label={`Enviar agora o relatório ${s.name}`}>
                              {send.isPending && send.variables === s.id ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                            </Button>
                            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar relatório ${s.name}`}>
                              <PencilIcon />
                            </Button>
                          </>
                        )}
                        {can('mi_relatorios', 'delete') && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Excluir relatório ${s.name}`}
                            onClick={async () => {
                              if (await confirm({ title: `Excluir o relatório “${s.name}”?`, description: 'O relatório para de ser enviado e não pode ser recuperado. Os envios já feitos continuam no histórico.', confirmLabel: 'Excluir relatório' })) remove.mutate(s.id)
                            }}
                          >
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
        <ResumoVendedorCard />
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
    </div>
  )
}

function ScheduleDialog({ initial, view, onClose, onSaved }: { initial: Partial<Schedule>; view: ReportsView; onClose: () => void; onSaved: () => void }) {
  const opts = useMktOptions()
  const [s, setS] = useState<Partial<Schedule>>(initial)
  const [emails, setEmails] = useState((initial.emails ?? []).join('\n'))
  const [phones, setPhones] = useState((initial.whatsapp ?? []).join('\n'))
  const [preview, setPreview] = useState<string | null>(null)
  const body = () => ({ ...s, emails: emails.split(/[\s,;]+/).filter(Boolean), whatsapp: phones.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) })
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
  const guard = useCloseGuard(isDirty(initial, s) || emails !== (initial.emails ?? []).join('\n') || phones !== (initial.whatsapp ?? []).join('\n'), onClose, 'o relatório')
  const toggleSection = (k: string, on: boolean) => set({ sections: on ? [...(s.sections ?? []), k] : (s.sections ?? []).filter((x) => x !== k) })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{s.id ? 'Editar relatório' : 'Novo relatório'}</DialogTitle>
          <DialogDescription>O envio sai no horário de Brasília, com o período escolhido e só as informações marcadas.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rep-name" required>
              Nome
            </Label>
            <Input id="rep-name" autoFocus maxLength={80} placeholder="Ex.: Resumo semanal da diretoria" value={s.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-emails">
              <MailIcon className="size-4" /> E-mails que recebem
            </Label>
            <Textarea id="rep-emails" rows={3} placeholder={'diretoria@usaparts.com.br\nmarketing@usaparts.com.br'} value={emails} onChange={(e) => setEmails(e.target.value)} />
            <p className="text-xs text-muted-foreground">Um por linha (ou separados por vírgula). Até 20.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-whatsapp">
              <MessageCircleIcon className="size-4" /> WhatsApp que recebem
            </Label>
            <Textarea id="rep-whatsapp" rows={2} placeholder={'(49) 98863-2548\n(49) 99999-0000'} value={phones} onChange={(e) => setPhones(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Um celular por linha, com DDD. Até 20. Vai um resumo com os principais números e o PDF. Os celulares recebem um de cada vez, com uma pausa sorteada entre 40 s e 2 min, para não bloquear o número.
            </p>
            {phones.trim() && (
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm font-normal text-muted-foreground">Enviar pelo número</Label>
                <Select value={s.whatsappNumberId ?? 'auto'} onValueChange={(v) => set({ whatsappNumberId: v === 'auto' ? null : v })}>
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">O primeiro conectado</SelectItem>
                    {view.whatsappNumbers.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}
                        {n.status !== 'CONECTADO' ? ' (desconectado)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
          <div className="space-y-1.5">
            <Label>Anexo no e-mail</Label>
            <Select value={s.attach ?? 'none'} onValueChange={(v) => set({ attach: v as Schedule['attach'] })}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem anexo (só o e-mail)</SelectItem>
                <SelectItem value="pdf">PDF com as mesmas informações</SelectItem>
                <SelectItem value="xlsx">Excel com as mesmas informações</SelectItem>
              </SelectContent>
            </Select>
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
          <Button type="button" variant="ghost" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="button" variant="outline" onClick={() => prev.mutate()} disabled={prev.isPending}>
            {prev.isPending ? <Loader2Icon className="animate-spin" /> : <EyeIcon />} Prévia
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}


// ---------- Baixar agora ----------

function Baixar() {
  const f = useMktFilters()
  const q = useQuery({ queryKey: ['mkt-relatorios'], queryFn: () => api.get<ReportsView>('/marketing/relatorios') })
  const [sections, setSections] = useState<string[]>(['kpis', 'plataformas', 'campanhas', 'funil', 'vendedores', 'regioes', 'recomendacoes'])
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  const download = async (format: 'pdf' | 'xlsx') => {
    setBusy(format)
    try {
      await downloadReport(f.query, format, sections)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gerar o relatório agora</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MktFilters />
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">O que vai no arquivo</legend>
          {q.error && <InlineError error={q.error} onRetry={() => q.refetch()} />}
          {(q.data?.sections ?? []).map((x) => (
            <label key={x.key} className="flex items-start gap-2 text-sm">
              <Checkbox checked={sections.includes(x.key)} onCheckedChange={(v) => setSections((cur) => (v ? [...cur, x.key] : cur.filter((k) => k !== x.key)))} className="mt-0.5" />
              {x.label}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Button onClick={() => download('pdf')} disabled={!!busy || !sections.length}>
            {busy === 'pdf' && <Loader2Icon className="animate-spin" />} Baixar PDF
          </Button>
          <Button variant="outline" onClick={() => download('xlsx')} disabled={!!busy || !sections.length}>
            {busy === 'xlsx' && <Loader2Icon className="animate-spin" />} Baixar Excel
          </Button>
        </div>
        {!sections.length && <p className="text-xs text-muted-foreground">Marque ao menos uma informação para baixar o arquivo.</p>}
        <p className="text-xs text-muted-foreground">Usa o período e os filtros escolhidos acima. O arquivo traz o período, a data da atualização, as fontes e o modelo de atribuição.</p>
      </CardContent>
    </Card>
  )
}

// ---------- Alertas ----------

interface AlertRule {
  id: string
  type: string
  threshold: number
  windowDays: number
  emails: string[]
  active: boolean
  lastFiredAt: string | null
}
interface AlertsView {
  rules: AlertRule[]
  events: { at: string; ruleId: string; type: string; message: string; limitation: string | null }[]
  types: { key: string; label: string; unit: string; default: number }[]
}

function Alertas() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['mkt-alertas'], queryFn: () => api.get<AlertsView>('/marketing/alertas') })
  const [edit, setEdit] = useState<Partial<AlertRule> | null>(null)
  const confirm = useConfirm()
  const [results, setResults] = useState<Record<string, { fired: boolean; message: string; limitation: string | null }> | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['mkt-alertas'] })
  const test = useMutation({
    mutationFn: () => api.post<{ id: string; fired: boolean; message: string; limitation: string | null }[]>('/marketing/alertas/testar'),
    onSuccess: (r) => setResults(Object.fromEntries(r.map((x) => [x.id, x]))),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/alertas/${id}`),
    onSuccess: () => (toast.success('Alerta excluído.'), refresh()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const toggle = useMutation({
    mutationFn: (r: AlertRule) => api.put(`/marketing/alertas/${r.id}`, { ...r, active: !r.active }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const label = (t: string) => d?.types.find((x) => x.key === t)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {d && d.rules.length > 0 && (
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending && <Loader2Icon className="animate-spin" />} Testar agora (sem enviar)
          </Button>
        )}
        {can('mi_relatorios', 'create') && d && (
          <Button onClick={() => setEdit({ type: d.types[0]!.key, threshold: d.types[0]!.default, windowDays: 7, emails: [], active: true })}>
            <PlusIcon /> Novo alerta
          </Button>
        )}
      </div>
      {q.isLoading && <TableSkeleton rows={3} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && d.rules.length === 0 && <EmptyState title="Nenhum alerta" description="Crie alertas para gasto perto do limite, campanha sem leads, alta do CPL, queda de leads ou faturamento, leads sem atendimento, metas atrasadas, perda de UTM e dados desatualizados." />}
      {d && d.rules.length > 0 && (
        <Card>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Alerta</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Avisa</TableHead>
                  <TableHead>Último aviso</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="pr-6 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-96 pl-6">
                      <p className="font-medium">{label(r.type)?.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Limite: {r.threshold.toLocaleString('pt-BR')} ({label(r.type)?.unit})
                      </p>
                      {results?.[r.id] && <p className={`text-xs ${results[r.id]!.fired ? 'text-red-600' : 'text-[#006300] dark:text-[#0ca30c]'}`}>{results[r.id]!.fired ? results[r.id]!.message : 'Hoje não dispararia.'}</p>}
                    </TableCell>
                    <TableCell>{r.windowDays} dia(s)</TableCell>
                    <TableCell className="max-w-56 truncate text-sm" title={r.emails.join(', ')}>
                      {r.emails.length ? r.emails.join(', ') : 'Só na tela'}
                    </TableCell>
                    <TableCell>{r.lastFiredAt ? formatDateTime(r.lastFiredAt) : '—'}</TableCell>
                    <TableCell>
                      <Switch checked={r.active} onCheckedChange={() => toggle.mutate(r)} disabled={!can('mi_relatorios', 'edit')} aria-label={`Ligar alerta ${label(r.type)?.label ?? ''}`.trim()} />
                    </TableCell>
                    <TableCell className="pr-6 text-right whitespace-nowrap">
                      {can('mi_relatorios', 'edit') && (
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => setEdit(r)} aria-label={`Editar alerta ${label(r.type)?.label ?? ''}`.trim()}>
                          <PencilIcon />
                        </Button>
                      )}
                      {can('mi_relatorios', 'delete') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Excluir alerta ${label(r.type)?.label ?? ''}`.trim()}
                          onClick={async () => {
                            if (await confirm({ title: `Excluir o alerta “${label(r.type)?.label ?? 'sem nome'}”?`, description: 'O alerta deixa de ser conferido e ninguém mais recebe este aviso. Os avisos já disparados continuam no histórico.', confirmLabel: 'Excluir alerta' })) remove.mutate(r.id)
                          }}
                        >
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
      {d && d.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos avisos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {d.events.slice(0, 20).map((e) => (
              <p key={`${e.at}-${e.ruleId}`}>
                <span className="text-muted-foreground">{formatDateTime(e.at)}</span> · {e.message}
                {e.limitation && <span className="text-xs text-muted-foreground"> ({e.limitation})</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Os alertas são conferidos de hora em hora e avisam no máximo uma vez por dia cada um. Com amostra pequena (menos de 10 leads), os de variação não disparam.</p>
      {edit && d && <AlertDialogForm initial={edit} types={d.types} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), refresh())} />}
    </div>
  )
}

function AlertDialogForm({ initial, types, onClose, onSaved }: { initial: Partial<AlertRule>; types: AlertsView['types']; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState(initial)
  const [emails, setEmails] = useState((initial.emails ?? []).join('\n'))
  const type = types.find((t) => t.key === r.type)
  const guard = useCloseGuard(isDirty(initial, r) || emails !== (initial.emails ?? []).join('\n'), onClose, 'o alerta')
  const save = useMutation({
    mutationFn: () => {
      const body = { ...r, emails: emails.split(/[\s,;]+/).filter(Boolean) }
      return r.id ? api.put(`/marketing/alertas/${r.id}`, body) : api.post('/marketing/alertas', body)
    },
    onSuccess: () => (toast.success('Alerta salvo.'), onSaved()),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r.id ? 'Editar alerta' : 'Novo alerta'}</DialogTitle>
          <DialogDescription>Avisa por e-mail quando a condição acontecer no período avaliado (comparado com o anterior do mesmo tamanho).</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={r.type} onValueChange={(v) => setR({ ...r, type: v, threshold: types.find((t) => t.key === v)?.default ?? r.threshold })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="al-th" required>
                Limite ({type?.unit})
              </Label>
              <Input id="al-th" autoFocus type="number" min={0} value={r.threshold ?? ''} onChange={(e) => setR({ ...r, threshold: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-win">Período avaliado (dias)</Label>
              <Input id="al-win" type="number" min={1} max={90} value={r.windowDays ?? 7} onChange={(e) => setR({ ...r, windowDays: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al-emails">E-mails que recebem o aviso</Label>
            <Textarea id="al-emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="marketing@usaparts.com.br" />
            <p className="text-xs text-muted-foreground">Vazio: o aviso só aparece na tela (Últimos avisos e Visão geral).</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
