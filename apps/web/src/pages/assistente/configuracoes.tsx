import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PlayIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { CopyField } from '@/components/copy-field'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { num } from '@/lib/format'
import { BASE, Field } from './comum'

interface AiSettings {
  assistant_name: string
  tone: string
  formality: 'formal' | 'semiformal'
  greeting_by_time: boolean
  max_answer_chars: number
  auto_reply: boolean
  min_confidence: number
  upsell_enabled: boolean
  upsell_rules: string
  max_complementary: number
  request_info_when: string
  request_info_mode: 'enviar' | 'revisar'
  forward_when: string
  allowed_categories: string[]
  custom_instructions: string
  provider: 'claude' | 'gemini' | 'sem_ia'
  gemini_model: string
  gemini_fallback: boolean
  auto_learn: boolean
  auto_learn_status: 'ativo' | 'em_revisao'
  auto_learn_from_ai: boolean
  model: string
  effort: string
  import_status_mode: 'planilha' | 'revisao'
  frete_enabled: boolean
  frete_intro: string
  frete_outro: string
  frete_ask_cep: boolean
  frete_ask_cep_text: string
}
interface KeyStatus {
  source: string | null
  masked?: string | null
  updated_at?: string | null
  updated_by?: string | null
}
interface ConfigResponse {
  settings: AiSettings
  defaults: AiSettings
  models: string[]
  efforts: string[]
  categories: string[]
  keys: { claude: KeyStatus; gemini: KeyStatus }
  providers: Record<string, string>
  geminiModels: string[]
}
interface ItemSync {
  running: boolean
  phase: string
  done: number
  total: number
  finishedAt: string | null
  result: { found: number; stored: number; linked: number; linkable: number } | null
  error: string | null
}
interface Integration {
  connected: boolean
  account: { sellerId: string; nickname: string | null } | null
  active: boolean
  taken: boolean
  status: 'desconectada' | 'painel_antigo' | 'ativa' | 'aguardando_teste'
  webhookUrl: string
  lastTestAt: string | null
  lastTestOk: boolean
  lastItemsSyncAt: string | null
  lastQuestionsSyncAt: string | null
  lastWebhookAt: string | null
  webhookStatus: 'recebendo' | 'sem_notificacoes_recentes' | 'nenhuma_notificacao'
  lastError: string | null
  lastErrorAt: string | null
  items: number
  sales: { lastSyncAt: string | null; error: string | null; running: boolean; linked: number }
  store: { seller_id: string | null; nickname?: string | null; official_store_id?: string | null; permalink?: string | null; configured_at?: string | null; configured_by?: string | null; last_sync_at?: string | null; synced_items?: number | null; linkable_now: number }
  settings: { active: boolean; polling_enabled: boolean; poll_minutes: number; sales_enabled: boolean; sales_window_days: number; activatedAt?: string | null; activatedBy?: string | null }
  recentLogs: { level: string; message: string; at: string }[]
  painel: { importedAt: string; version: string | null; nickname: string | null; sellerId: string | null; hasTokens: boolean; hasApp: boolean; counts: Record<string, number> } | null
  itemSync: ItemSync | null
}
interface TestResult {
  answer: string
  storeConfigured: boolean
  result: { decision: string; confidence: number; pending_reason: string | null; reason_explanation: string; missing_info: string[] }
  model: string
  freightNote: string | null
  wouldAutoSend: boolean
  knowledgeUsed: { id: number; title: string; version: number }[]
}

const MODEL_NAMES: Record<string, string> = { 'claude-opus-5-5': 'Claude Opus 5.5 (melhor qualidade)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (equilíbrio)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (rápido e barato)', 'claude-haiku-4-5': 'Claude Haiku 4.5' }
const EFFORT_NAMES: Record<string, string> = { low: 'Baixo (mais rápido)', medium: 'Médio', high: 'Alto (pensa mais)' }
const COUNT_LABELS: Record<string, string> = { perguntas: 'perguntas', respostas: 'respostas', conhecimentos: 'conhecimentos', aplicacoes: 'aplicações', anuncios: 'anúncios', vendas: 'vendas', eventos: 'registros da trajetória' }
const DECISION: Record<string, string> = { responder: 'Responder', solicitar_info: 'Pedir informação ao cliente', encaminhar: 'Encaminhar para a equipe' }

