import { FilterXIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { REGIONS, todaySP, UF_LIST } from '@/lib/atendimento'
import { useMktOptions } from '@/lib/marketing'

const firstOfMonth = (offset = 0) => {
  const [y, m] = todaySP().split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return d.toISOString().slice(0, 10)
}
const lastOfMonth = (offset: number) => new Date(Date.parse(`${firstOfMonth(offset + 1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [firstOfMonth(), todaySP()] },
  { id: 'mes-1', label: 'Mês passado', range: () => [firstOfMonth(-1), lastOfMonth(-1)] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
  { id: '365', label: '12 meses', range: () => [todaySP(-364), todaySP()] },
] as const

const GRAN = [
  { id: '', label: 'Agrupar: automático' },
  { id: 'dia', label: 'Por dia' },
  { id: 'semana', label: 'Por semana' },
  { id: 'mes', label: 'Por mês' },
  { id: 'trimestre', label: 'Por trimestre' },
  { id: 'ano', label: 'Por ano' },
]

const ALL = '__todos'

/** Filtro de lista: "Todos" limpa o parâmetro. */
function Pick({ label, value, items, onChange, width = 'w-44' }: { label: string; value: string | null; items: { id: string; name: string }[]; onChange: (v: string | null) => void; width?: string }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className={width} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Filtros globais do módulo. Ficam na URL (a tela pode ir para os favoritos). Todos os gráficos e tabelas da tela usam os mesmos.
 * `compact` mostra só período e agrupamento (telas que não cruzam com o CRM, como E-mail).
 */
export function MktFilters({ params, set, compact = false }: { params: URLSearchParams; set: (p: Record<string, string | null>) => void; compact?: boolean }) {
  const opts = useMktOptions().data
  const de = params.get('de') ?? todaySP(-29)
  const ate = params.get('ate') ?? todaySP()
  const preset = PRESETS.find((p) => {
    const [a, b] = p.range()
    return a === de && b === ate
  })?.id
  const active = ['canal', 'campanha', 'marca', 'peca', 'uf', 'regiao', 'filial', 'vendedor', 'origem', 'tipoCliente', 'status', 'cliente'].filter((k) => params.get(k))
  const g = (k: string) => params.get(k)
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={preset ?? ''}
          onValueChange={(v) => {
            const pr = PRESETS.find((x) => x.id === v)
            if (pr) {
              const [a, b] = pr.range()
              set({ de: a!, ate: b! })
            }
          }}
          aria-label="Período"
          className="flex-wrap"
        >
          {PRESETS.map((pr) => (
            <ToggleGroupItem key={pr.id} value={pr.id} className="px-2.5">
              {pr.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 w-36" aria-label="De" value={de} max={ate} onChange={(e) => e.target.value && set({ de: e.target.value })} />
          <span className="text-sm text-muted-foreground">até</span>
          <Input type="date" className="h-8 w-36" aria-label="Até" value={ate} min={de} onChange={(e) => e.target.value && set({ ate: e.target.value })} />
        </div>
        <Select value={g('agrupar') ?? ALL} onValueChange={(v) => set({ agrupar: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="w-44" aria-label="Agrupar o histórico">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRAN.map((x) => (
              <SelectItem key={x.id || ALL} value={x.id || ALL}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!compact && opts && (
        <div className="flex flex-wrap items-center gap-2">
          <Pick label="Plataforma/canal" value={g('canal')} items={opts.channels} onChange={(v) => set({ canal: v, campanha: null })} width="w-56" />
          <Pick label="Marca" value={g('marca')} items={opts.brands} onChange={(v) => set({ marca: v })} />
          <Pick label="Peça" value={g('peca')} items={opts.partTypes} onChange={(v) => set({ peca: v })} />
          <Pick label="Estado" value={g('uf')} items={[...UF_LIST.map((uf) => ({ id: uf, name: uf })), { id: 'EX', name: 'Exterior' }]} onChange={(v) => set({ uf: v })} width="w-36" />
          <Pick label="Região" value={g('regiao')} items={[...REGIONS, 'Exterior'].map((r) => ({ id: r, name: r }))} onChange={(v) => set({ regiao: v })} width="w-40" />
          <Pick label="Filial" value={g('filial')} items={opts.units} onChange={(v) => set({ filial: v })} />
          <Pick label="Vendedor" value={g('vendedor')} items={opts.sellers} onChange={(v) => set({ vendedor: v })} />
          <Pick label="Origem" value={g('origem')} items={opts.origins} onChange={(v) => set({ origem: v })} />
          <Pick label="Tipo de cliente" value={g('tipoCliente')} items={opts.customerTypes} onChange={(v) => set({ tipoCliente: v })} />
          <Pick
            label="Situação"
            value={g('status')}
            items={[
              { id: 'SIM', name: 'Vendeu' },
              { id: 'NEGOCIACAO', name: 'Em negociação' },
              { id: 'NAO', name: 'Perdida' },
            ]}
            onChange={(v) => set({ status: v })}
            width="w-40"
          />
          <Pick
            label="Cliente"
            value={g('cliente')}
            items={[
              { id: 'novo', name: 'Novo (1ª compra)' },
              { id: 'recorrente', name: 'Recorrente' },
            ]}
            onChange={(v) => set({ cliente: v })}
            width="w-44"
          />
          {g('campanha') && (
            <Button variant="secondary" size="sm" onClick={() => set({ campanha: null })} title="Tirar o filtro de campanha">
              Campanha filtrada ✕
            </Button>
          )}
          {active.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries(active.map((k) => [k, null])))}>
              <FilterXIcon /> Limpar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
