import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardListIcon, HeadsetIcon, Loader2Icon, MegaphoneIcon, SparklesIcon, UserCheckIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { type RecordPrefill, RecordSheet } from '@/components/atendimento/record-sheet'
import { InlineError } from '@/components/page'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, type Kind, type ServiceRecord, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { type ChatService, quickPrefill, stageText } from './atendimento-chat'
import { type ChatLabel, LabelChip } from './organizar'

/**
 * Painel do cliente (telas novas): fica fixo ao lado da conversa, em telas largas. Mostra de onde o contato veio,
 * a pré-venda e a pós-venda, o último vendedor e as etiquetas; a pré-venda rápida abre já preenchida pela conversa.
 */

interface PanelThread {
  conversation: { id: string; name: string | null; phone: string | null; category: string; labels?: ChatLabel[] }
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null
  service?: ChatService
  record: { adsVia: string | null; adsCampaign: string | null; adsCampaignId: string | null; entryChannel: string | null } | null
  messages: { fromMe: boolean; internal?: boolean; text: string | null }[]
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' })
const CATEGORY: Record<string, string> = { CLIENTE: 'Cliente / lead', COLEGA: 'Colega de trabalho', FORNECEDOR: 'Fornecedor', OUTRO: 'Outro', NOVO: 'A classificar', GRUPO: 'Grupo do WhatsApp (fora das pré-vendas)' }

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter((p) => /[a-zA-ZÀ-ÿ]/.test(p))
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?'
}

function Box({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'brand' }) {
  return (
    <section className={cn('space-y-1.5 rounded-lg border bg-card p-3', tone === 'brand' && 'border-[color:var(--brand)]/40 bg-[color:var(--brand)]/5')}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function ClientPanel({ id, monitor }: { id: string; monitor: boolean }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const options = useOptions()
  const mq = monitor ? '?monitorar=true' : ''
  // Mesma consulta da conversa aberta (o React Query reaproveita): o painel não faz pedido a mais.
  const q = useQuery({ queryKey: ['chat-conversa', id, monitor], queryFn: () => api.get<PanelThread>(`/chat/conversas/${id}${mq}`), refetchInterval: 4000 })
  const [open, setOpen] = useState<{ kind: Kind; record: ServiceRecord | null; prefill?: RecordPrefill } | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const d = q.data
  if (!d) return <div className="p-4 text-sm text-muted-foreground">{q.error ? <InlineError error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? 'Carregando…' : ''}</div>

  const name = d.lead?.name || d.conversation.name || formatPhone(d.conversation.phone) || 'Contato'
  const pre = d.service?.pre ?? null
  const pos = d.service?.pos ?? null
  const isClient = d.conversation.category === 'CLIENTE'
  const show = async (kind: Kind, itemId: string) => {
    setLoading(itemId)
    try {
      setOpen({ kind, record: await api.get<ServiceRecord>(`/atendimentos/${itemId}`) })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoading(null)
    }
  }
  const quick = () => {
    const p = quickPrefill({ name: d.lead?.name ?? d.conversation.name, phone: d.conversation.phone, email: d.lead?.email }, d.messages, options.data)
    setOpen({ kind: 'PRE_VENDAS', record: null, prefill: p })
    if (p.found) toast.info(`Marca e peça preenchidas pelas mensagens do cliente (${p.found}). Confira antes de salvar.`)
  }
  const close = () => {
    setOpen(null)
    void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
    void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
  }

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto border-l bg-muted/20 p-3" aria-label="Dados do cliente">
      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-[color:var(--brand)]/15 text-lg font-semibold text-[color:var(--brand)]">{initials(name)}</span>
        <p className="font-medium">{name}</p>
        {d.conversation.phone && <p className="text-xs text-muted-foreground">{formatPhone(d.conversation.phone)}</p>}
        <p className="text-xs text-muted-foreground">{CATEGORY[d.conversation.category] ?? d.conversation.category}</p>
        {(d.conversation.labels ?? []).length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {d.conversation.labels!.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        )}
      </div>

      <Box title="Como chegou">
        {d.record?.adsVia ? (
          <p className="flex items-start gap-1.5 text-sm">
            <MegaphoneIcon className="mt-0.5 size-3.5 shrink-0 text-sky-600" />
            Google Ads{d.record.adsCampaign ? ` · ${d.record.adsCampaign}` : d.record.adsCampaignId ? ` · campanha nº ${d.record.adsCampaignId}` : ''}
          </p>
        ) : (
          <p className="text-sm">{d.record?.entryChannel || 'WhatsApp direto, sem anúncio registrado'}</p>
        )}
        {d.record?.adsVia && d.record.entryChannel && <p className="text-xs text-muted-foreground">{d.record.entryChannel}</p>}
      </Box>

      {isClient && (can('pre_vendas') || can('pre_vendas', 'create')) && (
        <Box title="Pré-venda" tone="brand">
          {pre ? (
            <>
              <p className="text-sm font-medium">{stageText({ kind: 'PRE_VENDAS', ...pre })}</p>
              <p className="text-xs text-muted-foreground">
                De {dateFmt.format(new Date(pre.leadAt))}
                {pre.sellerName ? ` · ${pre.sellerName}` : ' · sem vendedor'}
              </p>
              <Button size="sm" variant="outline" className="w-full" onClick={() => void show('PRE_VENDAS', pre.id)} disabled={loading === pre.id}>
                {loading === pre.id ? <Loader2Icon className="animate-spin" /> : <HeadsetIcon />} Abrir a pré-venda
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma pré-venda para este contato.</p>
          )}
          {can('pre_vendas', 'create') && !monitor && (!pre || pre.saleStatus !== 'NEGOCIACAO') && (
            <Button size="sm" className="w-full" onClick={quick} title="Abre a pré-venda já com nome, telefone, marca, peça e as últimas mensagens do cliente">
              <SparklesIcon /> Pré-venda rápida
            </Button>
          )}
        </Box>
      )}

      {pos && can('pos_vendas') && (
        <Box title="Pós-venda">
          <p className="text-sm font-medium">{stageText({ kind: 'POS_VENDAS', ...pos })}</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => void show('POS_VENDAS', pos.id)} disabled={loading === pos.id}>
            {loading === pos.id ? <Loader2Icon className="animate-spin" /> : <ClipboardListIcon />} Abrir a pós-venda
          </Button>
        </Box>
      )}

      {d.service?.lastSeller && (
        <Box title="Último vendedor">
          <p className="flex items-center gap-1.5 text-sm">
            <UserCheckIcon className="size-3.5" /> {d.service.lastSeller.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {d.service.lastSeller.kind === 'POS_VENDAS' ? 'Pós-venda' : 'Pré-venda'} de {dateFmt.format(new Date(d.service.lastSeller.at))}
          </p>
        </Box>
      )}

      {d.lead && can('leads') && (
        <Button asChild size="sm" variant="outline">
          <Link to={`/leads/${d.lead.id}`}>
            <UserIcon /> Ficha completa do lead
          </Link>
        </Button>
      )}

      {open && <RecordSheet kind={open.kind} record={open.record} onClose={close} prefill={open.prefill} />}
    </aside>
  )
}
