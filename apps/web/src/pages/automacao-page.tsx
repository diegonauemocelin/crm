import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  BellRingIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  GitBranchIcon,
  HeadsetIcon,
  Loader2Icon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  TagIcon,
  TagsIcon,
  Trash2Icon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UserRoundCogIcon,
  UsersRoundIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, type Options, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import {
  type Automation,
  type AutomationOptions,
  type AutomationReport,
  cloneStep,
  findStep,
  insertStep,
  moveStep,
  newStep,
  removeStep,
  type Rule,
  RULE_INFO,
  RULES,
  type RuleType,
  RUN_STATUS,
  type RunLog,
  type Step,
  STEP_INFO,
  type StepType,
  type Trigger,
  TRIGGERS,
  UNIT_LABEL,
  updateStep,
  type Where,
} from '@/lib/automacoes'
import { STAGES } from '@/lib/leads'
import { cn } from '@/lib/utils'

const ANY = '__any__'
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const stageLabel = (s?: string) => STAGES.find((x) => x.id === s)?.label ?? s ?? '—'

export function AutomacaoPage() {
  return (
    <RequirePermission module="automacoes">
      <Loader />
    </RequirePermission>
  )
}

function Loader() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['automacao', id], queryFn: () => api.get<Automation>(`/automacoes/${id}`) })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return <FlowEditor key={`${q.data.id}-${q.data.updatedAt}`} initial={q.data} />
}

type Sel = 'trigger' | 'config' | string

const STEP_ICON: Record<StepType, typeof MailIcon> = {
  esperar: ClockIcon,
  condicao: GitBranchIcon,
  enviar_email: MailIcon,
  adicionar_tag: TagIcon,
  remover_tag: TagsIcon,
  alterar_vendedor: UserRoundCogIcon,
  alterar_etapa: TrendingUpIcon,
  criar_atendimento: HeadsetIcon,
  notificar: BellRingIcon,
  encerrar: FlagIcon,
}

interface Ctx {
  options: AutomationOptions | undefined
  lists: Options | undefined
}

// ---------- Editor ----------

