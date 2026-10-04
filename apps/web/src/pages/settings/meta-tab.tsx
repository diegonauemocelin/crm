import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, XCircleIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CopyField } from '@/components/copy-field'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import type { MetaConfig, MetaReceipt } from '@/lib/rastreamento'
import { FormError } from '../auth/auth-layout'

const NONE = '__none__'

const RECEIPT_LABEL: Record<MetaReceipt['status'], string> = {
  RECEBIDO: 'Processando',
  LEAD_CRIADO: 'Lead criado',
  LEAD_ATUALIZADO: 'Lead atualizado',
  SEM_CONTATO: 'Sem e-mail/telefone',
  ERRO: 'Erro',
}

export function MetaTab() {
  const q = useQuery({ queryKey: ['meta-config'], queryFn: () => api.get<MetaConfig>('/integracoes/meta-lead-ads') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={5} />
  return (
    <div className="space-y-4">
      <MetaEditor initial={q.data} />
      <Receipts />
    </div>
  )
}

function MetaEditor({ initial }: { initial: MetaConfig }) {
  const { can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const options = useOptions()
  const [form, setForm] = useState(initial)
  const [tagsText, setTagsText] = useState(initial.tags.join(', '))
  const [appSecret, setAppSecret] = useState('')
  const [pageToken, setPageToken] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const saved = await api.put<MetaConfig>('/integracoes/meta-lead-ads', {
        enabled: form.enabled,
        graphVersion: form.graphVersion.trim(),
        ownerId: form.ownerId,
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        ...(appSecret ? { appSecret } : {}),
        ...(pageToken ? { pageToken } : {}),
      })
      qc.setQueryData(['meta-config'], saved)
      setForm(saved)
      setAppSecret('')
      setPageToken('')
      toast.success('Meta Lead Ads salvo.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setResult(null)
    try {
      setResult(await api.post<{ ok: boolean; message: string }>('/integracoes/meta-lead-ads/testar', { graphVersion: form.graphVersion.trim(), ...(pageToken ? { pageToken } : {}) }))
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Meta Lead Ads
              <Badge variant={initial.enabled ? 'default' : 'outline'}>{initial.enabled ? 'Ligado' : 'Desligado'}</Badge>
            </CardTitle>
            <CardDescription>
              Leads dos formulários de anúncios do Facebook e do Instagram entram direto na base, com a campanha e o anúncio de origem. Fica desligado até o app do Meta ser aprovado.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="m-enabled">Receber leads do Meta</Label>
                <p className="text-xs text-muted-foreground">Para ligar, informe a chave secreta do app e o token da página.</p>
              </div>
              <Switch id="m-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={!canEdit} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-secret">Chave secreta do app (App Secret)</Label>
                <Input id="m-secret" type="password" autoComplete="new-password" placeholder={initial.hasAppSecret ? '•••••••• (mantida)' : ''} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-token">Token de acesso da página</Label>
                <Input id="m-token" type="password" autoComplete="new-password" placeholder={initial.hasPageToken ? '•••••••• (mantido)' : ''} value={pageToken} onChange={(e) => setPageToken(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-owner">Responsável pelos leads novos</Label>
                <Select value={form.ownerId ?? NONE} onValueChange={(v) => setForm({ ...form, ownerId: v === NONE ? null : v })} disabled={!canEdit}>
                  <SelectTrigger id="m-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem responsável</SelectItem>
                    {(options.data?.sellers ?? [])
                      .filter((s) => s.active || s.id === form.ownerId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-tags">Tags aplicadas</Label>
                <Input id="m-tags" value={tagsText} placeholder="meta-lead-ads" onChange={(e) => setTagsText(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-version">Versão da Graph API</Label>
                <Input id="m-version" className="w-32" value={form.graphVersion} onChange={(e) => setForm({ ...form, graphVersion: e.target.value })} disabled={!canEdit} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Chave e token ficam guardados criptografados e nunca são mostrados de novo. Deixe em branco para manter os atuais.</p>
            <FormError message={error} />
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4 gap-2">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null || (!pageToken && !initial.hasPageToken)} onClick={() => void test()}>
                {busy === 'test' ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
                Testar conexão
              </Button>
            </CardFooter>
          )}
          {result && (
            <p
              role="status"
              className={`mx-6 mt-4 flex gap-2 rounded-md border p-3 text-sm ${result.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-destructive/40 bg-destructive/10'}`}
            >
              {result.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
              {result.message}
            </p>
          )}
        </form>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Configuração no Meta</CardTitle>
          <CardDescription>No app do Meta for Developers: produto Webhooks → objeto “Page” → campo “leadgen”.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-url">URL de retorno (Callback URL)</Label>
            <CopyField id="m-url" value={initial.webhookUrl} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-verify">Token de verificação (Verify Token)</Label>
            <CopyField id="m-verify" value={initial.verifyToken} />
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Ligue a integração aqui e salve (a verificação só responde com ela ligada).</li>
            <li>Cole a URL e o token no Meta e clique em “Verificar e salvar”.</li>
            <li>Assine a página no campo “leadgen” e dê ao app as permissões leads_retrieval e pages_manage_metadata.</li>
            <li>Teste com a Ferramenta de Teste de Lead Ads do Meta: o lead aparece abaixo e na base.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function Receipts() {
  const q = useQuery({ queryKey: ['meta-receipts'], queryFn: () => api.get<MetaReceipt[]>('/integracoes/meta-lead-ads/recebimentos'), refetchInterval: 30_000 })
  if (!q.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Últimos leads recebidos</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Recebido em</TableHead>
              <TableHead>Id no Meta</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="pr-6">Detalhe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="pl-6 text-sm">{formatDateTime(r.receivedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{r.externalId}</TableCell>
                <TableCell>
                  <Badge variant={r.status === 'ERRO' ? 'destructive' : 'outline'}>{RECEIPT_LABEL[r.status] ?? r.status}</Badge>
                </TableCell>
                <TableCell className="max-w-96 pr-6 text-sm">
                  {r.leadId ? (
                    <Link to={`/leads/${r.leadId}`} className="hover:underline">
                      Abrir lead
                    </Link>
                  ) : (
                    <span className="line-clamp-2 text-muted-foreground">{r.error ?? '—'}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
