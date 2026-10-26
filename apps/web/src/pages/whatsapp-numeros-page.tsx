import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, Loader2Icon, PencilIcon, PlugIcon, PlusIcon, QrCodeIcon, SmartphoneIcon, Trash2Icon, UnplugIcon, UsersIcon } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ReplyFileField, saveReplyFile } from '@/components/chat/organizar'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { MultiSelect } from '@/components/multi-select'
import { EmptyState, ErrorState, formatDateTime, InlineError, PageHeader, TableSkeleton } from '@/components/page'
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
  /** Logins que usam o número (com o escopo "Próprios", só eles veem as conversas). */
  userIds: string[]
  splitAttendance?: boolean
  /** Atendente que recebe todos os clientes novos (atendimento dividido). */
  defaultUserId?: string | null
  createRecords: boolean
  signMessages: boolean
  connectedAt: string | null
  disconnectedAt: string | null
}
interface ListData {
  users: { id: string; name: string }[]
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

export function Numbers() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['whatsapp-numeros'], queryFn: () => api.get<ListData>('/whatsapp/numeros'), refetchInterval: 30_000 })
  const options = useOptions()
  const names = namesOf(options.data)
  const [editing, setEditing] = useState<WaNumber | 'novo' | null>(null)
  const [connecting, setConnecting] = useState<{ number: WaNumber; fresh?: boolean } | null>(null)
  const confirm = useConfirm()
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: ({ n, kind }: { n: WaNumber; kind: 'desconectar' | 'excluir' }) => (kind === 'desconectar' ? api.post(`/whatsapp/numeros/${n.id}/desconectar`) : api.delete(`/whatsapp/numeros/${n.id}`)),
    onSuccess: (_r, { kind }) => {
      void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] })
      toast.success(kind === 'desconectar' ? 'Número desconectado. A vaga de conexão foi liberada.' : 'Número excluído.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const ask = async (n: WaNumber, kind: 'desconectar' | 'excluir') => {
    const ok = await confirm(
      kind === 'desconectar'
        ? {
            title: `Desconectar o número “${n.name}”?`,
            description: 'O CRM para de receber e enviar mensagens por este número. Para voltar, será preciso ler o QR Code de novo. O WhatsApp no celular continua funcionando normalmente.',
            confirmLabel: 'Desconectar número',
          }
        : {
            title: `Excluir o número “${n.name}”?`,
            description: 'O número sai do CRM e a conexão com o celular é encerrada. Para usar de novo, cadastre e conecte outra vez. Não dá para desfazer.',
            confirmLabel: 'Excluir número',
          },
    )
    if (ok) run.mutate({ n, kind })
  }
  // Sessão caída que ainda aparece conectada (ou troca de aparelho): encerra a sessão e mostra um QR Code novo.
  const askFresh = async (n: WaNumber) => {
    const ok = await confirm({
      title: `Gerar um QR Code novo para “${n.name}”?`,
      description: 'A conexão atual é encerrada e o número só volta a enviar e receber depois de ler o QR Code novo no celular. Use quando o número aparece conectado, mas as mensagens não saem.',
      confirmLabel: 'Gerar QR Code novo',
    })
    if (ok) setConnecting({ number: n, fresh: true })
  }
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
            <EmptyState
              icon={SmartphoneIcon}
              title="Nenhum número cadastrado"
              description="Cadastre um por vendedor ou setor (ex.: Vendas Paraná)."
              action={
                can('whatsapp', 'create') && (
                  <Button onClick={() => setEditing('novo')} disabled={full}>
                    <PlusIcon /> Cadastrar número
                  </Button>
                )
              }
            />
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
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <UsersIcon className="mt-0.5 size-3.5 shrink-0" />
                      {n.userIds?.length ? `Usam: ${n.userIds.map((id) => d?.users.find((u) => u.id === id)?.name ?? 'usuário removido').join(', ')}` : 'Nenhum usuário ligado (só quem vê todas as conversas)'}
                      {n.splitAttendance ? ` · atendimento dividido${n.defaultUserId ? ` · clientes novos para ${d?.users.find((u) => u.id === n.defaultUserId)?.name ?? 'usuário removido'}` : ''}` : ''}
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
                          <>
                            <Button size="sm" variant="outline" onClick={() => void ask(n, 'desconectar')} disabled={run.isPending}>
                              <UnplugIcon /> Desconectar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void askFresh(n)} disabled={run.isPending || !d.service.online}>
                              <QrCodeIcon /> Novo QR Code
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => setConnecting({ number: n })}
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
                          <Button size="sm" variant="ghost" onClick={() => void ask(n, 'excluir')} disabled={run.isPending} aria-label={`Excluir número ${n.name}`}>
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
          <AgendaLink />
        </div>
      )}
      {editing && <NumberDialog number={editing === 'novo' ? null : editing} users={d?.users ?? []} onClose={() => setEditing(null)} />}
      {connecting && <ConnectDialog number={connecting.number} fresh={connecting.fresh} onClose={() => setConnecting(null)} />}
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

