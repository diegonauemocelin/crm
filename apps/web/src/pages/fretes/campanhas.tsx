import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
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
import { cn } from '@/lib/utils'

type Mode = 'PERCENT_NF' | 'PERCENT_NF_ACIMA' | 'REPASSE' | 'DESCONTO' | 'GRATIS' | 'ACRESCIMO'
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
  tableAbove?: number | null
  startsOn: string | null
  endsOn: string | null
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'PERCENT_NF', label: '% sobre o valor da nota', hint: 'O cliente paga este % do valor da nota (ex.: 3%).' },
  { value: 'PERCENT_NF_ACIMA', label: '% da nota quando o frete passar de um valor', hint: 'Até o valor escolhido o cliente paga o frete da tabela; acima dele, paga só este % da nota (a empresa paga a diferença).' },
  { value: 'REPASSE', label: '% da nota (repasse da transportadora)', hint: 'O cliente paga o % da nota que a transportadora cobra (ex.: para uma cidade). A empresa não banca: vale mesmo acima da tabela. Escolha a cidade em Cidades.' },
  { value: 'DESCONTO', label: 'Desconto na tabela', hint: 'Desconto deste % sobre o valor calculado pela tabela.' },
  { value: 'GRATIS', label: 'Frete grátis', hint: 'O cliente não paga frete.' },
  {
    value: 'ACRESCIMO',
    label: 'Acréscimo na tabela (reajuste)',
    hint: 'O cliente paga o frete da tabela + este % no período (todas ou só as transportadoras escolhidas). Só muda o valor a cobrar do cliente: a conferência do CT-e continua pela tabela. Se uma promoção valer para a mesma cotação, vale a promoção.',
  },
]

const blank = (): Campaign => ({ name: '', active: true, mode: 'GRATIS', value: 0, carrierIds: [], ufs: [], cities: [], minCargoValue: null, tableAbove: null, startsOn: null, endsOn: null })

