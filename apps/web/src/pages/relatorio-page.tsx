import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, CopyIcon, DownloadIcon, Loader2Icon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { ReportView } from '@/components/relatorios/report-view'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { int, todaySP } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import {
  type Chart,
  CHART_LABEL,
  downloadReport,
  type Filter,
  newConfig,
  periodText,
  type Preset,
  PRESET_LABEL,
  type ReportConfig,
  type ReportResult,
  type SavedReport,
  type SourceInfo,
  useCatalog,
} from '@/lib/relatorios'

const NONE = '__none__'
const NULL = '__null__'

export function RelatorioPage() {
  return (
    <RequirePermission module="relatorios">
      <Loader />
    </RequirePermission>
  )
}

function Loader() {
  const { id } = useParams()
  const catalog = useCatalog()
  const saved = useQuery({ queryKey: ['relatorio', id], queryFn: () => api.get<SavedReport>(`/relatorios/salvos/${id}`), enabled: !!id && id !== 'novo' })
  if (catalog.error || saved.error) return <ErrorState error={catalog.error ?? saved.error} onRetry={() => void (catalog.refetch(), saved.refetch())} />
  if (!catalog.data || (id !== 'novo' && !saved.data)) return <TableSkeleton rows={8} />
  return <Builder key={id} sources={catalog.data.sources.filter((s) => s.available)} saved={id === 'novo' ? null : saved.data!} />
}

interface Meta {
  name: string
  description: string
  visibility: 'privado' | 'equipe'
  pinned: boolean
  width: 1 | 2
}

