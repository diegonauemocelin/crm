import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, Loader2Icon, MessageCircleIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { MoneyInput } from '@/components/money-input'
import { MultiSelect } from '@/components/multi-select'
import { formatDateTime } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import {
  formatPhone,
  type Kind,
  KIND_INFO,
  maskPhone,
  namesOf,
  RETURN_LABEL,
  type ReturnStatus,
  SALE_LABEL,
  type SaleStatus,
  type ServiceRecord,
  UF_LIST,
  UF_NAMES,
  ufFromPhoneInput,
  useOptions,
  whatsappLink,
} from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'

const NONE = '__none__'

interface FormState {
  kind: Kind
  leadAt: string
  name: string
  customerCode: string
  phone: string
  email: string
  sellerId: string | null
  originId: string | null
  customerTypeId: string | null
  country: string
  state: string | null
  city: string
  brandIds: string[]
  partTypeIds: string[]
  forwarded: boolean
  returnStatus: ReturnStatus | null
  saleStatus: SaleStatus
  lostReasonId: string | null
  invoiceNumber: string
  saleValue: number | null
  notes: string
}

/** ISO → valor para <input type="datetime-local"> no horário de São Paulo. */
function toLocalInput(iso: string) {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 16)
}
function fromLocalInput(v: string) {
  return new Date(`${v}:00-03:00`).toISOString()
}

function initial(kind: Kind, r: ServiceRecord | null): FormState {
  return {
    kind: r?.kind ?? kind,
    leadAt: toLocalInput(r?.leadAt ?? new Date().toISOString()),
    name: r?.name ?? '',
    customerCode: r?.customerCode ?? '',
    phone: r?.phone ? formatPhone(r.phone) : '',
    email: r?.email ?? '',
    sellerId: r?.sellerId ?? null,
    originId: r?.originId ?? null,
    customerTypeId: r?.customerTypeId ?? null,
    country: r?.country ?? 'BR',
    state: r?.state ?? null,
    city: r?.city ?? '',
    brandIds: r?.brandIds ?? [],
    partTypeIds: r?.partTypeIds ?? [],
    forwarded: r?.forwarded ?? false,
    returnStatus: r?.returnStatus ?? null,
    saleStatus: r?.saleStatus ?? 'NEGOCIACAO',
    lostReasonId: r?.lostReasonId ?? null,
    invoiceNumber: r?.invoiceNumber ?? '',
    saleValue: r?.saleValue ?? null,
    notes: r?.notes ?? '',
  }
}

/** Mesmas regras do servidor, para avisar antes de salvar. */
function validate(f: FormState): string | null {
  if (!f.name.trim()) return 'Informe o nome.'
  if (f.saleStatus === 'NAO' && !f.lostReasonId) return 'Informe o motivo da venda perdida.'
  if (f.saleStatus === 'SIM' && !f.invoiceNumber.trim()) return 'Informe o número da nota fiscal.'
  if (f.saleStatus === 'SIM' && !(f.saleValue && f.saleValue > 0)) return 'Informe o valor da venda.'
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return 'E-mail inválido.'
  return null
}

function toPayload(f: FormState) {
  return {
    kind: f.kind,
    leadAt: fromLocalInput(f.leadAt),
    name: f.name.trim(),
    customerCode: f.customerCode.trim() || null,
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    sellerId: f.sellerId,
    originId: f.originId,
    customerTypeId: f.customerTypeId,
    country: f.country.trim() || 'BR',
    state: f.country === 'BR' ? f.state : null,
    city: f.city.trim() || null,
    brandIds: f.brandIds,
    partTypeIds: f.partTypeIds,
    forwarded: f.forwarded,
    returnStatus: f.forwarded ? f.returnStatus : null,
    saleStatus: f.saleStatus,
    lostReasonId: f.saleStatus === 'NAO' ? f.lostReasonId : null,
    invoiceNumber: f.saleStatus === 'SIM' ? f.invoiceNumber.trim() || null : null,
    saleValue: f.saleStatus === 'SIM' ? f.saleValue : null,
    notes: f.notes.trim() || null,
  }
}

