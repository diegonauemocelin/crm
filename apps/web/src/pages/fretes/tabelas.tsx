import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, FilePlus2Icon, Loader2Icon, PlusIcon, SearchIcon, TableIcon, UploadIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { ComponentsTab } from '@/components/fretes/componentes'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { ImportsTab } from '@/components/fretes/importar'
import { RulesTab } from '@/components/fretes/regras'
import { MultiSelect } from '@/components/multi-select'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr } from '@/lib/format'
import { fmtNum, KIND_LABEL, LOAD_LABEL, parseBr, PERSON_LABEL, STATUS_LABEL, USAGE_LABEL, useActiveUnit, useFreightContext, VALIDITY, VERSION_STATUS } from '@/lib/fretes'
import { cn } from '@/lib/utils'

export interface FreightTable {
  id: string
  carrier: { id: string; name: string; cnpj: string; active: boolean }
  name: string
  quoteName: string | null
  kind: string
  status: string
  modal: string
  validFrom: string
  validTo: string
  validity: { state: 'VIGENTE' | 'VENCIDA' | 'FUTURA'; days: number }
  unitIds: string[]
  goodsTypes: string[]
  personType: string
  usage: string
  weightMin: number | null
  weightMax: number | null
  valueMin: number | null
  valueMax: number | null
  loadType: string
  dispatchDays: number | null
  serviceCode: string | null
  partner: string | null
  notes: string | null
  publishedVersionId: string | null
  createdAt: string
  updatedAt: string
}
export interface VersionRow {
  id: string
  number: number
  status: string
  source: string
  note: string | null
  rulesCount: number
  createdByName: string | null
  createdAt: string
  publishedAt: string | null
  publishedByName: string | null
}
type TableDetail = FreightTable & { versions: VersionRow[] }
type TableListRow = FreightTable & { published: { id: string; number: number; rulesCount: number } | null; draft: { number: number } | null }

export function FretesTabelasPage() {
  return (
    <RequirePermission module="fretes_tabelas">
      <TableList />
    </RequirePermission>
  )
}

