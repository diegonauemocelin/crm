import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CopyIcon, DownloadIcon, KeyRoundIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface BiKey {
  id: string
  name: string
  prefix: string
  createdByName: string | null
  createdAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  revokedAt: string | null
  revokedByName: string | null
}

interface BiKeys {
  baseUrl: string
  keys: BiKey[]
}

const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copiado.`), () => toast.error('Não foi possível copiar.'))

/** Configurações › Power BI: chaves de acesso às tabelas de BI (criar, ver uma vez, revogar) e o contrato de dados. */
export function PowerBiTab() {
  const { can } = useAuth()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['power-bi-chaves'], queryFn: () => api.get<BiKeys>('/power-bi/chaves') })
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null)
  const create = useMutation({
    mutationFn: () => api.post<BiKey & { key: string }>('/power-bi/chaves', { name: name.trim() }),
    onSuccess: (r) => {
      setCreated({ name: r.name, key: r.key })
      setName('')
      void qc.invalidateQueries({ queryKey: ['power-bi-chaves'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/power-bi/chaves/${id}`),
    onSuccess: () => {
      toast.success('Chave revogada: o Power BI que usava esta chave para de atualizar.')
      void qc.invalidateQueries({ queryKey: ['power-bi-chaves'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  const { baseUrl, keys } = q.data
  const canCreate = can('bi', 'create')
  const canRevoke = can('bi', 'delete')

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Chaves de acesso</CardTitle>
            <CardDescription>
              Cada chave lê todas as tabelas de BI da empresa (só leitura, sem nome, telefone ou e-mail de clientes). Crie uma por uso (ex.: “Power BI da diretoria”) e revogue a que não for mais usada.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-4">
            {canCreate && (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  if (name.trim()) create.mutate()
                }}
              >
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="bi-name">Nome da chave</Label>
                  <Input id="bi-name" maxLength={80} placeholder="Ex.: Power BI da diretoria" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Criar chave
                </Button>
              </form>
            )}
            {created && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> Copie agora a chave “{created.name}”: ela não aparece de novo. Guarde só no Power BI (não mande por WhatsApp ou e-mail).
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={created.key} className="font-mono text-xs" aria-label="Chave criada" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" size="sm" variant="outline" onClick={() => copy(created.key, 'Chave')}>
                    <CopyIcon /> Copiar
                  </Button>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  Já copiei
                </Button>
              </div>
            )}
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chave</TableHead>
                      <TableHead>Criada</TableHead>
                      <TableHead>Último uso</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id} className={k.revokedAt ? 'opacity-60' : undefined}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" /> {k.name}
                            {k.revokedAt && <Badge variant="secondary">Revogada</Badge>}
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateTime(k.createdAt)}
                          {k.createdByName && <span className="block text-xs text-muted-foreground">por {k.createdByName}</span>}
                          {k.revokedAt && <span className="block text-xs text-muted-foreground">revogada em {formatDateTime(k.revokedAt)}{k.revokedByName ? ` por ${k.revokedByName}` : ''}</span>}
                        </TableCell>
                        <TableCell className="text-sm">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : <span className="text-muted-foreground">Nunca usada</span>}</TableCell>
                        <TableCell>
                          {canRevoke && !k.revokedAt && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={revoke.isPending}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: `Revogar a chave “${k.name}”?`,
                                    description: 'O Power BI que usa esta chave para de atualizar na hora. Não dá para desfazer: para voltar, crie outra chave e troque no Power BI.',
                                    confirmLabel: 'Revogar',
                                  })
                                )
                                  revoke.mutate(k.id)
                              }}
                            >
                              Revogar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Como ligar o Power BI</CardTitle>
          <CardDescription>Funciona no Power BI Desktop e na atualização agendada do Power BI Service, sem gateway.</CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="bi-url">Endereço da API de BI (parâmetro CRM_BaseUrl)</Label>
            <div className="flex gap-2">
              <Input id="bi-url" readOnly value={baseUrl} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={() => copy(baseUrl, 'Endereço')}>
                <CopyIcon /> Copiar
              </Button>
            </div>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>Crie uma chave aqui e copie.</li>
            <li>
              Baixe o projeto do Power BI abaixo, descompacte e abra o arquivo <code>CRM Usaparts.pbip</code> no Power BI Desktop (o LEIA-ME do zip explica). Ou, num relatório novo, crie os parâmetros <code>CRM_BaseUrl</code> e <code>CRM_Chave</code> e a função <code>CRM_Tabela</code> do contrato.
            </li>
            <li>
              Em Transformar dados › Editar parâmetros, cole a chave em <code>CRM_Chave</code> e atualize: as tabelas vêm em páginas de até 50 mil linhas, últimos 24 meses nos fatos.
            </li>
            <li>
              No Power BI Service, nas credenciais da fonte de dados, escolha <strong>Anônima</strong> e privacidade <strong>Organizacional</strong>. A chave vai no parâmetro <code>CRM_Chave</code>.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            O projeto já vem com o modelo (tabelas, relações, calendário, medidas por área, cenários) e o relatório (visão geral, comercial, WhatsApp, loja e Mercado Livre, marketing, fretes e cenários), com o endereço deste CRM. O contrato lista as tabelas, as colunas, as relações, a função do Power Query e as medidas DAX.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => api.download('/power-bi/projeto', 'CRM Usaparts - Power BI.zip').catch((e) => toast.error(errorMessage(e)))}>
              <DownloadIcon /> Baixar projeto do Power BI
            </Button>
            <Button type="button" variant="outline" onClick={() => api.download('/power-bi/contrato', 'BI-CONTRATO.md').catch((e) => toast.error(errorMessage(e)))}>
              <DownloadIcon /> Baixar o contrato de dados (Markdown)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
