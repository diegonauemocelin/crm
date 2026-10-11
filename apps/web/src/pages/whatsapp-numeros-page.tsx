import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, Loader2Icon, PencilIcon, PlugIcon, PlusIcon, SmartphoneIcon, Trash2Icon, UnplugIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, namesOf, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'

type Status = 'CONECTADO' | 'CONECTANDO' | 'DESCONECTADO'
interface WaNumber {
  id: string
  name: string
  phone: string | null
  profileName: string | null
  status: Status
  statusReason: string | null
  unitId: string | null
  sellerIds: string[]
  createRecords: boolean
  signMessages: boolean
  connectedAt: string | null
  disconnectedAt: string | null
}
interface ListData {
  numbers: WaNumber[]
  limits: { maxNumbers: number; maxConnected: number; connected: number; registered: number }
  service: { configured: boolean; online: boolean; version: string | null; error: string | null }
}
interface QrData {
  status: Status
  qr: string | null
  phone: string | null
  profileName: string | null
  statusReason: string | null
}

const STATUS: Record<Status, { label: string; className: string }> = {
  CONECTADO: { label: 'Conectado', className: 'border-transparent bg-[#006300]/12 text-[#006300] dark:bg-[#0ca30c]/15 dark:text-[#0ca30c]' },
  CONECTANDO: { label: 'Aguardando o QR Code', className: 'border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  DESCONECTADO: { label: 'Desconectado', className: 'border-transparent bg-muted text-muted-foreground' },
}
const NONE = '__none__'

export function WhatsappNumerosPage() {
  return (
    <RequirePermission module="whatsapp">
      <Numbers />
    </RequirePermission>
  )
}

function Numbers() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['whatsapp-numeros'], queryFn: () => api.get<ListData>('/whatsapp/numeros'), refetchInterval: 30_000 })
  const options = useOptions()
  const names = namesOf(options.data)
  const [editing, setEditing] = useState<WaNumber | 'novo' | null>(null)
  const [connecting, setConnecting] = useState<WaNumber | null>(null)
  const [confirm, setConfirm] = useState<{ n: WaNumber; kind: 'desconectar' | 'excluir' } | null>(null)
  const d = q.data
  const full = !!d && d.limits.registered >= d.limits.maxNumbers
  const slotsFull = !!d && d.limits.connected >= d.limits.maxConnected
  return (
    <div>
      <PageHeader
        title="Números de WhatsApp"
        description="Números da empresa ligados ao CRM pela leitura do QR Code no WhatsApp Business do celular."
        actions={
          can('whatsapp', 'create') && (
            <Button onClick={() => setEditing('novo')} disabled={!d || full} title={full ? 'Limite de números cadastrados atingido' : undefined}>
              <PlusIcon /> Cadastrar número
            </Button>
          )
        }
      />
      {q.isLoading && <TableSkeleton rows={4} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-4">
          {!d.service.configured ? (
            <Notice>O WhatsApp ainda não foi ligado no servidor. Quem cuida da VPS roda: sudo bash deploy/whatsapp.sh ativar</Notice>
          ) : !d.service.online ? (
            <Notice>O serviço de WhatsApp não está respondendo. {d.service.error}</Notice>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Count label="Números cadastrados" value={`${d.limits.registered} de ${d.limits.maxNumbers}`} />
            <Count label="Conectados agora" value={`${d.limits.connected} de ${d.limits.maxConnected}`} hint={slotsFull ? 'Para conectar outro, desconecte um.' : undefined} />
            <Count label="Serviço" value={d.service.online ? `Ativo${d.service.version ? ` · v${d.service.version}` : ''}` : d.service.configured ? 'Sem resposta' : 'Desligado'} />
          </div>
          {d.numbers.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhum número cadastrado. Cadastre um por vendedor ou setor (ex.: Vendas Paraná).</CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {d.numbers.map((n) => (
                <Card key={n.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{n.name}</CardTitle>
                      <CardDescription className="flex items-center gap-1.5">
                        <SmartphoneIcon className="size-3.5" />
                        {n.phone ? formatPhone(n.phone) : 'Número aparece depois de conectar'}
                        {n.profileName ? ` · ${n.profileName}` : ''}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={STATUS[n.status].className}>
                      {STATUS[n.status].label}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      {n.unitId ? `${names.get(n.unitId) ?? 'Unidade'} · ` : ''}
                      {n.sellerIds.length ? n.sellerIds.map((id) => names.get(id) ?? '—').join(', ') : 'Sem vendedor definido'}
                    </p>
                    {n.status === 'CONECTADO' && n.connectedAt && <p className="text-xs text-muted-foreground">Conectado desde {formatDateTime(n.connectedAt)}</p>}
                    {n.status === 'DESCONECTADO' && n.statusReason && (
                      <p className="text-xs text-muted-foreground">
                        {n.statusReason}
                        {n.disconnectedAt ? ` · ${formatDateTime(n.disconnectedAt)}` : ''}
                      </p>
                    )}
                    {can('whatsapp', 'edit') && (
                      <div className="flex flex-wrap gap-2">
                        {n.status === 'CONECTADO' ? (
                          <Button size="sm" variant="outline" onClick={() => setConfirm({ n, kind: 'desconectar' })}>
                            <UnplugIcon /> Desconectar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => setConnecting(n)}
                            disabled={!d.service.online || (n.status !== 'CONECTANDO' && slotsFull)}
                            title={slotsFull && n.status !== 'CONECTANDO' ? `Limite de ${d.limits.maxConnected} conectados ao mesmo tempo` : undefined}
                          >
                            <PlugIcon /> {n.status === 'CONECTANDO' ? 'Mostrar QR Code' : 'Conectar'}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(n)}>
                          <PencilIcon /> Editar
                        </Button>
                        {can('whatsapp', 'delete') && (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ n, kind: 'excluir' })} aria-label={`Excluir ${n.name}`}>
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Use os números só para conversas com clientes (responder quem chamou). Envio em massa por aqui pode fazer o WhatsApp bloquear o número.
          </p>
          <Rules editable={can('whatsapp', 'edit')} />
          <CompanyContacts editable={can('whatsapp', 'edit')} />
          <QuickReplies editable={can('whatsapp', 'edit')} />
        </div>
      )}
      {editing && <NumberDialog number={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />}
      {connecting && <ConnectDialog number={connecting} onClose={() => setConnecting(null)} />}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
      <span>{children}</span>
    </p>
  )
}

function Count({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function NumberDialog({ number, onClose }: { number: WaNumber | null; onClose: () => void }) {
  const qc = useQueryClient()
  const options = useOptions()
  const [name, setName] = useState(number?.name ?? '')
  const [unitId, setUnitId] = useState<string | null>(number?.unitId ?? null)
  const [sellerIds, setSellerIds] = useState<string[]>(number?.sellerIds ?? [])
  const [createRecords, setCreateRecords] = useState(number?.createRecords ?? true)
  const [signMessages, setSignMessages] = useState(number?.signMessages ?? true)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, unitId, sellerIds, createRecords, signMessages }
      return number ? api.put(`/whatsapp/numeros/${number.id}`, body) : api.post('/whatsapp/numeros', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] })
      toast.success(number ? 'Número atualizado.' : 'Número cadastrado. Agora clique em Conectar e leia o QR Code.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{number ? 'Editar número' : 'Cadastrar número'}</DialogTitle>
            <DialogDescription>O número do WhatsApp é preenchido sozinho quando o celular ler o QR Code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="wa-n-name">Nome</Label>
            <Input id="wa-n-name" required minLength={2} maxLength={80} placeholder="Ex.: Vendas Paraná" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-n-unit">Unidade</Label>
            <Select value={unitId ?? NONE} onValueChange={(v) => setUnitId(v === NONE ? null : v)}>
              <SelectTrigger id="wa-n-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem unidade</SelectItem>
                {options.data?.units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-n-sellers">Vendedores que atendem por este número</Label>
            <MultiSelect id="wa-n-sellers" items={options.data?.sellers ?? []} value={sellerIds} onChange={setSellerIds} placeholder="Selecione os vendedores" />
            <p className="text-xs text-muted-foreground">Com um vendedor só, os contatos novos vão para a fila dele.</p>
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Este número abre pré-venda
              <span className="block text-xs text-muted-foreground">Desligue em números que não são de venda (ex.: financeiro). O histórico no lead segue as regras do WhatsApp, abaixo na página.</span>
            </span>
            <Switch checked={createRecords} onCheckedChange={setCreateRecords} />
          </label>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Assinar as mensagens enviadas pelo CRM
              <span className="block text-xs text-muted-foreground">Começam com o nome de quem enviou (ex.: *Diego:*), para o cliente saber com quem fala.</span>
            </span>
            <Switch checked={signMessages} onCheckedChange={setSignMessages} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Pede a conexão e mostra o QR Code, consultando a cada 3 s até o celular ler. */
function ConnectDialog({ number, onClose }: { number: WaNumber; onClose: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => api.post<QrData>(`/whatsapp/numeros/${number.id}/conectar`),
    onError: (err) => setError(errorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] }),
  })
  // Só começa uma vez ao abrir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    start.mutate()
  }, [])
  const poll = useQuery({
    queryKey: ['whatsapp-qr', number.id],
    queryFn: () => api.get<QrData>(`/whatsapp/numeros/${number.id}/qr`),
    enabled: start.isSuccess,
    refetchInterval: (q) => (q.state.data?.status === 'CONECTANDO' || !q.state.data ? 3000 : false),
  })
  const data = poll.data ?? start.data
  useEffect(() => {
    if (data?.status === 'CONECTADO') {
      toast.success(`Conectado${data.phone ? `: ${formatPhone(data.phone)}` : ''}.`)
      void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] })
      onClose()
    }
  }, [data?.status, data?.phone, onClose, qc])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar {number.name}</DialogTitle>
          <DialogDescription>
            No celular, abra o WhatsApp Business → toque nos três pontinhos (ou em Configurações) → Aparelhos conectados → Conectar um aparelho, e aponte para o QR Code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-72 items-center justify-center">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : data?.qr ? (
            <img src={data.qr} alt="QR Code para conectar o WhatsApp" className="size-64 rounded-md border bg-white p-2" />
          ) : data?.status === 'DESCONECTADO' ? (
            <p className="text-center text-sm text-muted-foreground">{data.statusReason ?? 'A conexão foi cancelada.'} Feche e tente de novo.</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Gerando o QR Code…
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">O QR Code se renova sozinho. Sem leitura em 3 minutos, a conexão é cancelada e libera a vaga.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({ n, kind, onClose }: { n: WaNumber; kind: 'desconectar' | 'excluir'; onClose: () => void }) {
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: () => (kind === 'desconectar' ? api.post(`/whatsapp/numeros/${n.id}/desconectar`) : api.delete(`/whatsapp/numeros/${n.id}`)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] })
      toast.success(kind === 'desconectar' ? 'Número desconectado. A vaga de conexão foi liberada.' : 'Número excluído.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{kind === 'desconectar' ? `Desconectar ${n.name}?` : `Excluir ${n.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'desconectar'
              ? 'O CRM para de receber e enviar mensagens por este número. Para voltar, será preciso ler o QR Code de novo. O WhatsApp no celular continua funcionando normalmente.'
              : 'O número sai do CRM e a conexão com o celular é encerrada. Para usar de novo, cadastre e conecte outra vez.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              run.mutate()
            }}
            disabled={run.isPending}
          >
            {kind === 'desconectar' ? 'Desconectar' : 'Excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface QuickReply {
  id: string
  title: string
  text: string
}

