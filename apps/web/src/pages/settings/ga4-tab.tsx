import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, FileJsonIcon, Loader2Icon, PlugZapIcon, XCircleIcon } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { FormError } from '../auth/auth-layout'

interface Ga4Config {
  enabled: boolean
  propertyId: string
  clientEmail: string
  hasKey: boolean
  updatedAt: string | null
}

export function Ga4Tab() {
  const q = useQuery({ queryKey: ['ga4-config'], queryFn: () => api.get<Ga4Config>('/relatorios/ga4/configuracao') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={5} />
  return <Ga4Editor initial={q.data} />
}

function Ga4Editor({ initial }: { initial: Ga4Config }) {
  const { can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [propertyId, setPropertyId] = useState(initial.propertyId)
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 20_000) return setError('Arquivo grande demais para uma chave de conta de serviço (máximo 20 KB).')
    setError(null)
    setKeyFile({ name: file.name, text: await file.text() })
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    setResult(null)
    try {
      const saved = await api.put<Ga4Config>('/relatorios/ga4/configuracao', { enabled, propertyId: propertyId.trim(), ...(keyFile ? { keyFile: keyFile.text } : {}) })
      qc.setQueryData(['ga4-config'], saved)
      void qc.invalidateQueries({ queryKey: ['relatorios-ga4'] })
      setKeyFile(null)
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Google Analytics salvo.')
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
      setResult(await api.post<{ ok: boolean; message: string }>('/relatorios/ga4/testar'))
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
              Google Analytics 4
              <Badge variant={initial.enabled ? 'default' : 'outline'}>{initial.enabled ? 'Ligado' : 'Desligado'}</Badge>
            </CardTitle>
            <CardDescription>Mostra usuários, sessões, canais, páginas e receita do GA4 em Dashboards e relatórios. O acesso é só de leitura: o CRM não altera nada no Google Analytics.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="g-enabled">Mostrar dados do Google Analytics</Label>
                <p className="text-xs text-muted-foreground">Para ligar, informe o ID da propriedade e envie o arquivo de chave.</p>
              </div>
              <Switch id="g-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="g-property">ID da propriedade</Label>
                <Input id="g-property" inputMode="numeric" placeholder="123456789" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!canEdit} />
                <p className="text-xs text-muted-foreground">Só números (não é o "G-XXXX" da tag).</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="g-key">Arquivo de chave da conta de serviço (.json)</Label>
                <Input id="g-key" ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void pickFile(e.target.files?.[0])} disabled={!canEdit} />
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileJsonIcon className="size-3.5" />
                  {keyFile ? `Será enviado: ${keyFile.name}` : initial.hasKey ? `Chave guardada de ${initial.clientEmail}` : 'Nenhuma chave enviada.'}
                </p>
              </div>
            </div>
            {initial.clientEmail && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground">E-mail da conta de serviço (adicione como Leitor no GA4)</p>
                <p className="font-mono text-xs break-all">{initial.clientEmail}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A chave fica guardada criptografada e nunca é mostrada de novo. Envie um arquivo novo só para trocar.
              {initial.updatedAt ? ` Última alteração: ${formatDateTime(initial.updatedAt)}.` : ''}
            </p>
            <FormError message={error} />
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4 gap-2">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null || !initial.hasKey || !initial.propertyId} onClick={() => void test()}>
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
          <CardTitle>Como conectar</CardTitle>
          <CardDescription>Uma vez só, com a conta Google que administra o GA4 da loja.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              No <strong>Google Cloud Console</strong> (console.cloud.google.com), crie um projeto (ou use um existente) e, em <em>APIs e serviços → Biblioteca</em>, ative a{' '}
              <strong>Google Analytics Data API</strong>.
            </li>
            <li>
              Em <em>IAM e administrador → Contas de serviço</em>, crie uma conta de serviço (sem papéis). Na aba <em>Chaves</em>, crie uma chave do tipo <strong>JSON</strong> e baixe o
              arquivo.
            </li>
            <li>
              No <strong>GA4</strong>, em <em>Administrador → Gerenciamento de acesso à propriedade</em>, adicione o e-mail da conta de serviço (termina em .iam.gserviceaccount.com) com
              o papel <strong>Leitor</strong>.
            </li>
            <li>
              Copie o <strong>ID da propriedade</strong> (<em>Administrador → Detalhes da propriedade</em>), envie o arquivo aqui, ligue e salve. Depois clique em Testar conexão.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Guarde o arquivo baixado em lugar seguro ou apague-o depois de enviar. Não mande a chave por e-mail ou WhatsApp.</p>
        </CardContent>
      </Card>
    </div>
  )
}
