import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, XCircleIcon } from 'lucide-react'
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
  updatedAt: string | null
}
interface Integrations {
  metaAds: { enabled: boolean; adAccountIds: string[]; hasToken: boolean; lastTest: Test | null }
  metaOrganic: { enabled: boolean; pageId: string; instagramId: string; hasToken: boolean; lastTest: Test | null }
  tiktok: { enabled: boolean; advertiserIds: string[]; hasToken: boolean; lastTest: Test | null }
  searchConsole: { enabled: boolean; siteUrl: string; lastTest: Test | null }
}

/** Configurações › Marketing Inteligente: regras das contas e as contas das plataformas (somente leitura). */
export function MarketingSettingsTab() {
  const q = useQuery({ queryKey: ['mkt-config'], queryFn: () => api.get<{ config: MktConfig; integrations: Integrations }>('/marketing/configuracoes') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return (
    <div className="space-y-4">
      <RulesCard initial={q.data.config} />
      <IntegrationsCards initial={q.data.integrations} />
    </div>
  )
}

function RulesCard({ initial }: { initial: MktConfig }) {
  const { can } = useAuth()
  const canEdit = can('mi_config', 'edit')
  const qc = useQueryClient()
  const opts = useMktOptions()
  const [c, setC] = useState(initial)
  const save = useMutation({
    mutationFn: () => api.put<MktConfig>('/marketing/configuracoes', { ...c }),
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

function IntegrationsCards({ initial }: { initial: Integrations }) {
  const [i, setI] = useState(initial)
  return (
    <>
      <Integration
        k="metaAds"
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
            <li>Gerar token: escolha o app da empresa e marque ads_read e read_insights. Cole o token aqui com o número de cada conta (Gerenciador de Anúncios, no topo: act_…).</li>
          </ol>
        }
      />
      <Integration
        k="metaOrganic"
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
        help={<p>O token da Meta precisa também de pages_read_engagement, instagram_basic e instagram_manage_insights. O Instagram deve ser conta profissional ligada à página.</p>}
      />
      <Integration
        k="tiktok"
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

function Integration({ k, title, description, enabled, lastTest, initialValues, fields, hasToken, tokenLabel, help, onSaved }: {
  k: keyof Integrations
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
        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{help}</div>
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
