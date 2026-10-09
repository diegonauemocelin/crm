import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, FileJsonIcon, Loader2Icon, PlugZapIcon, SendIcon, XCircleIcon } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CopyField } from '@/components/copy-field'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { brl, int, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { FormError } from '../auth/auth-layout'

type Kind = 'contato' | 'negociacao' | 'venda' | 'perda'
interface Config {
  enabled: boolean
  customerId: string
  loginCustomerId: string
  clientEmail: string
  hasKey: boolean
  actions: Record<Kind, string> & { perdaPorMotivo: Record<string, string> }
  sendUserData: boolean
  onlyGoogle: boolean
  originIds: string[]
  campaigns: Record<string, string>
  campaignsScript: string | null
  campaignsSyncedAt: string | null
  startDate: string | null
  updatedAt: string | null
}
interface Status {
  lastRunAt: string | null
  nextRunAt: string | null
  pausedReason: string | null
  counts: { kind: Kind; status: string; count: number }[]
  recent: { id: string; leadId: string | null; leadName: string | null; kind: Kind; status: string; error: string | null; eventAt: string; value: number | null; campaign: string | null; byClick: boolean; sentAt: string | null }[]
}

const KIND_LABEL: Record<Kind, string> = { contato: 'Contato recebido', negociacao: 'Vendedor retornou (qualificado)', venda: 'Venda', perda: 'Perda' }
const STATUS_LABEL: Record<string, string> = { PENDENTE: 'Na fila', ENVIADO: 'Enviado', ERRO: 'Erro', IGNORADO: 'Não enviado' }

export function GoogleAdsTab() {
  const q = useQuery({ queryKey: ['google-ads-config'], queryFn: () => api.get<Config>('/integracoes/google-ads') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return (
    <div className="space-y-4">
      <Editor initial={q.data} />
      <Sends />
    </div>
  )
}

function Editor({ initial }: { initial: Config }) {
  const { can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const options = useOptions()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(initial)
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | 'send' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  // Nomes das campanhas como linhas editáveis (número + nome).
  const [campaigns, setCampaigns] = useState(() => Object.entries(initial.campaigns ?? {}).map(([id, name]) => ({ id, name })))
  const setCampaign = (i: number, patch: Partial<{ id: string; name: string }>) => setCampaigns((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const setAction = (k: Kind, v: string) => setForm((f) => ({ ...f, actions: { ...f.actions, [k]: v.replace(/[^\d]/g, '') } }))
  const setReason = (id: string, v: string) => setForm((f) => ({ ...f, actions: { ...f.actions, perdaPorMotivo: { ...f.actions.perdaPorMotivo, [id]: v.trim() === '-' ? '-' : v.replace(/[^\d]/g, '') } } }))

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
      const saved = await api.put<Config>('/integracoes/google-ads', {
        enabled: form.enabled,
        customerId: form.customerId,
        loginCustomerId: form.loginCustomerId,
        actions: form.actions,
        sendUserData: form.sendUserData,
        onlyGoogle: form.onlyGoogle,
        originIds: form.originIds,
        campaigns: Object.fromEntries(campaigns.filter((c) => c.id.trim() && c.name.trim()).map((c) => [c.id.trim(), c.name.trim()])),
        startDate: form.startDate,
        ...(keyFile ? { keyFile: keyFile.text } : {}),
      })
      qc.setQueryData(['google-ads-config'], saved)
      setForm(saved)
      setCampaigns(Object.entries(saved.campaigns ?? {}).map(([id, name]) => ({ id, name })))
      setKeyFile(null)
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Google Ads salvo.')
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
      setResult(await api.post<{ ok: boolean; message: string }>('/integracoes/google-ads/testar'))
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const sendNow = async () => {
    setBusy('send')
    try {
      const r = await api.post<{ since: string; considered: number; matched: number; registered: number; sent: number; failed: number; ignored: number; paused: string | null }>('/integracoes/google-ads/enviar')
      const desde = r.since.split('-').reverse().join('/')
      // Explica o resultado: quantos atendimentos olhou, quantos entraram nas regras e por que ficou zero.
      const resumo = `${int.format(r.considered)} atendimento(s) do Pré-Vendas desde ${desde}; ${int.format(r.matched)} vieram de anúncio ou de origem marcada.`
      if (r.considered === 0) toast.info(`Nenhum atendimento do Pré-Vendas desde ${desde}. Volte a data de “Atendimentos a partir de” (até 60 dias).`, { duration: 10_000 })
      else if (r.matched === 0) toast.info(`${resumo} Marque em “Quais contatos enviar” as origens que recebem os contatos dos anúncios (ex.: WhatsApp, Site - LP).`, { duration: 12_000 })
      else if (r.sent + r.failed + r.ignored === 0) toast.info(`${resumo} Nenhum resultado novo: os que tinham já foram enviados, ou falta preencher o ID da conversão desse resultado.`, { duration: 12_000 })
      else if (r.paused) toast.warning(`${resumo} ${int.format(r.sent)} enviado(s) antes de o Google pedir uma pausa: ${r.paused} O restante vai no próximo envio automático (em até 2 horas).`, { duration: 14_000 })
      else toast.success(`${resumo} ${int.format(r.sent)} enviado(s), ${int.format(r.failed)} com erro, ${int.format(r.ignored)} sem como o Google reconhecer o cliente.`, { duration: 10_000 })
      void qc.invalidateQueries({ queryKey: ['google-ads-envios'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const reasons = (options.data?.lostReasons ?? []).filter((r) => r.active !== false || form.actions.perdaPorMotivo[r.id])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Google Ads
              <Badge variant={initial.enabled ? 'default' : 'outline'}>{initial.enabled ? 'Ligado' : 'Desligado'}</Badge>
            </CardTitle>
            <CardDescription>
              Devolve ao Google Ads o resultado de cada contato que veio de anúncio (venda com o valor, perda pelo motivo, retorno do vendedor), direto pela API do Google, a cada
              2 horas. O Google usa isso para mostrar os anúncios a quem compra de verdade.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="ga-enabled">Enviar resultados ao Google Ads</Label>
                <p className="text-xs text-muted-foreground">Vale para os atendimentos de Pré-Vendas a partir da data de início.</p>
              </div>
              <Switch id="ga-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={!canEdit} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ga-customer">ID da conta do Google Ads</Label>
                <Input id="ga-customer" placeholder="123-456-7890" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ga-login">ID da conta de administrador (MCC)</Label>
                <Input id="ga-login" placeholder="Só se a conta for gerenciada por uma MCC" value={form.loginCustomerId} onChange={(e) => setForm({ ...form, loginCustomerId: e.target.value })} disabled={!canEdit} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ga-key">Arquivo de chave da conta de serviço (.json)</Label>
                <Input id="ga-key" ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void pickFile(e.target.files?.[0])} disabled={!canEdit} />
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileJsonIcon className="size-3.5" />
                  {keyFile ? `Será enviado: ${keyFile.name}` : initial.hasKey ? `Chave guardada de ${initial.clientEmail}` : 'Nenhuma chave enviada. Pode ser a mesma conta de serviço do Google Analytics.'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ga-start">Atendimentos a partir de</Label>
                <Input id="ga-start" type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || null })} disabled={!canEdit} />
                <p className="text-xs text-muted-foreground">O Google só aceita até 90 dias depois do clique.</p>
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Conversões no Google Ads</p>
              <p className="text-xs text-muted-foreground">
                Para cada resultado, o ID da ação de conversão (tipo “Importação → Cliques”). Fica na URL da ação, depois de <span className="font-mono">ctId=</span>. Vazio não envia.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['venda', 'negociacao', 'contato', 'perda'] as Kind[]).map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`ga-${k}`} className="text-xs">
                      {k === 'perda' ? 'Perda (motivos sem conversão própria)' : KIND_LABEL[k]}
                    </Label>
                    <Input id={`ga-${k}`} inputMode="numeric" placeholder="ID da conversão" value={form.actions[k]} onChange={(e) => setAction(k, e.target.value)} disabled={!canEdit} />
                  </div>
                ))}
              </div>
              {reasons.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Perda por motivo (vazio usa a de “Perda”; “-” não envia esse motivo)</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {reasons.map((r) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm" title={r.name}>
                          {r.name}
                        </span>
                        <Input className="h-8 w-40" inputMode="numeric" placeholder="usa o padrão" value={form.actions.perdaPorMotivo[r.id] ?? ''} onChange={(e) => setReason(r.id, e.target.value)} disabled={!canEdit} aria-label={`Conversão para o motivo ${r.name}`} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="ga-user">Reconhecer o cliente pelo telefone e e-mail</Label>
                  <p className="text-xs text-muted-foreground">
                    Para quem clicou no anúncio e chamou direto no WhatsApp ou ligou, sem passar pelo site. Vão criptografados (SHA-256), só para medir o anúncio: o CRM nunca
                    autoriza o uso para personalizar anúncios.
                  </p>
                </div>
                <Switch id="ga-user" checked={form.sendUserData} onCheckedChange={(v) => setForm({ ...form, sendUserData: v })} disabled={!canEdit} />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Quais contatos enviar</p>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="ga-only">Contatos em que o CRM detectou anúncio do Google</Label>
                  <p className="text-xs text-muted-foreground">
                    Código de clique do Google na página de entrada, origem google/cpc ou a origem do atendimento com “Google” no nome (ex.: “Google Ads”).
                  </p>
                </div>
                <Switch id="ga-only" checked={form.onlyGoogle} onCheckedChange={(v) => setForm({ ...form, onlyGoogle: v })} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ga-origins">E também os atendimentos destas origens</Label>
                <MultiSelect
                  id="ga-origins"
                  items={(options.data?.origins ?? []).map((o) => ({ id: o.id, name: o.name, active: o.active }))}
                  value={form.originIds}
                  onChange={(originIds) => setForm({ ...form, originIds })}
                  placeholder="Nenhuma origem marcada"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Pode marcar várias (ex.: WhatsApp, Ligação, Site - LP). Vale a origem escolhida no atendimento do Pré-Vendas. O Google só aproveita quem de fato clicou num anúncio; os
                  demais ele ignora.
                </p>
              </div>
              <p className="text-xs font-medium">
                {!form.onlyGoogle && form.originIds.length === 0
                  ? 'Com as duas opções vazias, vão todos os atendimentos do Pré-Vendas.'
                  : `Vai: ${[form.onlyGoogle ? 'quem veio de anúncio detectado' : null, form.originIds.length ? `${form.originIds.length} origem(ns) marcada(s)` : null].filter(Boolean).join(' + ')}.`}
              </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Nomes das campanhas</p>
              {initial.campaignsScript && (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  <p className="text-sm font-medium">Buscar os nomes do Google Ads automaticamente</p>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>
                      No Google Ads: <em>Ferramentas → Ações em massa → Scripts</em> → botão <strong>+</strong> → Novo script.
                    </li>
                    <li>Apague o que vier escrito, cole o código abaixo e clique em Autorizar (com a conta que administra o Google Ads).</li>
                    <li>
                      Clique em <strong>Visualizar</strong> para testar, depois em Salvar. Na lista de scripts, em Frequência, escolha <strong>Diariamente</strong>.
                    </li>
                  </ol>
                  <CopyField value={initial.campaignsScript} multiline />
                  <p className="text-xs text-muted-foreground">
                    {initial.campaignsSyncedAt ? `Última lista recebida: ${formatDateTime(initial.campaignsSyncedAt)}.` : 'Ainda não recebeu nenhuma lista.'} O código contém um endereço
                    secreto: não compartilhe fora da conta do Google Ads.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                O Google Ads põe sozinho o <strong>número da campanha</strong> no link do anúncio (marcação automática ligada). O nome só vem se a campanha tiver
                <span className="font-mono"> utm_campaign</span>; quando vem junto com o número, o CRM guarda o nome aqui sozinho. Também dá para cadastrar ou corrigir: o número fica
                em Campanhas, na coluna “ID da campanha”.
              </p>
              {campaigns.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="h-8 w-40 font-mono" inputMode="numeric" placeholder="Número" value={c.id} onChange={(e) => setCampaign(i, { id: e.target.value.replace(/\D/g, '') })} disabled={!canEdit} aria-label="Número da campanha" />
                  <Input className="h-8 min-w-0 flex-1" placeholder="Nome da campanha" maxLength={120} value={c.name} onChange={(e) => setCampaign(i, { name: e.target.value })} disabled={!canEdit} aria-label="Nome da campanha" />
                  {canEdit && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setCampaigns((list) => list.filter((_, j) => j !== i))}>
                      Remover
                    </Button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button type="button" variant="outline" size="sm" onClick={() => setCampaigns((list) => [...list, { id: '', name: '' }])}>
                  Adicionar campanha
                </Button>
              )}
            </div>
            <FormError message={error} />
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4 flex-wrap gap-2">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null || !initial.hasKey || !initial.customerId} onClick={() => void test()}>
                {busy === 'test' ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
                Testar conexão
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null || !initial.enabled} onClick={() => void sendNow()}>
                {busy === 'send' ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                Enviar agora
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
          <CardDescription>Uma vez só, com quem administra a conta do Google Ads.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              No <strong>Google Cloud Console</strong>, no mesmo projeto do Google Analytics, ative a <strong>Data Manager API</strong> (APIs e serviços → Biblioteca). Pode usar a mesma
              conta de serviço e o mesmo arquivo de chave do Google Analytics.
            </li>
            <li>
              No <strong>Google Ads</strong>, em <em>Administrador → Acesso e segurança</em>, adicione o e-mail da conta de serviço (termina em .iam.gserviceaccount.com) com acesso
              <strong> Padrão</strong>.
            </li>
            <li>
              Em <em>Metas → Conversões → Nova ação de conversão → Importar → Cliques</em>, crie as conversões, por exemplo “CRM - Venda” (com valor), “CRM - Contato” e “CRM -
              Perdido”. Copie o ID de cada uma (na URL, depois de <span className="font-mono">ctId=</span>) para os campos ao lado.
            </li>
            <li>
              Deixe <strong>só a venda</strong> (e, se quiser, o contato qualificado) como conversão <strong>principal</strong>. Perdas e contatos devem ser <strong>secundárias</strong>:
              aparecem nos relatórios do Google sem ensinar a campanha a buscar perdas.
            </li>
            <li>Preencha o ID da conta, envie o arquivo, ligue, salve e clique em Testar conexão.</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Para analisar por campanha dentro do CRM: <Link to="/relatorios/novo" className="underline">Relatórios</Link> → fonte Atendimentos → agrupar por “Lead: campanha” ou “Lead: veio de
            anúncio do Google”.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Sends() {
  const q = useQuery({ queryKey: ['google-ads-envios'], queryFn: () => api.get<Status>('/integracoes/google-ads/envios'), refetchInterval: 60_000 })
  if (!q.data || q.data.counts.length === 0) return null
  const total = (kind: Kind, status: string) => q.data!.counts.find((c) => c.kind === kind && c.status === status)?.count ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Envios ao Google Ads</CardTitle>
        <CardDescription>Cada resultado vai uma vez só. Envio automático a cada 2 horas; os erros são tentados de novo nesses envios (até 5 vezes).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(q.data.lastRunAt || q.data.pausedReason) && (
          <p className="text-sm text-muted-foreground">
            {q.data.lastRunAt && <>Último envio: {formatDateTime(q.data.lastRunAt)} · próximo automático: {formatDateTime(q.data.nextRunAt)}.</>}
          </p>
        )}
        {q.data.pausedReason && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm">
            O último envio foi pausado a pedido do Google: {q.data.pausedReason} O restante vai no próximo envio automático.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(['venda', 'perda', 'negociacao', 'contato'] as Kind[]).map((k) => (
            <div key={k} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{KIND_LABEL[k]}</p>
              <p className="text-lg font-semibold tabular-nums">{int.format(total(k, 'ENVIADO'))}</p>
              <p className="text-xs text-muted-foreground">
                {int.format(total(k, 'PENDENTE'))} na fila · {int.format(total(k, 'ERRO'))} com erro · {int.format(total(k, 'IGNORADO'))} não enviados
              </p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.recent.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.leadId ? <Link to={`/leads/${r.leadId}`} className="hover:underline">{r.leadName ?? 'Lead'}</Link> : '—'}</TableCell>
                  <TableCell className="text-sm">
                    {KIND_LABEL[r.kind]}
                    {r.value ? ` · ${brl.format(r.value)}` : ''}
                    <p className="text-xs text-muted-foreground">{r.byClick ? 'pelo clique no anúncio' : 'pelo telefone/e-mail'}</p>
                  </TableCell>
                  <TableCell className="text-sm">{r.campaign ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'ENVIADO' ? 'secondary' : r.status === 'ERRO' ? 'destructive' : 'outline'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                    {r.error && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{r.error}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(r.sentAt ?? r.eventAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
