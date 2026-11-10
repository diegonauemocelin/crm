import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRingIcon, CheckCircle2Icon, CopyIcon, DownloadIcon, ImageIcon, Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, SendIcon, SettingsIcon, Trash2Icon, XCircleIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { todaySP } from '@/lib/format'
import { cn } from '@/lib/utils'

const TITLE_MAX = 70
const MESSAGE_MAX = 140
const BUTTON_MAX = 25

interface Prompt {
  title: string
  text: string
  allowLabel: string
  denyLabel: string
  delaySec: number
  askAgainDays: number
  color: string
}

interface View {
  enabled: boolean
  siteUrl: string | null
  prompt: Prompt
  subscribers: number
  swFile: string
  swUrl: string | null
  swLoader: string
  tracking: { enabled: boolean; domains: string[]; scriptOk: boolean }
  defaultIconUrl: string | null
}

type Status = 'RASCUNHO' | 'AGENDADO' | 'ENVIANDO' | 'ENVIADO' | 'CANCELADO' | 'ERRO'

interface Campaign {
  id: string
  name: string
  title: string
  message: string
  url: string
  buttonLabel: string | null
  iconFileId: string | null
  iconUrl: string | null
  imageFileId: string | null
  imageUrl: string | null
  status: Status
  scheduledAt: string | null
  sentAt: string | null
  targets: number
  sent: number
  failed: number
  delivered: number
  clicks: number
  deliveredPct: number
  clickPct: number
  error: string | null
  createdByName: string | null
  updatedAt: string
}

interface Draft {
  name: string
  title: string
  message: string
  url: string
  useButton: boolean
  buttonLabel: string
  iconFileId: string | null
  iconUrl: string | null
  imageFileId: string | null
  imageUrl: string | null
}

const SENT: Status[] = ['ENVIANDO', 'ENVIADO', 'ERRO']
const DRAFTS: Status[] = ['RASCUNHO', 'CANCELADO']
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (n: number) => n.toLocaleString('pt-BR')

export function WebPushPage() {
  return (
    <RequirePermission module="web_push">
      <WebPush />
    </RequirePermission>
  )
}

