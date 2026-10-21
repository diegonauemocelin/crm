import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileTextIcon, MessageCircleIcon, PhoneOutgoingIcon, SearchIcon, ShoppingCartIcon, UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
import { todaySP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { StartDialog } from '@/pages/chat-page'

/** Leads para chamar: têm telefone, converteram (formulário, loja virtual…) e ainda não conversaram no WhatsApp. */

interface ToCallItem {
  id: string
  name: string | null
  phone: string
  email: string | null
  place: string | null
  seller: string | null
  at: string
  via: { kind: 'formulario' | 'whatsapp' | 'ecommerce' | 'outro'; label: string }
}
interface ToCallData {
  total: number
  page: number
  days: number
  items: ToCallItem[]
  /** Último lead que chegou por canal (com ou sem conversa), para ver se algum canal parou. */
  latest?: { form: { at: string; name: string } | null; store: { at: string } | null; any: { at: string; origin: string | null } | null }
}

/** Data de hoje (ou de N dias atrás) em Brasília, AAAA-MM-DD. */
const spDay = (back = 0) => todaySP(-back)

const VIA_STYLE: Record<ToCallItem['via']['kind'], { icon: typeof FileTextIcon; tone: string }> = {
  formulario: { icon: FileTextIcon, tone: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300' },
  whatsapp: { icon: MessageCircleIcon, tone: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300' },
  ecommerce: { icon: ShoppingCartIcon, tone: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300' },
  outro: { icon: UserIcon, tone: 'bg-muted text-muted-foreground' },
}

export function ToCallPanel({ onStarted }: { onStarted: (conversationId: string) => void }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [days, setDays] = useState('30')
  const [from, setFrom] = useState(spDay(7))
  const [to, setTo] = useState(spDay())
  const [page, setPage] = useState(1)
  const [calling, setCalling] = useState<ToCallItem | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])
  // Hoje, ontem e período escolhido no calendário vão como datas; o resto, como "últimos N dias".
  const period: Record<string, string> = days === 'hoje' ? { de: spDay(), ate: spDay() } : days === 'ontem' ? { de: spDay(1), ate: spDay(1) } : days === 'periodo' ? { de: from, ate: to } : { dias: days }
  const qs = new URLSearchParams({ ...period, pagina: String(page), ...(q ? { busca: q } : {}) }).toString()
  const list = useQuery({ queryKey: ['chat-para-chamar', qs], queryFn: () => api.get<ToCallData>(`/chat/para-chamar?${qs}`), placeholderData: keepPreviousData })
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar lead" />
        </div>
        <Select value={days} onValueChange={(v) => (setDays(v), setPage(1))}>
          <SelectTrigger size="sm" className="w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hoje">Hoje</SelectItem>
            <SelectItem value="ontem">Ontem</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
            <SelectItem value="periodo">Escolher período…</SelectItem>
          </SelectContent>
        </Select>
        {days === 'periodo' && (
          <div className="flex items-center gap-1.5 text-sm">
            <Input type="date" className="h-8 w-40" value={from} max={to} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="De" />
            até
            <Input type="date" className="h-8 w-40" value={to} min={from} max={spDay()} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="Até" />
          </div>
        )}
        <p className="text-sm text-muted-foreground">{list.data ? `${list.data.total.toLocaleString('pt-BR')} lead(s) sem conversa no WhatsApp` : ''}</p>
      </div>
      {list.data?.latest && (
        <p className="border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          Último lead que entrou no CRM: {list.data.latest.any ? `${formatDateTime(list.data.latest.any.at)}${list.data.latest.any.origin ? ` (${list.data.latest.any.origin})` : ''}` : 'nenhum'}
          {' · '}último formulário/pop-up: {list.data.latest.form ? `${formatDateTime(list.data.latest.form.at)} (${list.data.latest.form.name})` : 'nenhum'}
          {' · '}última da loja virtual: {list.data.latest.store ? formatDateTime(list.data.latest.store.at) : 'nenhum'}.
          {' '}Data antiga num canal que deveria ter movimento = esse canal não está mandando leads para o CRM.
        </p>
      )}
      {list.isLoading ? (
        <div className="p-4">
          <TableSkeleton rows={6} />
        </div>
      ) : list.isError ? (
        <div className="p-4">
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </div>
      ) : list.data!.items.length === 0 ? (
        <EmptyState icon={PhoneOutgoingIcon} title="Ninguém para chamar" description="Todos os leads com telefone do período já conversaram no WhatsApp." />
      ) : (
        <ul className="divide-y">
          {list.data!.items.map((l) => {
            const v = VIA_STYLE[l.via.kind] ?? VIA_STYLE.outro
            const Icon = v.icon
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link to={`/leads/${l.id}`} className="block truncate font-medium hover:underline">
                    {l.name || 'Lead sem nome'}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatPhone(l.phone)}
                    {l.place ? ` · ${l.place}` : ''}
                    {l.seller ? ` · vendedor ${l.seller}` : ''}
                  </p>
                </div>
                <span className={cn('inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', v.tone)}>
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{l.via.label}</span>
                </span>
                <span className="w-32 text-xs text-muted-foreground tabular-nums">{formatDateTime(l.at)}</span>
                <Button size="sm" onClick={() => setCalling(l)}>
                  <MessageCircleIcon /> Chamar no WhatsApp
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {list.data && list.data.total > 50 && (
        <div className="flex items-center justify-end gap-2 border-t p-3 text-sm text-muted-foreground">
          {(page - 1) * 50 + 1}–{Math.min(page * 50, list.data.total)} de {list.data.total}
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
      {calling && <StartDialog leadId={calling.id} phone={calling.phone} onClose={() => setCalling(null)} onStarted={(cid) => (setCalling(null), onStarted(cid))} />}
    </Card>
  )
}
