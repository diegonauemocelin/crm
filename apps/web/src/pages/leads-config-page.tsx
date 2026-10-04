import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int, UF_LIST } from '@/lib/atendimento'
import { type CustomField, FIELD_TYPE_LABEL, STAGE_LABEL, STAGES, useCustomFields, useTags } from '@/lib/leads'
import { FormError } from './auth/auth-layout'

export function LeadsConfigPage() {
  return (
    <RequirePermission module="configuracoes" action="edit">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/leads">
          <ArrowLeftIcon /> Base de leads
        </Link>
      </Button>
      <PageHeader title="Configurar leads" description="Campos personalizados, lead scoring e tags." />
      <Tabs defaultValue="campos">
        <TabsList className="mb-4">
          <TabsTrigger value="campos">Campos personalizados</TabsTrigger>
          <TabsTrigger value="scoring">Lead scoring</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="campos">
          <FieldsTab />
        </TabsContent>
        <TabsContent value="scoring">
          <ScoringTab />
        </TabsContent>
        <TabsContent value="tags">
          <TagsTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

// ---------- Campos personalizados ----------

function FieldsTab() {
  const q = useCustomFields()
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null)
  if (q.isLoading) return <TableSkeleton rows={3} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Campos personalizados</CardTitle>
          <CardDescription className="mt-1.5">Aparecem na ficha do lead, na importação de planilhas e no lead scoring (e, nas próximas etapas, em formulários e segmentações).</CardDescription>
        </div>
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> Novo campo
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {q.data?.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">Nenhum campo ainda. Exemplos: “Segmento” (lista), “Tamanho da frota” (número), “Data da próxima revisão” (data).</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Campo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Opções</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12 pr-6">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.map((f) => (
                <TableRow key={f.id} className={f.active ? undefined : 'opacity-60'}>
                  <TableCell className="pl-6">
                    <p className="font-medium">{f.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{f.key}</p>
                  </TableCell>
                  <TableCell className="text-sm">{FIELD_TYPE_LABEL[f.type]}</TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">{f.options.join(', ') || '—'}</TableCell>
                  <TableCell>{f.active ? <Badge variant="outline">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                  <TableCell className="pr-6">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(f)} aria-label={`Editar ${f.label}`}>
                      <PencilIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && <FieldDialog field={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function FieldDialog({ field, onClose }: { field: CustomField | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<CustomField['type']>(field?.type ?? 'TEXT')
  const [options, setOptions] = useState((field?.options ?? []).join('\n'))
  const [active, setActive] = useState(field?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const isList = type === 'SELECT' || type === 'MULTISELECT'

  const save = useMutation({
    mutationFn: () => {
      const body = { label, type, options: isList ? options.split('\n').map((o) => o.trim()).filter(Boolean) : [], active }
      return field ? api.put(`/leads/config/campos/${field.id}`, body) : api.post('/leads/config/campos', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-fields'] })
      toast.success(field ? 'Campo atualizado.' : 'Campo criado.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{field ? 'Editar campo' : 'Novo campo personalizado'}</DialogTitle>
            {field && <DialogDescription>O tipo não muda depois de criado, para não invalidar os valores já gravados.</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="f-label">Nome do campo</Label>
            <Input id="f-label" required minLength={2} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-type">Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as CustomField['type'])} disabled={!!field}>
              <SelectTrigger id="f-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FIELD_TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isList && (
            <div className="space-y-2">
              <Label htmlFor="f-options">Opções (uma por linha)</Label>
              <Textarea id="f-options" rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
            </div>
          )}
          {field && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Campo ativo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || label.trim().length < 2}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Lead scoring ----------

interface Rule {
  id: string
  dimension: 'PERFIL' | 'INTERESSE'
  name: string
  field: string
  operator: string
  value: unknown
  points: number
  active: boolean
}

interface ScoreSettings {
  interestWindowDays: number
  gradeA: number
  gradeB: number
  gradeC: number
  maxProfile: number
  maxInterest: number
}

const EVENT_LABEL: Record<string, string> = {
  conversao: 'Cada conversão (formulário, LP, WhatsApp)',
  atendimento: 'Cada atendimento de Pré/Pós-Vendas',
  venda: 'Cada venda',
  email_aberto: 'Cada e-mail aberto',
  email_clique: 'Cada clique em e-mail',
  visita: 'Cada visita ao site',
}

function describe(r: Rule, fields: CustomField[]) {
  if (r.dimension === 'INTERESSE') return EVENT_LABEL[r.field] ?? r.field
  const v = r.value
  if (r.field === 'stage') return `Estágio é ${STAGE_LABEL[v as keyof typeof STAGE_LABEL] ?? v}`
  if (r.field === 'tag') return `Tem a tag “${v}”`
  if (r.field === 'has_phone') return 'Tem telefone'
  if (r.field === 'has_email') return 'Tem e-mail'
  if (r.field === 'state') return `Estado é ${Array.isArray(v) ? v.join(', ') : v}`
  if (r.field.startsWith('custom:')) {
    const f = fields.find((x) => x.key === r.field.slice(7))
    return `${f?.label ?? r.field} ${r.operator === 'exists' ? 'preenchido' : `= ${Array.isArray(v) ? v.join(', ') : v}`}`
  }
  return r.field
}

function ScoringTab() {
  const qc = useQueryClient()
  const fields = useCustomFields()
  const q = useQuery({ queryKey: ['lead-scoring'], queryFn: () => api.get<{ rules: Rule[]; settings: ScoreSettings }>('/leads/config/scoring') })
  const [settings, setSettings] = useState<ScoreSettings | null>(null)
  const [editing, setEditing] = useState<Rule | 'PERFIL' | 'INTERESSE' | null>(null)

  const saveSettings = useMutation({
    mutationFn: (s: ScoreSettings) => api.put('/leads/config/scoring', { ...s }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-scoring'] })
      toast.success('Faixas salvas. As notas serão recalculadas em instantes.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/leads/config/scoring/regras/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead-scoring'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (q.isLoading) return <TableSkeleton rows={5} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const s = settings ?? q.data!.settings
  const setS = (k: keyof ScoreSettings, v: number) => setSettings({ ...s, [k]: v })

  const tableProps = { rules: q.data!.rules, fields: fields.data ?? [], onEdit: setEditing, onAdd: setEditing, onRemove: (id: string) => remove.mutate(id) }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Como a nota é calculada</CardTitle>
          <CardDescription>
            Nota = pontos de perfil (quanto o lead se parece com o cliente ideal) + pontos de interesse (o que ele fez nos últimos {s.interestWindowDays} dias). Interações mais antigas que a janela deixam de contar.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['gradeA', 'Nota A a partir de'],
              ['gradeB', 'Nota B a partir de'],
              ['gradeC', 'Nota C a partir de'],
              ['interestWindowDays', 'Janela de interesse (dias)'],
              ['maxProfile', 'Teto de perfil'],
              ['maxInterest', 'Teto de interesse'],
            ] as [keyof ScoreSettings, string][]
          ).map(([k, label]) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`s-${k}`} className="text-xs">
                {label}
              </Label>
              <Input id={`s-${k}`} type="number" min={1} value={s[k]} onChange={(e) => setS(k, Number(e.target.value))} />
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Button onClick={() => saveSettings.mutate(s)} disabled={saveSettings.isPending || !settings}>
            {saveSettings.isPending && <Loader2Icon className="animate-spin" />}
            Salvar faixas
          </Button>
        </CardFooter>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <RuleTable {...tableProps} dim="PERFIL" title="Perfil" help="Pontos por características do lead." />
        <RuleTable {...tableProps} dim="INTERESSE" title="Interesse" help="Pontos por cada interação dentro da janela." />
      </div>
      {editing && (
        <RuleDialog
          rule={typeof editing === 'string' ? null : editing}
          dimension={typeof editing === 'string' ? editing : editing.dimension}
          fields={fields.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RuleTable({
  dim,
  title,
  help,
  rules,
  fields,
  onEdit,
  onAdd,
  onRemove,
}: {
  dim: 'PERFIL' | 'INTERESSE'
  title: string
  help: string
  rules: Rule[]
  fields: CustomField[]
  onEdit: (r: Rule) => void
  onAdd: (d: 'PERFIL' | 'INTERESSE') => void
  onRemove: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1.5">{help}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => onAdd(dim)}>
          <PlusIcon /> Regra
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableBody>
            {rules
              .filter((r) => r.dimension === dim)
              .map((r) => (
                <TableRow key={r.id} className={r.active ? undefined : 'opacity-50'}>
                  <TableCell className="pl-6">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{describe(r, fields)}</p>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {r.points > 0 ? '+' : ''}
                    {r.points}
                  </TableCell>
                  <TableCell className="w-24 pr-6">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(r)} aria-label={`Editar ${r.name}`}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => onRemove(r.id)} aria-label={`Excluir ${r.name}`}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function RuleDialog({ rule, dimension, fields, onClose }: { rule: Rule | null; dimension: 'PERFIL' | 'INTERESSE'; fields: CustomField[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(rule?.name ?? '')
  const [field, setField] = useState(rule?.field ?? (dimension === 'PERFIL' ? 'stage' : 'conversao'))
  const [value, setValue] = useState(Array.isArray(rule?.value) ? (rule!.value as string[]).join(',') : String(rule?.value ?? (dimension === 'PERFIL' ? 'CLIENTE' : '')))
  const [points, setPoints] = useState(rule?.points ?? 10)
  const [active, setActive] = useState(rule?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  const cf = field.startsWith('custom:') ? fields.find((f) => f.key === field.slice(7)) : undefined
  const save = useMutation({
    mutationFn: () => {
      let operator = 'eq'
      let v: unknown = value
      if (dimension === 'INTERESSE') {
        operator = 'each'
        v = null
      } else if (field === 'state') {
        operator = 'in'
        v = value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
      } else if (field === 'has_phone' || field === 'has_email') v = true
      else if (cf && cf.type === 'BOOLEAN') v = value === 'true'
      else if (cf && cf.type === 'NUMBER') {
        operator = 'gte'
        v = Number(value)
      } else if (cf && !value) operator = 'exists'
      const body = { dimension, name, field, operator, value: v, points, active }
      return rule ? api.put(`/leads/config/scoring/regras/${rule.id}`, body) : api.post('/leads/config/scoring/regras', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-scoring'] })
      toast.success('Regra salva. As notas serão recalculadas em instantes.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{rule ? 'Editar regra' : `Nova regra de ${dimension === 'PERFIL' ? 'perfil' : 'interesse'}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="r-name">Nome</Label>
            <Input id="r-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-field">{dimension === 'PERFIL' ? 'Quando' : 'Pontuar'}</Label>
            <Select value={field} onValueChange={(v) => (setField(v), setValue(''))}>
              <SelectTrigger id="r-field" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimension === 'PERFIL' ? (
                  <>
                    <SelectItem value="stage">Estágio no funil</SelectItem>
                    <SelectItem value="tag">Tem a tag</SelectItem>
                    <SelectItem value="state">Estado (UF)</SelectItem>
                    <SelectItem value="has_phone">Tem telefone</SelectItem>
                    <SelectItem value="has_email">Tem e-mail</SelectItem>
                    {fields.filter((f) => f.active).map((f) => (
                      <SelectItem key={f.key} value={`custom:${f.key}`}>
                        {f.label} (personalizado)
                      </SelectItem>
                    ))}
                  </>
                ) : (
                  Object.entries(EVENT_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {dimension === 'PERFIL' && field === 'stage' && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Estágio">
                <SelectValue placeholder="Estágio" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {dimension === 'PERFIL' && field === 'tag' && <Input aria-label="Tag" placeholder="ex.: revenda" value={value} onChange={(e) => setValue(e.target.value.toLowerCase())} />}
          {dimension === 'PERFIL' && field === 'state' && <Input aria-label="Estados" placeholder={`ex.: SC, PR, RS (${UF_LIST.length} UFs)`} value={value} onChange={(e) => setValue(e.target.value)} />}
          {cf && (cf.type === 'SELECT' || cf.type === 'MULTISELECT') && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Valor">
                <SelectValue placeholder="Valor" />
              </SelectTrigger>
              <SelectContent>
                {cf.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {cf && cf.type === 'NUMBER' && <Input type="number" aria-label="A partir de" placeholder="a partir de" value={value} onChange={(e) => setValue(e.target.value)} />}
          {cf && cf.type === 'BOOLEAN' && (
            <Select value={value || 'true'} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="Valor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Sim</SelectItem>
                <SelectItem value="false">Não</SelectItem>
              </SelectContent>
            </Select>
          )}
          {cf && (cf.type === 'TEXT' || cf.type === 'DATE') && <p className="text-xs text-muted-foreground">Pontua quando o campo estiver preenchido.</p>}
          <div className="space-y-2">
            <Label htmlFor="r-points">Pontos (negativo diminui a nota)</Label>
            <Input id="r-points" type="number" min={-100} max={100} required value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Regra ativa
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Tags ----------

function TagsTab() {
  const qc = useQueryClient()
  const tags = useTags()
  const [editing, setEditing] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const rename = useMutation({
    mutationFn: (p: { from: string; to: string | null }) => api.post<{ affected: number }>('/leads/config/tags/renomear', p),
    onSuccess: (r) => {
      toast.success(`${int.format(r.affected)} lead(s) atualizado(s).`)
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['lead-tags'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (tags.isLoading) return <TableSkeleton rows={4} />
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Tags</CardTitle>
        <CardDescription>Renomeie (renomear para uma tag que já existe junta as duas) ou remova uma tag de todos os leads.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {tags.data?.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Nenhuma tag.</li>}
          {tags.data?.map((t) => (
            <li key={t.tag} className="flex items-center gap-3 px-3 py-2">
              <Badge variant="secondary" className="font-normal">
                {t.tag}
              </Badge>
              <span className="flex-1 text-sm text-muted-foreground">{int.format(t.total)} lead(s)</span>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => (setEditing(t.tag), setTo(t.tag))} aria-label={`Renomear ${t.tag}`}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => rename.mutate({ from: t.tag, to: null })} aria-label={`Remover ${t.tag}`}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (editing && to.trim()) rename.mutate({ from: editing, to: to.trim() })
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Renomear “{editing}”</DialogTitle>
            </DialogHeader>
            <Input value={to} maxLength={60} onChange={(e) => setTo(e.target.value.toLowerCase())} autoFocus aria-label="Novo nome" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={rename.isPending || !to.trim()}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
