import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon, CalculatorIcon, CheckCircle2Icon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ResultDetail } from '@/components/fretes/resultado'
import { MoneyInput } from '@/components/money-input'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money } from '@/lib/format'
import { type CalcSettings, type ComponentDef, fmtNum, type IcmsMode, maskCep, parseBr, type QuoteResult, RESULT_STATUS, useFreightContext, type VariableDef } from '@/lib/fretes'
import { cn } from '@/lib/utils'
import type { FreightTable, VersionRow } from '@/pages/fretes/tabelas'

interface VersionData {
  id: string
  number: number
  status: string
  components: ComponentDef[]
  settings: CalcSettings
  ruleVariables: string[]
}

const varOf = (code: string) => code.toLowerCase().replace(/-/g, '_')
/** Modelos de fórmula ("Fórmulas disponíveis"), com a variável de mesmo nome do componente. */
const PRESETS: { key: string; label: string; make: (v: string) => string }[] = [
  { key: 'fixo', label: 'fixo', make: (v) => `$${v}$` },
  { key: 'percentual_nf', label: 'percentual_nf', make: (v) => `$cargo_value$ * ($${v}$ / 100)` },
  { key: 'percentual_fr', label: 'percentual_fr', make: (v) => `$c_frete_peso$ * ($${v}$ / 100)` },
  { key: 'por_kg', label: 'por_kg', make: (v) => `$weight$ * $${v}$` },
  { key: 'fracao', label: 'fração de peso', make: (v) => `ceil($weight$ / $fraction$) * $${v}$` },
]

