import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalculatorIcon, ExternalLinkIcon, Loader2Icon, MessageCircleQuestionIcon, RefreshCwIcon, SendIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { isDirty, useConfirm } from '@/components/confirm'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money } from '@/lib/marketing'
import { cn } from '@/lib/utils'

interface Option {
  name: string
  price: number
  days: number | null
}
interface Question {
  id: string
  questionId: string
  itemId: string
  itemTitle: string | null
  itemPermalink: string | null
  sku: string | null
  text: string
  cep: string | null
  kind: 'frete' | 'frete_sem_cep' | 'misto'
  status: 'sugerida' | 'revisar' | 'respondida' | 'ignorada' | 'erro' | 'encerrada'
  answer: string | null
  options: Option[] | null
  error: string | null
  askedAt: string
  answeredAt: string | null
  answeredBy: string | null
}
interface Config {
  enabled: boolean
  mode: 'sugerir' | 'automatico'
  askCep: boolean
  intro: string
  outro: string
  askCepText: string
  enabledAt: string | null
  lastCheckAt?: string | null
  lastError?: string | null
}
interface ListResponse {
  items: Question[]
  total: number
  page: number
  pageSize: number
  counts: Record<string, number>
  config: Config
}

const STATUS: Record<Question['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  sugerida: { label: 'Resposta pronta', variant: 'default' },
  revisar: { label: 'Revisar', variant: 'outline' },
  erro: { label: 'Precisa de atenção', variant: 'destructive' },
  respondida: { label: 'Respondida', variant: 'secondary' },
  ignorada: { label: 'Ignorada', variant: 'secondary' },
  encerrada: { label: 'Respondida no Mercado Livre', variant: 'secondary' },
}
const KIND: Record<Question['kind'], string> = { frete: 'Frete com CEP', frete_sem_cep: 'Frete sem CEP', misto: 'Frete e outro assunto' }
const cepFmt = (c: string | null) => (c ? `${c.slice(0, 5)}-${c.slice(5)}` : null)

export function PerguntasFretePage() {
  return (
    <RequirePermission module="marketplaces">
      <Perguntas />
    </RequirePermission>
  )
}

