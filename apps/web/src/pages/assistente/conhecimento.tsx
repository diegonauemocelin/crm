import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, FileSpreadsheetIcon, Loader2Icon, PlusIcon, UploadIcon } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { BASE, Facts, Field, KNOWLEDGE_LABELS, Pager, QuestionLink, qs } from './comum'

interface KnowledgeRow {
  id: number
  title: string
  category: string
  brand: string | null
  model: string | null
  partCode: string | null
  product: string | null
  status: string
  version: number
  source: string | null
  updatedAt: string
  autoLearned: boolean
  mlItemId: string | null
  learnedFrom: string | null
  updatedByName: string | null
  createdByName: string | null
}
interface Knowledge extends KnowledgeRow {
  application: string | null
  question: string | null
  answer: string
  approvedByName: string | null
  approvedAt: string | null
  originQuestionId: number | null
}
interface KMeta {
  categories: string[]
  brands: string[]
  models: string[]
  statuses: string[]
}

const statusVariant = (s: string) => (s === 'ativo' ? 'secondary' : s === 'em_revisao' ? 'default' : 'outline')
const ORIGIN_LEARNED: Record<string, string> = { ia: 'aprendido da IA', atendente: 'aprendido do atendente', externa: 'aprendido do Mercado Livre', manual: 'aprendido' }

export function AssistenteConhecimentoPage() {
  return (
    <RequirePermission module="assist_conhecimento">
      <Conhecimento />
    </RequirePermission>
  )
}