export function ComponentsTab({ table, version }: { table: FreightTable; version: VersionRow }) {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const { can } = useAuth()
  const v = useQuery({ queryKey: ['fretes', 'versao', version.id], queryFn: () => api.get<VersionData>(`/fretes/tabelas/${table.id}/versoes/${version.id}`) })
  const [rows, setRows] = useState<ComponentDef[]>([])
  const [settings, setSettings] = useState<CalcSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const lastFocus = useRef<{ index: number; field: 'formula' | 'condition'; el: HTMLInputElement } | null>(null)
  useEffect(() => {
    if (v.data) {
      setRows(v.data.components)
      setSettings(v.data.settings)
      setDirty(false)
      setErrors({})
    }
  }, [v.data])
  const editable = version.status === 'RASCUNHO' && can('fretes_tabelas', 'edit')

  const save = useMutation({
    mutationFn: () => api.patch<VersionData>(`/fretes/tabelas/${table.id}/versoes/${version.id}`, { components: rows, settings }),
    onSuccess: (d) => {
      qc.setQueryData(['fretes', 'versao', version.id], d)
      toast.success('Componentes e parâmetros salvos no rascunho.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const check = async (key: string, formula: string) => {
    if (!formula.trim()) return setErrors((e) => ({ ...e, [key]: '' }))
    const r = await api.post<{ ok: boolean; error?: string; variables?: string[] }>('/fretes/formula/validar', { formula }).catch(() => null)
    if (!r) return
    const known = new Set([...(ctx.data?.catalog.inputVariables.map((x) => x.code) ?? []), ...(v.data?.ruleVariables ?? []), ...rows.map((c) => `c_${varOf(c.code)}`)])
    const unknown = r.ok ? (r.variables ?? []).filter((x) => !known.has(x)) : []
    setErrors((e) => ({ ...e, [key]: r.ok ? (unknown.length ? `Aviso: ${unknown.map((x) => `$${x}$`).join(', ')} não aparece nas regras desta versão (vale 0).` : '') : r.error! }))
  }
  const update = (i: number, patch: Partial<ComponentDef>) => {
    setRows((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    setDirty(true)
  }
  const insertVar = (code: string) => {
    const f = lastFocus.current
    if (!f || !editable) return void navigator.clipboard?.writeText(`$${code}$`).then(() => toast.info(`$${code}$ copiado.`))
    const el = f.el
    const cur = rows[f.index]?.[f.field] ?? ''
    const pos = el.selectionStart ?? cur.length
    const next = `${cur.slice(0, pos)}$${code}$${cur.slice(el.selectionEnd ?? pos)}`
    update(f.index, { [f.field]: next })
    requestAnimationFrame(() => el.focus())
  }

  if (v.isLoading || ctx.isLoading || !settings) return <TableSkeleton />
  if (v.error) return <ErrorState error={v.error} onRetry={() => v.refetch()} />
  const cat = ctx.data!.catalog
  const allVars: VariableDef[] = [...cat.ruleVariables, ...cat.inputVariables, ...(v.data?.ruleVariables ?? []).filter((x) => !cat.ruleVariables.some((r) => r.code === x)).map((code) => ({ code, label: code, source: 'REGRA' as const, unit: '' }))]
  const shownVars = allVars.filter((x) => !filter || `${x.label} ${x.code}`.toLowerCase().includes(filter.toLowerCase()))
  const sorted = rows.map((c, i) => ({ c, i })).sort((a, b) => a.c.order - b.c.order)

  return (
    <div className="space-y-4">
      {!editable && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          Versão {version.number} {version.status === 'PUBLICADA' ? 'publicada' : 'fechada'}: só leitura. Para mudar fórmulas, crie uma nova versão na aba Versões.
        </p>
      )}
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Componente</TableHead>
                <TableHead className="w-44">Fórmulas disponíveis</TableHead>
                <TableHead>Fórmula atual</TableHead>
                <TableHead className="w-36">Nomes no CT-e</TableHead>
                <TableHead className="w-24 text-center">Soma no imposto</TableHead>
                <TableHead className="w-20 text-center">Ativo</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(({ c, i }) => (
                <TableRow key={i} className={cn(!c.active && 'opacity-60')}>
                  <TableCell className="align-top">
                    <Input aria-label="Nome do componente" className="h-8 font-medium" value={c.name} disabled={!editable} onChange={(e) => update(i, { name: e.target.value })} />
                    <div className="mt-1 flex gap-1">
                      <Input aria-label="Código" className="h-7 font-mono text-xs uppercase" value={c.code} disabled={!editable} onChange={(e) => update(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} />
                      <Input aria-label="Ordem de aplicação" title="Ordem de aplicação" className="h-7 w-16 text-xs" inputMode="numeric" value={c.order} disabled={!editable} onChange={(e) => update(i, { order: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Select value="__atual__" disabled={!editable} onValueChange={(p) => p !== '__atual__' && (update(i, { formula: PRESETS.find((x) => x.key === p)!.make(varOf(c.code)) }), check(`f${i}`, PRESETS.find((x) => x.key === p)!.make(varOf(c.code))))}>
                      <SelectTrigger className="h-8 w-full" aria-label={`Modelo de fórmula de ${c.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__atual__">Fórmula atual</SelectItem>
                        {PRESETS.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <Input
                      aria-label={`Fórmula de ${c.name}`}
                      className={cn('h-8 font-mono text-xs', errors[`f${i}`] && !errors[`f${i}`]!.startsWith('Aviso') && 'border-destructive')}
                      value={c.formula}
                      disabled={!editable}
                      onFocus={(e) => (lastFocus.current = { index: i, field: 'formula', el: e.currentTarget })}
                      onChange={(e) => update(i, { formula: e.target.value })}
                      onBlur={(e) => check(`f${i}`, e.target.value)}
                    />
                    <Input
                      aria-label={`Condição de ${c.name}`}
                      placeholder="Condição de incidência (opcional): ex. $is_pf$"
                      className="mt-1 h-7 font-mono text-xs"
                      value={c.condition ?? ''}
                      disabled={!editable}
                      onFocus={(e) => (lastFocus.current = { index: i, field: 'condition', el: e.currentTarget })}
                      onChange={(e) => update(i, { condition: e.target.value || null })}
                      onBlur={(e) => check(`c${i}`, e.target.value)}
                    />
                    {[errors[`f${i}`], errors[`c${i}`]].filter(Boolean).map((m, k) => (
                      <p key={k} className={cn('mt-1 flex items-center gap-1 text-xs', m!.startsWith('Aviso') ? 'text-amber-700 dark:text-amber-300' : 'text-destructive')}>
                        <AlertCircleIcon className="size-3" aria-hidden /> {m}
                      </p>
                    ))}
                    {c.description && <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>}
                  </TableCell>
                  <TableCell className="align-top">
                    <Input aria-label="Nome no CT-e" className="h-8 text-xs" placeholder="Padrão" value={c.cteName ?? ''} disabled={!editable} onChange={(e) => update(i, { cteName: e.target.value || null })} />
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <Switch checked={c.inTax} disabled={!editable} onCheckedChange={(x) => update(i, { inTax: x })} aria-label={`${c.name} soma no imposto`} />
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <Switch checked={c.active} disabled={!editable} onCheckedChange={(x) => update(i, { active: x })} aria-label={`${c.name} ativo`} />
                  </TableCell>
                  <TableCell className="align-top">
                    {editable && (
                      <Button size="icon" variant="ghost" aria-label={`Remover ${c.name}`} onClick={() => (setRows((p) => p.filter((_, j) => j !== i)), setDirty(true))}>
                        <Trash2Icon aria-hidden />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {editable && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setRows((p) => [...p, { code: `TAXA_${p.length + 1}`, name: 'Nova taxa', formula: '0', inTax: true, order: (Math.max(0, ...p.filter((x) => x.order < 900).map((x) => x.order)) || 0) + 10, active: true, condition: null, cteName: null }])
                setDirty(true)
              }}
            >
              <PlusIcon aria-hidden /> Componente
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variáveis disponíveis</CardTitle>
          <CardDescription>
            Clique para inserir na fórmula em edição. As de cotação vêm do envio; as de regra vêm da tabela da transportadora para o destino. Cada componente vira $c_código$ para os seguintes (ex.: $c_frete_peso$). Funções: {cat.functions.map((f) => f.name).join(', ')}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Buscar variável" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {shownVars.map((x) => (
              <button key={x.code} type="button" title={x.help ?? `${x.label} (${x.unit})`} onClick={() => insertVar(x.code)} className={cn('rounded-md border px-2 py-0.5 text-xs', x.source === 'ENTRADA' ? 'border-sky-600/40 text-sky-800 dark:text-sky-300' : 'border-teal-600/40 text-teal-800 dark:text-teal-300', v.data?.ruleVariables.includes(x.code) && 'bg-teal-500/10')}>
                {x.label} - {x.code}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros de cálculo da versão</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="p-icms">Cobrança do ICMS</Label>
            <Select value={settings.icmsMode} disabled={!editable} onValueChange={(x) => (setSettings({ ...settings, icmsMode: x as IcmsMode }), setDirty(true))}>
              <SelectTrigger id="p-icms" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(cat.icmsModes).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-rate">Alíquota padrão (%)</Label>
            <Input id="p-rate" inputMode="decimal" disabled={!editable} placeholder="Da regra (icms_aliq)" defaultValue={fmtNum(settings.icmsRate, 2)} onBlur={(e) => { const n = parseBr(e.target.value); if (!Number.isNaN(n)) { setSettings({ ...settings, icmsRate: n }); setDirty(true) } }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-cub">Fator de cubagem (kg/m³)</Label>
            <Input id="p-cub" inputMode="decimal" disabled={!editable} defaultValue={fmtNum(settings.cubageFactor, 2)} onBlur={(e) => { const n = parseBr(e.target.value); if (n !== null && !Number.isNaN(n)) { setSettings({ ...settings, cubageFactor: n }); setDirty(true) } }} />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-4">
            <Switch checked={settings.useCubage} disabled={!editable} onCheckedChange={(x) => (setSettings({ ...settings, useCubage: x }), setDirty(true))} /> Cobrar pelo peso taxado (maior entre real e cubado). Desligado: só o peso real.
          </label>
        </CardContent>
      </Card>

      {editable && (
        <div className="sticky bottom-2 flex justify-end gap-2">
          {dirty && <Badge variant="outline" className="self-center bg-background">Alterações não salvas</Badge>}
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar no rascunho
          </Button>
        </div>
      )}

      <Simulator table={table} version={version} dirty={dirty} />
    </div>
  )
}

/** Simula um envio com esta versão (inclusive rascunho) sem salvar cotação. */
function Simulator({ table, version, dirty }: { table: FreightTable; version: VersionRow; dirty: boolean }) {
  const [zip, setZip] = useState('')
  const [value, setValue] = useState<number | null>(1000)
  const [weight, setWeight] = useState('10')
  const [person, setPerson] = useState<'PF' | 'PJ'>('PJ')
  const sim = useMutation({
    mutationFn: () => {
      const w = parseBr(weight)
      if (!w || Number.isNaN(w)) throw new Error('Informe o peso.')
      return api.post<QuoteResult & { destCity: string | null; destUf: string | null }>('/fretes/simular', { tableId: table.id, versionId: version.id, destZip: zip, cargoValue: value ?? 0, weight: w, personType: person })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalculatorIcon className="size-4" aria-hidden /> Simulador da versão {version.number}
        </CardTitle>
        <CardDescription>{dirty ? 'Salve as alterações antes: o simulador usa o que está gravado no rascunho.' : 'Confira o cálculo antes de publicar. Nada é salvo.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            sim.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="s-zip">CEP de destino</Label>
            <Input id="s-zip" className="w-32" required value={zip} onChange={(e) => setZip(maskCep(e.target.value))} />
          </div>
          <div className="w-40 space-y-1.5">
            <Label htmlFor="s-value">Valor da NF</Label>
            <MoneyInput id="s-value" value={value} onChange={setValue} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-weight">Peso (kg)</Label>
            <Input id="s-weight" className="w-24" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <ToggleGroup type="single" variant="outline" value={person} onValueChange={(x) => x && setPerson(x as 'PF' | 'PJ')}>
            <ToggleGroupItem value="PJ">PJ</ToggleGroupItem>
            <ToggleGroupItem value="PF">PF</ToggleGroupItem>
          </ToggleGroup>
          <Button type="submit" disabled={sim.isPending}>
            {sim.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckCircle2Icon aria-hidden />} Simular
          </Button>
        </form>
        {sim.data && (
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">
              {sim.data.destCity ?? '—'}/{sim.data.destUf ?? '—'} ·{' '}
              <Badge variant="outline" className={RESULT_STATUS[sim.data.status].className}>
                {RESULT_STATUS[sim.data.status].label}
              </Badge>{' '}
              {sim.data.total !== null && <span className="ml-2 text-base">{money(sim.data.total)}</span>}
            </p>
            <ResultDetail r={sim.data} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
