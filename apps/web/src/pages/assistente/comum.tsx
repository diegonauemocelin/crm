// Partes comuns das telas do assistente das perguntas do Mercado Livre (veio do painel.usaparts.com.br).
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const BASE = '/marketplaces/assistente'

export const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova',
  aguardando_analise: 'Aguardando análise',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando o cliente',
  aguardando_validacao: 'Aguardando validação técnica',
  conhecimento_aprovacao: 'Conhecimento em aprovação',
  respondida: 'Respondida',
  resolvida: 'Resolvida',
  nao_aplicavel: 'Não se aplica',
}
export const FINAL = ['respondida', 'resolvida', 'nao_aplicavel']

export const SEND_LABELS: Record<string, string> = {
  pendente_aprovacao: 'Aguardando aprovação',
  preparada: 'Preparada',
  enviando: 'Enviando',
  pendente_confirmacao: 'Aguardando confirmação',
  enviada: 'Enviada',
  falha: 'Falha no envio',
  descartada: 'Descartada',
}

export const KNOWLEDGE_LABELS: Record<string, string> = { ativo: 'Ativo', em_revisao: 'Em revisão', inativo: 'Inativo', rascunho: 'Rascunho' }
export const VALIDATION_LABELS: Record<string, string> = { confirmada: 'Confirmada', pendente: 'Pendente', nao_confirmada: 'Não confirmada' }
export const PRIORITY_LABELS: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
export const ORIGIN_LABELS: Record<string, string> = { ia: 'IA', atendente: 'Atendente', externa: 'Direto no Mercado Livre', sem_resposta: 'Sem resposta' }

export function StatusBadge({ status }: { status: string }) {
  const variant = FINAL.includes(status) ? 'secondary' : status === 'nova' || status === 'aguardando_analise' ? 'default' : 'outline'
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>
}

export function SendBadge({ status }: { status: string }) {
  const variant = status === 'enviada' ? 'secondary' : status === 'falha' ? 'destructive' : status === 'descartada' ? 'outline' : 'default'
  return <Badge variant={variant}>{SEND_LABELS[status] ?? status}</Badge>
}

export function PriorityBadge({ level }: { level: string }) {
  return <Badge variant={level === 'alta' ? 'destructive' : level === 'media' ? 'default' : 'outline'}>{PRIORITY_LABELS[level] ?? level}</Badge>
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
      <span>
        {total} registro(s) · página {page} de {pages}
      </span>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeftIcon />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

/** Monta a query string sem os campos vazios. */
export function qs(o: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const customer = (r: { customerName?: unknown; customerNickname?: unknown; customerId?: unknown }) => String(r.customerName || r.customerNickname || (r.customerId ? `Cliente ${r.customerId}` : '—'))

/** Segundos em texto curto (2 min, 1 h 20 min, 3 d). */
export function duration(s: number | null | undefined) {
  if (s === null || s === undefined) return '—'
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  return `${Math.round(h / 24)} d`
}

export function QuestionLink({ id, children, className }: { id: number; children: ReactNode; className?: string }) {
  return (
    <Link to={`${BASE}/perguntas/${id}`} className={cn('hover:underline', className)}>
      {children}
    </Link>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Lista de pares rótulo: valor (fichas e detalhes). */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