function Conhecimento() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const meta = useQuery({ queryKey: ['assist-k-meta'], queryFn: () => api.get<KMeta>('/assistente/conhecimento/meta'), staleTime: 60_000 })
  const f = { q: params.get('q') ?? '', category: params.get('category') ?? '', status: params.get('status') ?? '', origin: params.get('origin') ?? '', model: params.get('model') ?? '', code: params.get('code') ?? '' }
  const [search, setSearch] = useState(f.q)
  const list = useQuery({ queryKey: ['assist-k', f, page], queryFn: () => api.get<{ rows: KnowledgeRow[]; total: number; pageSize: number; learned: number }>(`/assistente/conhecimento${qs({ ...f, page, pageSize: 25 })}`), placeholderData: keepPreviousData })
  const openId = Number(params.get('id')) || null
  const creating = params.get('novo') === '1'
  const fromQuestion = Number(params.get('pergunta')) || null
  const [editing, setEditing] = useState<Knowledge | null>(null)
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v && v !== 'todas') p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    if (!['id', 'novo', 'pergunta'].includes(k)) setPage(1)
  }
  const closeForm = () => {
    setEditing(null)
    const p = new URLSearchParams(params)
    p.delete('novo')
    p.delete('pergunta')
    setParams(p, { replace: true })
  }
  return (
    <div>
      <PageHeader
        title="Base de conhecimento"
        description="O que a IA pode usar nas respostas. Só o que está ativo vale; o que está em revisão espera aprovação."
        actions={
          <div className="flex gap-2">
            <Can module="assist_conhecimento" action="create">
              <Button variant="outline" asChild>
                <Link to={`${BASE}/conhecimento/importar`}>
                  <FileSpreadsheetIcon /> Importar planilha
                </Link>
              </Button>
              <Button onClick={() => set('novo', '1')}>
                <PlusIcon /> Novo conhecimento
              </Button>
            </Can>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={f.category || 'todas'} onValueChange={(v) => set('category', v)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {(meta.data?.categories ?? []).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.status || 'todas'} onValueChange={(v) => set('status', v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda situação</SelectItem>
            {Object.entries(KNOWLEDGE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={f.origin || 'todas'} onValueChange={(v) => set('origin', v)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Cadastrados e aprendidos</SelectItem>
            <SelectItem value="cadastrado">Cadastrados</SelectItem>
            <SelectItem value="aprendido">Aprendidos das respostas{list.data ? ` (${list.data.learned})` : ''}</SelectItem>
          </SelectContent>
        </Select>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set('q', search.trim())
          }}
        >
          <Input className="w-64" placeholder="Buscar título, pergunta, resposta, código" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error || !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.rows.length ? (
        <EmptyState title="Nenhum conhecimento" description="Cadastre, importe uma planilha ou deixe o assistente aprender com as respostas enviadas." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Título</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Máquina</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((k) => (
                <TableRow key={k.id} className="cursor-pointer" onClick={() => set('id', String(k.id))}>
                  <TableCell className="max-w-96 pl-4">
                    <p className="line-clamp-2 font-medium">{k.title}</p>
                    <p className="text-xs text-muted-foreground">
                      #{k.id} · versão {k.version}
                      {k.autoLearned && ` · ${ORIGIN_LEARNED[k.learnedFrom ?? 'manual'] ?? 'aprendido'}`}
                      {k.mlItemId && ` · só no anúncio ${k.mlItemId}`}
                    </p>
                  </TableCell>
                  <TableCell>{k.category}</TableCell>
                  <TableCell>{[k.brand, k.model].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell>{k.partCode ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(k.status)}>{KNOWLEDGE_LABELS[k.status] ?? k.status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(k.updatedAt)}
                    {k.updatedByName && <p className="text-xs text-muted-foreground">{k.updatedByName}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      {openId && !editing && <KnowledgeDetail id={openId} onClose={() => set('id', null)} onEdit={setEditing} />}
      {(creating || editing) && <KnowledgeForm meta={meta.data} initial={editing} fromQuestion={fromQuestion} onClose={closeForm} />}
    </div>
  )
}

function KnowledgeDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (k: Knowledge) => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['assist-k-detail', id], queryFn: () => api.get<{ knowledge: Knowledge; versions: { id: number; version: number; changeType: string; changedByName: string | null; changedAt: string }[]; usage: number; originQuestion: { id: number; text: string } | null }>(`/assistente/conhecimento/${id}`) })
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>, ok: string, close = false) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      void qc.invalidateQueries({ queryKey: ['assist-k'] })
      void qc.invalidateQueries({ queryKey: ['assist-k-detail', id] })
      if (close) onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const k = q.data?.knowledge
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{k ? k.title : 'Conhecimento'}</DialogTitle>
          {k && (
            <DialogDescription>
              #{k.id} · {k.category} · versão {k.version} · usado em {q.data?.usage ?? 0} resposta(s)
            </DialogDescription>
          )}
        </DialogHeader>
        {q.isLoading ? (
          <TableSkeleton rows={4} />
        ) : q.error || !k ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-4 text-sm">
            <Facts
              items={[
                ['Situação', <Badge key="s" variant={statusVariant(k.status)}>{KNOWLEDGE_LABELS[k.status] ?? k.status}</Badge>],
                ['Marca', k.brand],
                ['Modelo', k.model],
                ['Código', k.partCode],
                ['Produto', k.product],
                ['Aplicação', k.application],
                ['Fonte', k.source],
                ['Só no anúncio', k.mlItemId],
                ['Aprovado', k.approvedByName ? `${k.approvedByName} em ${formatDateTime(k.approvedAt)}` : null],
                ['Pergunta de origem', q.data!.originQuestion ? <QuestionLink key="o" id={q.data!.originQuestion.id} className="underline">{q.data!.originQuestion.text}</QuestionLink> : null],
              ]}
            />
            {k.question && (
              <div>
                <p className="font-medium">Pergunta</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{k.question}</p>
              </div>
            )}
            <div>
              <p className="font-medium">Resposta aprovada</p>
              <p className="whitespace-pre-wrap">{k.answer}</p>
            </div>
            <div>
              <p className="font-medium">Versões</p>
              <ul className="text-muted-foreground">
                {q.data!.versions.map((v) => (
                  <li key={v.id}>
                    Versão {v.version} · {v.changeType.replace(/_/g, ' ')} · {v.changedByName ?? 'sistema'} · {formatDateTime(v.changedAt)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {k && (
          <DialogFooter className="flex-wrap gap-2">
            {can('assist_conhecimento', 'delete') && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (await confirm({ title: 'Excluir este conhecimento?', description: 'Sai da base e a IA deixa de usar. O histórico das respostas que o usaram fica.', confirmLabel: 'Excluir conhecimento' })) await act(() => api.delete(`/assistente/conhecimento/${k.id}`), 'Conhecimento excluído.', true)
                }}
              >
                Excluir
              </Button>
            )}
            {can('assist_conhecimento', 'edit') && (
              <>
                {k.status !== 'ativo' && (
                  <Button variant="outline" disabled={busy} onClick={() => act(() => api.post(`/assistente/conhecimento/${k.id}/situacao`, { status: 'ativo' }), 'Conhecimento aprovado: a IA já pode usar.')}>
                    Aprovar e ativar
                  </Button>
                )}
                {k.status === 'ativo' && (
                  <Button variant="outline" disabled={busy} onClick={() => act(() => api.post(`/assistente/conhecimento/${k.id}/situacao`, { status: 'inativo' }), 'Conhecimento inativado.')}>
                    Inativar
                  </Button>
                )}
                <Button disabled={busy} onClick={() => onEdit(k)}>
                  Editar
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

const EMPTY = { title: '', category: '', brand: '', model: '', partCode: '', product: '', application: '', question: '', answer: '', source: '', status: 'em_revisao' }

function KnowledgeForm({ meta, initial, fromQuestion, onClose }: { meta?: KMeta; initial: Knowledge | null; fromQuestion: number | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canApprove = can('assist_conhecimento', 'edit')
  const [f, setF] = useState(() => (initial ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, String((initial as unknown as Record<string, unknown>)[k] ?? '')])) as typeof EMPTY : { ...EMPTY }))
  const [createApp, setCreateApp] = useState(true)
  const [saving, setSaving] = useState(false)
  const origin = useQuery({
    queryKey: ['assist-pergunta', String(fromQuestion)],
    queryFn: () => api.get<{ question: { text: string; brand: string | null; model: string | null; partCode: string | null }; item: { title: string | null } | null; attempts: { text: string; sendStatus: string }[] }>(`/assistente/perguntas/${fromQuestion}`),
    enabled: !!fromQuestion && !initial,
  })
  const filled = useRef(false)
  useEffect(() => {
    const d = origin.data
    if (!d || filled.current) return
    filled.current = true
    const sent = d.attempts.find((a) => a.sendStatus === 'enviada') ?? d.attempts[0]
    setF((cur) => ({ ...cur, question: d.question.text, answer: sent?.text.replace(/^(bom dia|boa tarde|boa noite|ol[aá]|oi)\s*[!,.]*\s*/i, '') ?? '', brand: d.question.brand ?? '', model: d.question.model ?? '', partCode: d.question.partCode ?? '', product: d.item?.title ?? '', source: `Pergunta #${fromQuestion}` }))
  }, [origin.data, fromQuestion])
  const up = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { ...f, originQuestionId: fromQuestion ?? undefined, createApplication: createApp }
      if (initial) await api.put(`/assistente/conhecimento/${initial.id}`, body)
      else {
        const r = await api.post<{ status: string }>('/assistente/conhecimento', body)
        if (r.status !== f.status) toast.info('Salvo como "em revisão": seu perfil não aprova conhecimento.')
      }
      toast.success('Conhecimento salvo.')
      void qc.invalidateQueries({ queryKey: ['assist-k'] })
      void qc.invalidateQueries({ queryKey: ['assist-k-detail'] })
      if (fromQuestion) void qc.invalidateQueries({ queryKey: ['assist-pergunta', String(fromQuestion)] })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{initial ? `Editar conhecimento #${initial.id}` : 'Novo conhecimento'}</DialogTitle>
            <DialogDescription>Compatibilidade só vale com a aplicação descrita e confirmada. Não escreva telefone, e-mail nem link de fora do Mercado Livre.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título">
              <Input value={f.title} maxLength={200} onChange={up('title')} placeholder="Gerado do produto e modelo se vazio" />
            </Field>
            <Field label="Categoria">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.categories ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Marca da máquina">
              <Input value={f.brand} onChange={up('brand')} />
            </Field>
            <Field label="Modelo da máquina">
              <Input value={f.model} onChange={up('model')} />
            </Field>
            <Field label="Código da peça">
              <Input value={f.partCode} onChange={up('partCode')} />
            </Field>
            <Field label="Produto">
              <Input value={f.product} onChange={up('product')} />
            </Field>
          </div>
          <Field label="Aplicação confirmada" hint="Ex.: Retroescavadeira JCB 3C, motor Perkins 1104.">
            <Input value={f.application} onChange={up('application')} />
          </Field>
          <Field label="Pergunta do cliente">
            <Textarea rows={2} value={f.question} onChange={up('question')} />
          </Field>
          <Field label="Resposta aprovada">
            <Textarea rows={5} value={f.answer} onChange={up('answer')} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fonte" hint="Catálogo, documento ou quem confirmou.">
              <Input value={f.source} onChange={up('source')} />
            </Field>
            <Field label="Situação">
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KNOWLEDGE_LABELS)
                    .filter(([k]) => canApprove || k !== 'ativo')
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {!initial && f.partCode && f.model && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createApp} onCheckedChange={(v) => setCreateApp(v === true)} /> Cadastrar também a aplicação peça × máquina
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !f.category || !f.answer.trim()}>
              {saving && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Importar planilha ----------

interface ImportRow {
  id: number
  rowNumber: number
  data: Record<string, string>
  action: string
  existing: Record<string, string | null> | null
  errors: string[] | null
  warnings: string[] | null
  decision: string
  result: string | null
}
interface ImportDetail {
  import: { id: number; filename: string; status: string; createdAt: string; userName: string | null; headerErrors: string[] | null; report: Report | null }
  rows: ImportRow[]
  summary: Record<string, number>
}
interface Report {
  total: number
  imported: number
  updated: number
  ignored: number
  errors: number
  errorDetails: { row: number; reasons: string[] }[]
}
const ACTION_LABELS: Record<string, string> = { novo: 'Novo', atualizacao: 'Atualização', identico: 'Idêntico', duplicado: 'Duplicado', erro: 'Erro' }
const COLS: [string, string][] = [
  ['category', 'Categoria'],
  ['brand', 'Marca'],
  ['model', 'Modelo'],
  ['part_code', 'Código'],
  ['product', 'Produto'],
  ['application', 'Aplicação'],
  ['question', 'Pergunta'],
  ['answer', 'Resposta'],
  ['source', 'Fonte'],
  ['status', 'Status'],
]
const EXISTING_KEY: Record<string, string> = { part_code: 'partCode' }

export function AssistenteImportarPage() {
  return (
    <RequirePermission module="assist_conhecimento" action="create">
      <Importar />
    </RequirePermission>
  )
}

function Importar() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const id = Number(params.get('id')) || null
  const history = useQuery({ queryKey: ['assist-imports'], queryFn: () => api.get<{ rows: { id: number; filename: string; createdAt: string; status: string; totalRows: number; imported: number; updated: number; ignored: number; errors: number; userName: string | null }[] }>('/assistente/importacoes') })
  const detail = useQuery({ queryKey: ['assist-import', id], queryFn: () => api.get<ImportDetail>(`/assistente/importacoes/${id}`), enabled: !!id })
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<ImportRow | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['assist-import', id] })
    void qc.invalidateQueries({ queryKey: ['assist-imports'] })
  }
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast.success(ok)
      refresh()
      return r
    } catch (err) {
      toast.error(errorMessage(err))
      return null
    } finally {
      setBusy(null)
    }
  }
  const upload = async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const r = (await run('upload', () => api.post<{ id: number; headerErrors: string[] }>('/assistente/importacoes', body))) as { id: number; headerErrors: string[] } | null
    if (r) setParams({ id: String(r.id) })
    if (fileRef.current) fileRef.current.value = ''
  }
  const d = detail.data
  const preview = d?.import.status === 'previa'
  const pendingUpdates = d?.rows.filter((r) => r.action === 'atualizacao' && r.decision === 'pendente').length ?? 0
  return (
    <div>
      <PageHeader
        title="Importar planilha da base de conhecimento"
        description="Envie um Excel no modelo. Antes de gravar, o CRM mostra o que é novo, o que atualiza um conhecimento existente, o que está duplicado e o que tem erro. Nada é apagado."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => api.download('/assistente/importacoes/modelo', 'modelo-base-conhecimento.xlsx').catch((err: unknown) => toast.error(errorMessage(err)))}>
              <DownloadIcon /> Baixar modelo
            </Button>
            <Button disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === 'upload' ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar planilha
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        }
      />
      {id && (
        <div className="mb-6 space-y-3">
          {detail.isLoading ? (
            <TableSkeleton />
          ) : detail.error || !d ? (
            <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {d.import.filename} {preview ? <Badge>Prévia</Badge> : <Badge variant="secondary">{d.import.status === 'confirmada' ? 'Confirmada' : 'Cancelada'}</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {Object.entries(d.summary)
                      .map(([k, v]) => `${v} ${(ACTION_LABELS[k] ?? k).toLowerCase()}`)
                      .join(' · ')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!!d.import.headerErrors?.length && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">{d.import.headerErrors.join(' ')}</p>}
                  {d.import.report && (
                    <p>
                      Resultado: {d.import.report.imported} importado(s), {d.import.report.updated} atualizado(s), {d.import.report.ignored} ignorado(s), {d.import.report.errors} com erro.
                    </p>
                  )}
                  {preview && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={!!busy || pendingUpdates > 0}
                        onClick={async () => {
                          const r = (await run('confirmar', () => api.post<{ report: Report }>(`/assistente/importacoes/${d.import.id}/confirmar`))) as { report: Report } | null
                          if (r) toast.success(`${r.report.imported} importado(s) e ${r.report.updated} atualizado(s).`)
                        }}
                      >
                        {busy === 'confirmar' && <Loader2Icon className="animate-spin" />} Confirmar importação
                      </Button>
                      {d.rows.some((r) => r.action === 'atualizacao') && (
                        <>
                          <Button variant="outline" disabled={!!busy} onClick={() => run('todas', () => api.post(`/assistente/importacoes/${d.import.id}/decidir-todas`, { decision: 'aceitar' }))}>
                            Aceitar todas as atualizações
                          </Button>
                          <Button variant="outline" disabled={!!busy} onClick={() => run('todas', () => api.post(`/assistente/importacoes/${d.import.id}/decidir-todas`, { decision: 'rejeitar' }))}>
                            Recusar todas
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        disabled={!!busy}
                        onClick={async () => {
                          if (await confirm({ title: 'Cancelar esta importação?', description: 'Nada da planilha será gravado.', confirmLabel: 'Cancelar importação' })) await run('cancelar', () => api.post(`/assistente/importacoes/${d.import.id}/cancelar`), 'Importação cancelada.')
                        }}
                      >
                        Cancelar
                      </Button>
                      {pendingUpdates > 0 && <span className="self-center text-muted-foreground">{pendingUpdates} atualização(ões) aguardando sua decisão.</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Linha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Conteúdo</TableHead>
                      <TableHead>Avisos</TableHead>
                      <TableHead>Decisão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="pl-4">{r.rowNumber}</TableCell>
                        <TableCell>
                          <Badge variant={r.action === 'erro' ? 'destructive' : r.action === 'novo' ? 'secondary' : 'outline'}>{ACTION_LABELS[r.action] ?? r.action}</Badge>
                        </TableCell>
                        <TableCell className="max-w-120">
                          <p className="font-medium">{[r.data.product, r.data.brand, r.data.model].filter(Boolean).join(' · ')}</p>
                          <p className="line-clamp-2 text-muted-foreground">{r.data.answer}</p>
                          {r.action === 'atualizacao' && r.existing && (
                            <div className="mt-1 rounded border p-2 text-xs">
                              <p className="font-medium">Muda em relação ao atual:</p>
                              {COLS.filter(([k]) => String(r.existing![EXISTING_KEY[k] ?? k] ?? '') !== String(r.data[k] ?? '') && k !== 'status').map(([k, label]) => (
                                <p key={k}>
                                  {label}: <s className="text-muted-foreground">{String(r.existing![EXISTING_KEY[k] ?? k] ?? '—')}</s> → {r.data[k] || '—'}
                                </p>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-72 text-xs">
                          {r.errors?.map((e) => (
                            <p key={e} className="text-destructive">
                              {e}
                            </p>
                          ))}
                          {r.warnings?.map((w) => (
                            <p key={w} className="text-muted-foreground">
                              {w}
                            </p>
                          ))}
                        </TableCell>
                        <TableCell>
                          {preview ? (
                            <div className="flex flex-wrap gap-1">
                              {['novo', 'atualizacao'].includes(r.action) && (
                                <>
                                  <Button size="sm" variant={r.decision === 'aceitar' || (r.action === 'novo' && r.decision === 'pendente') ? 'default' : 'outline'} disabled={!!busy} onClick={() => run(`d${r.id}`, () => api.put(`/assistente/importacoes/${d.import.id}/linhas/${r.id}`, { decision: 'aceitar' }))}>
                                    Aceitar
                                  </Button>
                                  <Button size="sm" variant={r.decision === 'rejeitar' ? 'default' : 'outline'} disabled={!!busy} onClick={() => run(`d${r.id}`, () => api.put(`/assistente/importacoes/${d.import.id}/linhas/${r.id}`, { decision: 'rejeitar' }))}>
                                    Recusar
                                  </Button>
                                </>
                              )}
                              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditRow(r)}>
                                Corrigir
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{r.result?.split(':')[0] ?? '—'}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importações anteriores</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {!history.data?.rows.length ? (
            <p className="px-6 text-sm text-muted-foreground">Nenhuma importação ainda.</p>
          ) : (
            <Table>
              <TableBody>
                {history.data.rows.map((h) => (
                  <TableRow key={h.id} className="cursor-pointer" onClick={() => setParams({ id: String(h.id) })}>
                    <TableCell className="pl-6 font-medium">{h.filename}</TableCell>
                    <TableCell>{h.status === 'previa' ? 'Prévia' : h.status === 'confirmada' ? 'Confirmada' : 'Cancelada'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.totalRows} linha(s) · {h.imported} importada(s) · {h.updated} atualizada(s) · {h.errors} erro(s)
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(h.createdAt)} · {h.userName ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {editRow && d && <RowEditor row={editRow} onClose={() => setEditRow(null)} onSave={(data) => run(`e${editRow.id}`, () => api.put(`/assistente/importacoes/${d.import.id}/linhas/${editRow.id}`, { data }), 'Linha corrigida.').then((r) => r && setEditRow(null))} />}
    </div>
  )
}

function RowEditor({ row, onClose, onSave }: { row: ImportRow; onClose: () => void; onSave: (d: Record<string, string>) => void }) {
  const [data, setData] = useState<Record<string, string>>({ ...row.data })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Corrigir a linha {row.rowNumber}</DialogTitle>
          <DialogDescription>A correção vale só para esta importação; a planilha original não muda.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {COLS.map(([k, label]) => (
            <Field key={k} label={label}>
              {k === 'answer' || k === 'question' ? <Textarea rows={3} value={data[k] ?? ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} /> : <Input value={data[k] ?? ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(data)}>Salvar correção</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
