import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtNum, maskCep, parseBr, useFreightContext } from '@/lib/fretes'
import type { FreightTable, VersionRow } from '@/pages/fretes/tabelas'

interface Rule {
  id: string
  line: number
  cepStart: number | null
  cepEnd: number | null
  cepStartLabel: string | null
  cepEndLabel: string | null
  uf: string | null
  city: string | null
  weightMin: number
  weightMax: number | null
  deadlineDays: number | null
  restricted: boolean
  values: Record<string, number>
  note: string | null
}

export function RulesTab({ table, version }: { table: FreightTable; version: VersionRow }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const ctx = useFreightContext()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Rule | 'nova' | null>(null)
  const base = `/fretes/tabelas/${table.id}/versoes/${version.id}/regras`
  const list = useQuery({
    queryKey: ['fretes', 'regras', version.id, q, page],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; items: Rule[] }>(`${base}?${new URLSearchParams({ pagina: String(page), ...(q ? { busca: q } : {}) })}`),
    placeholderData: keepPreviousData,
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fretes'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const editable = version.status === 'RASCUNHO' && can('fretes_tabelas', 'edit')
  const label = (code: string) => ctx.data?.catalog.ruleVariables.find((v) => v.code === code)?.label ?? code
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-60 flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              setQ(search.trim())
              setPage(1)
            }}
          >
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder="Buscar por CEP, cidade ou UF" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <Can module="fretes_tabelas" action="export">
            <Button variant="outline" onClick={() => api.download(`${base}.csv`, `regras-v${version.number}.csv`).catch((e) => toast.error(errorMessage(e)))}>
              <DownloadIcon aria-hidden /> Exportar
            </Button>
          </Can>
          {editable && (
            <Button onClick={() => setEditing('nova')}>
              <PlusIcon aria-hidden /> Regra
            </Button>
          )}
        </div>
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState title={q ? 'Nenhuma regra para esta busca' : 'Versão sem regras'} description={q ? undefined : 'Importe a planilha da transportadora na aba Histórico de Importação ou cadastre as regras.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destino</TableHead>
                    <TableHead>Peso (kg)</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Valores</TableHead>
                    <TableHead className="hidden lg:table-cell">Linha</TableHead>
                    {editable && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">
                        {r.cepStartLabel ? `${r.cepStartLabel} a ${r.cepEndLabel}` : r.city ? r.city : `UF ${r.uf}`}
                        <span className="block text-xs text-muted-foreground">{[r.cepStartLabel && r.city, r.uf].filter(Boolean).join(' · ')}</span>
                        {r.restricted && (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                            Restrição
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {fmtNum(r.weightMin)} a {r.weightMax === null ? '∞' : fmtNum(r.weightMax)}
                      </TableCell>
                      <TableCell className="text-sm">{r.deadlineDays === null ? '—' : `${r.deadlineDays} d`}</TableCell>
                      <TableCell className="max-w-xl whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.values).map(([k, v]) => (
                            <span key={k} className="rounded border px-1.5 text-xs" title={k}>
                              {label(k)}: <b className="tabular-nums">{fmtNum(v, 4)}</b>
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{r.line || 'manual'}</TableCell>
                      {editable && (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="icon" variant="ghost" aria-label="Editar regra" onClick={() => setEditing(r)}>
                            <PencilIcon aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Excluir regra"
                            onClick={async () => {
                              if (await confirm({ title: 'Excluir esta regra do rascunho?', confirmLabel: 'Excluir' })) del.mutate(r.id)
                            }}
                          >
                            <Trash2Icon aria-hidden />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{list.data.total} regra(s)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span className="self-center">
                  {page} de {pages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
      {editing && <RuleDialog base={base} rule={editing === 'nova' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function RuleDialog({ base, rule, onClose }: { base: string; rule: Rule | null; onClose: () => void }) {
  const qc = useQueryClient()
  const ctx = useFreightContext()
  const [f, setF] = useState({
    cepStart: rule?.cepStartLabel ?? '',
    cepEnd: rule?.cepEndLabel ?? '',
    uf: rule?.uf ?? '',
    city: rule?.city ?? '',
    weightMin: fmtNum(rule?.weightMin ?? 0),
    weightMax: fmtNum(rule?.weightMax ?? null),
    deadlineDays: rule?.deadlineDays?.toString() ?? '',
    restricted: rule?.restricted ?? false,
    note: rule?.note ?? '',
  })
  const [values, setValues] = useState<{ code: string; value: string }[]>(() => Object.entries(rule?.values ?? { freight: 0 }).map(([code, v]) => ({ code, value: fmtNum(v, 4) })))
  const save = useMutation({
    mutationFn: () => {
      const vals: Record<string, number> = {}
      for (const v of values) {
        if (!v.code) continue
        const n = parseBr(v.value)
        if (n === null) continue
        if (Number.isNaN(n)) throw new Error(`Valor inválido em ${v.code}.`)
        vals[v.code] = n
      }
      const wMin = parseBr(f.weightMin)
      const wMax = parseBr(f.weightMax)
      if (Number.isNaN(wMin) || Number.isNaN(wMax)) throw new Error('Peso inválido.')
      const body = { cepStart: f.cepStart || null, cepEnd: f.cepEnd || null, uf: f.uf || null, city: f.city || null, weightMin: wMin ?? 0, weightMax: wMax, deadlineDays: f.deadlineDays ? Number(f.deadlineDays) : null, restricted: f.restricted, values: vals, note: f.note || null }
      return rule ? api.put(`${base}/${rule.id}`, body) : api.post(base, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success('Regra salva no rascunho.')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const vars = ctx.data?.catalog.ruleVariables ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Editar regra' : 'Nova regra'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-a">CEP inicial</Label>
            <Input id="r-a" value={f.cepStart} onChange={(e) => setF({ ...f, cepStart: maskCep(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-b">CEP final</Label>
            <Input id="r-b" value={f.cepEnd} onChange={(e) => setF({ ...f, cepEnd: maskCep(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-uf">UF</Label>
            <Input id="r-uf" maxLength={2} className="uppercase" value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-city">Cidade</Label>
            <Input id="r-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-wmin">Peso inicial (kg)</Label>
            <Input id="r-wmin" inputMode="decimal" value={f.weightMin} onChange={(e) => setF({ ...f, weightMin: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-wmax">Peso final (kg)</Label>
            <Input id="r-wmax" inputMode="decimal" placeholder="Sem limite" value={f.weightMax} onChange={(e) => setF({ ...f, weightMax: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-dl">Prazo (dias úteis)</Label>
            <Input id="r-dl" inputMode="numeric" value={f.deadlineDays} onChange={(e) => setF({ ...f, deadlineDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox checked={f.restricted} onCheckedChange={(c) => setF({ ...f, restricted: c === true })} /> Restrição (não atende)
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Valores</p>
          {values.map((v, i) => (
            <div key={i} className="flex gap-2">
              <select aria-label="Variável" className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" value={v.code} onChange={(e) => setValues((p) => p.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}>
                {!vars.some((x) => x.code === v.code) && <option value={v.code}>{v.code}</option>}
                {vars.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label} ({x.code}, {x.unit})
                  </option>
                ))}
              </select>
              <Input aria-label="Valor" className="w-32" inputMode="decimal" value={v.value} onChange={(e) => setValues((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" aria-label="Remover valor" onClick={() => setValues((p) => p.filter((_, j) => j !== i))}>
                <Trash2Icon aria-hidden />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setValues((p) => [...p, { code: vars.find((x) => !p.some((y) => y.code === x.code))?.code ?? 'freight', value: '' }])}>
            <PlusIcon aria-hidden /> Valor
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-note">Observação</Label>
          <Input id="r-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