/** Abas antigas desta tela: agora cada uma é uma seção de Configurações › Marketplaces. */
const SECAO: Record<string, string> = { integracao: 'assistente-ml', respostas: 'assistente-respostas', motor: 'assistente-ia', testar: 'assistente-testar' }

/** Endereço antigo (/marketplaces/assistente/configuracoes?aba=...): vai para a seção certa de Configurações. */
export function AssistenteConfigPage() {
  const [params] = useSearchParams()
  return <Navigate to={`/configuracoes?secao=${SECAO[params.get('aba') ?? ''] ?? 'assistente-ml'}`} replace />
}

/** Configurações › Marketplaces: as partes do assistente do Mercado Livre. */
export function AssistenteIntegracao() {
  return <IntegracaoTab />
}
export function AssistenteRespostas() {
  return <SettingsForm part="respostas" />
}
export function AssistenteMotor() {
  return <SettingsForm part="motor" />
}
export function AssistenteTestar() {
  return <Testar />
}

const useConfig = () => useQuery({ queryKey: ['assist-config'], queryFn: () => api.get<ConfigResponse>('/assistente/config') })

function SettingsForm({ part }: { part: 'respostas' | 'motor' }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const edit = can('assist_config', 'edit')
  const q = useConfig()
  const [s, setS] = useState<AiSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const prompt = useQuery({ queryKey: ['assist-prompt'], queryFn: () => api.get<{ prompt: string }>('/assistente/config/prompt'), enabled: showPrompt })
  useEffect(() => {
    if (q.data) setS(q.data.settings)
  }, [q.data])
  if (q.isLoading || !s) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <TableSkeleton rows={6} />
  const c = q.data!
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setS({ ...s, [k]: v })
  const save = async () => {
    setSaving(true)
    try {
      await api.put('/assistente/config', { ...s })
      toast.success('Configurações salvas.')
      void qc.invalidateQueries({ queryKey: ['assist-config'] })
      void qc.invalidateQueries({ queryKey: ['assist-prompt'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  const toggle = (k: keyof AiSettings, label: string, hint?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={s[k] as boolean} onCheckedChange={(v) => set(k, v as never)} disabled={!edit} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
  const saveBar = edit && (
    <div className="flex justify-end">
      <Button onClick={save} disabled={saving}>
        {saving && <Loader2Icon className="animate-spin" />} Salvar configurações
      </Button>
    </div>
  )
  if (part === 'motor')
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Motor de respostas</CardTitle>
            <CardDescription>Sem IA usa só respostas aprovadas e as aplicações confirmadas (custo zero). Gemini e Claude escrevem a resposta a partir da base, sem inventar o que não está nela.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Motor">
              <Select value={s.provider} onValueChange={(v) => set('provider', v as AiSettings['provider'])} disabled={!edit}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(c.providers).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {s.provider === 'claude' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Modelo do Claude">
                  <Select value={s.model} onValueChange={(v) => set('model', v)} disabled={!edit}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {c.models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MODEL_NAMES[m] ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Esforço" hint="O Haiku 4.5 ignora o esforço.">
                  <Select value={s.effort} onValueChange={(v) => set('effort', v)} disabled={!edit}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {c.efforts.map((m) => (
                        <SelectItem key={m} value={m}>
                          {EFFORT_NAMES[m] ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {s.provider === 'gemini' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Modelo do Gemini">
                  <Select value={s.gemini_model} onValueChange={(v) => set('gemini_model', v)} disabled={!edit}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([s.gemini_model, ...c.geminiModels])].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="pt-6">{toggle('gemini_fallback', 'Tentar outro modelo do Gemini quando o escolhido estiver sobrecarregado')}</div>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <KeyCard provider="claude" status={c.keys.claude} />
          <KeyCard provider="gemini" status={c.keys.gemini} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aprendizado</CardTitle>
            <CardDescription>Respostas enviadas viram conhecimento para as próximas perguntas. Preço, estoque e frete nunca viram conhecimento (mudam com o tempo).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {toggle('auto_learn', 'Aprender com as respostas enviadas')}
            {toggle('auto_learn_from_ai', 'Aprender também com as respostas da IA', 'Desligado: só aprende com o que atendentes escreveram ou aprovaram.')}
            <Field label="Situação do que é aprendido">
              <Select value={s.auto_learn_status} onValueChange={(v) => set('auto_learn_status', v as AiSettings['auto_learn_status'])} disabled={!edit}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo (a IA já usa)</SelectItem>
                  <SelectItem value="em_revisao">Em revisão (alguém aprova antes)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Importação por planilha">
              <Select value={s.import_status_mode} onValueChange={(v) => set('import_status_mode', v as AiSettings['import_status_mode'])} disabled={!edit}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planilha">Usa o status da planilha (para quem pode aprovar)</SelectItem>
                  <SelectItem value="revisao">Tudo entra em revisão</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instruções que a IA recebe</CardTitle>
            <CardDescription>Montadas a partir destas configurações (salve antes de conferir).</CardDescription>
          </CardHeader>
          <CardContent>
            {showPrompt ? <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{prompt.data?.prompt ?? 'Carregando...'}</pre> : <Button variant="outline" onClick={() => setShowPrompt(true)}>Ver as instruções</Button>}
          </CardContent>
        </Card>
        {saveBar}
      </div>
    )
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Envio das respostas</CardTitle>
          <CardDescription>Desligado, toda resposta fica como sugestão para alguém aprovar na pergunta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {toggle('auto_reply', 'Responder sozinho quando a confiança for alta', 'Só vale depois que o CRM assumir o atendimento (aba Integração).')}
          <Field label={`Confiança mínima para responder sozinho: ${Math.round(s.min_confidence * 100)}%`}>
            <input type="range" min={50} max={99} value={Math.round(s.min_confidence * 100)} onChange={(e) => set('min_confidence', Number(e.target.value) / 100)} disabled={!edit} className="w-full max-w-md" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome do assistente">
              <Input value={s.assistant_name} onChange={(e) => set('assistant_name', e.target.value)} disabled={!edit} />
            </Field>
            <Field label="Tom">
              <Input value={s.tone} onChange={(e) => set('tone', e.target.value)} disabled={!edit} />
            </Field>
            <Field label="Tratamento">
              <Select value={s.formality} onValueChange={(v) => set('formality', v as AiSettings['formality'])} disabled={!edit}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="semiformal">Semiformal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tamanho máximo da resposta (caracteres)">
              <Input type="number" min={200} max={1900} value={s.max_answer_chars} onChange={(e) => set('max_answer_chars', Number(e.target.value))} disabled={!edit} />
            </Field>
            <div className="pt-6">{toggle('greeting_by_time', 'Saudação pelo horário (bom dia, boa tarde, boa noite)')}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frete pela Magazord</CardTitle>
          <CardDescription>Pergunta de frete com CEP é respondida com as opções calculadas na Magazord (peso, medidas e tabelas de frete do produto). O SKU do anúncio precisa ser o mesmo da Magazord.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {toggle('frete_enabled', 'Calcular o frete na Magazord')}
          <Field label="Começo da resposta" hint="{cep} vira o CEP do cliente.">
            <Input value={s.frete_intro} onChange={(e) => set('frete_intro', e.target.value)} disabled={!edit} />
          </Field>
          <Field label="Fim da resposta">
            <Textarea rows={2} value={s.frete_outro} onChange={(e) => set('frete_outro', e.target.value)} disabled={!edit} />
          </Field>
          {toggle('frete_ask_cep', 'Pedir o CEP quando a pergunta de frete vier sem CEP')}
          <Field label="Pedido do CEP">
            <Textarea rows={2} value={s.frete_ask_cep_text} onChange={(e) => set('frete_ask_cep_text', e.target.value)} disabled={!edit} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quando pedir informação e quando encaminhar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Pedir informação ao cliente quando">
            <Textarea rows={2} value={s.request_info_when} onChange={(e) => set('request_info_when', e.target.value)} disabled={!edit} />
          </Field>
          <Field label="O pedido de informação">
            <Select value={s.request_info_mode} onValueChange={(v) => set('request_info_mode', v as AiSettings['request_info_mode'])} disabled={!edit}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enviar">Vai direto para o cliente</SelectItem>
                <SelectItem value="revisar">Fica para alguém aprovar</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Encaminhar para a equipe quando">
            <Textarea rows={3} value={s.forward_when} onChange={(e) => set('forward_when', e.target.value)} disabled={!edit} />
          </Field>
          <Field label="Instruções extras para a IA">
            <Textarea rows={3} value={s.custom_instructions} onChange={(e) => set('custom_instructions', e.target.value)} disabled={!edit} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Venda adicional</CardTitle>
          <CardDescription>Sugere peças com aplicação confirmada para a mesma máquina, de forma breve e opcional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {toggle('upsell_enabled', 'Sugerir itens complementares')}
          <Field label="Máximo de itens sugeridos">
            <Input type="number" min={0} max={3} className="w-24" value={s.max_complementary} onChange={(e) => set('max_complementary', Number(e.target.value))} disabled={!edit} />
          </Field>
          <Field label="Regras da sugestão">
            <Textarea rows={3} value={s.upsell_rules} onChange={(e) => set('upsell_rules', e.target.value)} disabled={!edit} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categorias que a IA pode usar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {c.categories.map((cat) => (
            <label key={cat} className="flex items-center gap-2 text-sm">
              <Checkbox checked={s.allowed_categories.includes(cat)} disabled={!edit} onCheckedChange={(v) => set('allowed_categories', v === true ? [...s.allowed_categories, cat] : s.allowed_categories.filter((x) => x !== cat))} /> {cat}
            </label>
          ))}
        </CardContent>
      </Card>
      {saveBar}
    </div>
  )
}

function KeyCard({ provider, status }: { provider: 'claude' | 'gemini'; status: KeyStatus }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const edit = can('assist_config', 'edit')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const name = provider === 'claude' ? 'Claude (Anthropic)' : 'Google Gemini'
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      const r = (await fn()) as { ok?: boolean; detail?: string; test?: { ok: boolean; detail: string } }
      const t = r.test ?? (r.detail !== undefined ? (r as { ok: boolean; detail: string }) : null)
      if (t) (t.ok ? toast.success : toast.warning)(t.detail)
      else toast.success('Pronto.')
      void qc.invalidateQueries({ queryKey: ['assist-config'] })
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Chave do {name} {status.source ? <Badge variant="secondary">{status.masked}</Badge> : <Badge variant="outline">Sem chave</Badge>}
        </CardTitle>
        <CardDescription>
          {status.source ? `Salva${status.updated_by ? ` por ${status.updated_by}` : ''}${status.updated_at ? ` em ${formatDateTime(status.updated_at)}` : ''}. Fica criptografada; ninguém vê a chave inteira.` : provider === 'claude' ? 'Crie em console.anthropic.com › API Keys.' : 'Crie em aistudio.google.com/apikey.'}
        </CardDescription>
      </CardHeader>
      {edit && (
        <CardContent className="space-y-2">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run(() => api.put(`/assistente/config/chaves/${provider}`, { key }))) setKey('')
            }}
          >
            <Input type="password" autoComplete="off" placeholder={status.source ? 'Trocar a chave' : 'Cole a chave'} value={key} onChange={(e) => setKey(e.target.value)} />
            <Button type="submit" disabled={busy || key.trim().length < 20}>
              Salvar
            </Button>
          </form>
          {status.source && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.post(`/assistente/config/chaves/${provider}/testar`))}>
                Testar a chave
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (await confirm({ title: `Remover a chave do ${name}?`, description: 'Com este motor escolhido, as perguntas passam a ser encaminhadas para a equipe.', confirmLabel: 'Remover chave' })) await run(() => api.delete(`/assistente/config/chaves/${provider}`))
                }}
              >
                Remover
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function Testar() {
  const [question, setQuestion] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<TestResult | null>(null)
  const run = async () => {
    setBusy(true)
    try {
      setR(await api.post<TestResult>('/assistente/config/testar', { question, itemId: itemId.trim().replace(/-/g, '') || undefined }))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pergunta de teste</CardTitle>
          <CardDescription>Gera a resposta como numa pergunta real, com a base, a IA e o frete. Nada é enviado ao Mercado Livre.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={4} placeholder="Ex.: Serve na retro JCB 3C? Qual o frete para 01310-100?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Field label="Anúncio (opcional)" hint="O MLB do anúncio em que o cliente perguntou.">
            <Input placeholder="MLB1234567890" value={itemId} onChange={(e) => setItemId(e.target.value)} />
          </Field>
          <Button onClick={run} disabled={busy || !question.trim()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Testar
          </Button>
        </CardContent>
      </Card>
      {r && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{DECISION[r.result.decision] ?? r.result.decision}</CardTitle>
            <CardDescription>
              {r.model.startsWith('sem-ia') ? 'Sem IA (regras)' : r.model === 'frete-magazord' ? 'Frete pela Magazord' : r.model} · confiança {Math.round(r.result.confidence * 100)}% · {r.wouldAutoSend ? 'seria enviada sozinha' : 'ficaria para aprovação ou encaminhada'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {r.answer ? <p className="whitespace-pre-wrap rounded-md border p-3">{r.answer}</p> : <p className="text-muted-foreground">Sem resposta: a pergunta iria para a equipe.</p>}
            {r.result.reason_explanation && <p className="text-muted-foreground">{r.result.reason_explanation}</p>}
            {!!r.result.missing_info.length && <p className="text-muted-foreground">Faltou: {r.result.missing_info.join('; ')}</p>}
            {r.freightNote && <p className="text-destructive">Frete: {r.freightNote}</p>}
            {!r.storeConfigured && <p className="text-muted-foreground">Sem a loja oficial informada (aba Integração), a resposta não leva links de anúncios.</p>}
            {r.knowledgeUsed.length > 0 && (
              <p className="text-muted-foreground">
                Base usada:{' '}
                {r.knowledgeUsed.map((k) => (
                  <Link key={k.id} className="mr-2 underline" to={`${BASE}/conhecimento?id=${k.id}`}>
                    #{k.id} {k.title}
                  </Link>
                ))}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const STATUS_TEXT: Record<Integration['status'], [string, 'default' | 'secondary' | 'outline' | 'destructive']> = {
  desconectada: ['Mercado Livre não conectado no CRM', 'outline'],
  painel_antigo: ['O painel antigo responde', 'outline'],
  aguardando_teste: ['Assumido, aguardando teste da conexão', 'destructive'],
  ativa: ['O CRM responde', 'secondary'],
}

function IntegracaoTab() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const edit = can('assist_config', 'edit')
  const q = useQuery({ queryKey: ['assist-integracao'], queryFn: () => api.get<Integration>('/assistente/integracao'), refetchInterval: (query) => (query.state.data?.itemSync?.running ? 2000 : false) })
  const [busy, setBusy] = useState<string | null>(null)
  const [usePainel, setUsePainel] = useState(true)
  const [store, setStore] = useState('')
  const [poll, setPoll] = useState<Integration['settings'] | null>(null)
  useEffect(() => {
    if (q.data) setPoll(q.data.settings)
  }, [q.data])
  const run = async (key: string, fn: () => Promise<unknown>, ok?: (r: never) => string) => {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast.success(ok(r as never))
      void qc.invalidateQueries({ queryKey: ['assist-integracao'] })
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    } finally {
      setBusy(null)
    }
  }
  if (q.isLoading) return <TableSkeleton rows={6} />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data
  const [label, variant] = STATUS_TEXT[d.status]
  const sync = d.itemSync
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Atendimento do Mercado Livre <Badge variant={variant}>{label}</Badge>
          </CardTitle>
          <CardDescription>
            {d.taken
              ? `O CRM assumiu${d.settings.activatedBy ? ` (${d.settings.activatedBy}` : ''}${d.settings.activatedAt ? ` em ${formatDateTime(d.settings.activatedAt)})` : d.settings.activatedBy ? ')' : ''}: lê as perguntas, responde conforme as configurações e liga as vendas.`
              : 'Enquanto o CRM não assume, o painel antigo (painel.usaparts.com.br) continua lendo e respondendo as perguntas. O CRM só mostra os dados importados e permite testar.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {d.lastError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              {d.lastError} {d.lastErrorAt && <span className="text-xs">({formatDateTime(d.lastErrorAt)})</span>}
            </p>
          )}
          {d.painel && (
            <div className="rounded-md border p-3">
              <p className="font-medium">Dados trazidos do painel antigo{d.painel.version ? ` (versão ${d.painel.version})` : ''}</p>
              <p className="text-muted-foreground">
                Importados em {formatDateTime(d.painel.importedAt)}
                {d.painel.nickname && ` · conta ${d.painel.nickname}`} ·{' '}
                {Object.entries(d.painel.counts)
                  .map(([k, v]) => `${num(v)} ${COUNT_LABELS[k] ?? k}`)
                  .join(' · ')}
              </p>
            </div>
          )}
          <p className="text-muted-foreground">
            Conta no CRM: {d.account ? `${d.account.nickname ?? ''} (${d.account.sellerId})` : 'não conectada'} · <Link className="underline" to="/configuracoes?secao=marketplaces-conexoes">Configurações › Marketplaces › Conexões</Link>
            {d.lastTestAt && ` · último teste ${formatDateTime(d.lastTestAt)} ${d.lastTestOk ? '(ok)' : '(falhou)'}`}
          </p>
          {edit && (
            <div className="space-y-3">
              {!d.taken ? (
                <>
                  {d.painel?.hasTokens && d.painel.hasApp && (
                    <label className="flex items-start gap-2">
                      <Checkbox checked={usePainel} onCheckedChange={(v) => setUsePainel(v === true)} className="mt-0.5" />
                      <span>
                        Usar o aplicativo e o acesso do Mercado Livre do painel antigo
                        <span className="block text-xs text-muted-foreground">Substitui a conexão de Configurações › Marketplaces › Conexões por essa. Depois de assumir, pare o painel antigo: o acesso passa a ser renovado pelo CRM.</span>
                      </span>
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!!busy}
                      onClick={async () => {
                        if (await confirm({ title: 'Assumir o atendimento do Mercado Livre?', description: 'O CRM passa a ler as perguntas e responder conforme as configurações. Pare o painel antigo logo depois, para os dois não responderem a mesma pergunta.', confirmLabel: 'Assumir o atendimento', destructive: false }))
                          await run('assumir', () => api.post('/assistente/integracao/assumir', { usePainelAccess: usePainel && !!d.painel?.hasTokens }), () => 'O CRM assumiu o atendimento.')
                      }}
                    >
                      {busy === 'assumir' && <Loader2Icon className="animate-spin" />} Assumir o atendimento
                    </Button>
                    {d.connected && (
                      <Button variant="outline" disabled={!!busy} onClick={() => run('testar', () => api.post('/assistente/integracao/testar'), (r: { ok: boolean; nickname?: string; error?: string }) => (r.ok ? `Conexão ok: ${r.nickname ?? ''}` : `Falhou: ${r.error}`))}>
                        Testar a conexão
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={!!busy} onClick={() => run('testar', () => api.post('/assistente/integracao/testar'), (r: { ok: boolean; nickname?: string; error?: string }) => (r.ok ? `Conexão ok: ${r.nickname ?? ''}` : `Falhou: ${r.error}`))}>
                    Testar a conexão
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run('perguntas', () => api.post('/assistente/integracao/sincronizar-perguntas'), (r: { found?: number; created?: number }) => `${r.found ?? 0} pergunta(s) abertas; ${r.created ?? 0} nova(s).`)}>
                    <RefreshCwIcon /> Buscar perguntas agora
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run('vendas', () => api.post('/assistente/integracao/sincronizar-vendas', {}), () => 'Vendas atualizadas.')}>
                    Buscar vendas agora
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={async () => {
                      if (await confirm({ title: 'Devolver o atendimento ao painel antigo?', description: 'O CRM para de ler e responder as perguntas. Ligue o painel antigo de novo no servidor.', confirmLabel: 'Liberar o atendimento' })) await run('liberar', () => api.post('/assistente/integracao/liberar'), () => 'O CRM parou de atender.')
                    }}
                  >
                    Liberar o atendimento
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notificações do Mercado Livre</CardTitle>
          <CardDescription>
            No aplicativo do Mercado Livre (developers.mercadolivre.com.br), coloque esta URL em Notificações, com os tópicos questions e orders_v2. Sem ela, o CRM busca as perguntas a cada {d.settings.poll_minutes} minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <CopyField value={d.webhookUrl} />
          <p className="text-muted-foreground">{d.webhookStatus === 'recebendo' ? `Recebendo (última em ${formatDateTime(d.lastWebhookAt)}).` : d.webhookStatus === 'sem_notificacoes_recentes' ? `Nenhuma notificação nos últimos 7 dias (última em ${formatDateTime(d.lastWebhookAt)}).` : 'Nenhuma notificação recebida ainda.'}</p>
          {poll && edit && (
            <div className="flex flex-wrap items-end gap-4 pt-2">
              <label className="flex items-center gap-2">
                <Switch checked={poll.polling_enabled} onCheckedChange={(v) => setPoll({ ...poll, polling_enabled: v })} /> Buscar perguntas periodicamente
              </label>
              <Field label="A cada (minutos)">
                <Input type="number" min={2} max={60} className="w-24" value={poll.poll_minutes} onChange={(e) => setPoll({ ...poll, poll_minutes: Number(e.target.value) })} />
              </Field>
              <label className="flex items-center gap-2">
                <Switch checked={poll.sales_enabled} onCheckedChange={(v) => setPoll({ ...poll, sales_enabled: v })} /> Ligar perguntas às vendas
              </label>
              <Field label="Janela (dias depois da pergunta)">
                <Input type="number" min={1} max={90} className="w-24" value={poll.sales_window_days} onChange={(e) => setPoll({ ...poll, sales_window_days: Number(e.target.value) })} />
              </Field>
              <Button variant="outline" disabled={!!busy} onClick={() => run('poll', () => api.put('/assistente/integracao/config', { polling_enabled: poll.polling_enabled, poll_minutes: poll.poll_minutes, sales_enabled: poll.sales_enabled, sales_window_days: poll.sales_window_days }), () => 'Salvo.')}>
                Salvar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loja oficial e anúncios</CardTitle>
          <CardDescription>A IA só põe link de anúncio da loja oficial. Os anúncios sincronizados alimentam a busca por código, OEM e título.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {d.store.seller_id ? (
            <p>
              {d.store.nickname ?? d.store.seller_id}
              {d.store.official_store_id && ` · loja oficial ${d.store.official_store_id}`} · {num(d.items)} anúncio(s) sincronizado(s), {num(d.store.linkable_now)} com link liberado
              {d.store.last_sync_at && ` · última sincronização ${formatDateTime(d.store.last_sync_at)}`}
            </p>
          ) : (
            <p className="text-muted-foreground">Nenhuma loja informada.</p>
          )}
          {edit && (
            <>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await run('loja', () => api.put('/assistente/integracao/loja', { url: store }), () => 'Loja salva.')) setStore('')
                }}
              >
                <Input className="max-w-md" placeholder="Link da loja ou de um anúncio dela no Mercado Livre" value={store} onChange={(e) => setStore(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!!busy || !store.trim()}>
                  Salvar loja
                </Button>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={!!busy || !!sync?.running || !d.store.seller_id} onClick={() => run('anuncios', () => api.post('/assistente/integracao/sincronizar-anuncios'))}>
                  {sync?.running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Sincronizar anúncios
                </Button>
                {sync && (
                  <span className="text-muted-foreground">
                    {sync.running ? `${sync.phase === 'listando' ? 'Listando anúncios' : sync.phase === 'baixando' ? `Baixando ${num(sync.done)} de ${num(sync.total)}` : 'Ligando aplicações'}...` : sync.error ? `Falhou: ${sync.error}` : sync.result ? `Concluída: ${num(sync.result.stored)} de ${num(sync.result.found)} anúncios, ${num(sync.result.linkable)} com link.` : ''}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {d.recentLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registro</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {d.recentLogs.slice(0, 30).map((l, i) => (
                <li key={`${l.at}${i}`} className={l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                  {formatDateTime(l.at)} · {l.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
