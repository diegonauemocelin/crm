import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, BotIcon, Loader2Icon, MessageSquareIcon, PencilIcon, PlayIcon, PlusIcon, RotateCcwIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

type StepType = 'mensagem' | 'menu' | 'pergunta' | 'transferir' | 'encerrar'
interface Go {
  next?: string | null
  sectorId?: string | null
  userId?: string | null
}
interface Step {
  id: string
  type: StepType
  text: string
  options?: (Go & { label: string })[]
  go?: Go
  label?: string
}
interface FlowRow {
  id: string
  name: string
  description: string | null
  active: boolean
  numberIds: string[]
  trigger: 'NOVA_CONVERSA' | 'PALAVRA'
  keywords: string[]
  onlyAfterHours: boolean
  timeoutMinutes: number
  steps: Step[]
  startStepId: string
}
interface Data {
  flows: FlowRow[]
  sectors: { id: string; name: string }[]
  users: { id: string; name: string }[]
  numbers: { id: string; name: string }[]
}

const TYPE_INFO: Record<StepType, { label: string; help: string }> = {
  mensagem: { label: 'Mensagem', help: 'Envia o texto e segue para a próxima etapa.' },
  menu: { label: 'Menu de opções', help: 'Mostra opções numeradas; o cliente responde com o número ou o nome.' },
  pergunta: { label: 'Pergunta', help: 'Pergunta e guarda a resposta (vai como nota para quem atender).' },
  transferir: { label: 'Transferir', help: 'Passa a conversa para um setor ou uma pessoa. O robô sai.' },
  encerrar: { label: 'Encerrar o robô', help: 'Envia o texto (opcional) e deixa a conversa na fila geral.' },
}

const KEY = ['whatsapp-fluxos']
const uid = () => Math.random().toString(36).slice(2, 10)

/** Modelo pronto para começar: boas-vindas, menu e transferência por setor. */
function template(sectors: Data['sectors']): Pick<FlowRow, 'steps' | 'startStepId'> {
  const [a, b] = sectors
  return {
    startStepId: 'boas-vindas',
    steps: [
      { id: 'boas-vindas', type: 'mensagem', text: 'Olá, {nome}! Obrigado por chamar. Vou te direcionar para o atendimento certo.', go: { next: 'menu' } },
      {
        id: 'menu',
        type: 'menu',
        text: 'Como podemos ajudar?',
        options: [
          { label: 'Comprar peças / orçamento', next: 'maquina' },
          { label: a ? `Falar com ${a.name}` : 'Falar com um atendente', ...(a ? { sectorId: a.id } : { next: null }) },
          ...(b ? [{ label: `Falar com ${b.name}`, sectorId: b.id }] : []),
        ],
      },
      { id: 'maquina', type: 'pergunta', label: 'Máquina e peça', text: 'Qual a marca, o modelo da máquina e a peça que você procura? (se tiver o código da peça, mande também)', go: { next: 'fim' } },
      { id: 'fim', type: 'transferir', text: 'Obrigado! Um vendedor já vai te atender.', go: a ? { sectorId: a.id } : {} },
    ],
  }
}

