import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlusIcon, Loader2Icon, XIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Visões salvas (telas novas): abas com filtros guardados por nome, só para quem salvou, em qualquer computador. */

interface View {
  id: string
  name: string
  query: string
}

/** Parâmetros que não são filtro (página, aba, ficha aberta) ficam fora da comparação e da gravação. */
const SKIP = new Set(['page', 'aba', 'abrir', 'visao'])

function filtersOf(params: URLSearchParams) {
  const out = new URLSearchParams()
  for (const [k, v] of params) if (!SKIP.has(k) && v) out.set(k, v)
  out.sort()
  return out.toString()
}

function normalize(query: string) {
  return filtersOf(new URLSearchParams(query))
}

export function SavedViews({ screen, builtIn = [] }: { screen: 'leads' | 'pre-vendas'; builtIn?: { name: string; query: string }[] }) {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const key = ['visoes', screen]
  const views = useQuery({ queryKey: key, queryFn: () => api.get<View[]>(`/me/visoes/${screen}`), staleTime: 5 * 60_000 })
  const save = useMutation({
    mutationFn: (list: View[]) => api.put<View[]>(`/me/visoes/${screen}`, { views: list }),
    onSuccess: (list) => qc.setQueryData(key, list),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const current = filtersOf(params)
  const saved = views.data ?? []
  const all = [{ id: 'todos', name: 'Todos', query: '' }, ...builtIn.map((b, i) => ({ id: `b${i}`, ...b })), ...saved]
  const matches = (v: { query: string }) => normalize(v.query) === current
  const go = (query: string) => {
    const next = new URLSearchParams(query)
    const aba = params.get('aba')
    if (aba) next.set('aba', aba)
    setParams(next, { replace: true })
  }
  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    save.mutate([...saved, { id: '', name: name.trim(), query: current }], {
      onSuccess: () => {
        setNaming(false)
        setName('')
        toast.success('Visão salva. Ela aparece só para você.')
      },
    })
  }
  const remove = async (v: View) => {
    const ok = await confirm({
      title: `Excluir a visão "${v.name}"?`,
      description: 'A aba some da lista. Os leads e filtros continuam como estão; dá para salvar a visão de novo depois.',
      confirmLabel: 'Excluir visão',
    })
    if (ok) save.mutate(saved.filter((s) => s.id !== v.id), { onSuccess: () => toast.success('Visão excluída.') })
  }
  return (
    <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b" role="tablist" aria-label="Visões salvas">
      {all.map((v) => {
        const on = matches(v)
        const mine = saved.some((s) => s.id === v.id)
        return (
          <span key={v.id} className={cn('flex shrink-0 items-center border-b-2', on ? 'border-[color:var(--brand)]' : 'border-transparent')}>
            <button type="button" role="tab" aria-selected={on} onClick={() => go(v.query)} className={cn('h-9 px-3 text-sm whitespace-nowrap', on ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {v.name}
            </button>
            {mine && on && (
              <button
                type="button"
                className="-ml-1.5 mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Excluir a visão ${v.name}`}
                title={`Excluir a visão ${v.name}`}
                onClick={() => void remove(v as View)}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </span>
        )
      })}
      {current && !all.some(matches) && (
        <Popover open={naming} onOpenChange={setNaming}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="shrink-0 text-[color:var(--brand)]">
              <BookmarkPlusIcon /> Salvar esta visão
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <form onSubmit={add} className="space-y-2">
              <Label htmlFor={`visao-${screen}`} required>
                Nome da visão
              </Label>
              <Input id={`visao-${screen}`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="ex.: Paraná · Hyundai" autoFocus />
              <p className="text-xs text-muted-foreground">Guarda os filtros que estão aplicados agora. Só você vê.</p>
              <Button type="submit" size="sm" className="w-full" disabled={!name.trim() || save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />} Salvar visão
              </Button>
              {!name.trim() && <p className="text-center text-xs text-muted-foreground">Dê um nome à visão para salvar.</p>}
            </form>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
