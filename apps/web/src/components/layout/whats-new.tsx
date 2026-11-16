import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type ChangeType = 'novo' | 'melhoria' | 'correcao' | 'seguranca' | 'infra'
interface Release {
  version: string
  date: string
  title: string
  changes: { type: ChangeType; area?: string; text: string }[]
}

const TYPE: Record<ChangeType, { label: string; className: string }> = {
  novo: { label: 'Novo', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  melhoria: { label: 'Melhoria', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  correcao: { label: 'Correção', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30' },
  seguranca: { label: 'Segurança', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30' },
  infra: { label: 'Sistema', className: '' },
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')

/**
 * Novidades da atualização: depois de cada versão nova, aparece uma vez para cada usuário (ao entrar no sistema) com
 * o que mudou. Ao fechar, some e não volta até a próxima versão.
 */
export function WhatsNew() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['novidades'], queryFn: () => api.get<{ version: string; releases: Release[] }>('/system/novidades'), staleTime: Infinity, retry: false })
  const [closed, setClosed] = useState(false)
  const seen = useMutation({ mutationFn: () => api.post('/system/novidades/visto'), onSettled: () => qc.setQueryData(['novidades'], (d: { version: string; releases: Release[] } | undefined) => (d ? { ...d, releases: [] } : d)) })
  const list = q.data?.releases ?? []
  if (!list.length || closed) return null
  const close = () => {
    setClosed(true)
    seen.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-primary" aria-hidden /> Novidades do sistema
          </DialogTitle>
          <DialogDescription>
            O sistema foi atualizado{list.length > 1 ? ` (${list.length} versões desde a última vez que você viu)` : ''}. Veja o que mudou.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-1">
          {list.map((r) => (
            <section key={r.version} className="space-y-2">
              <h3 className="text-sm font-semibold">
                v{r.version} · {r.title} <span className="font-normal text-muted-foreground">· {fmtDate(r.date)}</span>
              </h3>
              <ul className="space-y-2">
                {r.changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <Badge variant="outline" className={cn('mt-0.5 h-5 shrink-0 px-1.5 text-xs', TYPE[c.type]?.className)}>
                      {TYPE[c.type]?.label ?? c.type}
                    </Badge>
                    <span>
                      {c.area && <strong className="font-medium">{c.area}: </strong>}
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" asChild>
            <Link to="/atualizacoes" onClick={close}>
              Ver todas as atualizações
            </Link>
          </Button>
          <Button onClick={close}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