/** Respostas rápidas do chat. {nome} vira o primeiro nome do cliente e {vendedor} o de quem envia. */
function QuickReplies({ editable }: { editable: boolean }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['chat-respostas-admin'], queryFn: () => api.get<QuickReply[]>('/chat/respostas') })
  const [editing, setEditing] = useState<QuickReply | 'nova' | null>(null)
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/respostas/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-respostas-admin'] })
      toast.success('Resposta excluída.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Respostas rápidas</CardTitle>
          <CardDescription>Textos prontos no chat (botão do raio). Use {'{nome}'} para o primeiro nome do cliente e {'{vendedor}'} para o de quem envia.</CardDescription>
        </div>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing('nova')}>
            <PlusIcon /> Nova
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {(list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma resposta cadastrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {list.data!.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.title}</p>
                  <p className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{r.text}</p>
                </div>
                {editable && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar ${r.title}`}>
                      <PencilIcon />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)} aria-label={`Excluir ${r.title}`}>
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && <QuickReplyDialog reply={editing === 'nova' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function QuickReplyDialog({ reply, onClose }: { reply: QuickReply | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(reply?.title ?? '')
  const [text, setText] = useState(reply?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => (reply ? api.put(`/chat/respostas/${reply.id}`, { title, text }) : api.post('/chat/respostas', { title, text })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-respostas-admin'] })
      void qc.invalidateQueries({ queryKey: ['chat-respostas'] })
      toast.success('Resposta salva.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{reply ? 'Editar resposta rápida' : 'Nova resposta rápida'}</DialogTitle>
            <DialogDescription>Ex.: Olá {'{nome}'}, aqui é o {'{vendedor}'} da USA Parts. Como posso ajudar?</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qr-title">Título</Label>
            <Input id="qr-title" required maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-text">Texto</Label>
            <Textarea id="qr-text" required rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface WaRules {
  newContact: 'LEAD_E_PREVENDA' | 'SO_LEAD' | 'NADA'
  knownLead: 'HISTORICO_E_PREVENDA' | 'SO_HISTORICO'
  reopenDays: number
}
const NEW_CONTACT: Record<WaRules['newContact'], string> = {
  LEAD_E_PREVENDA: 'Vira lead (com o histórico da conversa) e abre pré-venda',
  SO_LEAD: 'Vira lead com o histórico da conversa, sem pré-venda',
  NADA: 'Fica só no chat, "A classificar" (o operador marca se for venda)',
}
const KNOWN_LEAD: Record<WaRules['knownLead'], string> = {
  HISTORICO_E_PREVENDA: 'Entra no histórico do lead e abre pré-venda nova depois do prazo sem conversa',
  SO_HISTORICO: 'Só entra no histórico do lead',
}

/** O que cada conversa gera, sem o operador precisar fazer nada. */
function Rules({ editable }: { editable: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['whatsapp-regras'], queryFn: () => api.get<WaRules>('/whatsapp/regras') })
  const [form, setForm] = useState<WaRules | null>(null)
  useEffect(() => {
    if (q.data) setForm(q.data)
  }, [q.data])
  const save = useMutation({
    mutationFn: () => api.put<WaRules>('/whatsapp/regras', { ...form! }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-regras'] })
      toast.success('Regras salvas. Valem para as próximas mensagens.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!form) return null
  const set = <K extends keyof WaRules>(k: K, v: WaRules[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regras do WhatsApp</CardTitle>
        <CardDescription>
          O CRM decide sozinho o que cada conversa gera; o operador só atende. Contatos da empresa (lista abaixo) nunca viram lead nem pré-venda. Grupos ficam de fora.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wr-new">Quando chama um contato novo</Label>
            <Select value={form.newContact} onValueChange={(v) => set('newContact', v as WaRules['newContact'])} disabled={!editable}>
              <SelectTrigger id="wr-new" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(NEW_CONTACT) as WaRules['newContact'][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {NEW_CONTACT[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wr-known">Quando chama quem já é lead</Label>
            <Select value={form.knownLead} onValueChange={(v) => set('knownLead', v as WaRules['knownLead'])} disabled={!editable}>
              <SelectTrigger id="wr-known" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KNOWN_LEAD) as WaRules['knownLead'][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KNOWN_LEAD[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wr-days">Dias sem conversa para abrir um novo atendimento</Label>
            <Input id="wr-days" type="number" min={1} max={90} className="w-28" value={form.reopenDays} onChange={(e) => set('reopenDays', Number(e.target.value))} disabled={!editable} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">A pré-venda só abre em números marcados com “Este número abre pré-venda” e quando é o cliente que chama (não quando a empresa inicia a conversa).</p>
        {editable && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar regras
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

type CompanyCat = 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
const COMPANY_CAT: Record<CompanyCat, string> = { COLEGA: 'Colega de trabalho', FORNECEDOR: 'Fornecedor', OUTRO: 'Outro (não é venda)' }
interface CompanyContact {
  id: string
  name: string | null
  phone: string | null
  category: CompanyCat
}

/** Colegas, fornecedores e outros contatos que não são de venda: não viram lead nem pré-venda. */
function CompanyContacts({ editable }: { editable: boolean }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuery({ queryKey: ['whatsapp-contatos', q], queryFn: () => api.get<{ total: number; items: CompanyContact[] }>(`/whatsapp/contatos?busca=${encodeURIComponent(q)}`) })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/whatsapp/contatos/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Contatos da empresa</CardTitle>
          <CardDescription>Colegas, fornecedores e outros que não são de venda: as conversas ficam só no chat, sem lead e sem pré-venda, em todos os números.</CardDescription>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              Importar lista
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon /> Adicionar
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar contato da empresa" className="max-w-sm" />
        {(list.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{q ? 'Nenhum contato com essa busca.' : 'Nenhum contato da empresa cadastrado. Importe a lista de contatos (CSV do Google Contatos ou do Excel).'}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {list.data!.items.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{c.name ?? '—'}</span>
                <span className="text-muted-foreground tabular-nums">{c.phone ? formatPhone(c.phone) : '—'}</span>
                <Badge variant="outline" className="hidden font-normal sm:inline-flex">
                  {COMPANY_CAT[c.category] ?? c.category}
                </Badge>
                {editable && (
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)} aria-label={`Remover ${c.name ?? c.phone}`}>
                    <Trash2Icon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.total > list.data.items.length && <p className="text-xs text-muted-foreground">Mostrando {list.data.items.length} de {list.data.total}. Use a busca.</p>}
      </CardContent>
      {adding && <AddContactDialog onClose={() => setAdding(false)} />}
      {importing && <ImportContactsDialog onClose={() => setImporting(false)} />}
    </Card>
  )
}

function CategorySelect({ id, value, onChange }: { id: string; value: CompanyCat; onChange: (v: CompanyCat) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CompanyCat)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(COMPANY_CAT) as CompanyCat[]).map((k) => (
          <SelectItem key={k} value={k}>
            {COMPANY_CAT[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddContactDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [category, setCategory] = useState<CompanyCat>('COLEGA')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.post('/whatsapp/contatos', { name, phone, category }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] })
      toast.success('Contato adicionado.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Adicionar contato da empresa</DialogTitle>
            <DialogDescription>As conversas com este telefone não viram lead nem pré-venda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Nome</Label>
            <Input id="cc-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-phone">Telefone</Label>
            <Input id="cc-phone" required inputMode="tel" placeholder="(49) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-cat">Tipo</Label>
            <CategorySelect id="cc-cat" value={category} onChange={setCategory} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportContactsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [csv, setCsv] = useState('')
  const [category, setCategory] = useState<CompanyCat>('COLEGA')
  const [error, setError] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => api.post<{ saved: number; invalid: number; skipped: number }>('/whatsapp/contatos/importar', { csv, category }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-contatos'] })
      toast.success(`${r.saved} contato(s) importado(s).${r.invalid ? ` ${r.invalid} telefone(s) inválido(s).` : ''}${r.skipped ? ` ${r.skipped} linha(s) sem telefone.` : ''}`, { duration: 8000 })
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            run.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Importar contatos da empresa</DialogTitle>
            <DialogDescription>
              Escolha o arquivo CSV (Google Contatos → Exportar, ou Excel salvo como CSV) ou cole a lista. Cada linha: nome e telefone; se tiver uma coluna com “colega”, “fornecedor” ou “outro”, ela vale para a linha.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            aria-label="Arquivo CSV"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > 800_000) return void setError('Arquivo grande demais (máximo 800 KB). Divida em partes.')
              setCsv(await f.text())
            }}
          />
          <div className="space-y-1.5">
            <Label htmlFor="ci-text">Lista</Label>
            <Textarea id="ci-text" rows={7} placeholder={'Carlos Souza;(49) 98877-6655;colega\nPeças Brasil;(47) 3222-1100;fornecedor'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-cat">Tipo das linhas sem tipo</Label>
            <CategorySelect id="ci-cat" value={category} onChange={setCategory} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!csv.trim() || run.isPending}>
              Importar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
