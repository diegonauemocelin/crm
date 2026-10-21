import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, SearchIcon, XCircleIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useMktOptions } from '@/lib/marketing'

interface Test {
  at: string
  ok: boolean
  message: string
}
interface MktConfig {
  qualified: 'repassado_retorno' | 'repassado'
  marginPct: number
  fixedMonthly: number
  fixedNote: string
  marketingOriginIds: string[]
  attribution: { model: 'ultimo' | 'primeiro'; windowDays: number }
  negativeWords: string[] | null
  updatedAt: string | null
}
type SyncStates = Partial<Record<keyof Integrations, { lastRunAt?: string; lastOkAt?: string; lastError?: string | null; rows?: number; running?: boolean }>>
interface Integrations {
  metaAds: { enabled: boolean; adAccountIds: string[]; hasToken: boolean; lastTest: Test | null }
  metaOrganic: { enabled: boolean; pageId: string; instagramId: string; hasToken: boolean; lastTest: Test | null }
  tiktok: { enabled: boolean; advertiserIds: string[]; hasToken: boolean; lastTest: Test | null }
  searchConsole: { enabled: boolean; siteUrl: string; lastTest: Test | null }
}

/** Configurações › Marketing Inteligente: regras das contas e as contas das plataformas (somente leitura). */
export function MarketingSettingsTab() {
  const q = useQuery({ queryKey: ['mkt-config'], queryFn: () => api.get<{ config: MktConfig; integrations: Integrations; sync: SyncStates; defaultNegativeWords: string[] }>('/marketing/configuracoes') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return (
    <div className="space-y-4">
      <RulesCard initial={q.data.config} defaultWords={q.data.defaultNegativeWords} />
      <IntegrationsCards initial={q.data.integrations} sync={q.data.sync} />
    </div>
  )
}

function RulesCard({ initial, defaultWords }: { initial: MktConfig; defaultWords: string[] }) {
  const { can } = useAuth()
  const canEdit = can('mi_config', 'edit')
  const qc = useQueryClient()
  const opts = useMktOptions()
  const [c, setC] = useState(initial)
  const [words, setWords] = useState((initial.negativeWords ?? defaultWords).join(', '))
  const save = useMutation({
    mutationFn: () => {
      const list = words.split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean)
      const same = list.length === defaultWords.length && list.every((w, i) => w === defaultWords[i])
      return api.put<MktConfig>('/marketing/configuracoes', { ...c, negativeWords: same ? null : list })
    },
    onSuccess: (saved) => {
      setC(saved)
      toast.success('Regras do Marketing Inteligente salvas.')
      void qc.invalidateQueries({ queryKey: ['mkt-config'] })
      void qc.invalidateQueries({ queryKey: ['mkt-analise'] })
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regras das análises</CardTitle>
        <CardDescription>Como o Marketing Inteligente conta leads qualificados, faturamento, custo e retorno. Valem para todas as telas e relatórios do módulo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Lead qualificado</Label>
          <RadioGroup value={c.qualified} onValueChange={(v) => setC({ ...c, qualified: v as MktConfig['qualified'] })} disabled={!canEdit}>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="repassado_retorno" className="mt-0.5" />
              <span>
                <b>Repassado ao vendedor e com retorno do vendedor</b> (Pré-Vendas: “Repassou ao vendedor” e “Vendedor retornou? Sim”)
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="repassado" className="mt-0.5" />
              <span>Só repassado ao vendedor</span>
            </label>
          </RadioGroup>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mkt-margin">Margem de contribuição média (%)</Label>
            <Input id="mkt-margin" type="number" min={0} max={100} step="0.5" value={c.marginPct} onChange={(e) => setC({ ...c, marginPct: Number(e.target.value) })} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">Usada no ROI estimado: faturamento atribuído × margem − custos de marketing. O custo real das peças não é lido do ERP.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mkt-fixed">Custos fixos de marketing por mês (R$)</Label>
            <Input id="mkt-fixed" type="number" min={0} step="0.01" value={c.fixedMonthly} onChange={(e) => setC({ ...c, fixedMonthly: Number(e.target.value) })} disabled={!canEdit} />
            <Input aria-label="O que entra nos custos fixos" maxLength={200} placeholder="Ex.: agência, ferramentas, equipe" value={c.fixedNote} onChange={(e) => setC({ ...c, fixedNote: e.target.value })} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">Somados ao investimento em mídia no custo total, no CAC e no ROI (rateados pelos dias do período). Zero = só mídia.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Origens que também contam como marketing</Label>
          <MultiSelect items={opts.data?.origins ?? []} value={c.marketingOriginIds} onChange={(v) => setC({ ...c, marketingOriginIds: v })} placeholder="Só a mídia paga (Google, Meta, TikTok)" disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">Leads de Google, Meta e TikTok já contam como marketing. Marque outras origens do Pré-Vendas que vêm do marketing (ex.: Site, Formulário, E-mail).</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Modelo de atribuição da campanha</Label>
            <Select value={c.attribution.model} onValueChange={(v) => setC({ ...c, attribution: { ...c.attribution, model: v as 'ultimo' | 'primeiro' } })} disabled={!canEdit}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ultimo">Último toque: a campanha do contato (padrão do Google)</SelectItem>
                <SelectItem value="primeiro">Primeiro toque: a primeira campanha do lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mkt-window">Janela de atribuição (dias)</Label>
            <Input id="mkt-window" type="number" min={1} max={365} value={c.attribution.windowDays} onChange={(e) => setC({ ...c, attribution: { ...c.attribution, windowDays: Number(e.target.value) } })} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">Clique no anúncio mais antigo que isso, antes do contato, não é atribuído à campanha.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mkt-words">Palavras de alerta nos termos de pesquisa (Google Ads)</Label>
          <Textarea id="mkt-words" rows={3} value={words} onChange={(e) => setWords(e.target.value)} disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">Separadas por vírgula. Termo pesquisado com uma delas e algum custo entra nas sugestões de palavras negativas (só sugestão, para revisar).</p>
        </div>
        <p className="text-xs text-muted-foreground">Faturamento: valor da venda registrado no Pré-Vendas (a integração com o ERP fica para uma etapa futura).</p>
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-between gap-2">
          <span className="text-xs text-muted-foreground">{c.updatedAt ? `Salvo em ${formatDateTime(c.updatedAt)}` : 'Usando os valores padrão.'}</span>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar regras
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function IntegrationsCards({ initial, sync }: { initial: Integrations; sync: SyncStates }) {
  const [i, setI] = useState(initial)
  return (
    <>
      <Integration
        k="metaAds"
        sync={sync.metaAds ?? null}
        title="Meta Ads (Facebook e Instagram)"
        description="Investimento, alcance, frequência, cliques, leads e conversas por campanha, conjunto, anúncio e criativo. Só leitura."
        enabled={i.metaAds.enabled}
        lastTest={i.metaAds.lastTest}
        onSaved={(v) => setI(v)}
        initialValues={{ adAccountIds: i.metaAds.adAccountIds.join('\n') }}
        hasToken={i.metaAds.hasToken}
        tokenLabel="Token de acesso (usuário do sistema do Business Manager)"
        fields={[{ key: 'adAccountIds', label: 'Contas de anúncio (act_…)', placeholder: 'act_1234567890', multiline: true }]}
        help={
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>No Business Manager da Usaparts: Configurações do negócio › Usuários do sistema › Adicionar (função Administrador ou Funcionário).</li>
            <li>Atribua as contas de anúncio ao usuário do sistema (permissão “Ver desempenho”).</li>
            <li>No app da empresa (developers.facebook.com › Casos de uso › API de Marketing › Personalizar), adicione a permissão ads_read.</li>
            <li>Gerar token no usuário do sistema: escolha o app, validade “Nunca” e marque ads_read. Cole o token aqui com o número de cada conta (Gerenciador de Anúncios, no topo: act_…).</li>
          </ol>
        }
      />
      <Integration
        k="metaOrganic"
        sync={sync.metaOrganic ?? null}
        title="Instagram e Facebook orgânicos"
        description="Seguidores, alcance, engajamento e publicações. Usa o mesmo token da Meta Ads."
        enabled={i.metaOrganic.enabled}
        lastTest={i.metaOrganic.lastTest}
        onSaved={(v) => setI(v)}
        initialValues={{ pageId: i.metaOrganic.pageId, instagramId: i.metaOrganic.instagramId }}
        fields={[
          { key: 'pageId', label: 'ID da página do Facebook', placeholder: 'Só números' },
          { key: 'instagramId', label: 'ID da conta profissional do Instagram', placeholder: 'Só números' },
        ]}
        finder={(fill) => <MetaFinder fill={fill} />}
        help={<p>Adicione ao app os casos de uso da Página (pages_show_list, pages_read_engagement, read_insights) e do Instagram (instagram_basic, instagram_manage_insights) e gere o token do usuário do sistema de novo com essas permissões. O Instagram deve ser conta profissional ligada à página.</p>}
      />
      <Integration
        k="tiktok"
        sync={sync.tiktok ?? null}
        title="TikTok Ads"
        description="Campanhas, grupos, anúncios, investimento, cliques, vídeo e conversões. Só leitura."
        enabled={i.tiktok.enabled}
        lastTest={i.tiktok.lastTest}
        onSaved={(v) => setI(v)}
        initialValues={{ advertiserIds: i.tiktok.advertiserIds.join('\n') }}
        hasToken={i.tiktok.hasToken}
        tokenLabel="Token de acesso (Marketing API)"
        fields={[{ key: 'advertiserIds', label: 'ID do anunciante', placeholder: '7123456789012345678', multiline: true }]}
        help={<p>No TikTok for Developers, crie o app (Marketing API) e autorize a conta de anúncios da Usaparts. Cole o token de longa duração e o ID do anunciante (TikTok Ads Manager, no topo).</p>}
      />
      <Integration
        k="searchConsole"
        sync={sync.searchConsole ?? null}
        title="Google Search Console"
        description="Cliques e impressões orgânicas, CTR, posição média, consultas e páginas. Usa a conta de serviço do Google Analytics."
        enabled={i.searchConsole.enabled}
        lastTest={i.searchConsole.lastTest}
        onSaved={(v) => setI(v)}
        initialValues={{ siteUrl: i.searchConsole.siteUrl }}
        fields={[{ key: 'siteUrl', label: 'Propriedade', placeholder: 'https://www.usaparts.com.br/ ou sc-domain:usaparts.com.br' }]}
        help={<p>No Search Console, em Configurações › Usuários e permissões › Adicionar usuário, coloque o e-mail da conta de serviço (o mesmo de Configurações › Google Analytics) com permissão Restrita.</p>}
      />
    </>
  )
}

function Integration({ k, title, description, enabled, lastTest, initialValues, fields, hasToken, tokenLabel, help, onSaved, sync, finder }: {
  k: keyof Integrations
  sync: SyncStates[keyof Integrations] | null
  title: string
  description: string
  enabled: boolean
  lastTest: Test | null
  initialValues: Record<string, string>
  fields: { key: string; label: string; placeholder: string; multiline?: boolean }[]
  hasToken?: boolean
  tokenLabel?: string
  help: ReactNode
  onSaved: (v: Integrations) => void
  /** Ajuda para achar os IDs: recebe uma função que preenche os campos. */
  finder?: (fill: (v: Record<string, string>) => void) => ReactNode
}) {
  const { can } = useAuth()
  const canEdit = can('mi_config', 'edit')
  const [on, setOn] = useState(enabled)
  const [values, setValues] = useState(initialValues)
  const [token, setToken] = useState('')
  const [test, setTest] = useState<Test | null>(lastTest)
  const save = useMutation({
    mutationFn: () => api.put<Integrations>(`/marketing/integracoes/${k}`, { enabled: on, ...values, ...(token ? { token } : {}) }),
    onSuccess: (v) => (onSaved(v), setToken(''), toast.success(`${title}: salvo.`)),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const qc = useQueryClient()
  const syncNow = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/marketing/integracoes/${k}/sincronizar`),
    onSuccess: (r) => (toast.success(r.message), setTimeout(() => void qc.invalidateQueries({ queryKey: ['mkt-config'] }), 20_000)),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const probe = useMutation({
    mutationFn: () => api.post<Test>(`/marketing/integracoes/${k}/testar`),
    onSuccess: (r) => setTest(r),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <PlugZapIcon className="size-4" /> {title}
          <Badge variant={on ? 'default' : 'secondary'}>{on ? 'Ligado' : 'Desligado'}</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch id={`mkt-${k}-on`} checked={on} onCheckedChange={setOn} disabled={!canEdit} />
          <Label htmlFor={`mkt-${k}-on`}>Ligar a integração</Label>
        </div>
        {tokenLabel && (
          <div className="space-y-1.5">
            <Label htmlFor={`mkt-${k}-token`}>{tokenLabel}</Label>
            <Input id={`mkt-${k}-token`} type="password" autoComplete="off" placeholder={hasToken ? 'Token guardado (deixe vazio para manter)' : 'Cole o token'} value={token} onChange={(e) => setToken(e.target.value)} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">Fica criptografado no servidor e nunca volta para a tela.</p>
          </div>
        )}
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`mkt-${k}-${f.key}`}>{f.label}</Label>
            {f.multiline ? (
              <Textarea id={`mkt-${k}-${f.key}`} rows={2} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} disabled={!canEdit} />
            ) : (
              <Input id={`mkt-${k}-${f.key}`} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} disabled={!canEdit} />
            )}
          </div>
        ))}
        {finder && canEdit && finder((v) => setValues((cur) => ({ ...cur, ...v })))}
        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{help}</div>
        {(sync?.lastOkAt || sync?.lastError) && (
          <p className={`text-xs ${sync.lastError ? 'text-red-600' : 'text-muted-foreground'}`}>
            {sync.lastOkAt ? `Última sincronização: ${formatDateTime(sync.lastOkAt)} (${sync.rows ?? 0} linha(s)).` : ''}
            {sync.lastError ? ` Última tentativa falhou: ${sync.lastError}` : ''}
          </p>
        )}
        {test && (
          <p className={`flex items-start gap-2 text-sm ${test.ok ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-red-600'}`}>
            {test.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0" />}
            <span>
              {test.message} <span className="text-xs text-muted-foreground">({formatDateTime(test.at)})</span>
            </span>
          </p>
        )}
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-end gap-2">
          {enabled && (
            <Button variant="outline" onClick={() => syncNow.mutate()} disabled={syncNow.isPending || save.isPending}>
              {syncNow.isPending && <Loader2Icon className="animate-spin" />} Sincronizar agora
            </Button>
          )}
          <Button variant="outline" onClick={() => probe.mutate()} disabled={probe.isPending || save.isPending}>
            {probe.isPending && <Loader2Icon className="animate-spin" />} Testar conexão
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

/** Busca as páginas do Facebook e o Instagram ligado a cada uma (pelo token da Meta) e preenche os IDs com um clique. */
function MetaFinder({ fill }: { fill: (v: Record<string, string>) => void }) {
  const find = useMutation({
    mutationFn: () => api.post<{ pages: { id: string; name: string; instagram: { id: string; username: string } | null }[] }>('/marketing/integracoes/metaOrganic/buscar'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const pages = find.data?.pages
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => find.mutate()} disabled={find.isPending}>
        {find.isPending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />} Buscar página e Instagram
      </Button>
      {pages && pages.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhuma página encontrada. No Gerenciador de Negócios, atribua a página da Usaparts ao usuário do sistema (Atribuir ativos › Páginas) e busque de novo.</p>
      )}
      {pages && pages.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {pages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{p.name || 'Página sem nome'}</p>
                <p className="text-xs text-muted-foreground">
                  Página {p.id} · {p.instagram ? `Instagram @${p.instagram.username || p.instagram.id} (${p.instagram.id})` : 'sem Instagram profissional ligado'}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => (fill({ pageId: p.id, instagramId: p.instagram?.id ?? '' }), toast.success('IDs preenchidos. Clique em Salvar.'))}>
                Usar esta
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