function FlowEditor({ initial }: { initial: Automation }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canEdit = can('automacoes', 'edit')
  const options = useQuery({ queryKey: ['automacoes-opcoes'], queryFn: () => api.get<AutomationOptions>('/automacoes/opcoes') })
  const lists = useOptions()
  const report = useQuery({ queryKey: ['automacao-relatorio', initial.id], queryFn: () => api.get<AutomationReport>(`/automacoes/${initial.id}/relatorio`), refetchInterval: 30_000 })
  const [a, setA] = useState(initial)
  const [sel, setSel] = useState<Sel>('trigger')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState('fluxo')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const ctx: Ctx = { options: options.data, lists: lists.data }

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (p: Partial<Automation>) => {
    setA((x) => ({ ...x, ...p }))
    setDirty(true)
  }
  const setSteps = (fn: (s: Step[]) => Step[]) => {
    setA((x) => ({ ...x, steps: fn(x.steps) }))
    setDirty(true)
  }

  const body = () => ({ name: a.name, description: a.description, trigger: a.trigger, steps: a.steps, reentry: a.reentry, exitOnPurchase: a.exitOnPurchase })
  const persist = async () => {
    await api.put(`/automacoes/${a.id}`, body())
    setDirty(false)
    void qc.invalidateQueries({ queryKey: ['automacoes'] })
  }
  const save = useMutation({ mutationFn: persist, onSuccess: () => toast.success('Fluxo salvo.'), onError: (err) => toast.error(errorMessage(err)) })
  const toggle = useMutation({
    mutationFn: async (active: boolean) => {
      if (dirty) await persist()
      await api.post(`/automacoes/${a.id}/situacao`, { active })
      return active
    },
    onSuccess: (active) => {
      setA((x) => ({ ...x, active }))
      toast.success(active ? 'Fluxo ligado: a partir de agora, quem cumprir o gatilho entra nele.' : 'Fluxo desligado: os leads que estão nele ficam parados até ligar de novo.')
      void qc.invalidateQueries({ queryKey: ['automacoes'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const duplicate = useMutation({ mutationFn: () => api.post<{ id: string }>(`/automacoes/${a.id}/duplicar`), onSuccess: (r) => navigate(`/automacoes/${r.id}`), onError: (err) => toast.error(errorMessage(err)) })
  const remove = useMutation({
    mutationFn: () => api.delete(`/automacoes/${a.id}`),
    onSuccess: () => {
      setDirty(false)
      void qc.invalidateQueries({ queryKey: ['automacoes'] })
      navigate('/automacoes')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const selected = sel !== 'trigger' && sel !== 'config' ? findStep(a.steps, sel) : null
  const counts = report.data?.steps ?? {}

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/automacoes">
          <ArrowLeftIcon /> Automações
        </Link>
      </Button>
      <PageHeader
        title={a.name}
        description={a.active ? `Ligado${initial.activatedAt ? ` desde ${formatDateTime(initial.activatedAt)}` : ''} · ${int.format(report.data?.running ?? initial.running ?? 0)} lead(s) no fluxo agora` : 'Desligado: monte o fluxo e ligue quando estiver pronto.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={a.active ? RUN_STATUS.CONCLUIDO.tone : ''}>
              {a.active ? 'Ligado' : 'Desligado'}
            </Badge>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending && <Loader2Icon className="animate-spin" />}
                  Salvar{dirty ? ' *' : ''}
                </Button>
                <Button variant={a.active ? 'outline' : 'default'} onClick={() => toggle.mutate(!a.active)} disabled={toggle.isPending}>
                  {toggle.isPending ? <Loader2Icon className="animate-spin" /> : <ZapIcon />}
                  {a.active ? 'Desligar' : 'Ligar fluxo'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Mais ações">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEnrollOpen(true)} disabled={!a.active}>
                      <UsersRoundIcon /> Colocar leads de um segmento
                    </DropdownMenuItem>
                    {can('automacoes', 'create') && (
                      <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                        <CopyIcon /> Duplicar fluxo
                      </DropdownMenuItem>
                    )}
                    {can('automacoes', 'delete') && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={a.active} onSelect={() => confirm(`Excluir o fluxo "${a.name}" e o histórico dele?`) && remove.mutate()}>
                          <Trash2Icon /> Excluir
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="fluxo">Fluxo</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório</TabsTrigger>
        </TabsList>
        <TabsContent value="fluxo">
          {a.active && (
            <p className="mb-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Fluxo ligado: as mudanças valem ao salvar. Quem está num passo que você remover sai do fluxo.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 overflow-x-auto rounded-lg border bg-muted/30 p-4 sm:p-6">
              <div className="mx-auto flex w-max min-w-full flex-col items-center">
                <NodeCard icon={ZapIcon} tone="trigger" title="Gatilho" summary={describeTrigger(a.trigger, ctx)} selected={sel === 'trigger'} onClick={() => setSel('trigger')} />
                <StepList
                  steps={a.steps}
                  where={{ parent: null, branch: null }}
                  sel={sel}
                  ctx={ctx}
                  counts={counts}
                  canEdit={canEdit}
                  onSelect={setSel}
                  onInsert={(where, index, type) => {
                    const s = newStep(type)
                    setSteps((x) => insertStep(x, where, index, s))
                    setSel(s.id)
                  }}
                  onMove={(id, d) => setSteps((x) => moveStep(x, id, d))}
                  onDuplicate={(s, where, index) => {
                    const c = cloneStep(s)
                    setSteps((x) => insertStep(x, where, index + 1, c))
                    setSel(c.id)
                  }}
                  onRemove={(id) => {
                    setSteps((x) => removeStep(x, id))
                    setSel('trigger')
                  }}
                />
                <Connector />
                <div className="flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  <CheckCircle2Icon className="size-3.5" /> Fim do fluxo
                </div>
              </div>
            </div>

            <Card className="h-fit gap-0 py-0 lg:sticky lg:top-4">
              <div className="flex border-b">
                <button type="button" className={cn('flex-1 px-3 py-2.5 text-sm font-medium', sel !== 'config' ? 'border-b-2 border-[color:var(--brand)]' : 'text-muted-foreground')} onClick={() => sel === 'config' && setSel('trigger')}>
                  {selected ? STEP_INFO[selected.type].label : sel === 'trigger' ? 'Gatilho' : 'Passo'}
                </button>
                <button type="button" className={cn('flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium', sel === 'config' ? 'border-b-2 border-[color:var(--brand)]' : 'text-muted-foreground')} onClick={() => setSel('config')}>
                  <SettingsIcon className="size-4" /> Configurações
                </button>
              </div>
              <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto p-4">
                {sel === 'config' ? (
                  <FlowSettings a={a} disabled={!canEdit} onChange={patch} />
                ) : sel === 'trigger' ? (
                  <TriggerEditor trigger={a.trigger} ctx={ctx} disabled={!canEdit} onChange={(trigger) => patch({ trigger })} />
                ) : selected ? (
                  <StepEditor key={selected.id} step={selected} ctx={ctx} disabled={!canEdit} onChange={(s) => setSteps((x) => updateStep(x, s.id, s))} />
                ) : (
                  <p className="text-sm text-muted-foreground">Clique em um passo do fluxo para configurar.</p>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="relatorio">
          <ReportView a={a} report={report.data} error={report.error} onRetry={() => report.refetch()} />
        </TabsContent>
      </Tabs>

      <EnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} automationId={a.id} segments={options.data?.segments ?? []} />
    </div>
  )
}

// ---------- Desenho do fluxo ----------

function Connector({ className }: { className?: string }) {
  return <div className={cn('h-5 w-px bg-border', className)} aria-hidden />
}

function NodeCard(props: { icon: typeof MailIcon; title: string; summary: string; warn?: boolean; tone?: 'trigger' | 'condition' | 'action'; selected: boolean; onClick: () => void; badge?: ReactNode; tools?: ReactNode }) {
  const Icon = props.icon
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onClick())}
      className={cn(
        'group relative w-full max-w-sm cursor-pointer rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-[color:var(--brand)]',
        props.selected && 'border-[color:var(--brand)] ring-2 ring-[color:var(--brand)]/25',
        props.warn && !props.selected && 'border-amber-500/60',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            props.tone === 'trigger' ? 'bg-[color:var(--brand)] text-[color:var(--brand-foreground)]' : props.tone === 'condition' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-muted text-foreground',
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{props.title}</span>
          <span className={cn('block text-xs break-words', props.warn ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{props.summary}</span>
          {props.badge}
        </span>
      </div>
      {props.tools}
    </div>
  )
}

function AddButton({ onPick, disabled }: { onPick: (t: StepType) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  if (disabled) return <Connector />
  const groups = ['Tempo e decisão', 'Ações'] as const
  return (
    <div className="flex flex-col items-center">
      <Connector className="h-3" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:border-[color:var(--brand)] hover:text-foreground" aria-label="Adicionar passo aqui">
            <PlusIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1.5">
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{g}</p>
              {(Object.keys(STEP_INFO) as StepType[])
                .filter((t) => STEP_INFO[t].group === g)
                .map((t) => {
                  const Icon = STEP_ICON[t]
                  return (
                    <button
                      key={t}
                      type="button"
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => {
                        setOpen(false)
                        onPick(t)
                      }}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>
                        <span className="block text-sm">{STEP_INFO[t].label}</span>
                        <span className="block text-xs text-muted-foreground">{STEP_INFO[t].help}</span>
                      </span>
                    </button>
                  )
                })}
            </div>
          ))}
        </PopoverContent>
      </Popover>
      <Connector className="h-3" />
    </div>
  )
}

function StepList(props: {
  steps: Step[]
  where: Where
  sel: Sel
  ctx: Ctx
  counts: Record<string, Record<string, number>>
  canEdit: boolean
  onSelect: (id: string) => void
  onInsert: (where: Where, index: number, type: StepType) => void
  onMove: (id: string, d: -1 | 1) => void
  onDuplicate: (s: Step, where: Where, index: number) => void
  onRemove: (id: string) => void
}) {
  const { steps, where } = props
  return (
    <>
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.type]
        const d = describeStep(s, props.ctx)
        const c = props.counts[s.id]
        const passed = c ? Object.entries(c).filter(([k]) => k !== 'erro' && k !== 'aviso').reduce((n, [, v]) => n + v, 0) : 0
        return (
          <div key={s.id} className="flex w-full flex-col items-center">
            <AddButton disabled={!props.canEdit} onPick={(t) => props.onInsert(where, i, t)} />
            <NodeCard
              icon={Icon}
              tone={s.type === 'condicao' ? 'condition' : 'action'}
              title={STEP_INFO[s.type].label}
              summary={d.text}
              warn={d.warn}
              selected={props.sel === s.id}
              onClick={() => props.onSelect(s.id)}
              badge={
                c && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {s.type === 'condicao' ? (
                      <>
                        <Badge variant="outline" className="text-[10px]">Sim: {int.format(c.sim ?? 0)}</Badge>
                        <Badge variant="outline" className="text-[10px]">Não: {int.format(c.nao ?? 0)}</Badge>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{int.format(passed)} passaram</Badge>
                    )}
                    {(c.erro ?? 0) > 0 && <Badge variant="outline" className={cn('text-[10px]', RUN_STATUS.ERRO.tone)}>{int.format(c.erro!)} com erro</Badge>}
                  </span>
                )
              }
              tools={
                props.canEdit && (
                  <span className="absolute top-1.5 right-1.5 hidden gap-0.5 rounded-md bg-card group-hover:flex" onClick={(e) => e.stopPropagation()}>
                    <MiniButton label="Subir" disabled={i === 0} onClick={() => props.onMove(s.id, -1)}>
                      <ArrowUpIcon />
                    </MiniButton>
                    <MiniButton label="Descer" disabled={i === steps.length - 1} onClick={() => props.onMove(s.id, 1)}>
                      <ArrowDownIcon />
                    </MiniButton>
                    <MiniButton label="Duplicar" onClick={() => props.onDuplicate(s, where, i)}>
                      <CopyIcon />
                    </MiniButton>
                    <MiniButton label="Remover" onClick={() => (s.type !== 'condicao' || (!s.yes.length && !s.no.length) || confirm('Remover a condição e os passos dos caminhos Sim e Não?')) && props.onRemove(s.id)}>
                      <XIcon />
                    </MiniButton>
                  </span>
                )
              }
            />
            {s.type === 'condicao' && (
              <div className="grid w-full grid-cols-[repeat(2,minmax(250px,1fr))] gap-3">
                {(['yes', 'no'] as const).map((b) => (
                  <div key={b} className="flex flex-col items-center">
                    <Connector />
                    <div className={cn('flex w-full flex-col items-center rounded-lg border-2 border-dashed px-2 pt-2 pb-3', b === 'yes' ? 'border-emerald-500/40' : 'border-rose-500/40')}>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', b === 'yes' ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-800 dark:text-rose-300')}>{b === 'yes' ? 'Sim' : 'Não'}</span>
                      <StepList {...props} steps={b === 'yes' ? s.yes : s.no} where={{ parent: s.id, branch: b }} />
                      <AddButton disabled={!props.canEdit} onPick={(t) => props.onInsert({ parent: s.id, branch: b }, (b === 'yes' ? s.yes : s.no).length, t)} />
                      <span className="text-[11px] text-muted-foreground">{(b === 'yes' ? s.yes : s.no).length ? 'depois segue o fluxo' : 'segue o fluxo'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {where.parent === null && <AddButton disabled={!props.canEdit} onPick={(t) => props.onInsert(where, steps.length, t)} />}
    </>
  )
}

function MiniButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" size="icon" variant="ghost" className="size-6 [&_svg]:size-3.5" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

// ---------- Textos de resumo ----------

const nameOf = (list: { id: string; name: string }[] | undefined, id: string | null | undefined) => list?.find((x) => x.id === id)?.name

function describeTrigger(t: Trigger, ctx: Ctx): string {
  const label = TRIGGERS.find((x) => x.type === t.type)?.label ?? t.type
  switch (t.type) {
    case 'lead_novo':
      return `${label}${t.originId ? ` vindo de ${nameOf(ctx.lists?.origins, t.originId) ?? 'origem escolhida'}` : ''}${t.includeImported ? ' (inclui importados)' : ''}`
    case 'formulario':
      return t.text ? `${label} com "${t.text}" no nome` : label
    case 'visita':
      return t.text ? `Visitou página com "${t.text}"` : label
    case 'email_aberto':
    case 'email_clicado':
      return t.campaignId ? `${label}: ${nameOf([...(ctx.options?.templates ?? []), ...(ctx.options?.campaigns ?? [])], t.campaignId) ?? 'e-mail escolhido'}` : `${label} (qualquer)`
    case 'etapa':
      return `Passou para a etapa ${stageLabel(t.stage)}`
    case 'inatividade':
      return `${t.days ?? 30} dias sem ${t.kind === 'interacao' ? 'nenhuma interação' : 'acessar o site'}`
    default:
      return label
  }
}

function describeRule(r: Rule, ctx: Ctx): string {
  const info = RULE_INFO[r.type]
  const base = r.negate ? info.negLabel : info.label
  switch (r.type) {
    case 'abriu_email':
    case 'clicou_email':
      return `${base} ${r.scope === 'qualquer' ? `(qualquer, ${r.days} dias)` : 'enviado por este fluxo'}`
    case 'tem_tag':
      return `${base} "${r.tag ?? ''}"`
    case 'etapa':
      return `${base} ${stageLabel(r.stage)}`
    case 'nota':
      return `${base} ${(r.grades ?? []).join(', ')}`
    case 'origem':
      return `${base} ${nameOf(ctx.lists?.origins, r.originId) ?? '—'}`
    case 'vendedor':
      return `${base} ${r.ownerId === 'nenhum' ? 'nenhum' : r.ownerId ? (nameOf(ctx.lists?.sellers, r.ownerId) ?? '—') : 'qualquer (tem vendedor)'}`
    default:
      return info.days ? `${base} (${r.days ?? 30} dias)` : base
  }
}

function describeStep(s: Step, ctx: Ctx): { text: string; warn?: boolean } {
  switch (s.type) {
    case 'esperar':
      return { text: `${s.amount} ${UNIT_LABEL[s.unit]}` }
    case 'condicao':
      return { text: s.rules.map((r) => describeRule(r, ctx)).join(s.match === 'todas' ? ' e ' : ' ou ') || 'Sem regra', warn: !s.rules.length }
    case 'enviar_email': {
      const t = ctx.options?.templates.find((x) => x.id === s.templateId)
      return t ? { text: t.name } : { text: 'Escolha o modelo de e-mail', warn: true }
    }
    case 'adicionar_tag':
    case 'remover_tag':
      return s.tags.length ? { text: s.tags.join(', ') } : { text: 'Informe a tag', warn: true }
    case 'alterar_vendedor':
      return s.ownerId ? { text: nameOf(ctx.lists?.sellers, s.ownerId) ?? 'Vendedor' } : { text: 'Escolha o vendedor', warn: true }
    case 'alterar_etapa':
      return { text: stageLabel(s.stage) }
    case 'criar_atendimento':
      return { text: s.ownerId ? `Para ${nameOf(ctx.lists?.sellers, s.ownerId) ?? 'vendedor'}` : 'Para o vendedor do lead' }
    case 'notificar':
      return s.userIds.length ? { text: s.userIds.map((id) => nameOf(ctx.options?.users, id) ?? '—').join(', ') } : { text: 'Escolha quem recebe o aviso', warn: true }
    case 'encerrar':
      return { text: 'O lead sai do fluxo aqui' }
  }
}

// ---------- Painel de configuração ----------

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SimpleSelect({ id, value, onChange, items, disabled, placeholder }: { id?: string; value: string; onChange: (v: string) => void; items: { id: string; name: string }[]; disabled?: boolean; placeholder?: string }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TriggerEditor({ trigger: t, ctx, disabled, onChange }: { trigger: Trigger; ctx: Ctx; disabled: boolean; onChange: (t: Trigger) => void }) {
  const groups = [...new Set(TRIGGERS.map((x) => x.group))]
  const emails = [{ id: ANY, name: 'Qualquer e-mail' }, ...(ctx.options?.templates ?? []).map((x) => ({ id: x.id, name: `Modelo: ${x.name}` })), ...(ctx.options?.campaigns ?? []).map((x) => ({ id: x.id, name: `Campanha: ${x.name}` }))]
  return (
    <>
      <p className="text-sm text-muted-foreground">O que faz o lead entrar no fluxo. Só valem acontecimentos depois que o fluxo é ligado.</p>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{g}</p>
            <div className="space-y-1">
              {TRIGGERS.filter((x) => x.group === g).map((x) => (
                <button
                  key={x.type}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ type: x.type, ...(x.type === 'inatividade' ? { days: 30, kind: 'site' } : {}), ...(x.type === 'etapa' ? { stage: 'CLIENTE' } : {}) })}
                  className={cn('w-full rounded-md border px-3 py-2 text-left hover:bg-muted/60 disabled:cursor-not-allowed', t.type === x.type && 'border-[color:var(--brand)] bg-muted/60')}
                  aria-pressed={t.type === x.type}
                >
                  <span className="block text-sm font-medium">{x.label}</span>
                  {t.type === x.type && <span className="block text-xs text-muted-foreground">{x.help}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t pt-4">
        {t.type === 'lead_novo' && (
          <>
            <Field label="Só leads desta origem" htmlFor="t-origin">
              <SimpleSelect id="t-origin" value={t.originId ?? ANY} onChange={(v) => onChange({ ...t, originId: v === ANY ? null : v })} items={[{ id: ANY, name: 'Qualquer origem' }, ...(ctx.lists?.origins ?? []).filter((o) => o.active)]} disabled={disabled} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={!!t.includeImported} onCheckedChange={(v) => onChange({ ...t, includeImported: v === true })} disabled={disabled} className="mt-0.5" />
              <span>
                Incluir leads importados de planilha
                <span className="block text-xs text-muted-foreground">Desligado: importações grandes não disparam o fluxo para todo mundo.</span>
              </span>
            </label>
          </>
        )}
        {t.type === 'formulario' && (
          <Field label="Nome do formulário, pop-up ou botão contém (opcional)" htmlFor="t-text" hint="Vazio = qualquer captura. Ex.: JCB pega só a LP da JCB.">
            <Input id="t-text" maxLength={120} value={t.text ?? ''} onChange={(e) => onChange({ ...t, text: e.target.value })} disabled={disabled} />
          </Field>
        )}
        {t.type === 'visita' && (
          <Field label="Endereço da página contém (opcional)" htmlFor="t-page" hint="Ex.: /jcb ou /ofertas. Vazio = qualquer página.">
            <Input id="t-page" maxLength={120} value={t.text ?? ''} onChange={(e) => onChange({ ...t, text: e.target.value })} disabled={disabled} />
          </Field>
        )}
        {(t.type === 'email_aberto' || t.type === 'email_clicado') && (
          <Field label="Qual e-mail" htmlFor="t-mail">
            <SimpleSelect id="t-mail" value={t.campaignId ?? ANY} onChange={(v) => onChange({ ...t, campaignId: v === ANY ? null : v })} items={emails} disabled={disabled} />
          </Field>
        )}
        {t.type === 'etapa' && (
          <Field label="Etapa" htmlFor="t-stage">
            <SimpleSelect id="t-stage" value={t.stage ?? 'CLIENTE'} onChange={(stage) => onChange({ ...t, stage })} items={STAGES.map((s) => ({ id: s.id, name: s.label }))} disabled={disabled} />
          </Field>
        )}
        {t.type === 'inatividade' && (
          <>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <Field label="Dias" htmlFor="t-days">
                <Input id="t-days" type="number" min={1} max={365} value={t.days ?? 30} onChange={(e) => onChange({ ...t, days: Number(e.target.value) })} disabled={disabled} />
              </Field>
              <Field label="Sem" htmlFor="t-kind">
                <SimpleSelect
                  id="t-kind"
                  value={t.kind ?? 'site'}
                  onChange={(v) => onChange({ ...t, kind: v as 'site' | 'interacao' })}
                  items={[
                    { id: 'site', name: 'acessar o site' },
                    { id: 'interacao', name: 'nenhuma interação (site, e-mail, formulário, compra)' },
                  ]}
                  disabled={disabled}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Confere de hora em hora. Só entra quem completar o prazo depois de ligar o fluxo (a base antiga não recebe tudo de uma vez). Para a base atual, use “Colocar leads de um segmento”. Dica: em Configurações, deixe “pode entrar de novo” ligado.</p>
          </>
        )}
        {t.type === 'manual' && <p className="text-xs text-muted-foreground">Ligue o fluxo e use o menu ⋯ → “Colocar leads de um segmento”.</p>}
        {(t.type === 'compra' || t.type === 'carrinho_abandonado' || t.type === 'checkout') && (
          <p className="text-xs text-muted-foreground">Vem da integração com a Magazord e do rastreamento do site. {t.type === 'compra' ? 'Desligue “Sai do fluxo quando comprar” nas Configurações.' : ''}</p>
        )}
      </div>
    </>
  )
}

function FlowSettings({ a, disabled, onChange }: { a: Automation; disabled: boolean; onChange: (p: Partial<Automation>) => void }) {
  return (
    <>
      <Field label="Nome" htmlFor="f-name">
        <Input id="f-name" maxLength={120} value={a.name} onChange={(e) => onChange({ name: e.target.value })} disabled={disabled} />
      </Field>
      <Field label="Descrição (opcional)" htmlFor="f-desc">
        <Textarea id="f-desc" rows={3} maxLength={500} value={a.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} disabled={disabled} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={a.exitOnPurchase} onCheckedChange={(v) => onChange({ exitOnPurchase: v === true })} disabled={disabled} className="mt-0.5" />
        <span>
          Sai do fluxo quando comprar
          <span className="block text-xs text-muted-foreground">Pedido pago na loja ou compra no site encerra o fluxo para o lead (não recebe mais e-mails de recuperação).</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={a.reentry === 'apos_terminar'} onCheckedChange={(v) => onChange({ reentry: v === true ? 'apos_terminar' : 'nunca' })} disabled={disabled} className="mt-0.5" />
        <span>
          Pode entrar de novo depois de terminar
          <span className="block text-xs text-muted-foreground">Ex.: o lead abandona outro carrinho no mês seguinte e passa pelo fluxo de novo (no máximo uma vez por dia).</span>
        </span>
      </label>
    </>
  )
}

function DaysInput({ value, onChange, disabled }: { value: number | undefined; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      nos últimos
      <Input type="number" min={1} max={365} className="h-8 w-20" value={value ?? 30} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} aria-label="Dias" />
      dias
    </div>
  )
}

function RuleEditor({ rule: r, ctx, disabled, onChange, onRemove }: { rule: Rule; ctx: Ctx; disabled: boolean; onChange: (r: Rule) => void; onRemove: () => void }) {
  const info = RULE_INFO[r.type]
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <div className="flex items-center gap-1">
        <Select value={`${r.type}|${r.negate ? '1' : '0'}`} onValueChange={(v) => {
          const [type, neg] = v.split('|') as [RuleType, string]
          onChange({ type, negate: neg === '1', days: RULE_INFO[type].days ? (r.days ?? 7) : undefined, ...(type === 'abriu_email' || type === 'clicou_email' ? { scope: 'ultimo' } : {}), ...(type === 'nota' ? { grades: ['A'] } : {}), ...(type === 'etapa' ? { stage: 'QUALIFICADO' } : {}) })
        }} disabled={disabled}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULES.flatMap((x) => [
              <SelectItem key={`${x.type}0`} value={`${x.type}|0`}>
                {x.label}
              </SelectItem>,
              <SelectItem key={`${x.type}1`} value={`${x.type}|1`}>
                {x.negLabel}
              </SelectItem>,
            ])}
          </SelectContent>
        </Select>
        <MiniButton label="Tirar regra" onClick={onRemove} disabled={disabled}>
          <XIcon />
        </MiniButton>
      </div>
      {(r.type === 'abriu_email' || r.type === 'clicou_email') && (
        <SimpleSelect
          value={r.scope ?? 'ultimo'}
          onChange={(v) => onChange({ ...r, scope: v as 'ultimo' | 'qualquer' })}
          items={[
            { id: 'ultimo', name: 'o último e-mail enviado por este fluxo' },
            { id: 'qualquer', name: 'qualquer e-mail' },
          ]}
          disabled={disabled}
        />
      )}
      {info.days && !((r.type === 'abriu_email' || r.type === 'clicou_email') && r.scope !== 'qualquer') && <DaysInput value={r.days} onChange={(days) => onChange({ ...r, days })} disabled={disabled} />}
      {r.type === 'tem_tag' && <Input className="h-8" placeholder="Tag" maxLength={60} value={r.tag ?? ''} onChange={(e) => onChange({ ...r, tag: e.target.value })} disabled={disabled} aria-label="Tag" />}
      {r.type === 'etapa' && <SimpleSelect value={r.stage ?? 'QUALIFICADO'} onChange={(stage) => onChange({ ...r, stage })} items={STAGES.map((s) => ({ id: s.id, name: s.label }))} disabled={disabled} />}
      {r.type === 'nota' && (
        <div className="flex gap-3">
          {['A', 'B', 'C', 'D'].map((g) => (
            <label key={g} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={(r.grades ?? []).includes(g)} onCheckedChange={(v) => onChange({ ...r, grades: v === true ? [...(r.grades ?? []), g] : (r.grades ?? []).filter((x) => x !== g) })} disabled={disabled} />
              {g}
            </label>
          ))}
        </div>
      )}
      {r.type === 'origem' && <SimpleSelect value={r.originId ?? ''} onChange={(originId) => onChange({ ...r, originId })} items={(ctx.lists?.origins ?? []).filter((o) => o.active)} disabled={disabled} placeholder="Escolha a origem" />}
      {r.type === 'vendedor' && (
        <SimpleSelect
          value={r.ownerId ?? ANY}
          onChange={(v) => onChange({ ...r, ownerId: v === ANY ? null : v })}
          items={[{ id: ANY, name: 'Qualquer (tem vendedor)' }, { id: 'nenhum', name: 'Nenhum (sem vendedor)' }, ...(ctx.lists?.sellers ?? []).filter((s) => s.active)]}
          disabled={disabled}
        />
      )}
    </div>
  )
}

function StepEditor({ step: s, ctx, disabled, onChange }: { step: Step; ctx: Ctx; disabled: boolean; onChange: (s: Step) => void }) {
  const head = <p className="text-sm text-muted-foreground">{STEP_INFO[s.type].help}</p>
  switch (s.type) {
    case 'esperar':
      return (
        <>
          {head}
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <Field label="Quanto" htmlFor="s-amount">
              <Input id="s-amount" type="number" min={1} value={s.amount} onChange={(e) => onChange({ ...s, amount: Number(e.target.value) })} disabled={disabled} />
            </Field>
            <Field label="Unidade" htmlFor="s-unit">
              <SimpleSelect id="s-unit" value={s.unit} onChange={(unit) => onChange({ ...s, unit: unit as 'minutos' | 'horas' | 'dias' })} items={[{ id: 'minutos', name: 'Minutos' }, { id: 'horas', name: 'Horas' }, { id: 'dias', name: 'Dias' }]} disabled={disabled} />
            </Field>
          </div>
        </>
      )
    case 'condicao':
      return (
        <>
          {head}
          <Field label="Seguir por Sim quando" htmlFor="s-match">
            <SimpleSelect id="s-match" value={s.match} onChange={(m) => onChange({ ...s, match: m as 'todas' | 'qualquer' })} items={[{ id: 'todas', name: 'atender a todas as regras' }, { id: 'qualquer', name: 'atender a qualquer uma das regras' }]} disabled={disabled} />
          </Field>
          <div className="space-y-2">
            {s.rules.map((r, i) => (
              <RuleEditor key={i} rule={r} ctx={ctx} disabled={disabled} onChange={(nr) => onChange({ ...s, rules: s.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => onChange({ ...s, rules: s.rules.filter((_, j) => j !== i) })} />
            ))}
          </div>
          {s.rules.length < 10 && (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...s, rules: [...s.rules, { type: 'sem_visita', days: 7, negate: false }] })}>
              <PlusIcon /> Regra
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Exemplos: “Tem carrinho abandonado (7 dias)”; “Sem acessar o site (15 dias)” ou “Não abriu o e-mail enviado por este fluxo”.</p>
        </>
      )
    case 'enviar_email': {
      const tpl = ctx.options?.templates.find((t) => t.id === s.templateId)
      return (
        <>
          {head}
          <Field label="Modelo de e-mail" htmlFor="s-tpl" hint={tpl ? `Assunto: ${tpl.subject || '(sem assunto)'}` : 'Os modelos são montados no editor visual, em Email marketing → Modelos.'}>
            <SimpleSelect id="s-tpl" value={s.templateId} onChange={(templateId) => onChange({ ...s, templateId })} items={ctx.options?.templates ?? []} disabled={disabled} placeholder="Escolha o modelo" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {tpl && (
              <Button type="button" size="sm" variant="outline" asChild>
                <a href={`/email-marketing/${tpl.id}`} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> Editar modelo
                </a>
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" asChild>
              <a href="/email-marketing?aba=modelos" target="_blank" rel="noreferrer">
                <PlusIcon /> Criar modelo
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Só vai para quem autorizou receber e-mails (LGPD). Quem não autorizou passa direto para o próximo passo. Depois de criar um modelo em outra aba, recarregue esta página para ele aparecer.</p>
        </>
      )
    }
    case 'adicionar_tag':
    case 'remover_tag':
      return (
        <>
          {head}
          <Field label="Tags (separe por vírgula)" htmlFor="s-tags">
            <Input id="s-tags" defaultValue={s.tags.join(', ')} onChange={(e) => onChange({ ...s, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) })} disabled={disabled} />
          </Field>
        </>
      )
    case 'alterar_vendedor':
      return (
        <>
          {head}
          <Field label="Vendedor" htmlFor="s-owner">
            <SimpleSelect id="s-owner" value={s.ownerId} onChange={(ownerId) => onChange({ ...s, ownerId })} items={(ctx.lists?.sellers ?? []).filter((x) => x.active)} disabled={disabled} placeholder="Escolha o vendedor" />
          </Field>
        </>
      )
    case 'alterar_etapa':
      return (
        <>
          {head}
          <Field label="Etapa" htmlFor="s-stage">
            <SimpleSelect id="s-stage" value={s.stage} onChange={(stage) => onChange({ ...s, stage })} items={STAGES.map((x) => ({ id: x.id, name: x.label }))} disabled={disabled} />
          </Field>
        </>
      )
    case 'criar_atendimento':
      return (
        <>
          {head}
          <Field label="Na fila de" htmlFor="s-seller">
            <SimpleSelect id="s-seller" value={s.ownerId ?? ANY} onChange={(v) => onChange({ ...s, ownerId: v === ANY ? null : v })} items={[{ id: ANY, name: 'Vendedor do lead (ou sem vendedor)' }, ...(ctx.lists?.sellers ?? []).filter((x) => x.active)]} disabled={disabled} />
          </Field>
          <Field label="Observação para a equipe" htmlFor="s-note" hint="Ex.: Ligar oferecendo o cupom VOLTA10. Não duplica se já houver atendimento aberto nas últimas 24 horas.">
            <Textarea id="s-note" rows={3} maxLength={1000} value={s.note} onChange={(e) => onChange({ ...s, note: e.target.value })} disabled={disabled} />
          </Field>
        </>
      )
    case 'notificar':
      return (
        <>
          {head}
          <Field label="Quem recebe" htmlFor="s-users">
            <MultiSelect id="s-users" items={(ctx.options?.users ?? []).map((u) => ({ id: u.id, name: u.name }))} value={s.userIds} onChange={(userIds) => onChange({ ...s, userIds })} placeholder="Escolha as pessoas" disabled={disabled} />
          </Field>
          <Field label="Mensagem" htmlFor="s-msg" hint="Variáveis: {nome}, {email}, {telefone}, {automacao}. O link do lead vai junto.">
            <Textarea id="s-msg" rows={4} maxLength={1000} value={s.message} onChange={(e) => onChange({ ...s, message: e.target.value })} disabled={disabled} />
          </Field>
        </>
      )
    case 'encerrar':
      return head
  }
}

// ---------- Relatório ----------

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="py-4">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function ReportView({ a, report: r, error, onRetry }: { a: Automation; report: AutomationReport | undefined; error: unknown; onRetry: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [run, setRun] = useState<AutomationReport['runs'][number] | null>(null)
  const names = useMemo(() => {
    const m = new Map<string, string>()
    const walk = (l: Step[]) => l.forEach((s) => (m.set(s.id, STEP_INFO[s.type].label), s.type === 'condicao' && (walk(s.yes), walk(s.no))))
    walk(a.steps)
    return m
  }, [a.steps])
  const logs = useQuery({ queryKey: ['automacao-logs', run?.id], queryFn: () => api.get<RunLog[]>(`/automacoes/${a.id}/execucoes/${run!.id}`), enabled: !!run })
  const removeRun = useMutation({
    mutationFn: (id: string) => api.post(`/automacoes/${a.id}/execucoes/${id}/remover`),
    onSuccess: () => {
      setRun(null)
      void qc.invalidateQueries({ queryKey: ['automacao-relatorio', a.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!r) return <TableSkeleton rows={4} />
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entraram" value={int.format(r.entered)} hint={`${int.format(r.running)} no fluxo agora`} />
        <Stat label="Concluíram" value={int.format(r.completed)} hint={`${int.format(r.exited)} saíram antes · ${int.format(r.errors)} com erro`} />
        <Stat label="E-mails enviados" value={int.format(r.emails.sent)} hint={`${pct(r.emails.opened, r.emails.sent)} abriram · ${pct(r.emails.clicked, r.emails.sent)} clicaram`} />
        <Stat label="Vendas" value={brl.format(r.sales.revenue)} hint={`${int.format(r.sales.orders)} pedido(s) pago(s) até ${r.sales.days} dias depois de entrar`} />
      </div>
      <Card className="overflow-hidden py-0">
        <CardHeader className="pt-6">
          <CardTitle className="text-base">Últimos leads no fluxo</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Lead</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Onde está / motivo</TableHead>
              <TableHead className="pr-4">Entrou</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.runs.map((x) => (
              <TableRow key={x.id} className="cursor-pointer" onClick={() => setRun(x)}>
                <TableCell className="pl-4">
                  <span className="font-medium">{x.lead.name ?? x.lead.email ?? 'Lead'}</span>
                  {x.lead.name && x.lead.email && <span className="block text-xs text-muted-foreground">{x.lead.email}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={RUN_STATUS[x.status].tone}>
                    {RUN_STATUS[x.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs text-sm">
                  {x.status === 'ATIVO' ? `${names.get(x.stepId ?? '') ?? '—'}${x.nextRunAt ? ` · próximo passo ${formatDateTime(x.nextRunAt)}` : ''}` : (x.exitReason ?? '—')}
                </TableCell>
                <TableCell className="pr-4 text-sm whitespace-nowrap">{formatDateTime(x.startedAt)}</TableCell>
              </TableRow>
            ))}
            {!r.runs.length && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  <BotIcon className="mx-auto mb-2 size-6" />
                  Ninguém entrou ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!run} onOpenChange={(v) => !v && setRun(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{run?.lead.name ?? run?.lead.email ?? 'Lead'}</DialogTitle>
            <DialogDescription>O que aconteceu com este lead no fluxo, passo a passo.</DialogDescription>
          </DialogHeader>
          {logs.isLoading ? (
            <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
          ) : (
            <ol className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
              {(logs.data ?? []).map((l) => (
                <li key={l.id} className="border-l-2 pl-3">
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(l.createdAt)}
                    {l.stepId && names.get(l.stepId) ? ` · ${names.get(l.stepId)}` : ''}
                  </span>
                  <span className={cn(l.kind === 'erro' && 'text-destructive')}>{l.message}</span>
                </li>
              ))}
            </ol>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {run && (
              <Button variant="outline" asChild>
                <Link to={`/leads/${run.lead.id}`}>Abrir o lead</Link>
              </Button>
            )}
            {run?.status === 'ATIVO' && can('automacoes', 'edit') && (
              <Button variant="ghost" onClick={() => confirm('Tirar este lead do fluxo? Ele não recebe mais nenhum passo.') && removeRun.mutate(run.id)} disabled={removeRun.isPending}>
                Tirar do fluxo
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EnrollDialog({ open, onOpenChange, automationId, segments }: { open: boolean; onOpenChange: (v: boolean) => void; automationId: string; segments: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const [segmentId, setSegmentId] = useState('')
  const enroll = useMutation({
    mutationFn: () => api.post<{ total: number; entered: number }>(`/automacoes/${automationId}/inscrever`, { segmentId }),
    onSuccess: (r) => {
      toast.success(`${int.format(r.entered)} de ${int.format(r.total)} lead(s) entraram no fluxo.${r.entered < r.total ? ' Os demais já estavam nele ou já passaram por ele.' : ''}`)
      onOpenChange(false)
      void qc.invalidateQueries({ queryKey: ['automacao-relatorio', automationId] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colocar leads de um segmento</DialogTitle>
          <DialogDescription>Todos os leads do segmento entram agora no fluxo (quem já está nele ou já passou e não pode entrar de novo fica de fora). Os segmentos são criados em Email marketing → Segmentos.</DialogDescription>
        </DialogHeader>
        <SimpleSelect value={segmentId} onChange={setSegmentId} items={segments} placeholder="Escolha o segmento" />
        <DialogFooter>
          <Button onClick={() => enroll.mutate()} disabled={!segmentId || enroll.isPending}>
            {enroll.isPending && <Loader2Icon className="animate-spin" />}
            Colocar no fluxo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

