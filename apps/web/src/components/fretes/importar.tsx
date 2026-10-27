import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon, UploadIcon, WandSparklesIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime } from '@/lib/format'
import { fmtNum, formatCep, parseBr, useFreightContext } from '@/lib/fretes'
import { cn } from '@/lib/utils'
import type { FreightTable } from '@/pages/fretes/tabelas'

interface ImportRow {
  id: string
  fileName: string
  status: string
  readLines: number
  importedLines: number
  rejectedLines: number
  rulesCount: number
  version: { id: string; number: number; status: string } | null
  createdByName: string
  createdAt: string
  finishedAt: string | null
}
type Cell = string | number | boolean | null
interface Mapping {
  column: number
  field: string
  weightMin?: number | null
  weightMax?: number | null
}
interface Analysis {
  importId: string
  fileName: string
  sheets: { index: number; name: string; rowCount: number; preview: Cell[][] }[]
  suggested: { sheet: number; headerRow: number; mapping: Mapping[] }
}
interface Issue {
  line: number
  level: 'erro' | 'alerta'
  message: string
}
interface Validation {
  readLines: number
  importedLines: number
  errorLines: number
  rules: number
  issueCount: number
  issues: Issue[]
  variables: { code: string; label: string }[]
  sample: { line: number; cepStart: number | null; cepEnd: number | null; uf: string | null; city: string | null; weightMin: number; weightMax: number | null; deadlineDays: number | null; restricted: boolean; values: Record<string, number> }[]
  ufs: string[]
}

const IGNORE = '__ignorar__'
const OTHER = '__outra__'
const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
const cellText = (c: Cell) => (c === null || c === undefined ? '' : String(c))

export function ImportsTab({ table, onImported }: { table: FreightTable; onImported: (versionId: string) => void }) {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['fretes', 'importacoes', table.id], queryFn: () => api.get<ImportRow[]>(`/fretes/tabelas/${table.id}/importacoes`) })
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">A planilha vira um rascunho de nova versão. A versão publicada só muda quando você publicar (aba Versões).</p>
          {can('fretes_tabelas', 'create') && (
            <Button variant="outline" onClick={() => setOpen(true)}>
              <UploadIcon aria-hidden /> Importar Regras
            </Button>
          )}
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={3} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState icon={FileSpreadsheetIcon} title="Nenhuma importação" description="Envie a planilha (.xlsx ou .csv) que a transportadora mandou. Você escolhe o que é cada coluna." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="hidden md:table-cell">Versão</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    {dateTime(r.createdAt)}
                    <span className="block text-xs text-muted-foreground">{r.createdByName}</span>
                  </TableCell>
                  <TableCell className="max-w-md text-sm whitespace-normal">{r.fileName}</TableCell>
                  <TableCell className="text-sm">
                    {r.status === 'CONCLUIDA' ? (
                      <>
                        {r.importedLines} linha(s) · {r.rulesCount} regra(s)
                        {r.rejectedLines > 0 && <span className="block text-xs text-destructive">{r.rejectedLines} linha(s) rejeitada(s)</span>}
                      </>
                    ) : (
                      <Badge variant="outline">{r.status === 'CANCELADA' ? 'Cancelada' : 'Não concluída'}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.version ? `v${r.version.number}` : '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.status === 'CONCLUIDA' && (
                      <Button size="sm" variant="ghost" onClick={() => setReport(r.id)}>
                        <FileTextIcon aria-hidden /> Relatório
                      </Button>
                    )}
                    <Button size="icon" variant="outline" className="border-orange-500/60 text-orange-600" aria-label="Baixar o arquivo original" onClick={() => api.download(`/fretes/importacoes/${r.id}/arquivo`, r.fileName).catch((e) => toast.error(errorMessage(e)))}>
                      <DownloadIcon aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {open && <ImportWizard table={table} onClose={() => setOpen(false)} onDone={onImported} />}
      {report && <ReportDialog id={report} onClose={() => setReport(null)} />}
    </Card>
  )
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useQuery({ queryKey: ['fretes', 'importacao', id], queryFn: () => api.get<{ fileName: string; report: { issueCount: number; issues: Issue[] } | null; readLines: number; importedLines: number; rejectedLines: number; rulesCount: number }>(`/fretes/importacoes/${id}`) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Relatório da importação</DialogTitle>
          <DialogDescription>{r.data?.fileName}</DialogDescription>
        </DialogHeader>
        {r.isLoading ? <TableSkeleton rows={4} /> : r.data && <IssuesSummary readLines={r.data.readLines} imported={r.data.importedLines} rejected={r.data.rejectedLines} rules={r.data.rulesCount} issues={r.data.report?.issues ?? []} issueCount={r.data.report?.issueCount ?? 0} />}
      </DialogContent>
    </Dialog>
  )
}