function Field({ label, htmlFor, required, children, className }: { label: string; htmlFor?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </Label>
      {children}
    </div>
  )
}

function OptionSelect({ id, value, onChange, items, placeholder = 'Selecione', disabled }: { id?: string; value: string | null; onChange: (v: string | null) => void; items: { id: string; name: string; active?: boolean }[]; placeholder?: string; disabled?: boolean }) {
  const visible = items.filter((i) => i.active !== false || i.id === value)
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{placeholder}</span>
        </SelectItem>
        {visible.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
            {i.active === false && ' (inativo)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RecordSheet({ kind, record, onClose }: { kind: Kind; record: ServiceRecord | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const options = useOptions()
  const [form, setForm] = useState<FormState>(() => initial(kind, record))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const module = KIND_INFO[record?.kind ?? kind].module
  const canEdit = record ? can(module, 'edit') : can(module, 'create')
  const o = options.data

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => {
      const payload = toPayload(form)
      return record ? api.patch<ServiceRecord>(`/atendimentos/${record.id}`, payload) : api.post<ServiceRecord>('/atendimentos', payload)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      void qc.invalidateQueries({ queryKey: ['atendimento-alertas'] })
      toast.success(record ? 'Atendimento atualizado.' : 'Atendimento registrado.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/atendimentos/${record!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['atendimentos'] })
      toast.success('Atendimento excluído.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const problem = validate(form)
    setError(problem)
    if (!problem) save.mutate()
  }

  const wa = whatsappLink(record?.phone ?? null)

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{record ? record.name : `Novo atendimento — ${KIND_INFO[kind].title}`}</SheetTitle>
          <SheetDescription>
            {record ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Lead de {formatDateTime(record.leadAt)}</span>
                {record.importBatch && <span>· importado da planilha</span>}
                {wa && (
                  <a href={wa} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
                    <MessageCircleIcon className="size-3.5" /> Abrir no WhatsApp
                  </a>
                )}
              </span>
            ) : (
              'Campos com * são obrigatórios.'
            )}
          </SheetDescription>
        </SheetHeader>

        {record?.overdue && (
          <p role="status" className="mx-4 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm">
            <AlertTriangleIcon className="size-4 text-amber-600" />
            Repassado e ainda sem retorno do vendedor além do prazo de alerta.
          </p>
        )}

        <Tabs defaultValue="dados" className="px-4 pb-4">
          {record && (
            <TabsList>
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="dados">
            <form onSubmit={submit} className="space-y-6">
              <fieldset disabled={!canEdit || save.isPending} className="space-y-6">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Cliente</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Data do lead" htmlFor="r-date" required>
                      <Input id="r-date" type="datetime-local" required value={form.leadAt} onChange={(e) => set('leadAt', e.target.value)} />
                    </Field>
                    <Field label="Código do cliente" htmlFor="r-code">
                      <Input id="r-code" value={form.customerCode} maxLength={40} onChange={(e) => set('customerCode', e.target.value)} />
                    </Field>
                    <Field label="Nome" htmlFor="r-name" required className="space-y-1.5 sm:col-span-2">
                      <Input id="r-name" required maxLength={160} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus={!record} />
                    </Field>
                    <Field label="Telefone" htmlFor="r-phone">
                      <Input
                        id="r-phone"
                        inputMode="tel"
                        placeholder="(47) 99999-9999"
                        value={form.phone}
                        onChange={(e) => set('phone', maskPhone(e.target.value))}
                        onBlur={() => {
                          const uf = ufFromPhoneInput(form.phone)
                          if (uf && !form.state && form.country === 'BR') set('state', uf)
                        }}
                      />
                    </Field>
                    <Field label="E-mail" htmlFor="r-email">
                      <Input id="r-email" type="email" value={form.email} maxLength={200} onChange={(e) => set('email', e.target.value)} />
                    </Field>
                    <Field label="Estado" htmlFor="r-state">
                      <Select
                        value={form.country === 'BR' ? (form.state ?? NONE) : 'EX'}
                        onValueChange={(v) => {
                          if (v === 'EX') setForm((f) => ({ ...f, country: f.country === 'BR' ? '' : f.country, state: null }))
                          else setForm((f) => ({ ...f, country: 'BR', state: v === NONE ? null : v }))
                        }}
                      >
                        <SelectTrigger id="r-state" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>
                            <span className="text-muted-foreground">Selecione (sugerido pelo DDD)</span>
                          </SelectItem>
                          {UF_LIST.map((uf) => (
                            <SelectItem key={uf} value={uf}>
                              {UF_NAMES[uf]} ({uf})
                            </SelectItem>
                          ))}
                          <SelectItem value="EX">Exterior</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {form.country !== 'BR' ? (
                      <Field label="País" htmlFor="r-country" required>
                        <Input id="r-country" required value={form.country} maxLength={40} onChange={(e) => set('country', e.target.value)} />
                      </Field>
                    ) : (
                      <Field label="Cidade" htmlFor="r-city">
                        <Input id="r-city" value={form.city} maxLength={80} onChange={(e) => set('city', e.target.value)} />
                      </Field>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Interesse</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Origem do lead" htmlFor="r-origin">
                      <OptionSelect id="r-origin" value={form.originId} onChange={(v) => set('originId', v)} items={o?.origins ?? []} />
                    </Field>
                    <Field label="Tipo de cliente" htmlFor="r-type">
                      <OptionSelect id="r-type" value={form.customerTypeId} onChange={(v) => set('customerTypeId', v)} items={o?.customerTypes ?? []} />
                    </Field>
                    <Field label="Marca da máquina" htmlFor="r-brand">
                      <MultiSelect id="r-brand" items={o?.brands ?? []} value={form.brandIds} onChange={(v) => set('brandIds', v)} />
                    </Field>
                    <Field label="Tipo de peça" htmlFor="r-part">
                      <MultiSelect id="r-part" items={o?.partTypes ?? []} value={form.partTypeIds} onChange={(v) => set('partTypeIds', v)} />
                    </Field>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Encaminhamento</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Vendedor" htmlFor="r-seller">
                      <OptionSelect id="r-seller" value={form.sellerId} onChange={(v) => set('sellerId', v)} items={o?.sellers ?? []} placeholder="Sem vendedor" />
                    </Field>
                    <div className="flex items-end gap-3 pb-1.5">
                      <Switch
                        id="r-forwarded"
                        checked={form.forwarded}
                        onCheckedChange={(c) => setForm((f) => ({ ...f, forwarded: c, returnStatus: c ? (f.returnStatus ?? 'PENDENTE') : null }))}
                      />
                      <Label htmlFor="r-forwarded">Repassou ao vendedor</Label>
                    </div>
                    {form.forwarded && (
                      <Field label="Vendedor retornou?" className="space-y-1.5 sm:col-span-2">
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          value={form.returnStatus ?? 'PENDENTE'}
                          onValueChange={(v) => v && set('returnStatus', v as ReturnStatus)}
                          aria-label="Vendedor retornou?"
                        >
                          {(['SIM', 'NAO', 'PENDENTE'] as const).map((s) => (
                            <ToggleGroupItem key={s} value={s} className="px-4">
                              {RETURN_LABEL[s]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </Field>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Resultado</h3>
                  <Field label="Venda realizada?">
                    <ToggleGroup type="single" variant="outline" value={form.saleStatus} onValueChange={(v) => v && set('saleStatus', v as SaleStatus)} aria-label="Venda realizada?">
                      <ToggleGroupItem value="SIM" className="px-4">Sim</ToggleGroupItem>
                      <ToggleGroupItem value="NAO" className="px-4">Não</ToggleGroupItem>
                      <ToggleGroupItem value="NEGOCIACAO" className="px-4">Em negociação</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  {form.saleStatus === 'NAO' && (
                    <Field label="Motivo da venda perdida" htmlFor="r-lost" required>
                      <OptionSelect id="r-lost" value={form.lostReasonId} onChange={(v) => set('lostReasonId', v)} items={o?.lostReasons ?? []} />
                    </Field>
                  )}
                  {form.saleStatus === 'SIM' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Número da nota fiscal" htmlFor="r-nf" required>
                        <Input id="r-nf" value={form.invoiceNumber} maxLength={40} onChange={(e) => set('invoiceNumber', e.target.value)} />
                      </Field>
                      <Field label="Valor da venda" htmlFor="r-value" required>
                        <MoneyInput id="r-value" value={form.saleValue} onChange={(v) => set('saleValue', v)} />
                      </Field>
                    </div>
                  )}
                  <Field label="Observações" htmlFor="r-notes">
                    <Textarea id="r-notes" rows={4} maxLength={5000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                  </Field>
                </section>
              </fieldset>

              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {canEdit && (
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending && <Loader2Icon className="animate-spin" />}
                    {record ? 'Salvar alterações' : 'Registrar atendimento'}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={onClose}>
                  {canEdit ? 'Cancelar' : 'Fechar'}
                </Button>
                {record && can(module, 'delete') && (
                  <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2Icon /> Excluir
                  </Button>
                )}
              </div>
            </form>
          </TabsContent>
          {record && (
            <TabsContent value="historico">
              <History id={record.id} names={namesOf(o)} />
            </TabsContent>
          )}
        </Tabs>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir este atendimento?</AlertDialogTitle>
              <AlertDialogDescription>Ele deixa de aparecer nas telas e no dashboard. O registro continua guardado na auditoria.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  remove.mutate()
                }}
              >
                {remove.isPending && <Loader2Icon className="animate-spin" />}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

interface HistoryEntry {
  id: string
  userName: string | null
  action: string
  createdAt: string
  changes: Record<string, { de: unknown; para: unknown }>
  labels: Record<string, string>
}

function formatValue(field: string, v: unknown, names: Map<string, string>): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.map((x) => names.get(String(x)) ?? String(x)).join(', ') : '—'
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (field.endsWith('Id')) return names.get(String(v)) ?? '(item removido)'
  if (field === 'saleStatus') return SALE_LABEL[v as SaleStatus] ?? String(v)
  if (field === 'returnStatus') return RETURN_LABEL[v as ReturnStatus] ?? String(v)
  if (field === 'kind') return KIND_INFO[v as Kind]?.title ?? String(v)
  if (field === 'leadAt') return formatDateTime(String(v))
  if (field === 'phone') return formatPhone(String(v))
  if (field === 'saleValue') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return String(v)
}

function History({ id, names }: { id: string; names: Map<string, string> }) {
  const q = useQuery({ queryKey: ['atendimento-historico', id], queryFn: () => api.get<HistoryEntry[]>(`/atendimentos/${id}/historico`) })
  if (q.isLoading) return <Loader2Icon className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />
  if (!q.data?.length) return <p className="py-6 text-sm text-muted-foreground">Nenhuma alteração registrada pelo sistema (registro importado da planilha).</p>
  return (
    <ol className="space-y-4 py-2">
      {q.data.map((h) => (
        <li key={h.id} className="border-l-2 pl-3">
          <p className="text-sm">
            <span className="font-medium">{h.userName ?? 'Sistema'}</span> {h.action} o atendimento
          </p>
          <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
          {Object.keys(h.changes).length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-sm">
              {Object.entries(h.changes).map(([field, c]) => (
                <li key={field}>
                  <span className="text-muted-foreground">{h.labels[field] ?? field}:</span> <s className="text-muted-foreground">{formatValue(field, c.de, names)}</s> → {formatValue(field, c.para, names)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
