import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api, errorMessage } from '@/lib/api'

/** Mesmos motivos do servidor (atendimento/regras.ts). */
const REASONS = ['Telefone não funciona e sem e-mail', 'Dados falsos ou de teste', 'Cadastro duplicado', 'Outro'] as const

/**
 * Descartar cadastro que não serve como lead (formulário preenchido errado). Some das telas e relatórios, com o motivo
 * no histórico e na auditoria. `path` é o endereço do descarte (pré-venda ou lead).
 */
export function DiscardDialog({ path, title, description, onClose, onDone }: { path: string; title: string; description: string; onClose: () => void; onDone: (r: { leadDiscarded?: boolean; records?: number }) => void }) {
  const [reason, setReason] = useState<string>(REASONS[0])
  const [note, setNote] = useState('')
  const discard = useMutation({
    mutationFn: () => api.post<{ leadDiscarded?: boolean; records?: number }>(path, { reason, note: note.trim() || undefined }),
    onSuccess: (r) => onDone(r),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const ok = reason !== 'Outro' || note.trim().length > 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) discard.mutate()
          }}
        >
          <RadioGroup value={reason} onValueChange={setReason} aria-label="Motivo do descarte">
            {REASONS.map((r) => (
              <Label key={r} className="flex items-center gap-2 font-normal">
                <RadioGroupItem value={r} /> {r}
              </Label>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor="discard-note" required={reason === 'Outro'}>
              Observação
            </Label>
            <Input id="discard-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'Outro' ? 'Diga o motivo' : 'Opcional'} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!ok || discard.isPending}>
              {discard.isPending && <Loader2Icon className="animate-spin" />} Descartar cadastro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
