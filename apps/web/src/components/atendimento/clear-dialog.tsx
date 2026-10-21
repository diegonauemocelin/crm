import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, DownloadIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { todaySP } from '@/lib/format'
import { FormError } from '@/pages/auth/auth-layout'

const PHRASE = 'APAGAR ATENDIMENTOS'

interface Preview {
  pre: number
  pos: number
  sales: number
  leads: number
}

function downloadKind(kind: 'PRE_VENDAS' | 'POS_VENDAS') {
  return api.download(`/atendimentos/exportar?kind=${kind}`, `copia-${kind === 'PRE_VENDAS' ? 'pre-vendas' : 'pos-vendas'}-${todaySP()}.csv`)
}

/**
 * Limpa os atendimentos para recomeçar do zero com a importação da planilha.
 * Os leads ficam: ao reimportar, cada atendimento volta a se ligar ao mesmo contato (telefone/e-mail), sem duplicar.
 */
export function ClearDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const qc = useQueryClient()
  const preview = useQuery({ queryKey: ['atendimentos-limpeza'], queryFn: () => api.get<Preview>('/atendimentos/limpeza') })
  const [includePostSale, setIncludePostSale] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  const p = preview.data
  const total = p ? p.pre + (includePostSale ? p.pos : 0) : 0
  // O que ainda falta para liberar o botão (mesmas condições de antes, explicadas).
  const missing =
    total === 0
      ? 'Não há atendimentos para excluir.'
      : !copied
        ? 'Baixe uma cópia e marque "Já tenho uma cópia".'
        : confirmation.trim().toUpperCase() !== PHRASE
          ? `Digite ${PHRASE} para confirmar.`
          : !password
            ? 'Digite sua senha.'
            : null

  const download = async () => {
    setDownloading(true)
    try {
      await downloadKind('PRE_VENDAS')
      if (includePostSale && p?.pos) await downloadKind('POS_VENDAS')
      setCopied(true)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ records: number }>('/atendimentos/limpeza', { includePostSale, password, confirmation })
      setDone(r.records)
      setPassword('')
      await qc.invalidateQueries()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Limpar atendimentos e recomeçar</DialogTitle>
          <DialogDescription>Exclui os atendimentos para começar do zero com a importação da planilha.</DialogDescription>
        </DialogHeader>

        {preview.error ? (
          <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
        ) : !p ? (
          <TableSkeleton rows={3} />
        ) : done !== null ? (
          <div className="space-y-4">
            <p className="text-sm">
              <strong>{int.format(done)}</strong> atendimento(s) excluído(s). Agora importe a planilha: os atendimentos vão se ligar de novo aos mesmos contatos da base de leads, sem duplicar.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button onClick={onImport}>
                <UploadIcon /> Importar planilha agora
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p>
                  Vai excluir <strong>de vez</strong> {int.format(p.pre)} atendimento(s) de Pré-Vendas ({int.format(p.sales)} com venda)
                  {includePostSale ? ` e ${int.format(p.pos)} de Pós-Vendas` : ''}, com o histórico de alterações. Não dá para desfazer pelo sistema.
                </p>
                <p className="text-muted-foreground">
                  Continuam: os {int.format(p.leads)} leads (contatos), vendedores, unidades, listas e configurações. Na linha do tempo dos leads saem só os registros desses atendimentos.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={includePostSale} onCheckedChange={(v) => setIncludePostSale(v === true)} className="mt-0.5" />
              <span>
                Excluir também os {int.format(p.pos)} atendimento(s) de Pós-Vendas
                <span className="block text-xs text-muted-foreground">Sem marcar, os Pós-Vendas ficam, só sem o vínculo com a pré-venda excluída.</span>
              </span>
            </label>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">1. Baixe uma cópia antes</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void download()} disabled={downloading}>
                {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                Baixar cópia (CSV)
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={copied} onCheckedChange={(v) => setCopied(v === true)} />
                Já tenho uma cópia dos dados atuais
              </label>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">2. Confirme</p>
              <div className="space-y-1">
                <Label htmlFor="clear-phrase" required>
                  Digite <span className="font-mono">{PHRASE}</span>
                </Label>
                <Input id="clear-phrase" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="clear-password" required>
                  Sua senha
                </Label>
                <Input id="clear-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <FormError message={error} />
            {!busy && missing && <p className="text-right text-xs text-muted-foreground">{missing}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !!missing}>
                {busy && <Loader2Icon className="animate-spin" />}
                Excluir {int.format(total)} atendimento(s)
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
