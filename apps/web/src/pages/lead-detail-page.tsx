import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  DownloadIcon,
  GlobeIcon,
  HeadsetIcon,
  ShoppingCartIcon,
  Loader2Icon,
  MailIcon,
  MailXIcon,
  MessageCircleIcon,
  ShieldAlertIcon,
  XIcon,
} from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { brl, formatPhone, KIND_INFO, type Kind, maskPhone, namesOf, SALE_LABEL, type SaleStatus, UF_LIST, UF_NAMES, useOptions, whatsappLink } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type CustomField, type Lead, type LeadStage, STAGE_LABEL, STAGES, useCustomFields } from '@/lib/leads'
import { CONTACT_LABEL, DEVICE_LABEL, type LeadShop, type LeadSite, pathOf, SHOP_LABEL, touchLabel } from '@/lib/rastreamento'
import { FormError } from './auth/auth-layout'
import { GradeBadge } from './leads-page'

const NONE = '__none__'

interface Form {
  name: string
  email: string
  phone: string
  company: string
  jobTitle: string
  state: string | null
  city: string
  stage: LeadStage
  ownerId: string | null
  unitId: string | null
  originId: string | null
  tags: string[]
  customFields: Record<string, unknown>
}

function toForm(l: Lead | null): Form {
  return {
    name: l?.name ?? '',
    email: l?.email ?? '',
    phone: l?.phone ? formatPhone(l.phone) : '',
    company: l?.company ?? '',
    jobTitle: l?.jobTitle ?? '',
    state: l?.state ?? null,
    city: l?.city ?? '',
    stage: l?.stage ?? 'LEAD',
    ownerId: l?.ownerId ?? null,
    unitId: l?.unitId ?? null,
    originId: l?.originId ?? null,
    tags: l?.tags ?? [],
    customFields: l?.customFields ?? {},
  }
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function Pick({ id, value, onChange, items, empty }: { id: string; value: string | null; onChange: (v: string | null) => void; items: { id: string; name: string; active?: boolean }[]; empty: string }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{empty}</SelectItem>
        {items
          .filter((i) => i.active !== false || i.id === value)
          .map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

/** Campo de tags livre: Enter ou vírgula adiciona; o "x" remove. */
function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim().toLowerCase().replace(/,$/, '')
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1">
      {value.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1 font-normal">
          {t}
          <button type="button" className="rounded-sm hover:bg-muted-foreground/20" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remover tag ${t}`}>
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        className="min-w-28 flex-1 bg-transparent py-1 text-sm outline-none"
        value={text}
        maxLength={60}
        placeholder={value.length ? '' : 'Digite e tecle Enter'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        aria-label="Adicionar tag"
      />
    </div>
  )
}

function CustomInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cf-${field.key}`
  switch (field.type) {
    case 'NUMBER':
      return <Input id={id} type="number" value={(value as number | undefined) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    case 'DATE':
      return <Input id={id} type="date" value={(value as string | undefined) ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    case 'BOOLEAN':
      return <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c)} />
    case 'SELECT':
      return <Pick id={id} value={(value as string | undefined) ?? null} onChange={onChange} items={field.options.map((o) => ({ id: o, name: o }))} empty="—" />
    case 'MULTISELECT':
      return <MultiSelect id={id} items={field.options.map((o) => ({ id: o, name: o }))} value={(value as string[] | undefined) ?? []} onChange={onChange} />
    default:
      return <Input id={id} value={(value as string | undefined) ?? ''} maxLength={1000} onChange={(e) => onChange(e.target.value)} />
  }
}

export function LeadDetailPage() {
  return (
    <RequirePermission module="leads">
      <LeadDetail />
    </RequirePermission>
  )
}

function LeadDetail() {
  const { id } = useParams()
  const isNew = id === 'novo' || !id
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<Lead>(`/leads/${id}`), enabled: !isNew })
  if (!isNew && q.isLoading) return <TableSkeleton rows={6} />
  if (!isNew && q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return <LeadView key={q.data?.updatedAt ?? 'novo'} lead={isNew ? null : (q.data ?? null)} />
}

function LeadView({ lead }: { lead: Lead | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const options = useOptions()
  const fields = useCustomFields()
  const [form, setForm] = useState<Form>(() => toForm(lead))
  const [error, setError] = useState<string | null>(null)
  const o = options.data
  const editable = lead ? can('leads', 'edit') && !lead.anonymizedAt : can('leads', 'create')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        state: form.state,
        city: form.city.trim() || null,
        stage: form.stage,
        ownerId: form.ownerId,
        unitId: form.unitId,
        originId: form.originId,
        tags: form.tags,
        customFields: form.customFields,
      }
      return lead ? api.patch<Lead>(`/leads/${lead.id}`, body) : api.post<Lead>('/leads', body)
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', saved.id] })
      void qc.invalidateQueries({ queryKey: ['lead-timeline', saved.id] })
      toast.success(lead ? 'Lead atualizado.' : 'Lead cadastrado.')
      if (!lead) navigate(`/leads/${saved.id}`, { replace: true })
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const title = lead ? (lead.anonymizedAt ? 'Dados removidos (LGPD)' : (lead.name ?? lead.email ?? formatPhone(lead.phone))) : 'Novo lead'
  const wa = whatsappLink(lead?.phone ?? null)

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to="/leads">
          <ArrowLeftIcon /> Base de leads
        </Link>
      </Button>
      <PageHeader
        title={title}
        description={lead ? `Cadastrado em ${formatDateTime(lead.createdAt)}${lead.importBatch ? ' · importado' : ''}` : 'Informe ao menos o e-mail ou o telefone.'}
        actions={
          lead && (
            <div className="flex items-center gap-2">
              <GradeBadge grade={lead.scoreGrade} total={lead.scoreTotal} />
              <Badge variant="outline">{STAGE_LABEL[lead.stage]}</Badge>
              {wa && (
                <Button variant="outline" size="sm" asChild>
                  <a href={wa} target="_blank" rel="noreferrer noopener">
                    <MessageCircleIcon /> WhatsApp
                  </a>
                </Button>
              )}
            </div>
          )
        }
      />

      <Tabs defaultValue="dados">
        {lead && (
          <TabsList className="mb-4">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="linha">Linha do tempo</TabsTrigger>
            <TabsTrigger value="site">Site</TabsTrigger>
            <TabsTrigger value="loja">Loja virtual</TabsTrigger>
            <TabsTrigger value="privacidade">Privacidade (LGPD)</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="dados">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  setError(null)
                  save.mutate()
                }}
              >
                <CardContent className="space-y-6">
                  <fieldset disabled={!editable || save.isPending} className="space-y-6">
                    <section className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nome" htmlFor="l-name" className="space-y-1.5 sm:col-span-2">
                        <Input id="l-name" value={form.name} maxLength={160} onChange={(e) => set('name', e.target.value)} autoFocus={!lead} />
                      </Field>
                      <Field label="E-mail" htmlFor="l-email">
                        <Input id="l-email" type="email" value={form.email} maxLength={200} onChange={(e) => set('email', e.target.value)} />
                      </Field>
                      <Field label="Telefone / WhatsApp" htmlFor="l-phone">
                        <Input id="l-phone" inputMode="tel" placeholder="(47) 99999-9999" value={form.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} />
                      </Field>
                      <Field label="Empresa" htmlFor="l-company">
                        <Input id="l-company" value={form.company} maxLength={160} onChange={(e) => set('company', e.target.value)} />
                      </Field>
                      <Field label="Cargo" htmlFor="l-job">
                        <Input id="l-job" value={form.jobTitle} maxLength={120} onChange={(e) => set('jobTitle', e.target.value)} />
                      </Field>
                      <Field label="Cidade" htmlFor="l-city">
                        <Input id="l-city" value={form.city} maxLength={80} onChange={(e) => set('city', e.target.value)} />
                      </Field>
                      <Field label="Estado" htmlFor="l-state">
                        <Pick id="l-state" value={form.state} onChange={(v) => set('state', v)} items={UF_LIST.map((uf) => ({ id: uf, name: `${UF_NAMES[uf]} (${uf})` }))} empty="—" />
                      </Field>
                    </section>
                    <section className="grid gap-3 sm:grid-cols-2">
                      <Field label="Estágio no funil" htmlFor="l-stage">
                        <Select value={form.stage} onValueChange={(v) => set('stage', v as LeadStage)}>
                          <SelectTrigger id="l-stage" className="w-full">
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
                      </Field>
                      <Field label="Origem" htmlFor="l-origin">
                        <Pick id="l-origin" value={form.originId} onChange={(v) => set('originId', v)} items={o?.origins ?? []} empty="Sem origem" />
                      </Field>
                      <Field label="Responsável" htmlFor="l-owner">
                        <Pick id="l-owner" value={form.ownerId} onChange={(v) => set('ownerId', v)} items={o?.sellers ?? []} empty="Sem responsável" />
                      </Field>
                      <Field label="Unidade" htmlFor="l-unit">
                        <Pick id="l-unit" value={form.unitId} onChange={(v) => set('unitId', v)} items={o?.units ?? []} empty="Sem unidade" />
                      </Field>
                      <Field label="Tags" className="space-y-1.5 sm:col-span-2">
                        <TagInput value={form.tags} onChange={(v) => set('tags', v)} />
                      </Field>
                    </section>
                    {!!fields.data?.filter((f) => f.active).length && (
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold">Campos personalizados</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {fields.data
                            .filter((f) => f.active)
                            .map((f) => (
                              <Field key={f.key} label={f.label} htmlFor={`cf-${f.key}`}>
                                <CustomInput field={f} value={form.customFields[f.key]} onChange={(v) => set('customFields', { ...form.customFields, [f.key]: v })} />
                              </Field>
                            ))}
                        </div>
                      </section>
                    )}
                  </fieldset>
                  <FormError message={error} />
                </CardContent>
                {editable && (
                  <CardFooter className="mt-4">
                    <Button type="submit" disabled={save.isPending}>
                      {save.isPending && <Loader2Icon className="animate-spin" />}
                      {lead ? 'Salvar alterações' : 'Cadastrar lead'}
                    </Button>
                  </CardFooter>
                )}
              </form>
            </Card>
            {lead && <Summary lead={lead} />}
          </div>
        </TabsContent>
        {lead && (
          <>
            <TabsContent value="linha">
              <Timeline lead={lead} />
            </TabsContent>
            <TabsContent value="site">
              <SiteVisits lead={lead} />
            </TabsContent>
            <TabsContent value="loja">
              <ShopTab lead={lead} />
            </TabsContent>
            <TabsContent value="privacidade">
              <Privacy lead={lead} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}

function Summary({ lead }: { lead: Lead }) {
  const rows: [string, string][] = [
    ['Nota (lead scoring)', lead.scoreGrade ? `${lead.scoreGrade} · ${lead.scoreTotal} pts` : '—'],
    ['Perfil / interesse', `${lead.scoreProfile} / ${lead.scoreInterest} pts`],
    ['Última atividade', formatDateTime(lead.lastActivityAt)],
    ['Primeira conversão', formatDateTime(lead.firstConversionAt)],
    ['Última oportunidade', formatDateTime(lead.lastOpportunityAt)],
    ['Última venda', lead.lastSaleAt ? `${formatDateTime(lead.lastSaleAt)}${lead.lastSaleValue ? ` · ${brl.format(lead.lastSaleValue)}` : ''}` : '—'],
    ['E-mail marketing', lead.emailOptIn ? 'Aceita receber' : 'Não aceita'],
  ]
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">Resumo</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

interface TimelineData {
  events: { id: string; type: string; title: string; occurredAt: string; userName: string | null; data: Record<string, unknown> | null }[]
  records: { id: string; kind: Kind; leadAt: string; saleStatus: SaleStatus; saleValue: number | null; sellerId: string | null; notes: string | null }[]
  consents: { id: string; purpose: string; granted: boolean; source: string; text: string | null; createdAt: string }[]
}

function Timeline({ lead }: { lead: Lead }) {
  const options = useOptions()
  const names = namesOf(options.data)
  const q = useQuery({ queryKey: ['lead-timeline', lead.id], queryFn: () => api.get<TimelineData>(`/leads/${lead.id}/linha-do-tempo`) })
  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const items = [
    ...q.data!.events.filter((e) => e.type !== 'atendimento').map((e) => ({ at: e.occurredAt, key: e.id, node: <EventItem e={e} /> })),
    ...q.data!.records.map((r) => ({
      at: r.leadAt,
      key: r.id,
      node: (
        <div className="flex gap-3">
          <HeadsetIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm">
              <Link to={`${KIND_INFO[r.kind].path}`} className="font-medium hover:underline">
                Atendimento de {KIND_INFO[r.kind].title}
              </Link>{' '}
              · {SALE_LABEL[r.saleStatus]}
              {r.saleValue ? ` · ${brl.format(r.saleValue)}` : ''}
              {r.sellerId ? ` · ${names.get(r.sellerId) ?? ''}` : ''}
            </p>
            {r.notes && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.notes}</p>}
            <p className="text-xs text-muted-foreground">{formatDateTime(r.leadAt)}</p>
          </div>
        </div>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <Card>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ol className="space-y-4">
            {items.map((i) => (
              <li key={i.key}>{i.node}</li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function EventItem({ e }: { e: TimelineData['events'][number] }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[color:var(--brand)]" aria-hidden />
      <div>
        <p className="text-sm">{e.title}</p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(e.occurredAt)}
          {e.userName ? ` · ${e.userName}` : ''}
        </p>
      </div>
    </div>
  )
}

function SiteVisits({ lead }: { lead: Lead }) {
  const q = useQuery({ queryKey: ['lead-site', lead.id], queryFn: () => api.get<LeadSite>(`/rastreamento/leads/${lead.id}`) })
  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const s = q.data!
  if (!s.devices) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma visita ao site ligada a este lead. A ligação acontece quando ele clica num link de e-mail do CRM ou, na próxima fase, preenche um formulário no site.
        </CardContent>
      </Card>
    )
  }
  const rows: [string, string][] = [
    ['Primeira visita', `${formatDateTime(s.firstSeenAt)} · ${touchLabel(s.firstTouch)}`],
    ['Última visita', `${formatDateTime(s.lastSeenAt)} · ${touchLabel(s.lastTouch)}`],
    ['Visitas / páginas vistas', `${s.sessions} / ${s.pageviews}`],
    ['Dispositivo', [s.firstDevice, s.device].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => DEVICE_LABEL[x!] ?? x).join(' → ') || '—'],
    ['Navegadores diferentes', String(s.devices)],
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Páginas visitadas</CardTitle>
          <CardDescription>As 100 mais recentes.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {s.views.map((v) => (
              <li key={v.id} className="flex gap-3">
                <GlobeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm" title={v.url}>
                    {v.title || pathOf(v.url)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(v.occurredAt)}
                    {v.newSession ? ` · entrada por ${touchLabel(v.touch)}` : ''}
                    {v.newSession && v.device ? ` · ${DEVICE_LABEL[v.device] ?? v.device}` : ''}
                    {v.title ? ` · ${pathOf(v.url)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Origem</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function ShopTab({ lead }: { lead: Lead }) {
  const q = useQuery({ queryKey: ['lead-shop', lead.id], queryFn: () => api.get<LeadShop>(`/loja/leads/${lead.id}`) })
  const site = useQuery({ queryKey: ['lead-site', lead.id], queryFn: () => api.get<LeadSite>(`/rastreamento/leads/${lead.id}`) })
  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data!
  const shop = site.data?.shop ?? []
  if (!d.orders.length && !d.carts.length && !shop.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhum pedido, carrinho ou atividade de compra na loja virtual ligados a este lead.</CardContent>
      </Card>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pedidos</CardTitle>
            <CardDescription>
              {d.paidOrders} pedido(s) pago(s) · total {brl.format(d.totalSpent)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem pedidos na loja.</p>
            ) : (
              <ul className="divide-y text-sm">
                {d.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">Pedido {o.code}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(o.orderedAt)}
                        {o.payment ? ` · ${o.payment}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums">{brl.format(o.total)}</p>
                      <Badge variant={o.statusGroup === 'cancelado' ? 'destructive' : 'outline'}>{o.statusName}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {d.carts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Carrinhos</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {d.carts.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <ShoppingCartIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="line-clamp-2">{c.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(c.lastActivityAt)} · {c.status === 3 ? 'comprado' : c.status === 2 ? 'abandonado' : 'aberto'}
                        {c.checkoutStarted ? ' · checkout iniciado' : ''} · {CONTACT_LABEL[c.contactStatus]}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Atividade de compra no site</CardTitle>
          <CardDescription>Carrinho, checkout e compras vistos pelo rastreamento.</CardDescription>
        </CardHeader>
        <CardContent>
          {shop.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada registrado.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {shop.map((e) => (
                <li key={e.id}>
                  <p>
                    {SHOP_LABEL[e.name] ?? e.name}
                    {e.value ? ` · ${brl.format(e.value)}` : ''}
                  </p>
                  {!!e.items?.length && <p className="line-clamp-2 text-xs text-muted-foreground">{e.items.map((i) => i.name).join(', ')}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.occurredAt)}
                    {e.device ? ` · ${DEVICE_LABEL[e.device] ?? e.device}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Privacy({ lead }: { lead: Lead }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const tl = useQuery({ queryKey: ['lead-timeline', lead.id], queryFn: () => api.get<TimelineData>(`/leads/${lead.id}/linha-do-tempo`) })

  const consent = useMutation({
    mutationFn: (granted: boolean) => api.post(`/leads/${lead.id}/consentimento`, { granted, text: granted ? 'Consentimento registrado manualmente pela equipe.' : undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      void qc.invalidateQueries({ queryKey: ['lead-timeline', lead.id] })
      toast.success('Consentimento registrado.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const anonymize = useMutation({
    mutationFn: () => api.post(`/leads/${lead.id}/lgpd/anonimizar`),
    onSuccess: () => {
      toast.success('Dados pessoais apagados.')
      void qc.invalidateQueries({ queryKey: ['leads'] })
      navigate('/leads')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const download = async () => {
    const res = await fetch(`/api/leads/${lead.id}/lgpd/exportar`, { credentials: 'same-origin' })
    if (!res.ok) return toast.error('Falha ao exportar.')
    const url = URL.createObjectURL(await res.blob())
    Object.assign(document.createElement('a'), { href: url, download: `dados-titular-${lead.id.slice(0, 8)}.json` }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {lead.emailOptIn ? <MailIcon className="size-4 text-emerald-600" /> : <MailXIcon className="size-4 text-muted-foreground" />}
            E-mail marketing: {lead.emailOptIn ? 'aceita receber' : 'não aceita'}
          </CardTitle>
          <CardDescription>Só leads com consentimento recebem campanhas. Todo e-mail terá o link de descadastro em 1 clique.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium">Histórico de consentimento</p>
          <ul className="space-y-2 text-sm">
            {tl.data?.consents.length === 0 && <li className="text-muted-foreground">Nenhum registro.</li>}
            {tl.data?.consents.map((c) => (
              <li key={c.id} className="flex gap-2">
                {c.granted ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <span>
                  {c.granted ? 'Aceitou' : 'Recusou/descadastrou'} · {c.source}
                  <span className="block text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
        {can('leads', 'edit') && !lead.anonymizedAt && (
          <CardFooter className="gap-2">
            {lead.emailOptIn ? (
              <Button variant="outline" size="sm" onClick={() => consent.mutate(false)} disabled={consent.isPending}>
                Registrar descadastro
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => consent.mutate(true)} disabled={consent.isPending}>
                Registrar consentimento
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Direitos do titular (LGPD)</CardTitle>
          <CardDescription>Atenda pedidos de acesso/portabilidade e de eliminação dos dados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>Exportar dados:</strong> gera um arquivo com tudo o que o sistema guarda sobre esta pessoa (cadastro, histórico, atendimentos e consentimentos).
          </p>
          <p>
            <strong>Apagar dados pessoais:</strong> remove nome, e-mail, telefone e demais dados deste lead e dos atendimentos dele. Fica só um registro anônimo para as estatísticas. Não pode ser desfeito.
          </p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          {can('leads', 'export') && (
            <Button variant="outline" size="sm" onClick={download} disabled={!!lead.anonymizedAt}>
              <DownloadIcon /> Exportar dados
            </Button>
          )}
          {can('leads', 'delete') && (
            <Button variant="destructive" size="sm" onClick={() => setConfirm(true)} disabled={!!lead.anonymizedAt}>
              <ShieldAlertIcon /> Apagar dados pessoais
            </Button>
          )}
        </CardFooter>
      </Card>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar os dados pessoais deste lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Nome, e-mail, telefone, campos personalizados e histórico serão apagados, inclusive nos atendimentos vinculados. Esta ação é registrada na auditoria e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                anonymize.mutate()
              }}
            >
              {anonymize.isPending && <Loader2Icon className="animate-spin" />}
              Apagar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
