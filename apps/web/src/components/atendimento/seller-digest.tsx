import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, Loader2Icon, MessageCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { InlineError } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { formatPhone, todaySP, waDigits } from '@/lib/atendimento'

interface Digest {
  day: string
  today: string
  config: { enabled: boolean; time: string; split: boolean; allSellers: boolean }
  total: number
  sellers: {
    sellerId: string
    seller: string
    sellerPhone: string | null
    items: { id: string; name: string; phone: string | null; saleStatus?: string; situation?: string }[]
    messages: string[]
    /** Envio automático de hoje: ENVIADA, SEM_TELEFONE, ENVIANDO:n ou ERRO: motivo. */
    status: string | null
    automatic: boolean
  }[]
}

function statusBadge(s: Digest['sellers'][number], d: Digest) {
  if (s.status === 'ENVIADA') return <Badge className="bg-emerald-600 text-white">enviado pelo WhatsApp</Badge>
  if (s.status === 'SEM_TELEFONE') return <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">vendedor sem telefone</Badge>
  if (s.status?.startsWith('ERRO')) return <Badge variant="destructive" title={s.status}>não enviado</Badge>
  if (s.status?.startsWith('ENVIANDO')) return <Badge variant="outline">enviando…</Badge>
  if (!d.config.enabled || !s.automatic) return <Badge variant="outline">envio automático desligado</Badge>
  if (d.day === d.today) return <Badge variant="outline">sai às {d.config.time}</Badge>
  return null
}

/**
 * Resumo do dia: os clientes da pré-venda repassados a cada vendedor, prontos para copiar e colar no WhatsApp dele
 * (ou abrir a conversa com o texto pronto). Mostra também se o envio automático já saiu.
 */
export function SellerDigestDialog({ onClose }: { onClose: () => void }) {
  const [day, setDay] = useState(todaySP())
  const [copied, setCopied] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['resumo-vendedores', day], queryFn: () => api.get<Digest>(`/atendimentos/resumo-vendedores?data=${day}`), enabled: /^\d{4}-\d{2}-\d{2}$/.test(day) })
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      toast.success('Copiado. Cole no WhatsApp do vendedor.')
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie com Ctrl+C.')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resumo do dia por vendedor</DialogTitle>
          <DialogDescription>Clientes da pré-venda repassados a cada vendedor no dia (pela data do repasse). Copie e cole no WhatsApp dele, ou deixe o envio automático ligado em Configurações › Mensagens automáticas.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="dg-day">Dia</Label>
            <Input id="dg-day" type="date" className="w-44" value={day} max={todaySP()} onChange={(e) => setDay(e.target.value)} />
          </div>
          {q.data && <p className="pb-2 text-sm text-muted-foreground">{q.data.total} cliente(s) repassado(s)</p>}
        </div>
        {q.isLoading ? (
          <Loader2Icon className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />
        ) : q.isError ? (
          <InlineError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.sellers.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma pré-venda repassada a vendedor neste dia.</p>
        ) : (
          <ul className="space-y-3">
            {q.data.sellers.map((s) => {
              const phones = s.items.map((i) => (i.phone ? formatPhone(i.phone) : null)).filter(Boolean).join('\n')
              const full = s.messages.join('\n\n')
              return (
                <li key={s.sellerId} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{s.seller}</p>
                    <span className="text-xs text-muted-foreground">{s.sellerPhone ? formatPhone(s.sellerPhone) : 'sem telefone no cadastro'}</span>
                    <span className="text-xs text-muted-foreground">· {s.items.length} cliente(s)</span>
                    <span className="ml-auto">{statusBadge(s, q.data)}</span>
                  </div>
                  <ol className="space-y-0.5 text-sm">
                    {s.items.map((i) => (
                      <li key={i.id} className="flex gap-2">
                        <span className="w-36 shrink-0 tabular-nums">{i.phone ? formatPhone(i.phone) : '—'}</span>
                        <span className="truncate text-muted-foreground">{i.name}</span>
                        {i.situation && <span className={`ml-auto shrink-0 text-xs ${i.saleStatus === 'SIM' ? 'text-emerald-600' : i.saleStatus === 'NAO' ? 'text-destructive' : 'text-amber-600'}`}>{i.situation}</span>}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void copy(`${s.sellerId}-tel`, phones)} disabled={!phones}>
                      {copied === `${s.sellerId}-tel` ? <CheckIcon /> : <CopyIcon />} Copiar só os telefones
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void copy(`${s.sellerId}-msg`, full)}>
                      {copied === `${s.sellerId}-msg` ? <CheckIcon /> : <CopyIcon />} Copiar com nomes
                    </Button>
                    {s.sellerPhone && (
                      <Button asChild size="sm" variant="outline">
                        <a href={`https://wa.me/${waDigits(s.sellerPhone)}?text=${encodeURIComponent(full)}`} target="_blank" rel="noopener noreferrer">
                          <MessageCircleIcon /> Abrir no WhatsApp do vendedor
                        </a>
                      </Button>
                    )}
                  </div>
                  {s.status?.startsWith('ERRO') && <p className="text-xs text-destructive">{s.status.replace(/^ERRO:\s*/, 'Envio automático: ')}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