function IssuesSummary({ readLines, imported, rejected, rules, issues, issueCount }: { readLines: number; imported: number; rejected: number; rules: number; issues: Issue[]; issueCount: number }) {
  const [only, setOnly] = useState<'todos' | 'erro' | 'alerta'>('todos')
  const shown = issues.filter((i) => only === 'todos' || i.level === only)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          ['Linhas lidas', readLines, ''],
          ['Linhas importadas', imported, 'text-[#006300] dark:text-[#0ca30c]'],
          ['Linhas rejeitadas', rejected, rejected ? 'text-destructive' : ''],
          ['Regras geradas', rules, ''],
        ].map(([l, v, c]) => (
          <div key={l as string} className="rounded-md border p-2">
            <p className={cn('text-xl font-semibold tabular-nums', c as string)}>{(v as number).toLocaleString('pt-BR')}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      {issues.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span>{issueCount > issues.length ? `${issueCount} apontamentos (mostrando os ${issues.length} primeiros)` : `${issueCount} apontamento(s)`}</span>
            <Select value={only} onValueChange={(v) => setOnly(v as typeof only)}>
              <SelectTrigger size="sm" className="w-36" aria-label="Filtrar apontamentos">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="erro">Só erros</SelectItem>
                <SelectItem value="alerta">Só alertas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableBody>
                {shown.map((i, k) => (
                  <TableRow key={k}>
                    <TableCell className="w-20 text-xs">{i.line ? `Linha ${i.line}` : 'Geral'}</TableCell>
                    <TableCell className="w-20">
                      <Badge variant="outline" className={i.level === 'erro' ? 'border-destructive/50 text-destructive' : 'border-amber-500/50 text-amber-700 dark:text-amber-300'}>
                        {i.level === 'erro' ? 'Erro' : 'Alerta'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-normal">{i.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function ImportWizard({ table, onClose, onDone }: { table: FreightTable; onClose: () => void; onDone: (versionId: string) => void }) {
  const qc = useQueryClient()
  const ctx = useFreightContext()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [file, setFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [sheet, setSheet] = useState(0)
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [validation, setValidation] = useState<Validation | null>(null)
  const [result, setResult] = useState<{ versionId: string; rules: number; importedLines: number; rejectedLines: number } | null>(null)
  // Vigência da tabela informada pela transportadora: confirmada a cada importação.
  const [validFrom, setValidFrom] = useState(table.validFrom)
  const [validTo, setValidTo] = useState(table.validTo)

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('arquivo', file!)
      return api.post<Analysis>(`/fretes/tabelas/${table.id}/importacoes`, fd)
    },
    onSuccess: (a) => {
      setAnalysis(a)
      setSheet(a.suggested.sheet)
      setHeaderRow(a.suggested.headerRow)
      setMapping(a.suggested.mapping)
      setStep(2)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const suggest = useMutation({
    mutationFn: (p: { sheet: number; headerRow: number }) => api.post<{ headerRow: number; mapping: Mapping[] }>(`/fretes/importacoes/${analysis!.importId}/sugerir`, p),
    onSuccess: (r) => {
      setHeaderRow(r.headerRow)
      setMapping(r.mapping)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const validate = useMutation({
    mutationFn: () => api.post<Validation>(`/fretes/importacoes/${analysis!.importId}/validar`, { sheet, headerRow, mapping }),
    onSuccess: (v) => {
      setValidation(v)
      setStep(3)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const confirmImport = useMutation({
    mutationFn: () => api.post<{ versionId: string; rules: number; importedLines: number; rejectedLines: number }>(`/fretes/importacoes/${analysis!.importId}/confirmar`, { sheet, headerRow, mapping, validFrom, validTo }),
    onSuccess: (r) => {
      setResult(r)
      setStep(4)
      qc.invalidateQueries({ queryKey: ['fretes'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const close = () => {
    if (analysis && step < 4) void api.post(`/fretes/importacoes/${analysis.importId}/cancelar`).catch(() => undefined)
    onClose()
  }

  const preview = analysis?.sheets[sheet]?.preview ?? []
  const header = preview[headerRow - 1] ?? []
  const columns = Math.max(header.length, ...preview.slice(headerRow, headerRow + 5).map((r) => r.length))
  const samples = (c: number) =>
    preview
      .slice(headerRow, headerRow + 4)
      .map((r) => cellText(r[c] ?? null))
      .filter(Boolean)
  const vars = ctx.data?.catalog.ruleVariables ?? []
  const fields = ctx.data?.catalog.importFields ?? []
  const setCol = (column: number, patch: Partial<Mapping> | null) =>
    setMapping((prev) => {
      const rest = prev.filter((m) => m.column !== column)
      if (!patch) return rest
      const cur = prev.find((m) => m.column === column)
      return [...rest, { column, field: 'var:freight', ...cur, ...patch }].sort((a, b) => a.column - b.column)
    })
  const mapped = useMemo(() => new Map(mapping.map((m) => [m.column, m])), [mapping])

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Importar regras · {table.name}</DialogTitle>
          <DialogDescription>
            Passo {step} de 4: {['', 'enviar a planilha', 'dizer o que é cada coluna', 'conferir erros e alertas', 'concluído'][step]}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center hover:bg-muted/40">
              <FileSpreadsheetIcon className="size-10 text-muted-foreground" aria-hidden />
              <span className="font-medium">{file ? file.name : 'Escolha a planilha da transportadora'}</span>
              <span className="text-xs text-muted-foreground">Excel (.xlsx) ou CSV, até 20 MB. Excel antigo (.xls): salve como .xlsx antes.</span>
              <input type="file" className="sr-only" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
                {upload.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UploadIcon aria-hidden />} Enviar e ler
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && analysis && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              {analysis.sheets.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Aba</Label>
                  <Select value={String(sheet)} onValueChange={(v) => (setSheet(Number(v)), suggest.mutate({ sheet: Number(v), headerRow: 0 }))}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {analysis.sheets.map((s) => (
                        <SelectItem key={s.index} value={String(s.index)}>
                          {s.name} ({s.rowCount} linhas)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="w-header">Linha do cabeçalho</Label>
                <Input id="w-header" className="w-24" inputMode="numeric" value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} onBlur={() => suggest.mutate({ sheet, headerRow })} />
              </div>
              <Button variant="outline" onClick={() => suggest.mutate({ sheet, headerRow: 0 })} disabled={suggest.isPending}>
                <WandSparklesIcon aria-hidden /> Reconhecer de novo
              </Button>
              <p className="flex-1 text-xs text-muted-foreground">
                Para tabela com faixas de peso nas colunas ("Até 10 kg", "Até 20 kg"…), cada coluna de faixa vira uma regra por destino. Colunas sem mapeamento são ignoradas.
              </p>
            </div>

            <div className="max-h-56 overflow-auto rounded-md border text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1 text-left">#</th>
                    {Array.from({ length: columns }, (_, c) => (
                      <th key={c} className="px-2 py-1 text-left font-mono">
                        {colName(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, headerRow + 8).map((r, i) => (
                    <tr key={i} className={cn(i + 1 === headerRow && 'bg-primary/10 font-semibold', i + 1 < headerRow && 'text-muted-foreground')}>
                      <td className="px-2 py-0.5 text-muted-foreground">{i + 1}</td>
                      {Array.from({ length: columns }, (_, c) => (
                        <td key={c} className="max-w-40 truncate px-2 py-0.5">
                          {cellText(r[c] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Coluna</TableHead>
                    <TableHead>Título na planilha</TableHead>
                    <TableHead className="hidden md:table-cell">Exemplos</TableHead>
                    <TableHead className="w-72">Campo no sistema</TableHead>
                    <TableHead className="w-64">Faixa de peso (kg)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: columns }, (_, c) => {
                    const m = mapped.get(c)
                    const isVar = m?.field.startsWith('var:')
                    const code = isVar ? m!.field.slice(4) : ''
                    const known = !isVar || vars.some((v) => v.code === code)
                    const isBand = m?.weightMax !== undefined && m?.weightMax !== null
                    return (
                      <TableRow key={c} className={cn(!m && 'opacity-70')}>
                        <TableCell className="font-mono text-xs">{colName(c)}</TableCell>
                        <TableCell className="text-sm">{cellText(header[c] ?? null) || <span className="text-muted-foreground">(sem título)</span>}</TableCell>
                        <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground md:table-cell">{samples(c).join(' · ')}</TableCell>
                        <TableCell>
                          <Select
                            value={!m ? IGNORE : known ? m.field : OTHER}
                            onValueChange={(v) => {
                              if (v === IGNORE) return setCol(c, null)
                              if (v === OTHER) return setCol(c, { field: `var:${(cellText(header[c] ?? null) || `coluna_${colName(c)}`).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'v_$1').slice(0, 40) || 'outra'}` })
                              setCol(c, { field: v, ...(v.startsWith('var:') ? {} : { weightMin: null, weightMax: null }) })
                            }}
                          >
                            <SelectTrigger size="sm" className="w-full" aria-label={`Campo da coluna ${colName(c)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={IGNORE}>Ignorar</SelectItem>
                              {fields.map((f) => (
                                <SelectItem key={f.field} value={f.field}>
                                  {f.label}
                                </SelectItem>
                              ))}
                              {vars.map((v) => (
                                <SelectItem key={v.code} value={`var:${v.code}`}>
                                  {v.label} ({v.unit})
                                </SelectItem>
                              ))}
                              <SelectItem value={OTHER}>Outra variável (código próprio)</SelectItem>
                            </SelectContent>
                          </Select>
                          {isVar && !known && <Input aria-label="Código da variável" className="mt-1 h-7 font-mono text-xs" value={code} onChange={(e) => setCol(c, { field: `var:${e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40)}` })} />}
                        </TableCell>
                        <TableCell>
                          {isVar && (
                            <div className="flex items-center gap-2">
                              <Checkbox checked={isBand} onCheckedChange={(x) => setCol(c, x ? { weightMin: 0, weightMax: 10 } : { weightMin: null, weightMax: null })} aria-label="Esta coluna é uma faixa de peso" />
                              {isBand ? (
                                <>
                                  <Input aria-label="Peso inicial da faixa" className="h-7 w-20 text-xs" inputMode="decimal" defaultValue={fmtNum(m!.weightMin ?? 0)} onBlur={(e) => setCol(c, { weightMin: parseBr(e.target.value) ?? 0 })} />
                                  <span className="text-xs">a</span>
                                  <Input aria-label="Peso final da faixa" className="h-7 w-20 text-xs" inputMode="decimal" defaultValue={fmtNum(m!.weightMax)} onBlur={(e) => setCol(c, { weightMax: parseBr(e.target.value) })} />
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">vale para a linha toda</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button onClick={() => validate.mutate()} disabled={validate.isPending || !mapping.length}>
                {validate.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Validar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && validation && (
          <div className="space-y-4">
            <IssuesSummary readLines={validation.readLines} imported={validation.importedLines} rejected={validation.errorLines} rules={validation.rules} issues={validation.issues} issueCount={validation.issueCount} />
            <p className="text-sm">
              Valores encontrados: {validation.variables.map((v) => v.label).join(', ') || '—'}. UFs: {validation.ufs.join(', ') || '—'}.
            </p>
            {validation.sample.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Peso</TableHead>
                      <TableHead>Prazo</TableHead>
                      <TableHead>Valores</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validation.sample.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.line}</TableCell>
                        <TableCell className="text-xs">{r.cepStart !== null ? `${formatCep(r.cepStart)} a ${formatCep(r.cepEnd)}` : (r.city ?? `UF ${r.uf}`)}{r.uf && r.cepStart !== null ? ` · ${r.uf}` : ''}{r.restricted ? ' · restrição' : ''}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {fmtNum(r.weightMin)} a {r.weightMax === null ? '∞' : fmtNum(r.weightMax)}
                        </TableCell>
                        <TableCell className="text-xs">{r.deadlineDays ?? '—'}</TableCell>
                        <TableCell className="text-xs whitespace-normal">
                          {Object.entries(r.values)
                            .map(([k, v]) => `${k}: ${fmtNum(v, 4)}`)
                            .join(' · ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="w-from">Vigência inicial</Label>
                <Input id="w-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="w-to">Vigência final</Label>
                <Input id="w-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </div>
              <p className="flex-1 text-xs text-muted-foreground">Informe a vigência combinada com a transportadora para esta tabela. Ela vale para a tabela inteira e a mudança fica na auditoria.</p>
            </div>
            {validation.errorLines > 0 && (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangleIcon className="size-4" aria-hidden /> As linhas com erro ficam de fora. Para incluí-las, corrija a planilha e importe de novo (ou cadastre a regra à mão no rascunho).
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)}>
                Voltar ao mapeamento
              </Button>
              <Button onClick={() => confirmImport.mutate()} disabled={confirmImport.isPending || !validation.rules || !validFrom || !validTo || validTo < validFrom}>
                {confirmImport.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Importar {validation.rules.toLocaleString('pt-BR')} regra(s) no rascunho
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 4 && result && (
          <div className="space-y-4 text-center">
            <CheckCircle2Icon className="mx-auto size-12 text-[#006300]" aria-hidden />
            <p className="font-medium">
              {result.rules.toLocaleString('pt-BR')} regra(s) importada(s) de {result.importedLines} linha(s){result.rejectedLines ? `; ${result.rejectedLines} linha(s) rejeitada(s)` : ''}.
            </p>
            <p className="text-sm text-muted-foreground">Confira as regras e simule na aba Componentes. Depois publique a versão na aba Versões para valer nas cotações.</p>
            <DialogFooter>
              <Button
                onClick={() => {
                  onDone(result.versionId)
                  onClose()
                }}
              >
                Ver as regras
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