function Builder({ sources, saved }: { sources: SourceInfo[]; saved: SavedReport | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = useAuth()
  const [config, setConfig] = useState<ReportConfig>(() => saved?.config ?? newConfig(sources[0]!))
  const [meta, setMeta] = useState<Meta>(() => ({
    name: saved?.name ?? '',
    description: saved?.description ?? '',
    visibility: saved?.visibility ?? 'privado',
    pinned: saved?.pinned ?? false,
    width: saved?.width ?? 1,
  }))
  const [busy, setBusy] = useState<'save' | 'export' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const source = sources.find((s) => s.key === config.source) ?? sources[0]!
  const canEdit = saved ? (saved.mine || saved.visibility === 'equipe') && can('relatorios', 'edit') : can('relatorios', 'create')
  const canDelete = !!saved && (saved.mine || saved.visibility === 'equipe') && can('relatorios', 'delete')

  // Prévia ao vivo, com um pequeno atraso para não consultar a cada clique.
  const [debounced, setDebounced] = useState(config)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(config), 400)
    return () => clearTimeout(t)
  }, [config])
  const preview = useQuery({
    queryKey: ['relatorio-previa', JSON.stringify(debounced)],
    // Filtro ainda sem valor escolhido fica de fora da prévia.
    queryFn: () => api.post<ReportResult>('/relatorios/executar', { config: { ...debounced, filters: debounced.filters.filter((f) => f.values.length) } }),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const set = (patch: Partial<ReportConfig>) => setConfig((c) => ({ ...c, ...patch }))
  const changeSource = (key: string) => {
    const next = sources.find((s) => s.key === key)
    if (next) setConfig({ ...newConfig(next), period: config.period, compare: config.compare })
  }
  const setDim = (i: number, key: string) => {
    const dims = [...config.dimensions]
    if (key === NONE) dims.splice(i, dims.length - i)
    else dims[i] = key
    const next = dims.filter(Boolean)
    const chart: Chart = next.length === 0 ? (config.chart === 'tabela' ? 'tabela' : 'numero') : config.chart === 'numero' ? 'tabela' : config.chart
    set({ dimensions: next, chart })
  }
  const toggleMetric = (key: string, on: boolean) => {
    const metrics = on ? [...config.metrics, key].slice(0, 4) : config.metrics.filter((m) => m !== key)
    set({ metrics: metrics.length ? metrics : config.metrics })
  }

  const save = async () => {
    if (meta.name.trim().length < 2) return toast.error('Dê um nome ao relatório.')
    setBusy('save')
    try {
      const body = { ...meta, name: meta.name.trim(), description: meta.description.trim() || null, config }
      const r = saved ? await api.put<SavedReport>(`/relatorios/salvos/${saved.id}`, body) : await api.post<SavedReport>('/relatorios/salvos', body)
      qc.setQueryData(['relatorio', r.id], r)
      void qc.invalidateQueries({ queryKey: ['relatorios-salvos'] })
      toast.success('Relatório salvo.')
      if (!saved) navigate(`/relatorios/${r.id}`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const exportCsv = async () => {
    setBusy('export')
    try {
      await downloadReport(config, meta.name || source.label)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const duplicate = async () => {
    try {
      const r = await api.post<SavedReport>(`/relatorios/salvos/${saved!.id}/duplicar`)
      void qc.invalidateQueries({ queryKey: ['relatorios-salvos'] })
      toast.success('Cópia criada (privada).')
      navigate(`/relatorios/${r.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async () => {
    setBusy('delete')
    try {
      await api.delete(`/relatorios/salvos/${saved!.id}`)
      void qc.invalidateQueries({ queryKey: ['relatorios-salvos'] })
      toast.success('Relatório excluído.')
      navigate('/relatorios?aba=relatorios')
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(null)
    }
  }

  const freeDims = (i: number) => source.dimensions.filter((d) => !config.dimensions.slice(0, i).includes(d.key) && !(d.list && config.dimensions.some((k, j) => j !== i && source.dimensions.find((x) => x.key === k)?.list)))

  return (
    <>
      <PageHeader
        title={saved ? saved.name : 'Novo relatório'}
        description={saved ? `${saved.visibility === 'equipe' ? 'Da equipe' : 'Privado'}${saved.createdByName ? ` · criado por ${saved.createdByName}` : ''}` : 'Escolha a fonte, como agrupar, o que medir e o formato. A prévia ao lado mostra o resultado na hora.'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/relatorios?aba=relatorios">
                <ArrowLeftIcon /> Relatórios
              </Link>
            </Button>
            {can('relatorios', 'export') && (
              <Button variant="outline" onClick={() => void exportCsv()} disabled={busy !== null}>
                {busy === 'export' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Exportar CSV
              </Button>
            )}
            {saved && can('relatorios', 'create') && (
              <Button variant="outline" onClick={() => void duplicate()}>
                <CopyIcon /> Duplicar
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon /> Excluir
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => void save()} disabled={busy !== null}>
                {busy === 'save' ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Salvar
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="r-source">Fonte</Label>
                <Select value={source.key} onValueChange={changeSource}>
                  <SelectTrigger id="r-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{source.description} O período usa a {source.dateLabel}.</p>
              </div>

              <PeriodPicker value={config.period} onChange={(period) => set({ period })} />

              <div className="space-y-2">
                <Label>Agrupar por</Label>
                {[0, 1].map((i) =>
                  i > config.dimensions.length ? null : (
                    <Select key={i} value={config.dimensions[i] ?? NONE} onValueChange={(v) => setDim(i, v)}>
                      <SelectTrigger className="w-full" aria-label={i === 0 ? 'Primeiro agrupamento' : 'Segundo agrupamento'}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{i === 0 ? 'Sem agrupar (só o total)' : 'Sem segundo agrupamento'}</SelectItem>
                        {freeDims(i).map((d) => (
                          <SelectItem key={d.key} value={d.key}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ),
                )}
                {config.dimensions.length === 2 && <p className="text-xs text-muted-foreground">No gráfico, o segundo campo vira as séries (cores), até 5 e o resto em "Outros".</p>}
              </div>

              <div className="space-y-2">
                <Label>Métricas (até 4)</Label>
                <div className="grid gap-2">
                  {source.metrics.map((m) => {
                    const on = config.metrics.includes(m.key)
                    return (
                      <label key={m.key} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={on} disabled={!on && config.metrics.length >= 4} onCheckedChange={(v) => toggleMetric(m.key, v === true)} />
                        {m.label}
                      </label>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <FiltersCard source={source} filters={config.filters} onChange={(filters) => set({ filters })} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visualização</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleGroup type="single" variant="outline" size="sm" value={config.chart} onValueChange={(v) => v && set({ chart: v as Chart })} className="flex-wrap" aria-label="Formato">
                {(Object.keys(CHART_LABEL) as Chart[]).map((c) => (
                  <ToggleGroupItem key={c} value={c} className="px-3" disabled={c === 'numero' ? config.dimensions.length > 0 : c !== 'tabela' && config.dimensions.length === 0}>
                    {CHART_LABEL[c]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {config.dimensions.length > 0 && !source.dimensions.find((d) => d.key === config.dimensions[0])?.time && (
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="r-limit">Mostrar até</Label>
                  <Select value={String(config.limit)} onValueChange={(v) => set({ limit: Number(v) })}>
                    <SelectTrigger id="r-limit" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50, 100, 500].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} linhas
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="r-compare">Comparar com o período anterior</Label>
                <Switch id="r-compare" checked={config.compare} onCheckedChange={(v) => set({ compare: v })} />
              </div>
            </CardContent>
          </Card>

          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Salvar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="r-name">Nome</Label>
                  <Input id="r-name" maxLength={120} value={meta.name} placeholder="Ex.: Vendas por vendedor no mês" onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="r-desc">Descrição (opcional)</Label>
                  <Textarea id="r-desc" rows={2} maxLength={500} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="r-vis">Quem vê</Label>
                  <Select value={meta.visibility} onValueChange={(v) => setMeta({ ...meta, visibility: v as Meta['visibility'] })} disabled={!!saved && !saved.mine}>
                    <SelectTrigger id="r-vis" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="privado">Só eu</SelectItem>
                      <SelectItem value="equipe">Toda a equipe com acesso a relatórios</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="r-pin">Mostrar no Painel</Label>
                  <Switch id="r-pin" checked={meta.pinned} onCheckedChange={(v) => setMeta({ ...meta, pinned: v })} />
                </div>
                {meta.pinned && (
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="r-width">Tamanho no Painel</Label>
                    <Select value={String(meta.width)} onValueChange={(v) => setMeta({ ...meta, width: v === '2' ? 2 : 1 })}>
                      <SelectTrigger id="r-width" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Metade da tela</SelectItem>
                        <SelectItem value="2">Largura inteira</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="self-start xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Prévia {preview.isFetching && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
            </CardTitle>
            <CardDescription>
              {preview.data ? `${source.label} · ${periodText(preview.data.period)}${preview.data.previousTotals ? ` · comparado com ${periodText(preview.data.period.previous)}` : ''}` : source.label}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {preview.error ? (
              <p className="py-8 text-center text-sm text-destructive">{errorMessage(preview.error)}</p>
            ) : preview.data ? (
              <ReportView result={preview.data} />
            ) : (
              <TableSkeleton rows={5} />
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o relatório?</AlertDialogTitle>
            <AlertDialogDescription>"{saved?.name}" sai da lista e do Painel{saved?.visibility === 'equipe' ? ' para toda a equipe' : ''}. Os dados em si não são apagados.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PeriodPicker({ value, onChange }: { value: ReportConfig['period']; onChange: (p: ReportConfig['period']) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="r-period">Período</Label>
      <Select
        value={value.preset}
        onValueChange={(v) => onChange(v === 'personalizado' ? { preset: 'personalizado', from: value.from ?? todaySP(-29), to: value.to ?? todaySP() } : { preset: v as Preset })}
      >
        <SelectTrigger id="r-period" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <SelectItem key={p} value={p}>
              {PRESET_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === 'personalizado' && (
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8" aria-label="De" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="text-sm text-muted-foreground">até</span>
          <Input type="date" className="h-8" aria-label="Até" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
      {value.preset !== 'personalizado' && <p className="text-xs text-muted-foreground">Relativo ao dia em que o relatório é aberto.</p>}
    </div>
  )
}

function FiltersCard({ source, filters, onChange }: { source: SourceInfo; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const fields = source.dimensions.filter((d) => !d.time)
  const update = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filtros</CardTitle>
        <CardDescription>Só os registros que atendem a todos os filtros.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {filters.map((f, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <div className="flex gap-2">
              <Select value={f.field} onValueChange={(v) => update(i, { field: v, values: [] })}>
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Campo do filtro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={f.op} onValueChange={(v) => update(i, { op: v as Filter['op'] })}>
                <SelectTrigger size="sm" className="w-28" aria-label="Condição">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="igual">é</SelectItem>
                  <SelectItem value="diferente">não é</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Remover filtro" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
                <XIcon />
              </Button>
            </div>
            <FilterValues source={source.key} field={f.field} labels={source.dimensions.find((d) => d.key === f.field)?.labels ?? null} value={f.values} onChange={(values) => update(i, { values })} />
          </div>
        ))}
        {filters.length < 10 && fields.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => onChange([...filters, { field: fields[0]!.key, op: 'igual', values: [] }])}>
            <PlusIcon /> Adicionar filtro
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function FilterValues({ source, field, labels, value, onChange }: { source: string; field: string; labels: Record<string, string> | null; value: (string | null)[]; onChange: (v: (string | null)[]) => void }) {
  const q = useQuery({
    queryKey: ['relatorio-valores', source, field],
    queryFn: () => api.get<{ value: string | null; label: string; count: number }[]>(`/relatorios/valores?fonte=${encodeURIComponent(source)}&campo=${encodeURIComponent(field)}`),
    staleTime: 5 * 60_000,
  })
  const items = useMemo(() => {
    const list = (q.data ?? []).map((v) => ({ id: v.value ?? NULL, name: `${v.label} (${int.format(v.count)})` }))
    // Valores da lista fixa que ainda não apareceram nos dados também podem ser escolhidos.
    for (const [k, l] of Object.entries(labels ?? {})) if (!list.some((i) => i.id === k)) list.push({ id: k, name: l })
    for (const v of value) if (!list.some((i) => i.id === (v ?? NULL))) list.push({ id: v ?? NULL, name: v === null ? 'Não informado' : (labels?.[v] ?? v) })
    return list
  }, [q.data, labels, value])
  return (
    <MultiSelect
      items={items}
      value={value.map((v) => v ?? NULL)}
      onChange={(v) => onChange(v.map((x) => (x === NULL ? null : x)))}
      placeholder={q.isLoading ? 'Carregando valores…' : 'Escolha os valores'}
    />
  )
}
