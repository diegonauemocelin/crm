import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

/** Texto somente leitura com botão de copiar (código do site, URL do webhook, tokens). */
export function CopyField({ id, value, multiline, className }: { id?: string; value: string; multiline?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.')
    }
  }
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {multiline ? (
        <textarea id={id} readOnly value={value} rows={3} className="min-w-0 flex-1 resize-none rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all" onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <input id={id} readOnly value={value} className="h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      )}
      <Button type="button" variant="outline" size="icon" onClick={() => void copy()} aria-label="Copiar">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
