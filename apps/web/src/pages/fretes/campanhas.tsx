import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { UF_LIST } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'

type Mode = 'PERCENT_NF' | 'DESCONTO' | 'GRATIS'
interface Campaign {
  id?: string
  name: string
  active: boolean
  mode: Mode
  value: number
  carrierIds: string[]
  ufs: string[]
  cities: string[]
  minCargoValue: number | null
  startsOn: string | null
  endsOn: string | null
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'PERCENT_NF', label: '% sobre o valor da nota', hint: 'O cliente paga este % do valor da nota (ex.: 3%).' },
  { value: 'DESCONTO', label: 'Desconto na tabela', hint: 'Desconto deste % sobre o valor calculado pela tabela.' },
  { value: 'GRATIS', label: 'Frete grátis', hint: 'O cliente não paga frete.' },
]

const blank = (): Campaign => ({ name: '', active: true, mode: 'GRATIS', value: 0, carrierIds: [], ufs: [], cities: [], minCargoValue: null, startsOn: null, endsOn: null })

/** Fretes › Campanhas de frete: o que cobrar do cliente por transportadora e destino. Aparece na cotação. */
export function FretesCampanhasPage() {
  const { can } = useAuth()
  const editable = can('fretes_tabelas', 'edit')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'campanhas'], queryFn: () => api.get<Campaign[]>('/fretes/campanhas') })
  const carriers = useQuery({ queryKey: ['fretes', 'transportadoras', '', 'active'], queryFn: () => api.get<{ id: string; name: string; kind?: string }[]>('/fretes/transportadoras?situacao=active') })
  const [draft, setDraft] = useState<Campaign[] | null>(null)
  const list = draft ?? q.data ?? []
  const save = useMutation({
    mutationFn: (l: Campaign[]) => api.put<Campaign[]>('/fretes/campanhas', { list: l }),
    onSuccess: (l) => {
      qc.setQueryData(['fretes', 'campanhas'], l)
      setDraft(null)
      toast.success('Campanhas salvas.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const set = (i: number, patch: Partial<Campaign>) => setDraft(list.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const carrierList = (carriers.data ?? []).filter((c) => !c.kind || c.kind === 'TRANSPORTADORA')
  return (
    <RequirePermission module="fretes_cotacao">
      <div className="space-y-4">
        <PageHeader
          title="Campanhas de frete"
          description="Quanto cobrar do cliente em vez do valor da tabela: escolha a transportadora, o destino (estados e cidades) e a regra (% sobre a nota, desconto na tabela ou frete grátis). A cotação mostra o valor da campanha ao lado do frete calculado."
          actions={
            editable ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDraft([...list, blank()])}>
                  <PlusIcon /> Nova campanha
                </Button>
                <Button disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
                  {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
                </Button>
              </div>
            ) : null
          }
        />
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !list.length ? (
          <EmptyState title="Nenhuma campanha" description="Crie uma campanha para definir frete grátis, desconto ou % da nota por transportadora e região." />
        ) : (
          list.map((c, i) => (
            <Card key={c.id ?? `novo-${i}`}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Input aria-label="Nome da campanha" placeholder="Nome (ex.: Frete grátis SC acima de R$ 1.000)" className="max-w-md flex-1" value={c.name} disabled={!editable} onChange={(e) => set(i, { name: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={c.active} disabled={!editable} onCheckedChange={(v) => set(i, { active: v })} /> Ativa
                  </label>
                  {!c.active && <Badge variant="outline">Desligada</Badge>}
                  {editable && (
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label="Excluir campanha" onClick={() => setDraft(list.filter((_, j) => j !== i))}>
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`m-${i}`}>Como será a campanha</Label>
                    <select id={`m-${i}`} className="h-9 w-full rounded-md border bg-transparent px-2" value={c.mode} disabled={!editable} onChange={(e) => set(i, { mode: e.target.value as Mode })}>
                      {MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === c.mode)?.hint}</p>
                  </div>
                  {c.mode !== 'GRATIS' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`v-${i}`}>{c.mode === 'PERCENT_NF' ? '% da nota' : '% de desconto'}</Label>
                      <Input id={`v-${i}`} inputMode="decimal" value={String(c.value)} disabled={!editable} onChange={(e) => set(i, { value: Number(e.target.value.replace(',', '.')) || 0 })} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor={`min-${i}`}>Nota a partir de (R$)</Label>
                    <Input id={`min-${i}`} inputMode="decimal" placeholder="Qualquer valor" value={c.minCargoValue ?? ''} disabled={!editable} onChange={(e) => set(i, { minCargoValue: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || null })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`s-${i}`}>Início</Label>
                    <Input id={`s-${i}`} type="date" value={c.startsOn ?? ''} disabled={!editable} onChange={(e) => set(i, { startsOn: e.target.value || null })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`e-${i}`}>Fim</Label>
                    <Input id={`e-${i}`} type="date" value={c.endsOn ?? ''} disabled={!editable} onChange={(e) => set(i, { endsOn: e.target.value || null })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Transportadoras {c.carrierIds.length ? `(${c.carrierIds.length})` : '(todas)'}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {carrierList.map((t) => {
                      const on = c.carrierIds.includes(t.id)
                      return (
                        <button key={t.id} type="button" disabled={!editable} onClick={() => set(i, { carrierIds: on ? c.carrierIds.filter((x) => x !== t.id) : [...c.carrierIds, t.id] })} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground'}`}>
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Estados de destino {c.ufs.length ? `(${c.ufs.join(', ')})` : '(todos)'}</Label>
                  <div className="flex flex-wrap gap-1">
                    {UF_LIST.map((uf) => {
                      const on = c.ufs.includes(uf)
                      return (
                        <button key={uf} type="button" disabled={!editable} onClick={() => set(i, { ufs: on ? c.ufs.filter((x) => x !== uf) : [...c.ufs, uf] })} className={`w-9 rounded border py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground'}`}>
                          {uf}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`c-${i}`}>Cidades (opcional)</Label>
                  <Input id={`c-${i}`} placeholder="Ex.: Chapecó/SC, Maravilha/SC — vazio = todas as cidades dos estados" value={c.cities.join(', ')} disabled={!editable} onChange={(e) => set(i, { cities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {draft && <p className="text-sm text-amber-700 dark:text-amber-300">Há mudanças não salvas.</p>}
      </div>
    </RequirePermission>
  )
}