function TableList() {
  const active = useActiveUnit()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('busca') ?? '')
  const validity = params.get('vigencia') ?? '__all__'
  const status = params.get('situacao') ?? '__all__'
  const carrier = params.get('transportadora') ?? '__all__'
  const qs = new URLSearchParams()
  if (params.get('busca')) qs.set('busca', params.get('busca')!)
  if (validity !== '__all__') qs.set('vigencia', validity)
  if (status !== '__all__') qs.set('situacao', status)
  if (carrier !== '__all__') qs.set('transportadora', carrier)
  if (active.unitId) qs.set('filial', active.unitId)
  const list = useQuery({ queryKey: ['fretes', 'tabelas', qs.toString()], queryFn: () => api.get<TableListRow[]>(`/fretes/tabelas?${qs}`), enabled: !!active.ctx.data })
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v === '__all__' || !v) p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }
  const units = active.ctx.data?.units ?? []
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tabelas de frete"
        description="Tabelas negociadas com cada transportadora. Os valores ficam em versões: a publicada calcula; alterar cria uma nova versão e as anteriores ficam guardadas."
        actions={
          <>
            <FilialSwitch active={active} />
            <Can module="fretes_tabelas" action="create">
              <Button asChild>
                <Link to="/fretes/tabelas/nova">
                  <PlusIcon aria-hidden /> Nova tabela
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          set('busca', search.trim())
        }}
      >
        <div className="relative min-w-60 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Nome, transportadora ou código de serviço" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={validity} onValueChange={(v) => set('vigencia', v)}>
          <SelectTrigger className="w-44" aria-label="Vigência">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Qualquer vigência</SelectItem>
            <SelectItem value="VIGENTE">Vigentes</SelectItem>
            <SelectItem value="A_VENCER">Vencem em 30 dias</SelectItem>
            <SelectItem value="VENCIDA">Vencidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => set('situacao', v)}>
          <SelectTrigger className="w-40" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Toda situação</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={carrier} onValueChange={(v) => set('transportadora', v)}>
          <SelectTrigger className="w-52" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as transportadoras</SelectItem>
            {active.ctx.data?.carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {list.isLoading || active.ctx.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={TableIcon} title="Nenhuma tabela de frete" description="Cadastre a tabela e importe a planilha que a transportadora enviou." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tabela</TableHead>
              <TableHead>Transportadora</TableHead>
              <TableHead>Vigência</TableHead>
              <TableHead className="hidden md:table-cell">Filiais</TableHead>
              <TableHead className="hidden lg:table-cell">Versão</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map((t) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate(`/fretes/tabelas/${t.id}`)}>
                <TableCell>
                  <Link to={`/fretes/tabelas/${t.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>
                    {t.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABEL[t.kind]} · {LOAD_LABEL[t.loadType]} · {PERSON_LABEL[t.personType]}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{t.carrier.name}</TableCell>
                <TableCell className="text-sm">
                  {dayBr(t.validFrom)} a {dayBr(t.validTo)}
                  <Badge variant="outline" className={cn('ml-1', VALIDITY[t.validity.state].className)}>
                    {VALIDITY[t.validity.state].label}
                    {t.validity.state === 'VIGENTE' && t.validity.days <= 30 ? ` · ${t.validity.days} dias` : ''}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{t.unitIds.length ? t.unitIds.map((id) => units.find((u) => u.id === id)?.name ?? '—').join(', ') : 'Todas'}</TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  {t.published ? `v${t.published.number} · ${t.published.rulesCount} regras` : 'Nenhuma publicada'}
                  {t.draft && <span className="block text-xs text-amber-700 dark:text-amber-300">Rascunho v{t.draft.number}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{STATUS_LABEL[t.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// ─────────── Detalhe ───────────

export function FretesTabelaPage() {
  return (
    <RequirePermission module="fretes_tabelas">
      <TableDetailView />
    </RequirePermission>
  )
}

function TableDetailView() {
  const { id } = useParams()
  const isNew = id === 'nova'
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') ?? (isNew ? 'dados' : 'regras')
  const t = useQuery({ queryKey: ['fretes', 'tabela', id], queryFn: () => api.get<TableDetail>(`/fretes/tabelas/${id}`), enabled: !isNew })
  const versions = t.data?.versions ?? []
  const defaultVersion = versions.find((v) => v.status === 'RASCUNHO') ?? versions.find((v) => v.id === t.data?.publishedVersionId) ?? versions[0]
  const versionId = params.get('versao') && versions.some((v) => v.id === params.get('versao')) ? params.get('versao')! : defaultVersion?.id
  const version = versions.find((v) => v.id === versionId)
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    p.set(k, v)
    setParams(p, { replace: true })
  }

  if (isNew) {
    return (
      <div className="space-y-4">
        <PageHeader title="Nova tabela de frete" description="Depois de salvar, importe a planilha da transportadora (vira a versão 1 em rascunho) e publique." />
        <TableForm />
      </div>
    )
  }
  if (t.isLoading) return <TableSkeleton />
  if (t.error || !t.data) return <ErrorState error={t.error} onRetry={() => t.refetch()} />
  const d = t.data
  return (
    <div className="space-y-4">
      <PageHeader
        title={d.name}
        description={`${d.carrier.name} · ${dayBr(d.validFrom)} a ${dayBr(d.validTo)} · ${STATUS_LABEL[d.status]}`}
        actions={
          versions.length > 0 && (
            <Select value={versionId} onValueChange={(v) => setParam('versao', v)}>
              <SelectTrigger className="w-72" aria-label="Versão">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    Versão {v.number} · {VERSION_STATUS[v.status]?.label} · {v.rulesCount} regras
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      {d.validity.state === 'VENCIDA' && d.status === 'ATIVA' && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="size-4 text-destructive" aria-hidden /> Tabela vencida há {d.validity.days} dia(s): não entra nas cotações sem liberação justificada. Atualize a vigência ou importe a tabela nova.
        </p>
      )}
      {!d.publishedVersionId && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          Nenhuma versão publicada: a tabela ainda não entra nas cotações. Importe as regras na aba <b>Histórico de Importação</b> e publique em <b>Versões</b>.
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setParam('aba', v)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="regras">
            Regras{' '}
            <Badge variant="destructive" className="ml-1">
              {version?.rulesCount ?? 0}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="importacao">Histórico de Importação</TabsTrigger>
          <TabsTrigger value="componentes">Componentes</TabsTrigger>
          <TabsTrigger value="versoes">Versões</TabsTrigger>
          <TabsTrigger value="dados">Dados da tabela</TabsTrigger>
        </TabsList>
        <TabsContent value="regras">{version ? <RulesTab table={d} version={version} /> : <EmptyState title="Sem versão" />}</TabsContent>
        <TabsContent value="importacao">
          <ImportsTab table={d} onImported={(vid) => (setParam('versao', vid), setParam('aba', 'regras'))} />
        </TabsContent>
        <TabsContent value="componentes">{version ? <ComponentsTab table={d} version={version} /> : <EmptyState title="Sem versão" />}</TabsContent>
        <TabsContent value="versoes">
          <VersionsTab table={d} onOpen={(vid) => setParam('versao', vid)} />
        </TabsContent>
        <TabsContent value="dados">
          <TableForm table={d} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function VersionsTab({ table, onOpen }: { table: TableDetail; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const refresh = () => qc.invalidateQueries({ queryKey: ['fretes'] })
  const draft = table.versions.find((v) => v.status === 'RASCUNHO')
  const act = useMutation({
    mutationFn: (a: { kind: 'publicar' | 'descartar' | 'nova'; id?: string }) =>
      a.kind === 'nova' ? api.post<{ id: string }>(`/fretes/tabelas/${table.id}/versoes`, {}) : api.post<{ id: string }>(`/fretes/tabelas/${table.id}/versoes/${a.id}/${a.kind}`),
    onSuccess: (r, a) => {
      refresh()
      toast.success(a.kind === 'publicar' ? 'Versão publicada: as próximas cotações já usam estes valores.' : a.kind === 'descartar' ? 'Rascunho descartado.' : 'Rascunho criado a partir da versão publicada.')
      if (a.kind === 'nova') onOpen(r.id)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Versão publicada não muda. Para alterar valores, componentes ou parâmetros, crie um rascunho, confira com o simulador e publique.</p>
          {!draft && can('fretes_tabelas', 'edit') && (
            <Button variant="outline" onClick={() => act.mutate({ kind: 'nova' })} disabled={act.isPending}>
              <FilePlus2Icon aria-hidden /> Nova versão (rascunho)
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Versão</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Regras</TableHead>
              <TableHead>Criada</TableHead>
              <TableHead>Publicada</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpen(v.id)}>
                    v{v.number}
                  </button>
                  {v.note && <span className="block text-xs text-muted-foreground">{v.note}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={VERSION_STATUS[v.status]?.className}>
                    {VERSION_STATUS[v.status]?.label ?? v.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{{ MANUAL: 'Cadastro', IMPORTACAO: 'Importação', COPIA: 'Cópia' }[v.source] ?? v.source}</TableCell>
                <TableCell className="text-right tabular-nums">{v.rulesCount}</TableCell>
                <TableCell className="text-sm">
                  {dateTime(v.createdAt)}
                  <span className="block text-xs text-muted-foreground">{v.createdByName}</span>
                </TableCell>
                <TableCell className="text-sm">
                  {v.publishedAt ? dateTime(v.publishedAt) : '—'}
                  {v.publishedByName && <span className="block text-xs text-muted-foreground">{v.publishedByName}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {v.status === 'RASCUNHO' && (
                    <div className="flex justify-end gap-2">
                      <Can module="fretes_tabelas" action="edit">
                        <Button
                          size="sm"
                          disabled={act.isPending || !v.rulesCount}
                          onClick={async () => {
                            if (await confirm({ title: `Publicar a versão ${v.number}?`, description: 'A versão publicada passa a calcular as cotações na hora. A anterior fica guardada como substituída e as cotações antigas continuam reproduzíveis.', confirmLabel: 'Publicar', destructive: false }))
                              act.mutate({ kind: 'publicar', id: v.id })
                          }}
                        >
                          Publicar
                        </Button>
                      </Can>
                      <Can module="fretes_tabelas" action="delete">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={async () => {
                            if (await confirm({ title: `Descartar o rascunho v${v.number}?`, description: 'As regras deste rascunho são apagadas. A versão publicada não muda.', confirmLabel: 'Descartar', destructive: true })) act.mutate({ kind: 'descartar', id: v.id })
                          }}
                        >
                          Descartar
                        </Button>
                      </Can>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─────────── Formulário (como na tela de referência) ───────────

function SectionTitle({ children }: { children: string }) {
  return <h2 className="border-t pt-5 text-base font-semibold first:border-0 first:pt-0">{children}</h2>
}

function TableForm({ table }: { table?: TableDetail }) {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const editable = table ? can('fretes_tabelas', 'edit') : can('fretes_tabelas', 'create')
  const carriers = useQuery({ queryKey: ['fretes', 'transportadoras', 'todas'], queryFn: () => api.get<{ id: string; name: string; cnpj: string; active: boolean }[]>('/fretes/transportadoras') })
  const [f, setF] = useState(() => ({
    kind: table?.kind ?? 'VENDA',
    status: table?.status ?? 'RASCUNHO',
    carrierId: table?.carrier.id ?? '',
    name: table?.name ?? '',
    quoteName: table?.quoteName ?? '',
    modal: table?.modal ?? 'RODOVIARIO',
    validFrom: table?.validFrom ?? '',
    validTo: table?.validTo ?? '',
    goodsTypes: table?.goodsTypes ?? ['Geral'],
    personType: table?.personType ?? 'AMBOS',
    usage: table?.usage ?? 'COTACAO_CONCILIACAO',
    weightMin: fmtNum(table?.weightMin ?? null),
    weightMax: fmtNum(table?.weightMax ?? null),
    valueMin: fmtNum(table?.valueMin ?? null, 2),
    valueMax: fmtNum(table?.valueMax ?? null, 2),
    loadType: table?.loadType ?? 'FRACIONADA',
    dispatchDays: table?.dispatchDays?.toString() ?? '',
    unitIds: table?.unitIds ?? [],
    partner: table?.partner ?? '',
    serviceCode: table?.serviceCode ?? '',
    notes: table?.notes ?? '',
  }))
  useEffect(() => {
    if (!table && carriers.data?.length === 1 && !f.carrierId) setF((x) => ({ ...x, carrierId: carriers.data![0]!.id }))
  }, [carriers.data, table, f.carrierId])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const days = f.validTo ? Math.round((new Date(`${f.validTo}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000) : null

  const save = useMutation({
    mutationFn: () => {
      const n = (s: string) => {
        const v = parseBr(s)
        if (Number.isNaN(v)) throw new Error('Confira os números de peso e valor.')
        return v
      }
      const body = {
        ...f,
        quoteName: f.quoteName || null,
        weightMin: n(f.weightMin),
        weightMax: n(f.weightMax),
        valueMin: n(f.valueMin),
        valueMax: n(f.valueMax),
        dispatchDays: f.dispatchDays ? Number(f.dispatchDays) : null,
        partner: f.partner || null,
        serviceCode: f.serviceCode || null,
        notes: f.notes || null,
      }
      return table ? api.put<TableDetail>(`/fretes/tabelas/${table.id}`, body) : api.post<TableDetail>('/fretes/tabelas', body)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(table ? 'Tabela salva.' : 'Tabela criada. Agora importe a planilha da transportadora.')
      if (!table) navigate(`/fretes/tabelas/${r.id}?aba=importacao`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const cat = ctx.data?.catalog
  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={!editable} className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <ToggleGroup type="single" variant="outline" value={f.kind} onValueChange={(v) => v && set('kind', v)}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => (
                    <ToggleGroupItem key={k} value={k}>
                      {v}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="space-y-1.5">
                <Label>Situação</Label>
                <ToggleGroup type="single" variant="outline" value={f.status} onValueChange={(v) => v && set('status', v)}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <ToggleGroupItem key={k} value={k} disabled={k === 'ATIVA' && !table?.publishedVersionId}>
                      {v}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <SectionTitle>Identificação</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-carrier">Transportadora *</Label>
                <Select value={f.carrierId} onValueChange={(v) => set('carrierId', v)}>
                  <SelectTrigger id="t-carrier" className="w-full">
                    <SelectValue placeholder={carriers.data?.length === 0 ? 'Cadastre a transportadora antes' : 'Selecione'} />
                  </SelectTrigger>
                  <SelectContent>
                    {carriers.data?.filter((c) => c.active || c.id === f.carrierId).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Nome da tabela *</Label>
                <Input id="t-name" required value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={160} placeholder="Ex.: Alfa Transportes 2026/1 (PF - Até 150 kg)" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-quote">Nome de apresentação na cotação</Label>
                <Input id="t-quote" value={f.quoteName} onChange={(e) => set('quoteName', e.target.value)} maxLength={120} placeholder="Vazio = nome da transportadora" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-modal">Modal *</Label>
                <Select value={f.modal} onValueChange={(v) => set('modal', v)}>
                  <SelectTrigger id="t-modal" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cat?.modals.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="t-from">Vigência inicial *</Label>
                  <Input id="t-from" type="date" required value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-to">Vigência final *</Label>
                  <Input id="t-to" type="date" required value={f.validTo} onChange={(e) => set('validTo', e.target.value)} />
                </div>
              </div>
              <div className="flex items-end">
                {days !== null && (
                  <Badge variant="outline" className={days < 0 ? VALIDITY.VENCIDA.className : VALIDITY.VIGENTE.className}>
                    {days < 0 ? `Vencida há ${-days} dias` : `Faltam ${days} dias para finalizar`}
                  </Badge>
                )}
              </div>
            </div>

            <SectionTitle>Onde a tabela vale</SectionTitle>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-1">
                <Label htmlFor="t-goods">Tipo de mercadoria</Label>
                <MultiSelect id="t-goods" items={(cat?.goodsTypes ?? []).map((g) => ({ id: g, name: g }))} value={f.goodsTypes} onChange={(v) => set('goodsTypes', v)} placeholder="Qualquer" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-person">Tipo pessoa</Label>
                <Select value={f.personType} onValueChange={(v) => set('personType', v)}>
                  <SelectTrigger id="t-person" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERSON_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-usage">Utilizada em *</Label>
                <Select value={f.usage} onValueChange={(v) => set('usage', v)}>
                  <SelectTrigger id="t-usage" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(USAGE_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Peso inicial e final (kg)</Label>
                <div className="flex items-center gap-2">
                  <Input aria-label="Peso inicial" inputMode="decimal" value={f.weightMin} onChange={(e) => set('weightMin', e.target.value)} />
                  <span className="text-sm text-muted-foreground">até</span>
                  <Input aria-label="Peso final" inputMode="decimal" value={f.weightMax} onChange={(e) => set('weightMax', e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Valor inicial e final (R$)</Label>
                <div className="flex items-center gap-2">
                  <Input aria-label="Valor inicial" inputMode="decimal" value={f.valueMin} onChange={(e) => set('valueMin', e.target.value)} />
                  <span className="text-sm text-muted-foreground">até</span>
                  <Input aria-label="Valor final" inputMode="decimal" value={f.valueMax} onChange={(e) => set('valueMax', e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-load">Tabela de carga</Label>
                <Select value={f.loadType} onValueChange={(v) => set('loadType', v)}>
                  <SelectTrigger id="t-load" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LOAD_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-units">Filiais de origem</Label>
                <MultiSelect id="t-units" items={(ctx.data?.units ?? []).map((u) => ({ id: u.id, name: u.name, active: u.active }))} value={f.unitIds} onChange={(v) => set('unitIds', v)} placeholder="Todas as filiais" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-dispatch">Expedição (dias úteis)</Label>
                <Input id="t-dispatch" inputMode="numeric" value={f.dispatchDays} onChange={(e) => set('dispatchDays', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="Padrão da empresa (0)" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-service">Código de serviço</Label>
                <Input id="t-service" value={f.serviceCode} onChange={(e) => set('serviceCode', e.target.value)} maxLength={40} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="t-partner">Tabela exclusiva para integração/parceiro</Label>
                <Input id="t-partner" value={f.partner} onChange={(e) => set('partner', e.target.value)} maxLength={80} placeholder="Vazio = todos (ex.: Mercado Livre, loja virtual)" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-notes">Observações</Label>
              <Textarea id="t-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} />
            </div>
            <p className="text-xs text-muted-foreground">Cobrança do ICMS, fator de cubagem e componentes ficam na versão (aba Componentes): assim cada cotação guarda exatamente as regras da época.</p>
          </fieldset>
          {editable && (
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => (table ? window.location.reload() : navigate('/fretes/tabelas'))}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending || !f.carrierId} className="bg-[#006300] text-white hover:bg-[#006300]/90">
                {save.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : table ? null : <UploadIcon aria-hidden />} Salvar
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
