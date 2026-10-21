import { useQuery } from '@tanstack/react-query'
import { AlarmClockIcon, ArrowRightIcon, BellRingIcon, HeadsetIcon, MessageCircleIcon, PhoneOutgoingIcon, PlusIcon, UndoIcon, UserRoundXIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { useAttendanceAlerts } from '@/components/layout/alerts-bell'
import { RecordSheet } from '@/components/atendimento/record-sheet'
import { InlineError, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatPhone, whatsappLink } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { useChatAlerts } from '@/lib/chat-alerts'
import { cn } from '@/lib/utils'

/**
 * Minha fila (telas novas): o início mostra o que a pessoa precisa fazer agora, na ordem de quem espera há mais tempo.
 * Junta o que o sistema já avisa no sino e no chat: clientes sem resposta, pré-vendas novas, vendedor sem retorno,
 * lembretes vencidos e leads para chamar.
 */

type Tone = 'orange' | 'blue' | 'purple' | 'red' | 'green' | 'gray'
const TONE: Record<Tone, string> = {
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  purple: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  gray: 'bg-muted text-muted-foreground',
}

type Filter = 'tudo' | 'chat' | 'pre' | 'lembretes'

interface Task {
  key: string
  filter: Exclude<Filter, 'tudo'>
  kind: string
  tone: Tone
  name: string
  detail: string | null
  /** Desde quando espera (ordena a fila). */
  since: number
  late?: boolean
  action: ReactNode
}

interface ToCall {
  total: number
  items: { id: string; name: string | null; phone: string; at: string; via: { label: string } }[]
}

function ago(ms: number) {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60_000))
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.floor(m / 60)} h`
  return `${Math.floor(m / 1440)} dia(s)`
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function Counter({ value, label, hint, to, alert }: { value: number | undefined; label: string; hint: string; to: string; alert?: boolean }) {
  const hot = alert && !!value
  return (
    <Link
      to={to}
      className={cn(
        'flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-[color:var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        hot && 'border-orange-300 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10',
      )}
    >
      <span className={cn('text-3xl font-bold tabular-nums', hot && 'text-orange-700 dark:text-orange-300')}>{value ?? '–'}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Link>
  )
}

export function MinhaFila() {
  const { me, can } = useAuth()
  const chatQ = useChatAlerts()
  const attQ = useAttendanceAlerts()
  const chat = chatQ.data
  const att = attQ.data
  // Sem os avisos, a fila vazia não quer dizer "tudo em dia": mostra o erro.
  const alertsError = (!chat && chatQ.error) || (!att && attQ.error) || null
  const [filter, setFilter] = useState<Filter>('tudo')
  const [creating, setCreating] = useState(false)
  const toCall = useQuery({
    queryKey: ['chat-para-chamar', 'fila'],
    queryFn: () => api.get<ToCall>('/chat/para-chamar?dias=7&pagina=1'),
    enabled: can('chat'),
    staleTime: 60_000,
  })
  if (!me) return null

  const tasks: Task[] = []
  for (const w of chat?.waiting?.items ?? []) {
    const since = Date.parse(w.since)
    tasks.push({
      key: `w-${w.conversationId}`,
      filter: 'chat',
      kind: 'Cliente esperando',
      tone: 'orange',
      name: w.name,
      detail: w.preview,
      since,
      late: (Date.now() - since) / 60_000 >= (chat?.waiting?.redMinutes ?? 30),
      action: (
        <Button asChild size="sm">
          <Link to={`/chat?conversa=${w.conversationId}`}>Responder</Link>
        </Button>
      ),
    })
  }
  for (const f of att?.fresh ?? []) {
    tasks.push({
      key: `f-${f.id}`,
      filter: 'pre',
      kind: 'Pré-venda nova',
      tone: 'blue',
      name: f.name,
      detail: [f.origin, f.channel].filter(Boolean).join(' · ') || null,
      since: Date.parse(f.createdAt),
      action: (
        <Button asChild size="sm">
          <Link to={`/pre-vendas?abrir=${f.id}`}>Assumir</Link>
        </Button>
      ),
    })
  }
  for (const o of att?.overdueList ?? []) {
    const wa = whatsappLink(o.sellerPhone)
    tasks.push({
      key: `o-${o.id}`,
      filter: 'pre',
      kind: 'Vendedor sem retorno',
      tone: 'purple',
      name: o.name,
      detail: o.seller ? `Com ${o.seller}, ainda sem retorno ao cliente` : 'Repassada, ainda sem retorno ao cliente',
      since: o.forwardedAt ? Date.parse(o.forwardedAt) : Date.now(),
      late: true,
      action: (
        <div className="flex gap-2">
          {wa && (
            <Button asChild size="sm" variant="outline">
              <a href={wa} target="_blank" rel="noreferrer">
                Cobrar vendedor
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to={`/pre-vendas?abrir=${o.id}`}>Abrir</Link>
          </Button>
        </div>
      ),
    })
  }
  for (const r of chat?.dueReminders ?? []) {
    tasks.push({
      key: `r-${r.id}`,
      filter: 'lembretes',
      kind: 'Lembrete vencido',
      tone: 'red',
      name: r.name,
      detail: r.note,
      since: Date.parse(r.dueAt),
      late: true,
      action: (
        <Button asChild size="sm" variant="outline">
          <Link to={`/chat?conversa=${r.conversationId}`}>Abrir conversa</Link>
        </Button>
      ),
    })
  }
  tasks.sort((a, b) => a.since - b.since)
  const shown = filter === 'tudo' ? tasks : tasks.filter((t) => t.filter === filter)

  const filters: { v: Filter; label: string; show: boolean }[] = [
    { v: 'tudo', label: 'Tudo', show: true },
    { v: 'chat', label: 'Chat', show: can('chat') },
    { v: 'pre', label: 'Pré-Vendas', show: can('pre_vendas') },
    { v: 'lembretes', label: 'Lembretes', show: can('chat') },
  ]

  return (
    <div>
      <PageHeader
        title="Minha fila"
        description={`${greeting()}, ${me.name.split(' ')[0]}! Aqui está o que precisa de você agora, de quem espera há mais tempo para quem chegou agora.`}
        actions={
          <>
            {can('chat') && (
              <Button asChild variant="outline">
                <Link to="/chat">
                  <MessageCircleIcon /> Abrir o chat
                </Link>
              </Button>
            )}
            {can('pre_vendas', 'create') && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> Nova pré-venda
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {can('chat') && (
          <Counter
            value={chat?.waiting?.count}
            label="Clientes esperando resposta"
            hint={chat?.waiting?.items[0] ? `O mais antigo espera há ${ago(Date.parse(chat.waiting.items[0].since))}` : 'Ninguém esperando agora'}
            to="/chat"
            alert
          />
        )}
        {can('pre_vendas') && (
          <Counter value={att?.fresh?.length} label="Pré-vendas novas" hint={att?.waiting ? `${att.waiting} sem ninguém atender` : 'Todas já foram atendidas'} to="/pre-vendas?waiting=true" alert={!!att?.waiting} />
        )}
        {can('pre_vendas') && (
          <Counter
            value={att?.items.find((i) => i.kind === 'PRE_VENDAS')?.overdue}
            label="Vendedores sem retorno"
            hint={`Repassadas há mais de ${att?.alertHours ?? '…'} h`}
            to="/pre-vendas?overdue=true"
          />
        )}
        {can('chat') && (
          <Counter
            value={chat?.dueReminders.length}
            label="Lembretes vencidos"
            hint={chat?.upcomingReminders ? `${chat.upcomingReminders} ainda por vir` : 'Nenhum lembrete marcado'}
            to="/chat"
            alert
          />
        )}
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <div className="mr-auto">
              <h2 className="font-semibold">O que fazer agora</h2>
              <p className="text-xs text-muted-foreground">Quem espera há mais tempo aparece primeiro.</p>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar a fila">
              {filters
                .filter((f) => f.show)
                .map((f) => (
                  <Button key={f.v} size="sm" variant={filter === f.v ? 'default' : 'outline'} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>
                    {f.label}
                  </Button>
                ))}
            </div>
          </div>
          {alertsError && (
            <div className="border-b px-4 py-3">
              <InlineError
                error={alertsError}
                onRetry={() => {
                  void chatQ.refetch()
                  void attQ.refetch()
                }}
              />
            </div>
          )}
          {shown.length === 0 && alertsError ? null : shown.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-medium">Tudo em dia por aqui.</p>
              <p className="mt-1 text-sm text-muted-foreground">Quando um cliente esperar resposta ou chegar uma pré-venda, ela aparece nesta lista.</p>
            </div>
          ) : (
            <ul>
              {shown.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[t.tone])}>{t.kind}</span>
                  <div className="min-w-0 flex-[1_1_14rem]">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    {t.detail && <p className="truncate text-xs text-muted-foreground">{t.detail}</p>}
                  </div>
                  <span className={cn('min-w-16 text-right text-sm font-semibold tabular-nums', t.late ? 'text-orange-700 dark:text-orange-300' : 'text-muted-foreground')}>
                    {ago(t.since)}
                  </span>
                  {t.action}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {can('chat') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneOutgoingIcon className="size-4" /> Leads para chamar
                </CardTitle>
                <CardDescription>Deixaram telefone nos últimos 7 dias e ainda não conversaram no WhatsApp.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(toCall.data?.items ?? []).slice(0, 4).map((l) => (
                  <div key={l.id} className="text-sm">
                    <p className="truncate font-medium">{l.name || formatPhone(l.phone)}</p>
                    <p className="truncate text-xs text-muted-foreground">{l.via.label}</p>
                  </div>
                ))}
                {toCall.error && <InlineError error={toCall.error} onRetry={() => void toCall.refetch()} />}
                {toCall.data && toCall.data.total === 0 && <p className="text-sm text-muted-foreground">Ninguém para chamar agora.</p>}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/chat?aba=chamar">
                    Ver todos{toCall.data ? ` (${toCall.data.total})` : ''} <ArrowRightIcon />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {(att?.followOverdue || att?.returnedToMe) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pós-vendas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!!att?.followOverdue && (
                  <Link to="/pos-vendas?followOverdue=true" className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted">
                    <AlarmClockIcon className="size-4 text-orange-600" /> {att.followOverdue} sem contato no prazo
                  </Link>
                )}
                {!!att?.returnedToMe && (
                  <Link to="/pre-vendas?postSaleReturned=true" className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted">
                    <UndoIcon className="size-4 text-violet-600" /> {att.returnedToMe} voltaram para você
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Atalhos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {can('pre_vendas') && (
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/pre-vendas">
                    <HeadsetIcon /> Quadro de pré-vendas
                  </Link>
                </Button>
              )}
              {can('chat') && (
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/chat?naoLidas=1">
                    <BellRingIcon /> Conversas não lidas
                    {!!chat?.unreadConversations && <Badge className="ml-auto">{chat.unreadConversations}</Badge>}
                  </Link>
                </Button>
              )}
              {can('pre_vendas') && (
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/pre-vendas?overdue=true">
                    <UserRoundXIcon /> Repasses atrasados
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {creating && <RecordSheet kind="PRE_VENDAS" record={null} onClose={() => setCreating(false)} />}
    </div>
  )
}