function NumberDialog({ number, users, onClose }: { number: WaNumber | null; users: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const options = useOptions()
  const [name, setName] = useState(number?.name ?? '')
  const [unitId, setUnitId] = useState<string | null>(number?.unitId ?? null)
  const [sellerIds, setSellerIds] = useState<string[]>(number?.sellerIds ?? [])
  const [userIds, setUserIds] = useState<string[]>(number?.userIds ?? [])
  const [split, setSplit] = useState(number?.splitAttendance ?? false)
  const [defaultUserId, setDefaultUserId] = useState<string | null>(number?.defaultUserId ?? null)
  const [createRecords, setCreateRecords] = useState(number?.createRecords ?? true)
  const [signMessages, setSignMessages] = useState(number?.signMessages ?? true)
  const [error, setError] = useState<string | null>(null)
  const current = { name, unitId, sellerIds, userIds, split, defaultUserId, createRecords, signMessages }
  const [initial] = useState(current)
  const guard = useCloseGuard(isDirty(initial, current), onClose, 'o número')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, unitId, sellerIds, userIds, splitAttendance: split, defaultUserId: split && defaultUserId && userIds.includes(defaultUserId) ? defaultUserId : null, createRecords, signMessages }
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
    <Dialog open onOpenChange={(o) => !o && void guard()}>
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
            <Label htmlFor="wa-n-name" required>Nome</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="wa-n-users">Usuários que usam este número</Label>
            <MultiSelect id="wa-n-users" items={users} value={userIds} onChange={setUserIds} placeholder="Selecione os usuários" />
            <p className="text-xs text-muted-foreground">Quem tem a permissão Chat WhatsApp como “Próprios” só vê os números ligados a ele (ou ao vendedor dele). Administrador e Gestor comercial veem todos.</p>
          </div>
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <label className="flex items-start justify-between gap-3">
              <span>
                Atendimento dividido entre os usuários
                <span className="block text-xs text-muted-foreground">Cada cliente fica com um atendente: os outros do número não leem a conversa, a não ser que sejam adicionados como participantes. Clientes novos vão para o atendente padrão (abaixo) ou entram na fila até alguém assumir (ou responder). Conversas com colegas, fornecedores e outros ficam visíveis para todos.</span>
              </span>
              <Switch checked={split} onCheckedChange={setSplit} />
            </label>
            {split && (
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="wa-n-default" className="text-xs font-medium">
                  Atendente que recebe os clientes novos
                </Label>
                <Select value={defaultUserId && userIds.includes(defaultUserId) ? defaultUserId : NONE} onValueChange={(v) => setDefaultUserId(v === NONE ? null : v)}>
                  <SelectTrigger id="wa-n-default" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Ninguém: os clientes novos entram na fila</SelectItem>
                    {users
                      .filter((u) => userIds.includes(u.id))
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Todo cliente que chamar sem atendente vai direto para esta pessoa. Ela pode transferir ou adicionar outros atendentes do número como participantes.</p>
              </div>
            )}
            {split && (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Setores (Vendas, Pós-venda, Financeiro...), quem atende em cada um e os gestores ficam em{' '}
                <Link to="/configuracoes?secao=setores" className="font-medium text-foreground underline underline-offset-4">
                  Configurações → Setores e equipes
                </Link>
                .
              </p>
            )}
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
            <Button type="button" variant="outline" onClick={() => void guard()}>
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
function ConnectDialog({ number, fresh, onClose }: { number: WaNumber; fresh?: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => api.post<QrData>(`/whatsapp/numeros/${number.id}/conectar${fresh ? '?novo=1' : ''}`),
    onError: (err) => setError(errorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['whatsapp-numeros'] }),
  })
  // Só começa uma vez ao abrir.
  // Um pedido só, mesmo com o efeito rodando duas vezes (cada pedido de QR Code novo troca a sessão).
  const started = useRef(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (started.current) return
    started.current = true
    start.mutate()
  }, [])
  const poll = useQuery({
    queryKey: ['whatsapp-qr', number.id],
    queryFn: () => api.get<QrData>(`/whatsapp/numeros/${number.id}/qr`),
    enabled: start.isSuccess,
    // Não guarda a resposta depois de fechar: o "Conectado" de uma leitura anterior fecharia o diálogo na hora.
    gcTime: 0,
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
            No celular, abra o WhatsApp Business → toque nos três pontinhos (ou em Configurações) → Aparelhos conectados. Se o CRM ainda aparecer na lista, desconecte-o primeiro. Depois toque em Conectar um aparelho e aponte para o QR Code.
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

interface QuickReply {
  id: string
  title: string
  text: string
  fileName?: string | null
}

/** Respostas rápidas do chat. {nome} vira o primeiro nome do cliente e {vendedor} o de quem envia. */
export function QuickReplies({ editable }: { editable: boolean }) {
  const qc = useQueryClient()
  // Aqui ficam só as padrão da empresa; as pessoais cada usuário cria no próprio chat.
  const list = useQuery({ queryKey: ['chat-respostas-admin'], queryFn: () => api.get<(QuickReply & { standard?: boolean })[]>('/chat/respostas').then((r) => r.filter((x) => x.standard !== false)) })
  const [editing, setEditing] = useState<QuickReply | 'nova' | null>(null)
  const confirm = useConfirm()
  const remove = async (r: QuickReply) => {
    if (await confirm({ title: `Excluir a resposta rápida “${r.title}”?`, description: 'Ela some do chat de todos. Não dá para desfazer.', confirmLabel: 'Excluir resposta rápida' })) del.mutate(r.id)
  }
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
          <CardDescription>Textos prontos para todos no chat (botão do raio). Cada usuário também pode criar as suas no próprio chat. Use {'{nome}'} para o primeiro nome do cliente e {'{vendedor}'} para o de quem envia.</CardDescription>
        </div>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing('nova')}>
            <PlusIcon /> Nova
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {list.error && !list.data ? (
          <InlineError error={list.error} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma resposta cadastrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {list.data!.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.title}</p>
                  <p className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{r.text}</p>
                  {r.fileName && <p className="mt-0.5 text-xs text-muted-foreground">📎 {r.fileName}</p>}
                </div>
                {editable && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar resposta rápida ${r.title}`}>
                      <PencilIcon />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(r)} disabled={del.isPending} aria-label={`Excluir resposta rápida ${r.title}`}>
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
  const [picked, setPicked] = useState<File | null>(null)
  const [removed, setRemoved] = useState(false)
  const [initial] = useState({ title, text })
  const guard = useCloseGuard(isDirty(initial, { title, text }) || !!picked || removed, onClose, 'a resposta')
  const save = useMutation({
    mutationFn: async () => {
      const saved = await (reply ? api.put<{ id: string }>(`/chat/respostas/${reply.id}`, { title, text }) : api.post<{ id: string }>('/chat/respostas', { title, text, standard: true }))
      await saveReplyFile(saved.id, picked, removed)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-respostas-admin'] })
      void qc.invalidateQueries({ queryKey: ['chat-respostas'] })
      toast.success('Resposta salva.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
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
            <DialogDescription>Ex.: Olá {'{nome}'}, aqui é o {'{vendedor}'}. Como posso ajudar?</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qr-title" required>Título</Label>
            <Input id="qr-title" required maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-text" required>Texto</Label>
            <Textarea id="qr-text" required rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Arquivo (opcional)</Label>
            <ReplyFileField current={reply?.fileName} picked={picked} removed={removed} onPick={setPicked} onRemove={setRemoved} />
            <p className="text-xs text-muted-foreground">Catálogo em PDF, tabela, foto ou vídeo (até 64 MB). Vai junto, com o texto como legenda.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
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
  yellowMinutes?: number
  redMinutes?: number
  businessHours?: { enabled: boolean; days: ({ start: string; end: string } | null)[] }
  away?: { enabled: boolean; text: string; cooldownHours: number }
  retention?: { enabled: boolean; clientMonths: number; otherMonths: number; mediaMonths: number }
  close?: { enabled: boolean; text: string }
}
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const NEW_CONTACT: Record<WaRules['newContact'], string> = {
  LEAD_E_PREVENDA: 'Vira lead (com o histórico da conversa) e abre pré-venda',
  SO_LEAD: 'Vira lead com o histórico da conversa, sem pré-venda',
  NADA: 'Fica só no chat, "A classificar" (o operador marca se for venda)',
}
const KNOWN_LEAD: Record<WaRules['knownLead'], string> = {
  HISTORICO_E_PREVENDA: 'Entra no histórico do lead e abre pré-venda nova depois do prazo sem conversa',
  SO_HISTORICO: 'Só entra no histórico do lead',
}

/** Prazo de guarda das conversas (LGPD): passado o prazo, o CRM apaga sozinho (uma vez por dia). */
function RetentionSettings({ form, set, editable }: { form: WaRules; set: <K extends keyof WaRules>(k: K, v: WaRules[K]) => void; editable: boolean }) {
  const r = form.retention ?? { enabled: true, clientMonths: 60, otherMonths: 24, mediaMonths: 12 }
  const num = (k: 'clientMonths' | 'otherMonths' | 'mediaMonths', v: string) => set('retention', { ...r, [k]: Number(v) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">Prazo de guarda das conversas (LGPD)</span>
          <span className="block text-xs text-muted-foreground">
            A LGPD (Lei 13.709/2018, arts. 15 e 16) manda apagar os dados quando a finalidade acaba, permitindo guardar o necessário para cumprir a lei e se defender (art. 7º, VI). Passado o prazo, o CRM apaga sozinho, uma vez por dia, e registra na auditoria.
          </span>
        </span>
        <Switch checked={r.enabled} onCheckedChange={(v) => set('retention', { ...r, enabled: v })} disabled={!editable} aria-label="Apagar conversas pelo prazo de guarda" />
      </label>
      {r.enabled && (
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ret-client">Clientes (meses)</Label>
            <Input id="ret-client" type="number" min={6} max={120} className="h-8 w-24" value={r.clientMonths} onChange={(e) => num('clientMonths', e.target.value)} disabled={!editable} />
            <p className="text-xs text-muted-foreground">Padrão 60 (5 anos): prazo do Código de Defesa do Consumidor (art. 27) para reclamações.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-other">Colegas, fornecedores e outros (meses)</Label>
            <Input id="ret-other" type="number" min={3} max={120} className="h-8 w-24" value={r.otherMonths} onChange={(e) => num('otherMonths', e.target.value)} disabled={!editable} />
            <p className="text-xs text-muted-foreground">Padrão 24 (2 anos).</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-media">Fotos, áudios e documentos (meses)</Label>
            <Input id="ret-media" type="number" min={1} max={120} className="h-8 w-24" value={r.mediaMonths} onChange={(e) => num('mediaMonths', e.target.value)} disabled={!editable} />
            <p className="text-xs text-muted-foreground">Padrão 12. O arquivo sai antes; o texto da conversa fica até o prazo dela.</p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Pedido do próprio cliente para apagar os dados (art. 18): use “Anonimizar” na ficha do lead. As conversas e os arquivos dele saem na hora.</p>
    </div>
  )
}

/** Horário comercial (pausa os avisos de "sem resposta") e a mensagem automática para quem chama fora dele. */
function HoursAndAway({ form, set, editable }: { form: WaRules; set: <K extends keyof WaRules>(k: K, v: WaRules[K]) => void; editable: boolean }) {
  const hours = form.businessHours ?? { enabled: false, days: [null, null, null, null, null, null, null] }
  const away = form.away ?? { enabled: false, text: '', cooldownHours: 12 }
  const setDay = (i: number, v: { start: string; end: string } | null) => set('businessHours', { ...hours, days: hours.days.map((d, k) => (k === i ? v : d)) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">Horário comercial</span>
          <span className="block text-xs text-muted-foreground">Horário de Brasília. Fora dele, os avisos de cliente sem resposta ficam em pausa e pode sair a mensagem de ausência.</span>
        </span>
        <Switch checked={hours.enabled} onCheckedChange={(v) => set('businessHours', { ...hours, enabled: v })} disabled={!editable} aria-label="Usar horário comercial" />
      </label>
      {hours.enabled && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {WEEKDAYS.map((name, i) => {
            const d = hours.days[i] ?? null
            return (
              <div key={name} className="flex items-center gap-2 text-sm">
                <Switch checked={!!d} onCheckedChange={(v) => setDay(i, v ? { start: '08:00', end: '18:00' } : null)} disabled={!editable} aria-label={name + " aberto"} />
                <span className="w-16">{name}</span>
                {d ? (
                  <>
                    <Input type="time" className="h-8 w-24" value={d.start} onChange={(e) => setDay(i, { ...d, start: e.target.value })} disabled={!editable} aria-label={name + ": abre"} />
                    <span className="text-muted-foreground">às</span>
                    <Input type="time" className="h-8 w-24" value={d.end} onChange={(e) => setDay(i, { ...d, end: e.target.value })} disabled={!editable} aria-label={name + ": fecha"} />
                  </>
                ) : (
                  <span className="text-muted-foreground">fechado</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <label className="flex items-center justify-between gap-3 border-t pt-3">
        <span>
          <span className="block text-sm font-medium">Mensagem de ausência</span>
          <span className="block text-xs text-muted-foreground">Resposta automática para cliente que chama fora do horário comercial. Não conta como atendimento: a conversa continua aguardando resposta.</span>
        </span>
        <Switch checked={away.enabled} onCheckedChange={(v) => set('away', { ...away, enabled: v })} disabled={!editable || !hours.enabled} aria-label="Enviar mensagem de ausência" />
      </label>
      {!hours.enabled && <p className="text-xs text-muted-foreground">Ligue o horário comercial para usar a mensagem de ausência.</p>}
      {hours.enabled && away.enabled && (
        <div className="space-y-2">
          <Textarea rows={3} maxLength={1000} value={away.text} onChange={(e) => set('away', { ...away, text: e.target.value })} disabled={!editable} aria-label="Texto da mensagem de ausência" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Enviar de novo para o mesmo contato só depois de</span>
            <Input type="number" min={1} max={168} className="h-8 w-20" value={away.cooldownHours} onChange={(e) => set('away', { ...away, cooldownHours: Number(e.target.value) })} disabled={!editable} aria-label="Horas entre mensagens de ausência" />
            <span>horas</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Finalizar atendimento: mensagem de encerramento que vai para o cliente (quem finaliza pode não enviar na hora). */
function CloseMessage({ form, set, editable }: { form: WaRules; set: <K extends keyof WaRules>(k: K, v: WaRules[K]) => void; editable: boolean }) {
  const close = form.close ?? { enabled: true, text: '' }
  return (
    <div className="space-y-2 border-t pt-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">Mensagem ao finalizar o atendimento</span>
          <span className="block text-xs text-muted-foreground">Enviada quando o atendente clica em Finalizar no chat (ele pode desmarcar na hora). A conversa sai dele e da fila; se o cliente chamar de novo, começa outro atendimento.</span>
        </span>
        <Switch checked={close.enabled} onCheckedChange={(v) => set('close', { ...close, enabled: v })} disabled={!editable} aria-label="Enviar mensagem ao finalizar" />
      </label>
      {close.enabled && <Textarea rows={3} maxLength={1000} value={close.text} onChange={(e) => set('close', { ...close, text: e.target.value })} disabled={!editable} aria-label="Texto da mensagem de encerramento" />}
    </div>
  )
}

/** O que cada conversa gera, sem o operador precisar fazer nada. */
export function Rules({ editable }: { editable: boolean }) {
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
  if (!form) return q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null
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
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Cores do tempo sem resposta no chat</p>
          <p className="text-xs text-muted-foreground">Contadas desde a última mensagem do cliente sem resposta (tempo corrido).</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#16a34a]" /> verde até</span>
            <Input aria-label="Minutos até ficar amarelo" type="number" min={1} max={1440} className="h-8 w-20" value={form.yellowMinutes ?? 15} onChange={(e) => set('yellowMinutes', Number(e.target.value))} disabled={!editable} />
            <span className="inline-flex items-center gap-1.5">min · <span className="size-2.5 rounded-full bg-[#eab308]" /> amarelo até</span>
            <Input aria-label="Minutos até ficar vermelho" type="number" min={2} max={2880} className="h-8 w-20" value={form.redMinutes ?? 60} onChange={(e) => set('redMinutes', Number(e.target.value))} disabled={!editable} />
            <span className="inline-flex items-center gap-1.5">min · <span className="size-2.5 rounded-full bg-[#dc2626]" /> vermelho depois</span>
          </div>
        </div>
        <HoursAndAway form={form} set={set} editable={editable} />
        <CloseMessage form={form} set={set} editable={editable} />
        <RetentionSettings form={form} set={set} editable={editable} />
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

/** Colegas, fornecedores e outros contatos: ficam na Agenda de contatos (Atendimento Comercial). */
function AgendaLink() {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Contatos da empresa</CardTitle>
          <CardDescription>Colegas, fornecedores e outros que não são de venda (sem lead e sem pré-venda), e clientes marcados à mão. Ficam na Agenda de contatos, com importação do celular e do WhatsApp conectado.</CardDescription>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to="/agenda">Abrir a agenda</Link>
        </Button>
      </CardHeader>
    </Card>
  )
}
