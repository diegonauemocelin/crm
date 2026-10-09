import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, BellIcon, PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { brl } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

export interface Balance {
  estimate: {
    balance: number
    spent: number
    deposits: number
    avgDaily: number | null
    daysLeft: number | null
    low: boolean
    anchor: { amount: number; at: string; by?: string }
  } | null
  alertDays: number
  alertEmails: string[]
  deposits: { id: string; amount: number; at: string; note?: string; by?: string }[]
}

type Mode = 'saldo' | 'recarga' | 'aviso' | null

/** "1.234,56" ou "1234.56" → 1234.56 */
function parseMoney(v: string) {
  const s = v.replace(/[^\d,.-]/g, '')
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : NaN
}

/** Saldo pré-pago estimado: o Google não informa o saldo de Pix/boleto pela API; o CRM desconta o gasto do saldo informado. */
export function BalanceCard({ balance }: { balance: Balance }) {
  const { can } = useAuth()
  const editable = can('google_ads', 'edit')
  const [mode, setMode] = useState<Mode>(null)
  const e = balance.estimate
  const days = e?.daysLeft === null || e?.daysLeft === undefined ? null : Math.floor(e.daysLeft)
  return (
    <Card className={cn(e?.low && 'border-amber-500/60')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletIcon className="size-4 text-muted-foreground" /> Saldo estimado do Google Ads
          </CardTitle>
          <CardDescription>
            O Google não informa o saldo pré-pago (Pix/boleto) pela API: o CRM parte do saldo informado, soma as recargas e desconta o gasto de cada dia. Confira de vez
            em quando em Google Ads → Faturamento.
          </CardDescription>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setMode('saldo')}>
              Informar saldo atual
            </Button>
            <Button size="sm" variant="outline" disabled={!e} onClick={() => setMode('recarga')}>
              <PlusIcon /> Registrar recarga
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('aviso')} aria-label="Aviso de saldo baixo">
              <BellIcon /> Aviso
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!e ? (
          <p className="text-sm text-muted-foreground">
            Ainda sem saldo informado. Veja o saldo em Google Ads → Faturamento → Resumo e clique em “Informar saldo atual”.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <p className={cn('text-3xl font-semibold tracking-tight tabular-nums', e.balance <= 0 && 'text-[#b42323] dark:text-[#e66767]')}>{brl.format(e.balance)}</p>
                <p className="text-sm text-muted-foreground">
                  {days === null ? 'Sem gasto nos últimos 7 dias para estimar a duração.' : e.balance <= 0 ? 'Saldo esgotado: os anúncios podem parar.' : `Dura cerca de ${days} dia(s) no ritmo atual`}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <Item k="Saldo informado" v={`${brl.format(e.anchor.amount)} · ${formatDateTime(e.anchor.at)}`} />
                <Item k="Recargas depois" v={brl.format(e.deposits)} />
                <Item k="Gasto desde então" v={brl.format(e.spent)} />
                <Item k="Média por dia (7 dias)" v={e.avgDaily === null ? '—' : brl.format(e.avgDaily)} />
              </dl>
            </div>
            {e.low && (
              <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm">
                <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
                {e.balance <= 0 ? 'Saldo esgotado.' : `Saldo para menos de ${balance.alertDays} dia(s).`} Faça a recarga no Google Ads e registre aqui.
              </p>
            )}
            {balance.deposits.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Recargas registradas ({balance.deposits.length})</summary>
                <ul className="mt-2 divide-y rounded-md border">
                  {balance.deposits.map((d) => (
                    <DepositRow key={d.id} d={d} editable={editable} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {balance.alertEmails.length
            ? `Aviso por e-mail (${balance.alertEmails.join(', ')}) quando o saldo durar menos de ${balance.alertDays} dia(s).`
            : `Sem e-mail de aviso cadastrado; o alerta aparece só aqui quando o saldo durar menos de ${balance.alertDays} dia(s).`}
        </p>
      </CardContent>
      {mode && <BalanceDialog mode={mode} balance={balance} onClose={() => setMode(null)} />}
    </Card>
  )
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="truncate tabular-nums">{v}</dd>
    </div>
  )
}

function DepositRow({ d, editable }: { d: Balance['deposits'][number]; editable: boolean }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => api.delete(`/integracoes/google-ads/saldo/recargas/${d.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-painel'] })
      toast.success('Recarga removida.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="font-medium tabular-nums">{brl.format(d.amount)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {formatDateTime(d.at)}
        {d.by ? ` · ${d.by}` : ''}
        {d.note ? ` · ${d.note}` : ''}
      </span>
      {editable && (
        <Button size="icon" variant="ghost" className="size-7" disabled={del.isPending} onClick={() => del.mutate()} aria-label={`Remover recarga de ${brl.format(d.amount)}`}>
          <Trash2Icon />
        </Button>
      )}
    </li>
  )
}

function BalanceDialog({ mode, balance, onClose }: { mode: Exclude<Mode, null>; balance: Balance; onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [days, setDays] = useState(String(balance.alertDays))
  const [emails, setEmails] = useState(balance.alertEmails.join(', '))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      if (mode === 'aviso') return api.put('/integracoes/google-ads/saldo/aviso', { days: Number(days), emails: emails.split(/[,;\s]+/).filter(Boolean) })
      const v = parseMoney(amount)
      if (!Number.isFinite(v) || v < 0) throw new Error('Informe um valor válido (ex.: 1.500,00).')
      return mode === 'saldo' ? api.post('/integracoes/google-ads/saldo', { amount: v }) : api.post('/integracoes/google-ads/saldo/recargas', { amount: v, note: note || undefined })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-painel'] })
      toast.success(mode === 'aviso' ? 'Aviso salvo.' : mode === 'saldo' ? 'Saldo atualizado.' : 'Recarga registrada.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const title = mode === 'saldo' ? 'Informar saldo atual' : mode === 'recarga' ? 'Registrar recarga' : 'Aviso de saldo baixo'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === 'saldo' && 'O saldo como aparece agora em Google Ads → Faturamento → Resumo. Vira o novo ponto de partida (recargas anteriores já estão nele).'}
              {mode === 'recarga' && 'O valor que entrou como crédito no Google Ads (em Faturamento → Transações), já sem os impostos.'}
              {mode === 'aviso' && 'Quando o saldo durar menos que esses dias (pela média dos últimos 7), o painel avisa e o CRM manda e-mail, no máximo 1 vez por dia.'}
            </DialogDescription>
          </DialogHeader>
          {mode !== 'aviso' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bal-amount">Valor (R$)</Label>
                <Input id="bal-amount" inputMode="decimal" placeholder="1.500,00" autoFocus required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              {mode === 'recarga' && (
                <div className="space-y-1.5">
                  <Label htmlFor="bal-note">Observação (opcional)</Label>
                  <Input id="bal-note" maxLength={120} placeholder="Ex.: Pix de 09/10" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bal-days">Avisar quando durar menos de (dias)</Label>
                <Input id="bal-days" type="number" min={1} max={60} required value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bal-emails">E-mails para avisar (separados por vírgula)</Label>
                <Input id="bal-emails" placeholder="marketing@empresa.com.br" value={emails} onChange={(e) => setEmails(e.target.value)} />
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