function WebPush() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const view = useQuery({ queryKey: ['web-push'], queryFn: () => api.get<View>('/marketing/web-push') })
  const list = useQuery({
    queryKey: ['web-push', 'campanhas'],
    queryFn: () => api.get<Campaign[]>('/marketing/web-push/campanhas'),
    // Enquanto um envio está saindo, os números sobem sozinhos.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'ENVIANDO' || c.status === 'AGENDADO') ? 15_000 : false),
  })
  const [tab, setTab] = useState('enviados')
  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<Campaign | 'novo' | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['web-push'] })
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'duplicar' | 'cancelar' | 'excluir' }) =>
      what === 'excluir' ? api.delete(`/marketing/web-push/campanhas/${id}`) : api.post<Campaign>(`/marketing/web-push/campanhas/${id}/${what}`),
    onSuccess: (_, v) => {
      toast.success(v.what === 'duplicar' ? 'Cópia criada nos rascunhos.' : v.what === 'cancelar' ? 'Agendamento cancelado: voltou para os rascunhos.' : 'Rascunho excluído.')
      if (v.what !== 'excluir') setTab('rascunhos')
      refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} />
  const v = view.data
  const items = list.data ?? []
  const sent = items.filter((c) => SENT.includes(c.status)).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
  const drafts = items.filter((c) => DRAFTS.includes(c.status))
  const scheduled = items.filter((c) => c.status === 'AGENDADO').sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))

  return (
    <div>
      <PageHeader
        title="Web Push"
        description="Notificações no navegador para quem visitou a loja virtual e aceitou receber: ofertas, lançamentos e avisos, com o link que abre no clique."
        actions={
          <>
            <Button variant="outline" onClick={() => setManage(true)} disabled={!v}>
              <SettingsIcon /> Gerenciar coleta
            </Button>
            <Can module="web_push" action="create">
              <Button onClick={() => setEditing('novo')} disabled={!v}>
                <PlusIcon /> Criar Web Push
              </Button>
            </Can>
          </>
        }
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <div>
            <p className="text-xs text-muted-foreground">Site da conta</p>
            <p className="font-medium">{v ? (v.siteUrl ?? 'não definido') : '…'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Inscritos</p>
            <p className="text-lg font-semibold">{v ? num(v.subscribers) : '…'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Coleta de inscritos</p>
            {v && (
              <Badge variant={v.enabled ? 'default' : 'secondary'} className={cn(v.enabled && 'bg-emerald-600 text-white')}>
                {v.enabled ? 'Ativa' : 'Desativada'}
              </Badge>
            )}
          </div>
          <p className="basis-full text-xs text-muted-foreground">
            Os inscritos do RD Station (194) não podem ser trazidos: cada inscrição fica presa às chaves de quem coletou. A lista começa do zero quando a coleta é ativada aqui; quem já tinha
            permitido as notificações da loja e voltar a visitá-la entra sozinho, sem ver a caixa de novo.
          </p>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="enviados">Enviados ({sent.length})</TabsTrigger>
          <TabsTrigger value="rascunhos">Rascunhos ({drafts.length})</TabsTrigger>
          <TabsTrigger value="agendados">Agendados ({scheduled.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="enviados">
          {list.isLoading ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !sent.length ? (
            <EmptyState icon={BellRingIcon} title="Nenhum web push enviado" description="Crie o primeiro e envie para os inscritos da loja." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do web push</TableHead>
                  <TableHead>Data do envio</TableHead>
                  <TableHead className="text-right">Disparos</TableHead>
                  <TableHead className="text-right">Entregas</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sent.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="max-w-md truncate text-xs text-muted-foreground">{c.title}</p>
                      {c.status === 'ENVIANDO' && (
                        <Badge variant="secondary" className="mt-1">
                          <Loader2Icon className="animate-spin" /> Enviando {num(c.sent + c.failed)} de {num(c.targets)}
                        </Badge>
                      )}
                      {c.status === 'ERRO' && (
                        <Badge variant="destructive" className="mt-1" title={c.error ?? undefined}>
                          Erro: {c.error}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(c.sentAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(c.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(c.deliveredPct)} <span className="text-xs text-muted-foreground">({num(c.delivered)})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(c.clickPct)} <span className="text-xs text-muted-foreground">({num(c.clicks)})</span>
                    </TableCell>
                    <TableCell>
                      {can('web_push', 'create') && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: c.id, what: 'duplicar' })} disabled={act.isPending} aria-label={`Duplicar ${c.name}`}>
                          <CopyIcon /> Duplicar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!!sent.length && <p className="mt-2 text-xs text-muted-foreground">Entregas: notificações que apareceram no aparelho (sobre os disparos). Cliques: sobre as entregas.</p>}
        </TabsContent>

        <TabsContent value="rascunhos">
          {list.isLoading ? (
            <TableSkeleton />
          ) : !drafts.length ? (
            <EmptyState icon={BellRingIcon} title="Nenhum rascunho" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do web push</TableHead>
                  <TableHead>Alterado em</TableHead>
                  <TableHead>Criado por</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="max-w-md truncate text-xs text-muted-foreground">{c.title || 'Sem título'}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(c.updatedAt)}</TableCell>
                    <TableCell>{c.createdByName ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {can('web_push', 'create') && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          <PencilIcon /> Editar
                        </Button>
                      )}
                      {can('web_push', 'delete') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Excluir ${c.name}`}
                          onClick={async () => {
                            if (await confirm({ title: 'Excluir rascunho?', description: `"${c.name}" será apagado.`, confirmLabel: 'Excluir rascunho' })) act.mutate({ id: c.id, what: 'excluir' })
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
          )}
        </TabsContent>

        <TabsContent value="agendados">
          {list.isLoading ? (
            <TableSkeleton />
          ) : !scheduled.length ? (
            <EmptyState icon={BellRingIcon} title="Nenhum web push agendado" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do web push</TableHead>
                  <TableHead>Agendado para</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduled.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="max-w-md truncate text-xs text-muted-foreground">{c.title}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(c.scheduledAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {can('web_push', 'create') && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          <PencilIcon /> Editar
                        </Button>
                      )}
                      {can('web_push', 'edit') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (await confirm({ title: 'Cancelar o agendamento?', description: 'O web push volta para os rascunhos e não é enviado.', confirmLabel: 'Cancelar agendamento' }))
                              act.mutate({ id: c.id, what: 'cancelar' })
                          }}
                        >
                          <XCircleIcon /> Cancelar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      {v && manage && <ManageDialog view={v} onClose={() => setManage(false)} />}
      {v && editing && (
        <EditorDialog
          view={v}
          campaign={editing === 'novo' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(next) => {
            setEditing(null)
            setTab(next)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ---------- Gerenciar coleta ----------

function Step({ ok, title, children }: { ok: boolean | null; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-2 font-medium">
        {ok === null ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : ok ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <XCircleIcon className="size-4 text-red-600" />}
        {title}
      </p>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

function ManageDialog({ view, onClose }: { view: View; onClose: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const editable = can('web_push', 'edit')
  const [enabled, setEnabled] = useState(view.enabled)
  const [siteUrl, setSiteUrl] = useState(view.siteUrl ?? '')
  const [prompt, setPrompt] = useState<Prompt>(view.prompt)
  const check = useQuery({ queryKey: ['web-push', 'verificar', view.siteUrl], queryFn: () => api.get<{ ok: boolean; url: string | null; message: string }>('/marketing/web-push/verificar'), retry: false })
  const save = useMutation({
    mutationFn: () => api.put<View>('/marketing/web-push/config', { enabled, siteUrl, prompt }),
    onSuccess: (next) => {
      qc.setQueryData(['web-push'], next)
      toast.success(next.enabled ? 'Coleta de inscritos ativa.' : 'Configuração salva.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const set = <K extends keyof Prompt>(k: K, val: Prompt[K]) => setPrompt((p) => ({ ...p, [k]: val }))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerenciar coleta</DialogTitle>
          <DialogDescription>Dois passos na loja e a caixa que pede a permissão ao visitante.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Step ok={view.tracking.scriptOk} title="1. Script do CRM instalado na loja">
            {view.tracking.scriptOk ? (
              <p>O script de rastreamento do CRM está ligado para {view.tracking.domains.join(', ')}. Ele mesmo mostra a caixa de permissão: nada a colar na loja.</p>
            ) : (
              <p>
                Ligue o rastreamento do site com o domínio da loja em Configurações › Rastreamento do site (o mesmo script já usado na loja). {view.tracking.domains.length ? `Domínios cadastrados: ${view.tracking.domains.join(', ')}.` : ''}
              </p>
            )}
          </Step>
          <Step ok={check.isFetching ? null : !!check.data?.ok} title={`2. Arquivo ${view.swFile} na raiz da loja`}>
            <p>
              Peça à Magazord para publicar, na raiz do domínio da loja, o arquivo {view.swUrl ? <code className="break-all text-foreground">{view.swUrl}</code> : '(informe o endereço da loja abaixo)'} com o conteúdo
              abaixo. É só uma linha que chama o .js do CRM: quando o CRM for atualizado, não precisa publicar de novo.
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-xs text-foreground">{view.swLoader}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(view.swLoader)
                    .then(() => toast.success('Conteúdo copiado.'))
                    .catch(() => toast.error('Não deu para copiar: selecione o texto e copie.'))
                }
              >
                <CopyIcon /> Copiar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => api.download('/marketing/web-push/service-worker', view.swFile).catch((err) => toast.error(errorMessage(err)))}>
                <DownloadIcon /> Baixar {view.swFile}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => check.refetch()} disabled={check.isFetching}>
                <RefreshCwIcon className={cn(check.isFetching && 'animate-spin')} /> Verificar
              </Button>
            </div>
            {check.data && <p className={check.data.ok ? 'text-emerald-700' : 'text-red-700'}>{check.data.message}</p>}
            {check.isError && <p className="text-red-700">{errorMessage(check.error)}</p>}
          </Step>

          <fieldset disabled={!editable} className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="wp-site">Endereço da loja</Label>
              <Input id="wp-site" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://www.usaparts.com.br" />
              <p className="text-xs text-muted-foreground">Só o domínio, com https. Vazio: o primeiro domínio do rastreamento do site.</p>
            </div>
            <p className="pt-1 text-sm font-medium">Caixa que pede a permissão</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wp-pt">Título</Label>
                <Input id="wp-pt" value={prompt.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wp-px">Texto</Label>
                <Textarea id="wp-px" value={prompt.text} maxLength={220} onChange={(e) => set('text', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-pa">Botão de aceitar</Label>
                <Input id="wp-pa" value={prompt.allowLabel} maxLength={25} onChange={(e) => set('allowLabel', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-pd">Botão de recusar</Label>
                <Input id="wp-pd" value={prompt.denyLabel} maxLength={25} onChange={(e) => set('denyLabel', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-delay">Mostrar depois de (segundos na página)</Label>
                <Input id="wp-delay" type="number" min={0} max={300} value={prompt.delaySec} onChange={(e) => set('delaySec', Math.max(0, Math.min(300, Number(e.target.value) || 0)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-days">Depois de "{prompt.denyLabel || 'Agora não'}", perguntar de novo em (dias)</Label>
                <Input id="wp-days" type="number" min={1} max={365} value={prompt.askAgainDays} onChange={(e) => set('askAgainDays', Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-color">Cor do botão</Label>
                <div className="flex items-center gap-2">
                  <input id="wp-color" type="color" value={prompt.color} onChange={(e) => set('color', e.target.value)} className="h-9 w-12 rounded border" />
                  <span className="text-sm text-muted-foreground">{prompt.color}</span>
                </div>
              </div>
            </div>
            <PromptPreview prompt={prompt} icon={view.defaultIconUrl} />
            <label className="flex items-center gap-3 pt-1">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm">
                <span className="font-medium">Coleta ativa</span>
                <span className="block text-xs text-muted-foreground">Ligada, a caixa aparece para quem ainda não respondeu às notificações da loja.</span>
              </span>
            </label>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {editable && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PromptPreview({ prompt, icon }: { prompt: Prompt; icon: string | null }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="mb-2 text-xs text-muted-foreground">Prévia (aparece no alto da página da loja)</p>
      <div className="mx-auto flex max-w-sm gap-3 rounded-xl bg-white p-4 text-[#0f172a] shadow-lg">
        {icon && <img src={icon} alt="" className="size-12 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0">
          <p className="font-semibold">{prompt.title}</p>
          <p className="mt-1 text-sm text-[#334155]">{prompt.text}</p>
          <div className="mt-3 flex justify-end gap-2">
            <span className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#334155]">{prompt.denyLabel}</span>
            <span className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ background: prompt.color }}>
              {prompt.allowLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Criar / editar ----------

function draftOf(c: Campaign | null): Draft {
  return {
    name: c?.name ?? '',
    title: c?.title ?? '',
    message: c?.message ?? '',
    url: c?.url ?? '',
    useButton: !!c?.buttonLabel,
    buttonLabel: c?.buttonLabel ?? 'Ver agora',
    iconFileId: c?.iconFileId ?? null,
    iconUrl: c?.iconUrl ?? null,
    imageFileId: c?.imageFileId ?? null,
    imageUrl: c?.imageUrl ?? null,
  }
}

/** Mesmas regras do servidor (src/webpush/webpush.ts), para avisar antes de enviar. */
function draftError(d: Draft, sending: boolean) {
  if (!d.name.trim()) return 'Dê um nome ao web push.'
  if (d.url.trim() && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(d.url.trim())) return 'A URL precisa começar com https://'
  if (!sending) return null
  if (!d.title.trim()) return 'Escreva o título.'
  if (!d.message.trim()) return 'Escreva a mensagem.'
  if (!d.url.trim()) return 'Informe a URL que abre no clique.'
  if (d.useButton && !d.buttonLabel.trim()) return 'Escreva o texto do botão.'
  return null
}

function ImagePick({ label, hint, url, fallback, onPick, onClear, disabled }: { label: string; hint: string; url: string | null; fallback?: string | null; onPick: (f: File) => void; onClear: () => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const shown = url ?? fallback ?? null
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {shown ? <img src={shown} alt="" className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
            Enviar imagem
          </Button>
          {url && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onClear}>
              Remover
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function EditorDialog({ view, campaign, onClose, onDone }: { view: View; campaign: Campaign | null; onClose: () => void; onDone: (tab: string) => void }) {
  const { can } = useAuth()
  const confirm = useConfirm()
  // Novo: a URL já começa com o endereço da loja.
  const [d, setD] = useState<Draft>(() => (campaign ? draftOf(campaign) : { ...draftOf(null), url: view.siteUrl ? `${view.siteUrl}/` : '' }))
  const [id, setId] = useState<string | null>(campaign?.id ?? null)
  const [scheduling, setScheduling] = useState(false)
  const [date, setDate] = useState(() => (campaign?.scheduledAt ? new Date(new Date(campaign.scheduledAt).getTime() - 3 * 3_600_000).toISOString().slice(0, 10) : todaySP(1)))
  const [time, setTime] = useState(() => (campaign?.scheduledAt ? new Date(new Date(campaign.scheduledAt).getTime() - 3 * 3_600_000).toISOString().slice(11, 16) : '10:00'))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))
  const scheduled = campaign?.status === 'AGENDADO'

  const upload = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: 'icon' | 'image' }) => {
      const form = new FormData()
      form.append('file', file)
      return { kind, r: await api.post<{ id: string; url: string }>('/marketing/web-push/imagens', form) }
    },
    onSuccess: ({ kind, r }) => setD((p) => (kind === 'icon' ? { ...p, iconFileId: r.id, iconUrl: r.url } : { ...p, imageFileId: r.id, imageUrl: r.url })),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const body = () => ({
    name: d.name.trim(),
    title: d.title.trim(),
    message: d.message.trim(),
    url: d.url.trim(),
    buttonLabel: d.useButton ? d.buttonLabel.trim() : null,
    iconFileId: d.iconFileId,
    imageFileId: d.imageFileId,
  })
  const persist = async () => {
    const saved = id ? await api.put<Campaign>(`/marketing/web-push/campanhas/${id}`, body()) : await api.post<Campaign>('/marketing/web-push/campanhas', body())
    setId(saved.id)
    return saved
  }

  const run = useMutation({
    mutationFn: async (what: 'salvar' | 'enviar' | 'agendar') => {
      const saved = await persist()
      if (what === 'enviar') await api.post(`/marketing/web-push/campanhas/${saved.id}/enviar`)
      if (what === 'agendar') await api.post(`/marketing/web-push/campanhas/${saved.id}/agendar`, { date, time })
      return what
    },
    onSuccess: (what) => {
      if (what === 'enviar') toast.success('Envio iniciado. Os números aparecem na aba Enviados.')
      else if (what === 'agendar') toast.success('Web push agendado.')
      else toast.success(scheduled ? 'Alterações salvas (continua agendado).' : 'Rascunho salvo.')
      onDone(what === 'enviar' ? 'enviados' : what === 'agendar' || scheduled ? 'agendados' : 'rascunhos')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const go = async (what: 'salvar' | 'enviar' | 'agendar') => {
    const err = draftError(d, what !== 'salvar' || scheduled)
    if (err) return toast.error(err)
    if (what === 'enviar') {
      if (!view.subscribers) return toast.error('Ainda não há inscritos para receber.')
      const ok = await confirm({
        title: 'Enviar agora?',
        description: `"${d.title.trim()}" vai ser enviada para ${num(view.subscribers)} ${view.subscribers === 1 ? 'inscrito' : 'inscritos'}. Depois de enviada, não dá para desfazer.`,
        confirmLabel: 'Enviar agora',
        destructive: false,
      })
      if (!ok) return
    }
    run.mutate(what)
  }

  const busy = run.isPending || upload.isPending
  const canSend = can('web_push', 'edit')

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{campaign ? (scheduled ? 'Editar web push agendado' : 'Editar web push') : 'Criar Web Push'}</DialogTitle>
          <DialogDescription>Vai para todos os {num(view.subscribers)} inscritos da loja.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wp-name">Nome</Label>
              <Input id="wp-name" value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Black Friday filtros" />
              <p className="text-xs text-muted-foreground">Só aparece aqui no CRM.</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor="wp-title">Título</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {d.title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input id="wp-title" value={d.title} maxLength={TITLE_MAX} onChange={(e) => set('title', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor="wp-msg">Mensagem</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {d.message.length}/{MESSAGE_MAX}
                </span>
              </div>
              <Textarea id="wp-msg" value={d.message} maxLength={MESSAGE_MAX} onChange={(e) => set('message', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wp-url">URL</Label>
              <Input id="wp-url" value={d.url} maxLength={1000} onChange={(e) => set('url', e.target.value)} placeholder="https://www.sualoja.com.br/ofertas" />
              <p className="text-xs text-muted-foreground">Página que abre ao clicar (https). O CRM acrescenta a origem "webpush" para o rastreamento.</p>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-3">
                <Switch checked={d.useButton} onCheckedChange={(v) => set('useButton', v)} />
                <span className="text-sm font-medium">Usar botão</span>
              </label>
              {d.useButton && <Input aria-label="Texto do botão" value={d.buttonLabel} maxLength={BUTTON_MAX} onChange={(e) => set('buttonLabel', e.target.value)} />}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImagePick
                label="Ícone"
                hint="Quadrado, 192 × 192 px. Sem imagem: o ícone da empresa."
                url={d.iconUrl}
                fallback={view.defaultIconUrl}
                disabled={busy}
                onPick={(file) => upload.mutate({ file, kind: 'icon' })}
                onClear={() => setD((p) => ({ ...p, iconFileId: null, iconUrl: null }))}
              />
              <ImagePick
                label="Imagem grande (opcional)"
                hint="Proporção 2:1, ex.: 720 × 360 px. Aparece no Chrome e no Edge (Windows e Android)."
                url={d.imageUrl}
                disabled={busy}
                onPick={(file) => upload.mutate({ file, kind: 'image' })}
                onClear={() => setD((p) => ({ ...p, imageFileId: null, imageUrl: null }))}
              />
            </div>
            {scheduling && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wp-date">Data</Label>
                  <Input id="wp-date" type="date" value={date} min={todaySP()} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wp-time">Hora (Brasília)</Label>
                  <Input id="wp-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <Button onClick={() => go('agendar')} disabled={busy || !date || !time}>
                  Confirmar agendamento
                </Button>
              </div>
            )}
          </div>
          <Preview d={d} icon={d.iconUrl ?? view.defaultIconUrl} site={view.siteUrl} />
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fechar
          </Button>
          <Button variant="outline" onClick={() => go('salvar')} disabled={busy}>
            {scheduled ? 'Salvar alterações' : 'Salvar rascunho'}
          </Button>
          {canSend && (
            <Button variant="outline" onClick={() => setScheduling((s) => !s)} disabled={busy}>
              {scheduled ? 'Mudar agendamento' : 'Agendar'}
            </Button>
          )}
          {canSend && (
            <Button onClick={() => go('enviar')} disabled={busy}>
              {run.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar agora
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Preview({ d, icon, site }: { d: Draft; icon: string | null; site: string | null }) {
  const host = site ? site.replace(/^https:\/\//, '') : 'sua loja'
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Prévia</p>
      <div className="rounded-xl border bg-white text-[#111827] shadow-md">
        {d.imageUrl && <img src={d.imageUrl} alt="" className="aspect-[2/1] w-full rounded-t-xl object-cover" />}
        <div className="flex gap-3 p-3">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#f3f4f6]">
            {icon ? <img src={icon} alt="" className="size-full object-cover" /> : <BellRingIcon className="size-5 text-[#6b7280]" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{d.title || 'Título da notificação'}</p>
            <p className="line-clamp-3 text-sm text-[#374151]">{d.message || 'A mensagem aparece aqui.'}</p>
            <p className="mt-1 text-xs text-[#6b7280]">{host}</p>
          </div>
        </div>
        {d.useButton && d.buttonLabel.trim() && <div className="border-t px-3 py-2 text-center text-sm font-medium text-[#1d4ed8]">{d.buttonLabel}</div>}
      </div>
      <p className="text-xs text-muted-foreground">O desenho muda um pouco em cada navegador e sistema.</p>
    </div>
  )
}
