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
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, unitId, sellerIds }
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
  useEffect(() => start.mutate(), [])
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