/** Fretes › Campanhas de frete: o que cobrar do cliente por transportadora e destino. Aparece na cotação. */
export function FretesCampanhasPage() {
  const { can } = useAuth()
  const editable = can('fretes_tabelas', 'edit')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'campanhas'], queryFn: () => api.get<Campaign[]>('/fretes/campanhas') })
  // Todas (as já marcadas aparecem mesmo inativas); para escolher, só as ativas que entram na cotação.
  const carriers = useQuery({ queryKey: ['fretes', 'transportadoras', '', 'all'], queryFn: () => api.get<{ id: string; name: string; kind?: string; active: boolean; quote?: boolean }[]>('/fretes/transportadoras') })
  const [draft, setDraft] = useState<Campaign[] | null>(null)
  /** Campanhas abertas para editar (as outras ficam só no resumo). */
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')
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
  const carrierItems = carrierList.map((c) => ({ id: c.id, name: c.name, active: c.active && c.quote !== false })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const nameOf = (id: string) => carrierList.find((c) => c.id === id)?.name ?? 'Transportadora removida'
  const toggleOpen = (i: number) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rule = (c: Campaign) => {
    const pct = `${c.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
    return c.mode === 'GRATIS' ? 'Frete grátis' : c.mode === 'DESCONTO' ? `${pct} de desconto na tabela` : c.mode === 'ACRESCIMO' ? `Reajuste: tabela + ${pct}` : c.mode === 'REPASSE' ? `${pct} da nota (repasse)` : c.mode === 'PERCENT_NF_ACIMA' ? `${pct} da nota quando o frete passar de ${c.tableAbove ? money(c.tableAbove) : '—'}` : `${pct} da nota`
  }
  const dayBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : null)
  const period = (c: Campaign) => (c.startsOn || c.endsOn ? `${dayBr(c.startsOn) ?? 'sempre'} a ${dayBr(c.endsOn) ?? 'sem fim'}` : 'Sem prazo')
  const expired = (c: Campaign) => !!c.endsOn && c.endsOn < new Date().toISOString().slice(0, 10)
  const term = filter.trim().toLowerCase()
  const shown = list.map((c, i) => ({ c, i })).filter(({ c }) => !term || c.name.toLowerCase().includes(term) || c.carrierIds.some((id) => nameOf(id).toLowerCase().includes(term)) || c.ufs.some((u) => u.toLowerCase() === term))
  return (
    <RequirePermission module="fretes_cotacao">
      <div className="space-y-4">
        <PageHeader
          title="Campanhas de frete"
          description="Quanto cobrar do cliente em vez do valor da tabela: escolha a transportadora, o destino (estados e cidades) e a regra (% sobre a nota, desconto na tabela ou frete grátis). A cotação mostra o valor da campanha ao lado do frete calculado."
          actions={
            editable ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft([blank(), ...list])
                    setOpen(new Set([0, ...[...open].map((x) => x + 1)]))
                  }}
                >
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
          <>
            <Input className="max-w-md" placeholder="Filtrar por nome, transportadora ou UF" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar campanhas" />
            {shown.map(({ c, i }) =>
              !open.has(i) ? (
                <button key={c.id ?? `novo-${i}`} type="button" onClick={() => toggleOpen(i)} className={cn('flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card p-3 text-left text-sm hover:bg-muted/50', !c.active && 'opacity-70')}>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-48 flex-1">
                    <span className="font-semibold">{c.name || 'Campanha sem nome'}</span>
                    <span className="block text-xs text-muted-foreground">{rule(c)}{c.minCargoValue ? ` · nota a partir de ${money(c.minCargoValue)}` : ''}</span>
                  </span>
                  <span className="min-w-40 text-xs">
                    <span className="text-muted-foreground">Transportadoras: </span>
                    {c.carrierIds.length ? `${c.carrierIds.slice(0, 2).map(nameOf).join(', ')}${c.carrierIds.length > 2 ? ` +${c.carrierIds.length - 2}` : ''}` : 'todas'}
                  </span>
                  <span className="text-xs">
                    <span className="text-muted-foreground">Destino: </span>
                    {c.cities.length ? c.cities.slice(0, 2).join(', ') + (c.cities.length > 2 ? ` +${c.cities.length - 2}` : '') : c.ufs.length ? c.ufs.join(', ') : 'todos'}
                  </span>
                  <span className="text-xs text-muted-foreground">{period(c)}</span>
                  <Badge variant="outline" className={cn(!c.active || expired(c) ? 'text-muted-foreground' : 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]')}>{!c.active ? 'Desligada' : expired(c) ? 'Encerrada' : 'Ativa'}</Badge>
                </button>
              ) : (
            <Card key={c.id ?? `novo-${i}`}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Input aria-label="Nome da campanha" placeholder="Nome (ex.: Frete grátis SC acima de R$ 1.000)" className="max-w-md flex-1" value={c.name} disabled={!editable} onChange={(e) => set(i, { name: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={c.active} disabled={!editable} onCheckedChange={(v) => set(i, { active: v })} /> Ativa
                  </label>
                  {!c.active && <Badge variant="outline">Desligada</Badge>}
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => toggleOpen(i)}>
                    <ChevronDownIcon aria-hidden /> Fechar
                  </Button>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir campanha"
                      onClick={() => {
                        setDraft(list.filter((_, j) => j !== i))
                        setOpen(new Set([...open].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))))
                      }}
                    >
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
                      <Label htmlFor={`v-${i}`}>{c.mode === 'DESCONTO' ? '% de desconto' : c.mode === 'ACRESCIMO' ? '% de acréscimo' : '% da nota'}</Label>
                      <Input id={`v-${i}`} inputMode="decimal" value={String(c.value)} disabled={!editable} onChange={(e) => set(i, { value: Number(e.target.value.replace(',', '.')) || 0 })} />
                    </div>
                  )}
                  {c.mode === 'PERCENT_NF_ACIMA' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`ta-${i}`}>Quando o frete da tabela passar de (R$)</Label>
                      <Input id={`ta-${i}`} inputMode="decimal" placeholder="Ex.: 150,00" value={c.tableAbove ?? ''} disabled={!editable} onChange={(e) => set(i, { tableAbove: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || null })} />
                      <p className="text-xs text-muted-foreground">Até este valor o cliente paga o frete da tabela; acima, vale a campanha.</p>
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
                  <Label htmlFor={`t-${i}`}>Transportadoras {c.carrierIds.length ? `(${c.carrierIds.length})` : '(vazio = todas)'}</Label>
                  <MultiSelect id={`t-${i}`} items={carrierItems} value={c.carrierIds} disabled={!editable} onChange={(v) => set(i, { carrierIds: v })} placeholder="Todas as transportadoras (clique para escolher)" />
                  <p className="text-xs text-muted-foreground">Na lista aparecem só as transportadoras ativas que entram na cotação.</p>
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
              ),
            )}
            {!shown.length && <p className="text-sm text-muted-foreground">Nenhuma campanha com esse filtro.</p>}
          </>
        )}
        {draft && <p className="text-sm text-amber-700 dark:text-amber-300">Há mudanças não salvas.</p>}
      </div>
    </RequirePermission>
  )
}
