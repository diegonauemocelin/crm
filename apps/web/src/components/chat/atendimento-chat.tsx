import { useQueryClient } from '@tanstack/react-query'
import { ClipboardListIcon, HeadsetIcon, Loader2Icon, UserCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { type RecordPrefill, RecordSheet } from '@/components/atendimento/record-sheet'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api'
import { FOLLOW_LABEL, type FollowStatus, type Kind, type Options, SALE_LABEL, type SaleStatus, type ServiceRecord } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/** Pré-Vendas e Pós-Vendas dentro do chat: a fase do contato e o painel lateral para ver e preencher sem sair da conversa. */

export interface StageInfo {
  kind: string
  saleStatus: string
  followStatus: string | null
  waiting: boolean
}
interface ServiceItem {
  id: string
  leadAt: string
  saleStatus: string
  forwarded: boolean
  waiting: boolean
  followStatus: string | null
  dueAt: string | null
  sellerName: string | null
}
export interface ChatService {
  pre: ServiceItem | null
  pos: ServiceItem | null
  lastSeller: { name: string; at: string; kind: string } | null
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Pré-venda rápida (telas novas): nome e telefone do contato, mais as marcas e os tipos de peça citados nas mensagens
 * do cliente (pelos nomes cadastrados em Cadastros) e as últimas mensagens dele como observação. Quem atende confere.
 */
export function quickPrefill(
  contact: { name: string | null; phone: string | null; email?: string | null },
  messages: { fromMe: boolean; internal?: boolean; text: string | null }[],
  options: Options | undefined,
): RecordPrefill & { found: number } {
  const said = messages.filter((m) => !m.fromMe && !m.internal && m.text?.trim()).slice(-10)
  const text = ` ${norm(said.map((m) => m.text).join(' '))} `
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = (list: { id: string; name: string; active: boolean }[] = []) =>
    list.filter((o) => o.active && o.name.trim().length >= 2 && new RegExp(`[^a-z0-9]${escape(norm(o.name.trim()))}[^a-z0-9]`).test(text)).map((o) => o.id)
  const brandIds = match(options?.brands)
  const partTypeIds = match(options?.partTypes)
  const notes = said.slice(-3).map((m) => m.text!.trim()).join(' / ').slice(0, 1000)
  return { name: contact.name, phone: contact.phone, email: contact.email ?? null, brandIds, partTypeIds, notes, found: brandIds.length + partTypeIds.length }
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' })

/** Texto da fase: "Pré-venda · Em negociação", "Pós-venda · Aguardando contato". */
export function stageText(s: { kind: string; saleStatus: string; followStatus: string | null; waiting: boolean; forwarded?: boolean }) {
  if (s.kind === 'POS_VENDAS') return FOLLOW_LABEL[s.followStatus as FollowStatus] ?? 'Em acompanhamento'
  if (s.saleStatus === 'NEGOCIACAO' && s.waiting) return 'Aguardando atendimento'
  if (s.saleStatus === 'NEGOCIACAO' && s.forwarded) return 'Com o vendedor'
  return SALE_LABEL[s.saleStatus as SaleStatus] ?? s.saleStatus
}

function stageTone(s: { kind: string; saleStatus: string; followStatus: string | null; waiting: boolean }) {
  if (s.kind === 'POS_VENDAS') return s.followStatus === 'RESOLVIDO' ? 'bg-muted text-muted-foreground' : 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300'
  if (s.saleStatus === 'SIM') return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
  if (s.saleStatus === 'NAO') return 'bg-muted text-muted-foreground'
  if (s.waiting) return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
  return 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300'
}

/** Selo na lista de conversas. */
export function StageBadge({ stage }: { stage: StageInfo }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 text-xs leading-[18px] font-medium', stageTone(stage))}>
      {stage.kind === 'POS_VENDAS' ? 'Pós' : 'Pré'} · {stageText(stage)}
    </span>
  )
}

/** Botões Pré-Vendas e Pós-Vendas no topo da conversa, com a fase; abrem o atendimento num painel ao lado. */
export function ServiceButtons({ service, contact, prefill }: { service: ChatService | undefined; contact: { name: string | null; phone: string | null; email?: string | null }; prefill?: () => RecordPrefill }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState<{ kind: Kind; record: ServiceRecord | null } | null>(null)
  const [loading, setLoading] = useState<Kind | null>(null)
  const show = async (kind: Kind, item: ServiceItem | null) => {
    if (!item) return setOpen({ kind, record: null })
    setLoading(kind)
    try {
      setOpen({ kind, record: await api.get<ServiceRecord>(`/atendimentos/${item.id}`) })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoading(null)
    }
  }
  const close = () => {
    setOpen(null)
    void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
    void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
  }
  const pre = service?.pre ?? null
  const pos = service?.pos ?? null
  const canPre = pre ? can('pre_vendas') : can('pre_vendas', 'create')
  return (
    <>
      {canPre && (
        <Button size="sm" variant="outline" onClick={() => void show('PRE_VENDAS', pre)} title={pre ? `Pré-venda de ${dateFmt.format(new Date(pre.leadAt))}${pre.sellerName ? ` · ${pre.sellerName}` : ''}` : 'Abrir uma pré-venda para este contato'}>
          {loading === 'PRE_VENDAS' ? <Loader2Icon className="animate-spin" /> : <HeadsetIcon />}
          Pré-Vendas
          {pre && <span className={cn('rounded px-1 text-xs font-medium', stageTone({ kind: 'PRE_VENDAS', ...pre }))}>{stageText({ kind: 'PRE_VENDAS', ...pre })}</span>}
          {!pre && <span className="text-xs text-muted-foreground">abrir</span>}
        </Button>
      )}
      {pos && can('pos_vendas') && (
        <Button size="sm" variant="outline" onClick={() => void show('POS_VENDAS', pos)} title={`Pós-venda de ${dateFmt.format(new Date(pos.leadAt))}${pos.sellerName ? ` · ${pos.sellerName}` : ''}`}>
          {loading === 'POS_VENDAS' ? <Loader2Icon className="animate-spin" /> : <ClipboardListIcon />}
          Pós-Vendas
          <span className={cn('rounded px-1 text-xs font-medium', stageTone({ kind: 'POS_VENDAS', ...pos }))}>{stageText({ kind: 'POS_VENDAS', ...pos })}</span>
        </Button>
      )}
      {open && <RecordSheet kind={open.kind} record={open.record} onClose={close} prefill={open.record ? undefined : (prefill?.() ?? { name: contact.name, phone: contact.phone, email: contact.email ?? null })} />}
    </>
  )
}

/** "Último vendedor: Fulano (pré-venda de 10/09/26)": quem atendeu este cliente da última vez. */
export function LastSeller({ service }: { service: ChatService | undefined }) {
  const s = service?.lastSeller
  if (!s) return null
  return (
    <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-foreground" title="Responsável pelo último atendimento deste cliente">
      <UserCheckIcon className="size-3" /> Último vendedor: {s.name} <span className="font-normal text-muted-foreground">({s.kind === 'POS_VENDAS' ? 'pós-venda' : 'pré-venda'} de {dateFmt.format(new Date(s.at))})</span>
    </span>
  )
}