function Perguntas() {
  const { can } = useAuth()
  const edit = can('marketplaces', 'edit')
  const qc = useQueryClient()
  const [filtro, setFiltro] = useState<'abertas' | 'respondidas' | 'todas'>('abertas')
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['ml-perguntas', filtro, page], queryFn: () => api.get<ListResponse>(`/marketplaces/mercado-livre/perguntas?filtro=${filtro}&page=${page}`), placeholderData: keepPreviousData, refetchInterval: 60_000 })
  const [checking, setChecking] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ml-perguntas'] })
  const check = async () => {
    setChecking(true)
    try {
      const r = await api.post<{ message: string }>('/marketplaces/mercado-livre/perguntas/verificar')
      toast.success(r.message)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }
  const d = q.data
  const open = (d?.counts.sugerida ?? 0) + (d?.counts.revisar ?? 0) + (d?.counts.erro ?? 0)
  return (
    <div>
      <PageHeader
        title="Perguntas de frete do Mercado Livre"
        description="O CRM lê as perguntas dos anúncios a cada 2 minutos. As que pedem frete são calculadas na Magazord (peso, medidas e tabelas de frete da loja) e a resposta fica pronta, ou é enviada sozinha, conforme a configuração. Perguntas sobre outros assuntos não são tocadas."
        actions={
          edit && (
            <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
              {checking ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Verificar agora
            </Button>
          )
        }
      />
      {q.isLoading && <TableSkeleton rows={5} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-4">
          <ConfigCard config={d.config} edit={edit} onSaved={refresh} />
          {edit && <TestCard />}
          <Tabs value={filtro} onValueChange={(v) => (setFiltro(v as typeof filtro), setPage(1))}>
            <TabsList>
              <TabsTrigger value="abertas">Para responder ({open})</TabsTrigger>
              <TabsTrigger value="respondidas">Respondidas pelo CRM ({d.counts.respondida ?? 0})</TabsTrigger>
              <TabsTrigger value="todas">Todas</TabsTrigger>
            </TabsList>
          </Tabs>
          {d.items.length === 0 ? (
            <EmptyState icon={MessageCircleQuestionIcon} title={filtro === 'abertas' ? 'Nenhuma pergunta de frete esperando' : 'Nenhuma pergunta aqui'} description={d.config.enabled ? `Última verificação: ${d.config.lastCheckAt ? formatDateTime(d.config.lastCheckAt) : 'ainda não feita'}.` : 'Ligue a leitura das perguntas na configuração acima.'} />
          ) : (
            <div className="space-y-3">
              {d.items.map((x) => (
                <QuestionCard key={x.id} q={x} edit={edit} onDone={refresh} />
              ))}
            </div>
          )}
          {d.total > d.pageSize && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {d.page} de {Math.ceil(d.total / d.pageSize)}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" disabled={page * d.pageSize >= d.total} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfigCard({ config, edit, onSaved }: { config: Config; edit: boolean; onSaved: () => void }) {
  const confirm = useConfirm()
  const initial = { enabled: config.enabled, mode: config.mode, askCep: config.askCep, intro: config.intro, outro: config.outro, askCepText: config.askCepText }
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setF({ enabled: config.enabled, mode: config.mode, askCep: config.askCep, intro: config.intro, outro: config.outro, askCepText: config.askCepText })
  }, [config.enabled, config.mode, config.askCep, config.intro, config.outro, config.askCepText])
  const dirty = isDirty(initial, f)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (f.enabled && f.mode === 'automatico' && (config.mode !== 'automatico' || !config.enabled)) {
      const ok = await confirm({
        title: 'Responder sozinho no Mercado Livre?',
        description: 'A partir de agora, as perguntas só de frete com CEP (e, se marcado, as sem CEP) são respondidas pelo CRM, em nome da loja, sem ninguém conferir. As perguntas que já estão na fila continuam esperando alguém. Confira antes algumas respostas no modo "Só sugerir".',
        confirmLabel: 'Ligar resposta automática',
        destructive: false,
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      await api.put('/marketplaces/mercado-livre/perguntas/config', f)
      toast.success('Configuração salva.')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Configuração
          <Badge variant={config.enabled ? 'default' : 'secondary'}>{config.enabled ? (config.mode === 'automatico' ? 'Respondendo sozinho' : 'Só sugerindo') : 'Desligado'}</Badge>
        </CardTitle>
        <CardDescription>
          {config.lastCheckAt ? `Última verificação: ${formatDateTime(config.lastCheckAt)}.` : 'Ainda não verificou.'}
          {config.lastError && <span className="text-red-600"> Falhou: {config.lastError}</span>} O aplicativo do Mercado Livre precisa da permissão de escrita em Perguntas e respostas (Marketplaces › Conexões).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4 text-sm" onSubmit={(e) => void save(e)}>
          <fieldset disabled={!edit} className="space-y-4">
            <label className="flex items-center gap-3">
              <Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} />
              <span>Ler as perguntas do Mercado Livre e calcular o frete</span>
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              {(['sugerir', 'automatico'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setF({ ...f, mode: m })}
                  className={cn('rounded-md border p-3 text-left transition-colors', f.mode === m ? 'border-[color:var(--brand)] bg-[color:var(--brand)]/5' : 'hover:bg-muted/50')}
                  aria-pressed={f.mode === m}
                >
                  <p className="font-medium">{m === 'sugerir' ? 'Só sugerir (recomendado para começar)' : 'Responder sozinho'}</p>
                  <p className="text-xs text-muted-foreground">{m === 'sugerir' ? 'A resposta fica pronta aqui; alguém confere, ajusta se quiser e clica em Enviar.' : 'Pergunta só de frete é respondida na hora, em nome da loja. Frete junto com outro assunto continua esperando alguém.'}</p>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-3">
              <Switch checked={f.askCep} onCheckedChange={(v) => setF({ ...f, askCep: v })} />
              <span>Pergunta de frete sem CEP: responder pedindo o CEP</span>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="q-intro">Começo da resposta * (use {'{cep}'})</Label>
                <Textarea id="q-intro" rows={2} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="q-outro">Fim da resposta</Label>
                <Textarea id="q-outro" rows={2} value={f.outro} onChange={(e) => setF({ ...f, outro: e.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="q-cep">Resposta pedindo o CEP</Label>
                <Textarea id="q-cep" rows={2} value={f.askCepText} onChange={(e) => setF({ ...f, askCepText: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">O Mercado Livre não aceita telefone, e-mail, WhatsApp ou link nas respostas: o CRM avisa se algum texto tiver.</p>
          </fieldset>
          {edit && (
            <Button type="submit" size="sm" disabled={saving || !dirty}>
              {saving && <Loader2Icon className="animate-spin" />} Salvar configuração
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function TestCard() {
  const [item, setItem] = useState('')
  const [sku, setSku] = useState('')
  const [cep, setCep] = useState('')
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<{ sku: string | null; title: string | null; options: Option[]; answer: string | null; raw: string } | null>(null)
  const run = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setR(null)
    try {
      setR(await api.post('/marketplaces/mercado-livre/perguntas/testar', { itemId: item.trim() || undefined, sku: sku.trim() || undefined, cep }))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalculatorIcon className="size-4" /> Testar cotação
        </CardTitle>
        <CardDescription>Calcula o frete na Magazord sem responder ninguém. Use para conferir as opções antes de ligar a resposta automática.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void run(e)}>
          <div className="space-y-1">
            <Label htmlFor="t-item">Anúncio</Label>
            <Input id="t-item" className="h-8 w-44" placeholder="MLB1234567890" value={item} onChange={(e) => setItem(e.target.value)} />
          </div>
          <span className="pb-2 text-muted-foreground">ou</span>
          <div className="space-y-1">
            <Label htmlFor="t-sku">SKU da Magazord</Label>
            <Input id="t-sku" className="h-8 w-40" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-cep">CEP *</Label>
            <Input id="t-cep" className="h-8 w-32" inputMode="numeric" placeholder="00000-000" value={cep} onChange={(e) => setCep(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={busy || !cep.trim() || (!item.trim() && !sku.trim())}>
            {busy && <Loader2Icon className="animate-spin" />} Calcular
          </Button>
        </form>
        {r && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-muted-foreground">
              {r.title ? `${r.title} · ` : ''}SKU {r.sku ?? '—'}
            </p>
            {r.options.length ? <Options options={r.options} /> : <p className="text-red-600">A Magazord não devolveu opção de frete reconhecida. Veja a resposta dela abaixo.</p>}
            {r.answer && <pre className="whitespace-pre-wrap rounded bg-muted/50 p-2 font-sans">{r.answer}</pre>}
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Resposta da Magazord (técnico)</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/50 p-2 text-xs break-all whitespace-pre-wrap">{r.raw}</pre>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Options({ options }: { options: Option[] }) {
  return (
    <ul className="space-y-0.5">
      {options.map((o) => (
        <li key={`${o.name}${o.price}`}>
          <b>{o.name}</b>: {o.price === 0 ? 'grátis' : money(o.price)}
          {o.days !== null ? ` · até ${o.days} dias úteis` : ''}
        </li>
      ))}
    </ul>
  )
}

function QuestionCard({ q, edit, onDone }: { q: Question; edit: boolean; onDone: () => void }) {
  const isOpen = q.status === 'sugerida' || q.status === 'revisar' || q.status === 'erro'
  const [text, setText] = useState(q.answer ?? '')
  const [cep, setCep] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => setText(q.answer ?? ''), [q.answer])
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(ok)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
      onDone()
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card className={cn(q.status === 'erro' && 'border-destructive/40')}>
      <CardContent className="space-y-3 pt-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="font-medium">“{q.text}”</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(q.askedAt)} · {KIND[q.kind]}
              {q.cep ? ` · CEP ${cepFmt(q.cep)}` : ''} ·{' '}
              {q.itemPermalink ? (
                <a href={q.itemPermalink} target="_blank" rel="noreferrer" className="underline">
                  {q.itemTitle ?? q.itemId} <ExternalLinkIcon className="inline size-3" />
                </a>
              ) : (
                (q.itemTitle ?? q.itemId)
              )}
              {q.sku ? ` · SKU ${q.sku}` : ''}
            </p>
          </div>
          <Badge variant={STATUS[q.status].variant}>{STATUS[q.status].label}</Badge>
        </div>
        {q.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive">{q.error}</p>}
        {q.kind === 'misto' && isOpen && <p className="text-xs text-amber-700 dark:text-amber-400">A pergunta tem outro assunto além do frete: complete a resposta antes de enviar.</p>}
        {q.options && q.options.length > 0 && <Options options={q.options} />}
        {isOpen && edit ? (
          <div className="space-y-2">
            <Textarea rows={5} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Escreva a resposta" aria-label="Resposta" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!!busy || !text.trim()} onClick={() => void act('send', () => api.post(`/marketplaces/mercado-livre/perguntas/${q.id}/enviar`, { text }), 'Resposta enviada ao Mercado Livre.')}>
                {busy === 'send' ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar resposta
              </Button>
              <Input className="h-8 w-32" placeholder="CEP" inputMode="numeric" value={cep} onChange={(e) => setCep(e.target.value)} aria-label="CEP para recalcular" />
              <Button size="sm" variant="outline" disabled={!!busy || (!cep.trim() && !q.cep)} onClick={() => void act('requote', () => api.post(`/marketplaces/mercado-livre/perguntas/${q.id}/recalcular`, { cep: cep.trim() || undefined }), 'Frete recalculado.')}>
                {busy === 'requote' && <Loader2Icon className="animate-spin" />} Recalcular frete
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act('ignore', () => api.post(`/marketplaces/mercado-livre/perguntas/${q.id}/ignorar`), 'Pergunta tirada da fila.')}>
                Ignorar
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">{text.length}/2000</span>
            </div>
          </div>
        ) : (
          q.answer && (
            <div className="space-y-1">
              <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans">{q.answer}</pre>
              {q.answeredAt && (
                <p className="text-xs text-muted-foreground">
                  Enviada em {formatDateTime(q.answeredAt)} por {q.answeredBy}
                </p>
              )}
            </div>
          )
        )}
        {!edit && isOpen && (
          <p className="text-xs text-muted-foreground">
            Para enviar, peça a permissão de editar Marketplaces. <Link to="/marketplaces/integracoes" className="underline">Conexões</Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