/** Chatbot de atendimento: lista de fluxos, editor de etapas e simulador. */
export function ChatbotSettings() {
  const { can } = useAuth()
  const editable = can('whatsapp', 'edit')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<Data>('/whatsapp/fluxos') })
  const [editing, setEditing] = useState<FlowRow | 'novo' | null>(null)
  const toggle = useMutation({
    mutationFn: (d: { id: string; active: boolean }) => api.post(`/whatsapp/fluxos/${d.id}/situacao`, { active: d.active }),
    onSuccess: (_r, d) => {
      void qc.invalidateQueries({ queryKey: KEY })
      toast.success(d.active ? 'Fluxo ligado: o robô já atende os próximos clientes.' : 'Fluxo desligado.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  const d = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          O robô recebe o cliente que chama sem atendente, mostra um menu, faz perguntas e passa a conversa para o setor ou a pessoa certa, com as respostas como nota. Quando uma pessoa responde (pelo CRM ou pelo celular), o robô sai. Não usa IA. Números com “atendente padrão” não passam pelo robô.
        </p>
        {editable && (
          <Button onClick={() => setEditing('novo')}>
            <PlusIcon /> Novo fluxo
          </Button>
        )}
      </div>
      {d.flows.length === 0 ? (
        <EmptyState icon={BotIcon} title="Nenhum fluxo ainda" description="Crie o primeiro fluxo a partir do modelo pronto: boas-vindas, menu e transferência para os setores." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {d.flows.map((f) => (
            <Card key={f.id} className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <BotIcon className="size-4 text-muted-foreground" /> {f.name}
                  </span>
                  <label className="flex items-center gap-2 text-xs font-normal">
                    {f.active ? 'Ligado' : 'Desligado'}
                    <Switch checked={f.active} onCheckedChange={(active) => toggle.mutate({ id: f.id, active })} disabled={!editable || toggle.isPending} aria-label={`Ligar o fluxo ${f.name}`} />
                  </label>
                </CardTitle>
                {f.description && <CardDescription>{f.description}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-1.5 px-4 text-sm">
                <p>
                  <span className="text-muted-foreground">Começa: </span>
                  {f.trigger === 'PALAVRA' ? `quando o cliente escrever ${f.keywords.map((k) => `“${k}”`).join(', ')}` : 'cliente sem atendente chama (conversa nova ou parada)'}
                  {f.onlyAfterHours && ' · só fora do horário'}
                </p>
                <p>
                  <span className="text-muted-foreground">Números: </span>
                  {f.numberIds.length ? f.numberIds.map((id) => d.numbers.find((n) => n.id === id)?.name ?? '—').join(', ') : 'todos'}
                </p>
                <p className="text-muted-foreground">
                  {f.steps.length} etapa(s) · sai depois de {f.timeoutMinutes} min sem resposta
                </p>
                {editable && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(f)}>
                    <PencilIcon /> Editar e testar
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && <FlowEditor flow={editing === 'novo' ? null : editing} data={d} onClose={() => setEditing(null)} />}
    </div>
  )
}

const NONE = '__none__'

/** Para onde vai: próxima etapa, setor, pessoa ou fim (fila). */
function GoPicker({ value, onChange, steps, data, selfId, allowEnd = true }: { value: Go; onChange: (g: Go) => void; steps: Step[]; data: Data; selfId: string; allowEnd?: boolean }) {
  const current = value.sectorId ? `s:${value.sectorId}` : value.userId ? `u:${value.userId}` : value.next ? `e:${value.next}` : NONE
  const label = (s: Step, i: number) => `${i + 1}. ${TYPE_INFO[s.type].label}${s.text ? `: ${s.text.slice(0, 40)}` : ''}`
  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NONE ? {} : v.startsWith('s:') ? { sectorId: v.slice(2) } : v.startsWith('u:') ? { userId: v.slice(2) } : { next: v.slice(2) })}
    >
      <SelectTrigger className="w-full" aria-label="Para onde vai">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowEnd && <SelectItem value={NONE}>Fila geral (o robô sai)</SelectItem>}
        <SelectGroup>
          <SelectLabel>Ir para a etapa</SelectLabel>
          {steps.map((s, i) =>
            s.id === selfId ? null : (
              <SelectItem key={s.id} value={`e:${s.id}`}>
                {label(s, i)}
              </SelectItem>
            ),
          )}
        </SelectGroup>
        {data.sectors.length > 0 && (
          <SelectGroup>
            <SelectLabel>Transferir para o setor</SelectLabel>
            {data.sectors.map((s) => (
              <SelectItem key={s.id} value={`s:${s.id}`}>
                Setor {s.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Transferir para a pessoa</SelectLabel>
          {data.users.map((u) => (
            <SelectItem key={u.id} value={`u:${u.id}`}>
              {u.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function FlowEditor({ flow, data, onClose }: { flow: FlowRow | null; data: Data; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => {
    const t = flow ?? { ...template(data.sectors), name: 'Atendimento inicial', description: '', numberIds: [], trigger: 'NOVA_CONVERSA' as const, keywords: [], onlyAfterHours: false, timeoutMinutes: 30 }
    return { name: t.name, description: t.description ?? '', numberIds: t.numberIds, trigger: t.trigger, keywords: t.keywords.join(', '), onlyAfterHours: t.onlyAfterHours, timeoutMinutes: t.timeoutMinutes, steps: t.steps, startStepId: t.startStepId }
  })
  const [initial] = useState(f)
  const confirm = useConfirm()
  const guard = useCloseGuard(isDirty(initial, f), onClose, 'o fluxo')
  const setStep = (i: number, patch: Partial<Step>) => setF((x) => ({ ...x, steps: x.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  const move = (i: number, d: -1 | 1) => setF((x) => {
    const steps = [...x.steps]
    const j = i + d
    if (j < 0 || j >= steps.length) return x
    ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
    return { ...x, steps }
  })
  const removeStep = (i: number) => setF((x) => {
    const gone = x.steps[i]!.id
    const clear = (g?: Go) => (g?.next === gone ? { ...g, next: null } : g)
    const steps = x.steps.filter((_, k) => k !== i).map((s) => ({ ...s, go: clear(s.go), options: s.options?.map((o) => ({ ...o, ...clear(o) })) }))
    return { ...x, steps, startStepId: x.startStepId === gone ? (steps[0]?.id ?? '') : x.startStepId }
  })
  const addStep = (type: StepType) => setF((x) => {
    const step: Step = { id: uid(), type, text: '', ...(type === 'menu' ? { options: [{ label: '', next: null }] } : { go: {} }) }
    return { ...x, steps: [...x.steps, step], startStepId: x.startStepId || step.id }
  })
  const body = () => ({
    name: f.name,
    description: f.description || null,
    numberIds: f.numberIds,
    trigger: f.trigger,
    keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    onlyAfterHours: f.onlyAfterHours,
    timeoutMinutes: Number(f.timeoutMinutes) || 30,
    steps: f.steps,
    startStepId: f.startStepId,
  })
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: KEY })
    toast.success(msg)
    onClose()
  }
  const save = useMutation({
    mutationFn: () => (flow ? api.put(`/whatsapp/fluxos/${flow.id}`, body()) : api.post('/whatsapp/fluxos', body())),
    onSuccess: () => done(flow ? 'Fluxo salvo.' : 'Fluxo criado. Ligue quando estiver pronto.'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/whatsapp/fluxos/${flow!.id}`),
    onSuccess: () => done('Fluxo excluído.'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const askRemove = async () => {
    if (await confirm({ title: `Excluir o fluxo “${flow!.name}”?`, description: 'O robô deixa de atender por este fluxo e as etapas se perdem. Não dá para desfazer.', confirmLabel: 'Excluir fluxo' })) remove.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{flow ? `Fluxo ${flow.name}` : 'Novo fluxo de atendimento'}</DialogTitle>
          <DialogDescription>Monte as etapas e teste ao lado antes de ligar. Use {'{nome}'} para o primeiro nome do cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fl-name">Nome</Label>
                <Input id="fl-name" autoFocus maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fl-desc">Descrição (opcional)</Label>
                <Input id="fl-desc" maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Quando começa</Label>
                <Select value={f.trigger} onValueChange={(v) => setF({ ...f, trigger: v as FlowRow['trigger'] })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOVA_CONVERSA">Cliente sem atendente chama (conversa nova ou parada)</SelectItem>
                    <SelectItem value="PALAVRA">Quando o cliente escrever uma palavra-chave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.trigger === 'PALAVRA' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="fl-kw">Palavras-chave (separe por vírgula)</Label>
                  <Input id="fl-kw" placeholder="garantia, defeito, troca" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="fl-num">Números</Label>
                  <MultiSelect id="fl-num" items={data.numbers} value={f.numberIds} onChange={(numberIds) => setF({ ...f, numberIds })} placeholder="Todos os números" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="fl-timeout">Sem resposta do cliente, o robô sai depois de (minutos)</Label>
                <Input id="fl-timeout" type="number" min={5} max={1440} className="w-28" value={f.timeoutMinutes} onChange={(e) => setF({ ...f, timeoutMinutes: Number(e.target.value) })} />
              </div>
              <label className="flex items-center justify-between gap-3 self-end rounded-md border p-2.5 text-sm">
                Só fora do horário comercial
                <Switch checked={f.onlyAfterHours} onCheckedChange={(onlyAfterHours) => setF({ ...f, onlyAfterHours })} />
              </label>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Etapas</h3>
              {f.steps.map((s, i) => (
                <Card key={s.id} className={cn('gap-3 py-3', f.startStepId === s.id && 'border-[color:var(--brand)]')}>
                  <CardContent className="space-y-3 px-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="tabular-nums">
                        {i + 1}
                      </Badge>
                      <Select value={s.type} onValueChange={(v) => setStep(i, { type: v as StepType, ...(v === 'menu' ? { options: s.options?.length ? s.options : [{ label: '', next: null }] } : { go: s.go ?? {} }) })}>
                        <SelectTrigger size="sm" className="w-44" aria-label="Tipo da etapa">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TYPE_INFO) as StepType[]).map((t) => (
                            <SelectItem key={t} value={t}>
                              {TYPE_INFO[t].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {f.startStepId === s.id ? (
                        <Badge className="bg-[color:var(--brand)] text-white">Etapa inicial</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setF({ ...f, startStepId: s.id })}>
                          Começar por aqui
                        </Button>
                      )}
                      <span className="ml-auto flex">
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => move(i, -1)} aria-label="Subir etapa" disabled={i === 0}>
                          <ArrowUpIcon />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => move(i, 1)} aria-label="Descer etapa" disabled={i === f.steps.length - 1}>
                          <ArrowDownIcon />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => removeStep(i)} aria-label={`Remover etapa ${i + 1}`}>
                          <Trash2Icon />
                        </Button>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{TYPE_INFO[s.type].help}</p>
                    {s.type === 'pergunta' && (
                      <Input aria-label="Nome da resposta" maxLength={60} placeholder="Nome da resposta (ex.: Modelo da máquina)" value={s.label ?? ''} onChange={(e) => setStep(i, { label: e.target.value })} />
                    )}
                    <Textarea rows={s.type === 'menu' ? 2 : 3} maxLength={1000} placeholder={s.type === 'menu' ? 'Pergunta do menu (ex.: Como podemos ajudar?)' : s.type === 'transferir' || s.type === 'encerrar' ? 'Mensagem (opcional)' : 'Mensagem para o cliente'} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} aria-label="Mensagem da etapa" />
                    {s.type === 'menu' ? (
                      <div className="space-y-2">
                        {(s.options ?? []).map((o, k) => (
                          <div key={k} className="grid items-center gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem]">
                            <span className="text-sm font-medium tabular-nums">{k + 1}.</span>
                            <Input aria-label={`Opção ${k + 1}`} maxLength={60} placeholder="Texto da opção" value={o.label} onChange={(e) => setStep(i, { options: s.options!.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })} />
                            <GoPicker value={o} onChange={(g) => setStep(i, { options: s.options!.map((x, m) => (m === k ? { label: x.label, ...g } : x)) })} steps={f.steps} data={data} selfId={s.id} />
                            <Button size="icon" variant="ghost" className="size-8" onClick={() => setStep(i, { options: s.options!.filter((_, m) => m !== k) })} aria-label={`Remover opção ${k + 1}`}>
                              <Trash2Icon />
                            </Button>
                          </div>
                        ))}
                        <Button size="sm" variant="outline" onClick={() => setStep(i, { options: [...(s.options ?? []), { label: '', next: null }] })} disabled={(s.options?.length ?? 0) >= 12}>
                          <PlusIcon /> Opção
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{s.type === 'transferir' ? 'Para quem vai' : s.type === 'encerrar' ? 'Depois' : 'Depois, vai para'}</Label>
                        {s.type === 'encerrar' ? (
                          <p className="text-sm">Fila geral do número (o robô sai).</p>
                        ) : (
                          <GoPicker value={s.go ?? {}} onChange={(go) => setStep(i, { go })} steps={f.steps} data={data} selfId={s.id} allowEnd={s.type !== 'transferir'} />
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TYPE_INFO) as StepType[]).map((t) => (
                  <Button key={t} size="sm" variant="outline" onClick={() => addStep(t)} disabled={f.steps.length >= 60}>
                    <PlusIcon /> {TYPE_INFO[t].label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <Simulator steps={f.steps} startStepId={f.startStepId} data={data} />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {flow ? (
            <Button variant="ghost" className="text-destructive" onClick={() => void askRemove()} disabled={remove.isPending}>
              <Trash2Icon /> Excluir fluxo
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Outcome {
  messages: string[]
  state: { stepId: string; tries: number; answers: { label: string; text: string }[] } | null
  transfer?: { sectorId: string | null; userId: string | null }
  ended?: string
  answers?: { label: string; text: string }[]
}

/** Conversa de teste com o fluxo, como o cliente veria no WhatsApp (sem enviar nada de verdade). */
function Simulator({ steps, startStepId, data }: { steps: Step[]; startStepId: string; data: Data }) {
  const [lines, setLines] = useState<{ from: 'bot' | 'cliente' | 'info'; text: string }[]>([])
  const [state, setState] = useState<Outcome['state']>(null)
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const call = useMutation({
    mutationFn: (d: { state: Outcome['state']; text: string }) => api.post<Outcome>('/whatsapp/fluxos/simular', { steps, startStepId, state: d.state, text: d.text, name: 'Cliente Teste' }),
    onSuccess: (r) => {
      const out: typeof lines = r.messages.map((m) => ({ from: 'bot' as const, text: m }))
      if (!r.state) {
        const to = r.transfer?.userId ? data.users.find((u) => u.id === r.transfer!.userId)?.name : r.transfer?.sectorId ? `setor ${data.sectors.find((s) => s.id === r.transfer!.sectorId)?.name}` : 'fila geral'
        out.push({ from: 'info', text: `O robô saiu: conversa passada para ${to}.${r.answers?.length ? ` Respostas: ${r.answers.map((a) => `${a.label}: ${a.text}`).join('; ')}` : ''}` })
        setRunning(false)
      }
      setLines((l) => [...l, ...out])
      setState(r.state)
    },
    onError: (err) => {
      toast.error(errorMessage(err))
      setRunning(false)
    },
  })
  const start = () => {
    setLines([{ from: 'cliente', text: 'Olá, bom dia!' }])
    setRunning(true)
    call.mutate({ state: null, text: 'Olá, bom dia!' })
  }
  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !state) return
    setLines((l) => [...l, { from: 'cliente', text }])
    call.mutate({ state, text })
    setText('')
  }
  return (
    <div className="flex h-[36rem] flex-col overflow-hidden rounded-lg border lg:sticky lg:top-0">
      <div className="flex items-center justify-between gap-2 border-b bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquareIcon className="size-4" /> Testar o fluxo
        </p>
        <Button size="sm" variant="outline" onClick={start} disabled={call.isPending || !steps.length}>
          {lines.length ? <RotateCcwIcon /> : <PlayIcon />} {lines.length ? 'Recomeçar' : 'Começar'}
        </Button>
      </div>
      <div className="wa-wallpaper min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {!lines.length && <p className="rounded-md bg-white/80 p-2 text-center text-xs text-muted-foreground dark:bg-black/30">Clique em Começar: você faz o papel do cliente. Nada é enviado de verdade.</p>}
        {lines.map((l, i) =>
          l.from === 'info' ? (
            <p key={i} className="mx-auto w-fit rounded-md bg-amber-100 px-2 py-1 text-center text-xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
              {l.text}
            </p>
          ) : (
            <div key={i} className={cn('flex', l.from === 'cliente' ? 'justify-end' : 'justify-start')}>
              <p className={cn('max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] whitespace-pre-wrap shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]', l.from === 'cliente' ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]')}>
                {l.text.replace(/\*(\d+)\.\*/g, '$1.')}
              </p>
            </div>
          ),
        )}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t bg-[#f0f2f5] p-2 dark:bg-[#202c33]">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={running ? 'Responda como o cliente' : 'Clique em Começar'} disabled={!running || !state} className="bg-white dark:bg-[#2a3942]" aria-label="Resposta do cliente" />
        <Button type="submit" size="icon" disabled={!running || !state || call.isPending} aria-label="Enviar resposta de teste">
          {call.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </form>
    </div>
  )
}
