import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, CheckCircle2Icon, FileSpreadsheetIcon, Loader2Icon, SearchCheckIcon, UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime, PageHeader, RequirePermission } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { int, useOptions } from '@/lib/atendimento'
import { gzipFile, type LeadStage, STAGE_LABEL, STAGES, useCustomFields } from '@/lib/leads'
import { FormError } from './auth/auth-layout'

const NONE = '__none__'

const BASE_TARGETS: { id: string; label: string }[] = [
  { id: 'email', label: 'E-mail' },
  { id: 'name', label: 'Nome' },
  { id: 'phone', label: 'Telefone' },
  { id: 'mobile', label: 'Celular / WhatsApp' },
  { id: 'company', label: 'Empresa' },
  { id: 'jobTitle', label: 'Cargo' },
  { id: 'city', label: 'Cidade' },
  { id: 'state', label: 'Estado' },
  { id: 'country', label: 'País' },
  { id: 'stage', label: 'Estágio no funil' },
  { id: 'owner', label: 'Responsável (e-mail do vendedor)' },
  { id: 'tags', label: 'Tags' },
  { id: 'emailOptIn', label: 'Aceita receber e-mail' },
  { id: 'origin', label: 'Origem' },
  { id: 'lastOpportunityAt', label: 'Data da última oportunidade' },
  { id: 'lastSaleAt', label: 'Data da última venda' },
  { id: 'lastSaleValue', label: 'Valor da última venda' },
]

interface Options {
  forceOwnerId?: string | null
  defaultOwnerId?: string | null
  defaultStage?: LeadStage
  addTags?: string[]
  discardTags?: string | null
  duplicates?: 'update' | 'skip'
  originId?: string | null
}

interface Upload {
  id: string
  fileName: string
  headers: string[]
  totalRows: number
  sample: string[][]
  mapping: Record<string, string>
  options: Options
  isRdExport: boolean
}

interface Report {
  total: number
  valid: number
  invalid: number
  toCreate: number
  toUpdate: number
  skipped: number
  duplicatedInFile: number
  stages: Record<string, number>
  tags: Record<string, number>
  optOut: number
  sales: number
  invalidRows: { line: number; reason: string }[]
  problemRows: { line: number; reason: string }[]
  problemsTotal: number
  created?: number
  updated?: number
  mergedInFile?: number
  atendimentosVinculados?: number
  leadsCriadosDeAtendimentos?: number
  erro?: string
}

interface ImportRow {
  id: string
  fileName: string
  status: string
  totalRows: number
  processed: number
  createdAt: string
  finishedAt: string | null
  report: Report | null
}

const STATUS: Record<string, string> = { ENVIADO: 'Enviado', ANALISADO: 'Analisado', PROCESSANDO: 'Importando', CONCLUIDO: 'Concluído', ERRO: 'Erro' }

export function LeadImportPage() {
  return (
    <RequirePermission module="leads" action="create">
      <ImportWizard />
    </RequirePermission>
  )
}

