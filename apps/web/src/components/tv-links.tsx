import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, Loader2Icon, MonitorIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'

export type TvKind = 'COLETAS' | 'EXECUTIVO'

interface TvLinkRow {
  id: string
  name: string
  unit: string | null
  createdByName: string
  createdAt: string
  lastUsedAt: string | null
}

const PATH: Record<TvKind, string> = { COLETAS: 'coletas', EXECUTIVO: 'executivo' }
export const tvUrl = (kind: TvKind, token: string) => `${window.location.origin}/tv/${PATH[kind]}/${token}`

/**
 * Links para abrir o painel na TV sem login (só leitura). O endereço completo aparece uma vez, ao criar; depois só
 * dá para cancelar. Quem tiver o link vê os dados do painel.
 */
export function TvLinksButton({ kind, units, variant = 'outline' }: { kind: TvKind; units?: { id: string; name: string }[]; variant?: 'outline' | 'secondary' }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <MonitorIcon aria-hidden /> Link para TV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Abrir na TV sem senha</DialogTitle>
          <DialogDescription>
            Crie um link e abra no navegador da TV: o painel aparece sem login, só para ver, e se atualiza sozinho. Quem tiver o link vê os dados{kind === 'EXECUTIVO' ? ' (inclusive faturamento)' : ''}; cancele o link
            quando não usar mais.
          </DialogDescription>
        </DialogHeader>
        {open && <TvLinks kind={kind} units={units} />}
      </DialogContent>
    </Dialog>
  )
}

function TvLinks({ kind, units }: { kind: TvKind; units?: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const key = ['tv-links', kind]
  const list = useQuery({ queryKey: key, queryFn: () => api.get<TvLinkRow[]>(`/tv/links?tipo=${kind}`) })
  const [name, setName] = useState('')
  const [unitId, setUnitId] = useState('all')
  const [created, setCreated] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; token: string }>('/tv/links', { kind, name: name.trim() || 'TV', unitId: kind === 'COLETAS' && unitId !== 'all' ? unitId : null }),
    onSuccess: (r) => {
      setCreated(tvUrl(kind, r.token))
      setName('')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/tv/links/${id}`),
    onSuccess: () => {
      toast.success('Link cancelado: a TV deixa de abrir o painel.')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não deu para copiar: selecione o link e copie.')
    }
  }
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor="tv-nome">Nome (onde fica a TV)</Label>
          <Input id="tv-nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="TV do comercial" maxLength={80} />
        </div>
        {kind === 'COLETAS' && !!units?.length && (
          <div className="space-y-1.5">
            <Label htmlFor="tv-filial">Filial</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger id="tv-filial" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as filiais</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Criar link
        </Button>
      </form>

      {created && (
        <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="text-sm font-medium">Link criado. Copie agora: ele não aparece de novo.</p>
          <div className="flex gap-2">
            <Input readOnly value={created} onFocus={(e) => e.target.select()} aria-label="Link da TV" className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={() => void copy(created)}>
              <CopyIcon aria-hidden /> Copiar
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Links ativos</p>
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : list.error ? (
          <p className="text-sm text-destructive">{errorMessage(list.error)}</p>
        ) : !list.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum link ativo.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.data.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {l.name}
                    {l.unit ? ` · ${l.unit}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Criado por {l.createdByName} em {formatDateTime(l.createdAt)} · {l.lastUsedAt ? `último uso ${formatDateTime(l.lastUsedAt)}` : 'ainda não aberto'}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => confirm(`Cancelar o link "${l.name}"? A TV deixa de abrir o painel.`) && revoke.mutate(l.id)}>
                  <Trash2Icon aria-hidden /> Cancelar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