function ImportWizard() {
  const qc = useQueryClient()
  const options = useOptions()
  const fields = useCustomFields()
  const fileRef = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [opts, setOpts] = useState<Options>({})
  const [tagsText, setTagsText] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const history = useQuery({ queryKey: ['lead-imports'], queryFn: () => api.get<ImportRow[]>('/leads/importacoes') })

  const status = useQuery({
    queryKey: ['lead-import', runningId],
    queryFn: () => api.get<ImportRow>(`/leads/importacoes/${runningId}`),
    enabled: !!runningId,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'PROCESSANDO' ? false : 2000),
  })

  useEffect(() => {
    if (status.data && status.data.status !== 'PROCESSANDO') {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead-imports'] })
      void qc.invalidateQueries({ queryKey: ['lead-tags'] })
    }
  }, [status.data, qc])

  const send = async (file: File) => {
    setBusy('upload')
    setError(null)
    try {
      const form = new FormData()
      form.append('file', await gzipFile(file), /\.(xlsx|gz)$/i.test(file.name) ? file.name : `${file.name}.gz`)
      const res = await api.post<Upload>('/leads/importacoes', form)
      setUpload(res)
      setMapping(res.mapping)
      setOpts(res.options)
      setTagsText((res.options.addTags ?? []).join(', '))
      setReport(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const finalOptions = (): Options => ({ ...opts, addTags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) })

  const analyze = async () => {
    if (!upload) return
    setBusy('analyze')
    setError(null)
    try {
      setReport(await api.post<Report>(`/leads/importacoes/${upload.id}/analisar`, { mapping, options: finalOptions() }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    if (!upload) return
    setBusy('start')
    setError(null)
    try {
      await api.post(`/leads/importacoes/${upload.id}/executar`)
      setRunningId(upload.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const targets = [...BASE_TARGETS, ...(fields.data ?? []).filter((f) => f.active).map((f) => ({ id: `custom:${f.key}`, label: `${f.label} (personalizado)` }))]
  const sellers = options.data?.sellers.filter((s) => s.active) ?? []
  const run = status.data

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/leads">
          <ArrowLeftIcon /> Base de leads
        </Link>
      </Button>
      <PageHeader
        title="Importar leads"
        description="CSV, planilha do Excel (XLSX ou “Texto Unicode”) ou o export do RD Station. Nada é gravado antes da análise e da sua confirmação. Quem já está na base é atualizado, não duplicado."
      />

      {run ? (
        <Card>
          <CardHeader>
            <CardTitle>{run.status === 'PROCESSANDO' ? 'Importando…' : run.status === 'CONCLUIDO' ? 'Importação concluída' : 'A importação falhou'}</CardTitle>
            <CardDescription>{run.fileName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {run.status === 'PROCESSANDO' && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={run.processed} aria-valuemax={run.report?.valid ?? run.totalRows}>
                  <div className="h-full bg-[color:var(--brand)] transition-all" style={{ width: `${Math.min(100, (run.processed / Math.max(1, run.report?.valid ?? run.totalRows)) * 100)}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {int.format(run.processed)} de {int.format(run.report?.valid ?? run.totalRows)} linhas. Pode sair desta tela: a importação continua.
                </p>
              </div>
            )}
            {run.status === 'CONCLUIDO' && run.report && (
              <>
                <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                  <CheckCircle2Icon className="size-4 text-emerald-600" />
                  {int.format(run.report.created ?? 0)} lead(s) novos e {int.format(run.report.updated ?? 0)} atualizados.
                </p>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ['Novos', run.report.created],
                    ['Atualizados', run.report.updated],
                    ['Repetidos na planilha', run.report.mergedInFile],
                    ['Atendimentos vinculados', run.report.atendimentosVinculados],
                    ['Leads criados de atendimentos', run.report.leadsCriadosDeAtendimentos],
                    ['Linhas inválidas', run.report.invalid],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-md border p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{int.format((v as number) ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {run.status === 'ERRO' && <FormError message={run.report?.erro ?? 'Erro inesperado.'} />}
          </CardContent>
          {run.status !== 'PROCESSANDO' && (
            <CardFooter className="gap-2">
              <Button asChild>
                <Link to="/leads">Ver a base de leads</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRunningId(null)
                  setUpload(null)
                  setReport(null)
                }}
              >
                Importar outra planilha
              </Button>
            </CardFooter>
          )}
        </Card>
      ) : !upload ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <FileSpreadsheetIcon className="size-10 text-muted-foreground" />
            <p className="font-medium">Escolha o arquivo da planilha</p>
            <p className="max-w-md text-sm text-muted-foreground">A primeira linha precisa ter os títulos das colunas. Precisa haver ao menos a coluna de e-mail ou de telefone.</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv" hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy === 'upload'}>
              {busy === 'upload' ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {busy === 'upload' ? 'Enviando…' : 'Escolher arquivo'}
            </Button>
            <FormError message={error} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {upload.fileName}
                {upload.isRdExport && <Badge>Export do RD Station reconhecido</Badge>}
              </CardTitle>
              <CardDescription>
                {int.format(upload.totalRows)} linhas. Confira para qual campo do sistema vai cada coluna{upload.isRdExport ? ' (já preenchido pelo modelo do RD)' : ''}.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Coluna da planilha</TableHead>
                    <TableHead>Exemplo</TableHead>
                    <TableHead className="w-72 pr-6">Vai para</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upload.headers.map((h, i) => (
                    <TableRow key={h} className={mapping[h] === 'ignore' ? 'opacity-60' : undefined}>
                      <TableCell className="pl-6 font-medium">{h}</TableCell>
                      <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{upload.sample.map((r) => r[i]).filter(Boolean)[0] ?? '—'}</TableCell>
                      <TableCell className="pr-6">
                        <Select
                          value={mapping[h] ?? 'ignore'}
                          onValueChange={(v) => {
                            setMapping((m) => ({ ...m, [h]: v }))
                            setReport(null)
                          }}
                        >
                          <SelectTrigger size="sm" className="w-full" aria-label={`Destino da coluna ${h}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ignore">Não importar</SelectItem>
                            {targets.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Opções</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Quem já está na base (mesmo e-mail ou telefone)</Label>
                <RadioGroup value={opts.duplicates ?? 'update'} onValueChange={(v) => (setOpts({ ...opts, duplicates: v as 'update' | 'skip' }), setReport(null))} className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="update" /> Atualizar com os dados da planilha
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="skip" /> Manter como está
                  </label>
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="o-owner">Responsável de todos os leads</Label>
                <Select value={opts.forceOwnerId ?? NONE} onValueChange={(v) => (setOpts({ ...opts, forceOwnerId: v === NONE ? null : v }), setReport(null))}>
                  <SelectTrigger id="o-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Usar a coluna de responsável da planilha</SelectItem>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="o-stage">Estágio quando a planilha não informar</Label>
                <Select value={opts.defaultStage ?? 'LEAD'} onValueChange={(v) => (setOpts({ ...opts, defaultStage: v as LeadStage }), setReport(null))}>
                  <SelectTrigger id="o-stage" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="o-origin">Origem quando a planilha não informar</Label>
                <Select value={opts.originId ?? NONE} onValueChange={(v) => (setOpts({ ...opts, originId: v === NONE ? null : v }), setReport(null))}>
                  <SelectTrigger id="o-origin" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem origem</SelectItem>
                    {options.data?.origins.filter((x) => x.active).map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="o-tags">Adicionar tags a todos (separe por vírgula)</Label>
                <Input id="o-tags" value={tagsText} maxLength={300} placeholder="ex.: importado-rd" onChange={(e) => (setTagsText(e.target.value), setReport(null))} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="o-discard">Descartar tags que começam com</Label>
                <Input
                  id="o-discard"
                  value={(opts.discardTags ?? '').replace(/^\^/, '')}
                  maxLength={60}
                  placeholder="ex.: importacao-"
                  onChange={(e) => (setOpts({ ...opts, discardTags: e.target.value ? `^${e.target.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : null }), setReport(null))}
                />
              </div>
            </CardContent>
          </Card>

          {report && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SearchCheckIcon className="size-5" /> Resultado da análise
                </CardTitle>
                <CardDescription>Nada foi gravado ainda.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ['Novos leads', report.toCreate],
                    ['Serão atualizados', report.toUpdate],
                    ['Mantidos como estão', report.skipped],
                    ['Linhas inválidas', report.invalid],
                    ['Repetidos na planilha', report.duplicatedInFile],
                    ['Sem permissão de e-mail', report.optOut],
                    ['Com última venda', report.sales],
                    ['Avisos', report.problemsTotal],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-md border p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{int.format(v as number)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estágios</p>
                    <ul className="text-sm">
                      {Object.entries(report.stages).map(([s, n]) => (
                        <li key={s} className="flex justify-between">
                          <span>{STAGE_LABEL[s as LeadStage] ?? s}</span>
                          <span className="tabular-nums text-muted-foreground">{int.format(n)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
                    <ul className="text-sm">
                      {Object.entries(report.tags).length === 0 && <li className="text-muted-foreground">Nenhuma</li>}
                      {Object.entries(report.tags)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([t, n]) => (
                          <li key={t} className="flex justify-between">
                            <span>{t}</span>
                            <span className="tabular-nums text-muted-foreground">{int.format(n)}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
                {(report.invalidRows.length > 0 || report.problemRows.length > 0) && (
                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Ver linhas com problema</summary>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
                      {report.invalidRows.map((r) => (
                        <li key={`i${r.line}`}>Linha {r.line}: não importada — {r.reason}</li>
                      ))}
                      {report.problemRows.map((r) => (
                        <li key={`p${r.line}`}>Linha {r.line}: importada com aviso — {r.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            {report ? (
              <Button onClick={start} disabled={busy !== null || report.toCreate + report.toUpdate === 0}>
                {busy === 'start' && <Loader2Icon className="animate-spin" />}
                Importar {int.format(report.toCreate + report.toUpdate)} lead(s)
              </Button>
            ) : (
              <Button onClick={analyze} disabled={busy !== null}>
                {busy === 'analyze' ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />}
                Analisar
              </Button>
            )}
            <Button variant="outline" onClick={() => setUpload(null)} disabled={busy !== null}>
              Trocar arquivo
            </Button>
          </div>
        </div>
      )}

      {!!history.data?.length && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Importações anteriores</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Arquivo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="pr-6 text-right">Novos / atualizados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="max-w-64 truncate pl-6">{h.fileName}</TableCell>
                    <TableCell className="text-sm">{formatDateTime(h.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={h.status === 'ERRO' ? 'destructive' : 'outline'}>{STATUS[h.status] ?? h.status}</Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {h.report?.created !== undefined ? `${int.format(h.report.created)} / ${int.format(h.report.updated ?? 0)}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
