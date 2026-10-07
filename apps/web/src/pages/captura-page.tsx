import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, CodeIcon, InboxIcon, Loader2Icon, MegaphoneIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CopyField } from '@/components/copy-field'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, int, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import {
  type AfterSubmit,
  type CaptureForm,
  type CapturePopup,
  type CaptureSettings,
  CHANNEL_LABEL,
  DEFAULT_CONSENT,
  DEVICE_RULE_LABEL,
  type DeviceRule,
  type FieldCatalogItem,
  type FormField,
  linesOf,
  type Submission,
  type Trigger,
  TRIGGER_LABEL,
} from '@/lib/captura'
import { FormError } from './auth/auth-layout'

const NONE = '__none__'

export function CapturaPage() {
  return (
    <RequirePermission module="captura">
      <PageHeader
        title="Captura"
        description="Formulários, pop-ups e botão de WhatsApp no site. Quem preenche vira lead (sem duplicar) e entra na fila de Pré-Vendas."
      />
      <InstallHint />
      <Tabs defaultValue="formularios">
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="formularios">Formulários</TabsTrigger>
          <TabsTrigger value="popups">Pop-ups</TabsTrigger>
          <TabsTrigger value="whatsapp">Botão de WhatsApp</TabsTrigger>
          <TabsTrigger value="envios">Envios</TabsTrigger>
        </TabsList>
        <TabsContent value="formularios">
          <FormsTab />
        </TabsContent>
        <TabsContent value="popups">
          <PopupsTab />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsappTab />
        </TabsContent>
        <TabsContent value="envios">
          <SubmissionsTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

function InstallHint() {
  return (
    <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
      Pop-ups, formulários e o botão de WhatsApp aparecem no site pelo mesmo código do rastreamento (Configurações → Rastreamento do site), que precisa estar ligado. Não é preciso colar nada novo no site.
    </p>
  )
}

function Field({ label, htmlFor, children, hint, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SellerPick({ id, value, onChange, disabled }: { id: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const options = useOptions()
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Sem responsável</SelectItem>
        {(options.data?.sellers ?? [])
          .filter((s) => s.active || s.id === value)
          .map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

// ---------- Formulários ----------

/** "campo do lead: Nome" ou "campo personalizado", ao lado do rótulo editável. */
function fieldHint(catalog: FieldCatalogItem[] | undefined, key: string) {
  const c = catalog?.find((x) => x.key === key)
  return c?.custom ? 'campo personalizado' : `campo do lead: ${c?.label ?? key}`
}

function useForms() {
  return useQuery({ queryKey: ['captura-forms'], queryFn: () => api.get<CaptureForm[]>('/captura/formularios') })
}

function FormsTab() {
  const q = useForms()
  const { can } = useAuth()
  const [open, setOpen] = useState<CaptureForm | 'new' | null>(null)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('captura', 'create') && (
          <Button onClick={() => setOpen('new')}>
            <PlusIcon /> Novo formulário
          </Button>
        )}
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={MegaphoneIcon} title="Nenhum formulário ainda" description="Crie um formulário para usar em pop-ups, embutir em páginas do site e, em breve, nas landing pages." />
      ) : (
        <div className="space-y-3">
          {q.data.map((f) => (
            <Card key={f.id} className="py-4">
              <CardContent className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {f.name}
                    <Badge variant={f.active ? 'default' : 'outline'}>{f.active ? 'Ativo' : 'Inativo'}</Badge>
                    {f.createRecord && <Badge variant="outline">Cria atendimento em Pré-Vendas</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {f.fields.map((x) => x.label).join(', ')} · {int.format(f.submissions)} envio(s){f.popups ? ` · usado em ${f.popups} pop-up(s)` : ''}
                  </p>
                  <div className="max-w-2xl space-y-2 pt-1">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CodeIcon className="size-3.5" /> Para colocar numa página do site: cole no corpo da página (modo HTML do editor), no ponto onde o formulário deve aparecer.
                    </p>
                    {f.embedScript && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Código com script (recomendado)</p>
                        <CopyField value={f.embedScript} />
                      </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Código simples (só se o editor não aceitar script)</p>
                      <CopyField value={f.embedDiv ?? `<div data-usacrm-form="${f.id}"></div>`} />
                    </div>
                    {f.trackingEnabled === false && (
                      <p className="text-xs text-destructive">O rastreamento do site está desligado: ligue em Configurações → Rastreamento do site para o formulário aparecer.</p>
                    )}
                    {!f.active && <p className="text-xs text-destructive">Este formulário está inativo: ele não aparece no site.</p>}
                  </div>
                </div>
                {can('captura', 'edit') && (
                  <Button variant="outline" size="sm" onClick={() => setOpen(f)}>
                    <PencilIcon /> Editar
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && <FormEditor form={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </>
  )
}

const NEW_FORM = (): Omit<CaptureForm, 'id' | 'submissions' | 'createdAt'> => ({
  name: '',
  fields: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'phone', label: 'WhatsApp', required: true },
    { key: 'email', label: 'E-mail', required: false },
  ],
  submitLabel: 'Quero ser atendido',
  successMessage: 'Recebemos seus dados! Nossa equipe vai falar com você em breve.',
  afterSubmit: 'mensagem',
  redirectUrl: null,
  consentText: DEFAULT_CONSENT,
  originName: 'Site - LP',
  ownerId: null,
  tags: [],
  createRecord: true,
  active: true,
})

function FormEditor({ form, onClose }: { form: CaptureForm | null; onClose: () => void }) {
  const qc = useQueryClient()
  const catalog = useQuery({ queryKey: ['captura-catalog'], queryFn: () => api.get<FieldCatalogItem[]>('/captura/campos') })
  const options = useOptions()
  const [f, setF] = useState(() => (form ? { ...form } : { ...NEW_FORM() }))
  const [tags, setTags] = useState((form?.tags ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const setField = (i: number, patch: Partial<FormField>) => set('fields', f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...f.fields]
    const [x] = next.splice(i, 1)
    next.splice(i + dir, 0, x!)
    set('fields', next)
  }
  const available = (catalog.data ?? []).filter((c) => !f.fields.some((x) => x.key === c.key))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        fields: f.fields.map(({ key, label, required }) => ({ key, label, required })),
        submitLabel: f.submitLabel,
        successMessage: f.successMessage,
        afterSubmit: f.afterSubmit,
        redirectUrl: f.afterSubmit === 'redirect' ? f.redirectUrl : null,
        consentText: f.consentText?.trim() || null,
        originName: f.originName,
        ownerId: f.ownerId,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        createRecord: f.createRecord,
        active: f.active,
      }
      return form ? api.put<CaptureForm>(`/captura/formularios/${form.id}`, body) : api.post<CaptureForm>('/captura/formularios', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['captura-forms'] })
      toast.success('Formulário salvo.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{form ? `Editar: ${form.name}` : 'Novo formulário'}</SheetTitle>
          <SheetDescription>Peça só o necessário: formulários curtos convertem mais. E-mail ou WhatsApp é obrigatório (é o que identifica o lead).</SheetDescription>
        </SheetHeader>
        <form
          className="space-y-5 px-4 pb-6"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <Field label="Nome interno" htmlFor="cf-name">
            <Input id="cf-name" required maxLength={80} placeholder="Ex.: Orçamento de peças" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Campos</h3>
            <ul className="space-y-2">
              {f.fields.map((x, i) => (
                <li key={x.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Input className="h-8 min-w-40 flex-1" value={x.label} maxLength={80} onChange={(e) => setField(i, { label: e.target.value })} aria-label={`Rótulo do campo ${x.key}`} />
                  <span className="text-xs text-muted-foreground">{fieldHint(catalog.data, x.key)}</span>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch checked={x.required} onCheckedChange={(c) => setField(i, { required: c })} /> Obrigatório
                  </label>
                  <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                    <ArrowUpIcon />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === f.fields.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
                    <ArrowDownIcon />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => set('fields', f.fields.filter((_, j) => j !== i))} aria-label="Remover campo">
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
            {available.length > 0 && (
              <Select value="" onValueChange={(key) => { const c = catalog.data?.find((x) => x.key === key); if (c) set('fields', [...f.fields, { key: c.key, label: c.label, required: false }]) }}>
                <SelectTrigger className="w-64" aria-label="Adicionar campo">
                  <SelectValue placeholder="+ Adicionar campo" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                      {c.custom ? ' (personalizado)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Texto do botão" htmlFor="cf-submit">
              <Input id="cf-submit" maxLength={40} value={f.submitLabel} onChange={(e) => set('submitLabel', e.target.value)} />
            </Field>
            <Field label="Depois de enviar" htmlFor="cf-after">
              <Select value={f.afterSubmit} onValueChange={(v) => set('afterSubmit', v as AfterSubmit)}>
                <SelectTrigger id="cf-after" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensagem">Mostrar mensagem de agradecimento</SelectItem>
                  <SelectItem value="whatsapp">Abrir o WhatsApp de Pré-Vendas</SelectItem>
                  <SelectItem value="redirect">Ir para outro endereço</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mensagem de agradecimento" htmlFor="cf-success" className="space-y-1.5 sm:col-span-2">
              <Input id="cf-success" maxLength={300} value={f.successMessage} onChange={(e) => set('successMessage', e.target.value)} />
            </Field>
            {f.afterSubmit === 'redirect' && (
              <Field label="Endereço" htmlFor="cf-url" className="space-y-1.5 sm:col-span-2">
                <Input id="cf-url" placeholder="https://www.usaparts.com.br/obrigado" value={f.redirectUrl ?? ''} onChange={(e) => set('redirectUrl', e.target.value)} />
              </Field>
            )}
          </div>

          <Field label="Caixa de consentimento para e-mail marketing (LGPD)" htmlFor="cf-consent" hint="Aparece desmarcada; só quem marcar recebe campanhas. Deixe vazio para não mostrar.">
            <Textarea id="cf-consent" rows={2} maxLength={500} value={f.consentText ?? ''} onChange={(e) => set('consentText', e.target.value)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origem do lead" htmlFor="cf-origin">
              <Input id="cf-origin" list="cf-origins" maxLength={80} value={f.originName} onChange={(e) => set('originName', e.target.value)} />
              <datalist id="cf-origins">{options.data?.origins.map((o) => <option key={o.id} value={o.name} />)}</datalist>
            </Field>
            <Field label="Responsável" htmlFor="cf-owner">
              <SellerPick id="cf-owner" value={f.ownerId} onChange={(v) => set('ownerId', v)} />
            </Field>
            <Field label="Tags" htmlFor="cf-tags" className="space-y-1.5 sm:col-span-2">
              <Input id="cf-tags" placeholder="orcamento, site" value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              Criar atendimento na fila de Pré-Vendas
              <Switch checked={f.createRecord} onCheckedChange={(c) => set('createRecord', c)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Formulário ativo
              <Switch checked={f.active} onCheckedChange={(c) => set('active', c)} />
            </label>
          </div>

          <FormError message={error} />
          <div className="flex gap-2 border-t pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ---------- Pop-ups ----------

function PopupsTab() {
  const q = useQuery({ queryKey: ['captura-popups'], queryFn: () => api.get<CapturePopup[]>('/captura/popups') })
  const forms = useForms()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState<CapturePopup | 'new' | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/captura/popups/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['captura-popups'] })
      toast.success('Pop-up excluído.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={3} />
  const formName = (id: string) => forms.data?.find((f) => f.id === id)?.name ?? '—'
  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('captura', 'create') && (
          <Button onClick={() => setOpen('new')} disabled={!forms.data?.length}>
            <PlusIcon /> Novo pop-up
          </Button>
        )}
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={MegaphoneIcon} title="Nenhum pop-up ainda" description={forms.data?.length ? 'Crie um pop-up com um dos seus formulários.' : 'Crie primeiro um formulário (aba Formulários).'} />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Pop-up</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead className="text-right">Exibições</TableHead>
                <TableHead className="text-right">Envios</TableHead>
                <TableHead className="text-right">Conversão</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4">
                    <p className="flex items-center gap-2 font-medium">
                      {p.name}
                      <Badge variant={p.active ? 'default' : 'outline'}>{p.active ? 'No ar' : 'Pausado'}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">Formulário: {formName(p.formId)}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {TRIGGER_LABEL[p.trigger]}
                    {p.trigger === 'delay' ? ` (${p.delaySec} s)` : p.trigger === 'scroll' ? ` (${p.scrollPct}%)` : ''}
                    <p className="text-xs text-muted-foreground">{DEVICE_RULE_LABEL[p.device]}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(p.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{int.format(p.submissions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.views ? `${((p.submissions / p.views) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    {can('captura', 'edit') && (
                      <Button size="sm" variant="ghost" onClick={() => setOpen(p)} aria-label={`Editar ${p.name}`}>
                        <PencilIcon />
                      </Button>
                    )}
                    {can('captura', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`Excluir o pop-up "${p.name}"?`) && remove.mutate(p.id)} aria-label={`Excluir ${p.name}`}>
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {open && forms.data && <PopupEditor popup={open === 'new' ? null : open} forms={forms.data} onClose={() => setOpen(null)} />}
    </>
  )
}

function PopupEditor({ popup, forms, onClose }: { popup: CapturePopup | null; forms: CaptureForm[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [p, setP] = useState(() =>
    popup
      ? { ...popup }
      : {
          name: '',
          formId: forms.find((f) => f.active)?.id ?? forms[0]!.id,
          title: 'Precisa de peças para sua máquina?',
          text: 'Deixe seu contato que nossa equipe envia o orçamento.',
          imageUrl: '',
          trigger: 'delay' as Trigger,
          delaySec: 15,
          scrollPct: 50,
          include: [] as string[],
          exclude: ['/checkout', '/carrinho'],
          device: 'todos' as DeviceRule,
          frequencyDays: 7,
          color: '#1d4ed8',
          active: false,
        },
  )
  const [include, setInclude] = useState(p.include.join('\n'))
  const [exclude, setExclude] = useState(p.exclude.join('\n'))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: p.name.trim(),
        formId: p.formId,
        title: p.title,
        text: p.text || null,
        imageUrl: p.imageUrl || null,
        trigger: p.trigger,
        delaySec: p.delaySec,
        scrollPct: p.scrollPct,
        include: linesOf(include),
        exclude: linesOf(exclude),
        device: p.device,
        frequencyDays: p.frequencyDays,
        color: p.color,
        active: p.active,
      }
      return popup ? api.put(`/captura/popups/${popup.id}`, body) : api.post('/captura/popups', body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['captura-popups'] })
      toast.success('Pop-up salvo.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{popup ? `Editar: ${popup.name}` : 'Novo pop-up'}</SheetTitle>
          <SheetDescription>Aparece uma vez por visita e respeita o intervalo para não incomodar quem já fechou ou enviou.</SheetDescription>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-6"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <Field label="Nome interno" htmlFor="pp-name">
            <Input id="pp-name" required maxLength={80} placeholder="Ex.: Orçamento — páginas de produto" value={p.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Formulário" htmlFor="pp-form">
            <Select value={p.formId} onValueChange={(v) => set('formId', v)}>
              <SelectTrigger id="pp-form" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {forms.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {f.active ? '' : ' (inativo)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Título" htmlFor="pp-title">
            <Input id="pp-title" required maxLength={120} value={p.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Texto" htmlFor="pp-text">
            <Textarea id="pp-text" rows={2} maxLength={500} value={p.text ?? ''} onChange={(e) => set('text', e.target.value)} />
          </Field>
          <Field label="Imagem (opcional)" htmlFor="pp-img" hint="Endereço https:// de uma imagem (ex.: foto da loja ou de um produto).">
            <Input id="pp-img" placeholder="https://..." value={p.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quando aparece" htmlFor="pp-trigger">
              <Select value={p.trigger} onValueChange={(v) => set('trigger', v as Trigger)}>
                <SelectTrigger id="pp-trigger" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABEL) as Trigger[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {p.trigger === 'delay' && (
              <Field label="Segundos na página" htmlFor="pp-delay">
                <Input id="pp-delay" type="number" min={0} max={300} value={p.delaySec} onChange={(e) => set('delaySec', Number(e.target.value))} />
              </Field>
            )}
            {p.trigger === 'scroll' && (
              <Field label="% da página rolada" htmlFor="pp-scroll">
                <Input id="pp-scroll" type="number" min={10} max={100} value={p.scrollPct} onChange={(e) => set('scrollPct', Number(e.target.value))} />
              </Field>
            )}
            {p.trigger === 'exit' && <p className="self-end text-xs text-muted-foreground">No celular (que não tem “sair com o mouse”), aparece depois de 30 segundos.</p>}
            <Field label="Dispositivos" htmlFor="pp-device">
              <Select value={p.device} onValueChange={(v) => set('device', v as DeviceRule)}>
                <SelectTrigger id="pp-device" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DEVICE_RULE_LABEL) as DeviceRule[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DEVICE_RULE_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Não repetir por (dias)" htmlFor="pp-freq">
              <Input id="pp-freq" type="number" min={0} max={365} value={p.frequencyDays} onChange={(e) => set('frequencyDays', Number(e.target.value))} />
            </Field>
            <Field label="Mostrar só nas páginas" htmlFor="pp-inc" hint="Uma por linha. Ex.: /produto/* (vazio = todas).">
              <Textarea id="pp-inc" rows={3} value={include} onChange={(e) => setInclude(e.target.value)} />
            </Field>
            <Field label="Nunca mostrar em" htmlFor="pp-exc" hint="Uma por linha. Ex.: /checkout">
              <Textarea id="pp-exc" rows={3} value={exclude} onChange={(e) => setExclude(e.target.value)} />
            </Field>
            <Field label="Cor do botão" htmlFor="pp-color">
              <Input id="pp-color" type="color" className="h-9 w-20 p-1" value={p.color} onChange={(e) => set('color', e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            Pop-up no ar
            <Switch checked={p.active} onCheckedChange={(c) => set('active', c)} />
          </label>
          <FormError message={error} />
          <div className="flex gap-2 border-t pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ---------- Botão de WhatsApp ----------

function WhatsappTab() {
  const q = useQuery({ queryKey: ['captura-settings'], queryFn: () => api.get<CaptureSettings>('/captura/configuracoes') })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={4} />
  return <WhatsappEditor initial={q.data} />
}

function WhatsappEditor({ initial }: { initial: CaptureSettings }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('captura', 'edit')
  const [w, setW] = useState(initial.whatsapp)
  const [privacyUrl, setPrivacyUrl] = useState(initial.privacyUrl)
  const [phone, setPhone] = useState(initial.whatsapp.phone ? formatPhone(initial.whatsapp.phone) : '')
  const [include, setInclude] = useState(initial.whatsapp.include.join('\n'))
  const [exclude, setExclude] = useState(initial.whatsapp.exclude.join('\n'))
  const [tags, setTags] = useState(initial.whatsapp.tags.join(', '))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof w>(k: K, v: (typeof w)[K]) => setW((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () =>
      api.put<CaptureSettings>('/captura/configuracoes', {
        privacyUrl,
        whatsapp: { ...w, phone: phone.trim() || null, include: linesOf(include), exclude: linesOf(exclude), tags: tags.split(',').map((t) => t.trim()).filter(Boolean) },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['captura-settings'], saved)
      toast.success('Botão de WhatsApp salvo.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        setError(null)
        save.mutate()
      }}
      className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Botão flutuante de WhatsApp
            <Badge variant={initial.whatsapp.enabled ? 'default' : 'outline'}>{initial.whatsapp.enabled ? 'No ar' : 'Desligado'}</Badge>
          </CardTitle>
          <CardDescription>O visitante informa nome e WhatsApp, vira lead, entra na fila de Pré-Vendas e só então abre a conversa no número central.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              Botão no ar
              <Switch checked={w.enabled} onCheckedChange={(c) => set('enabled', c)} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do WhatsApp de Pré-Vendas" htmlFor="wa-phone" hint="Não aparece no site: só é usado depois que o visitante se identifica.">
                <Input id="wa-phone" inputMode="tel" placeholder="(49) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Texto do botão" htmlFor="wa-btn">
                <Input id="wa-btn" maxLength={40} value={w.buttonText} onChange={(e) => set('buttonText', e.target.value)} />
              </Field>
              <Field label="Título da janela" htmlFor="wa-title">
                <Input id="wa-title" maxLength={80} value={w.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Subtítulo" htmlFor="wa-sub">
                <Input id="wa-sub" maxLength={200} value={w.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
              </Field>
              <Field label="Mensagem que abre no WhatsApp" htmlFor="wa-msg" hint="Variáveis: {nome} e {pagina}." className="space-y-1.5 sm:col-span-2">
                <Textarea id="wa-msg" rows={2} maxLength={500} value={w.message} onChange={(e) => set('message', e.target.value)} />
              </Field>
              <Field label="Responsável pelos leads" htmlFor="wa-owner">
                <SellerPick id="wa-owner" value={w.ownerId} onChange={(v) => set('ownerId', v)} disabled={!canEdit} />
              </Field>
              <Field label="Tags" htmlFor="wa-tags">
                <Input id="wa-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <Field label="Posição" htmlFor="wa-pos">
                <Select value={w.position} onValueChange={(v) => set('position', v as 'direita' | 'esquerda')}>
                  <SelectTrigger id="wa-pos" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direita">Canto inferior direito</SelectItem>
                    <SelectItem value="esquerda">Canto inferior esquerdo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Dispositivos" htmlFor="wa-device">
                <Select value={w.device} onValueChange={(v) => set('device', v as DeviceRule)}>
                  <SelectTrigger id="wa-device" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DEVICE_RULE_LABEL) as DeviceRule[]).map((d) => (
                      <SelectItem key={d} value={d}>
                        {DEVICE_RULE_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Mostrar só nas páginas" htmlFor="wa-inc" hint="Uma por linha (vazio = todas).">
                <Textarea id="wa-inc" rows={2} value={include} onChange={(e) => setInclude(e.target.value)} />
              </Field>
              <Field label="Nunca mostrar em" htmlFor="wa-exc" hint="Uma por linha. Ex.: /checkout">
                <Textarea id="wa-exc" rows={2} value={exclude} onChange={(e) => setExclude(e.target.value)} />
              </Field>
              <Field label="Cor" htmlFor="wa-color">
                <Input id="wa-color" type="color" className="h-9 w-20 p-1" value={w.color} onChange={(e) => set('color', e.target.value)} />
              </Field>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                Pedir também o e-mail (opcional para o visitante)
                <Switch checked={w.askEmail} onCheckedChange={(c) => set('askEmail', c)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Criar atendimento na fila de Pré-Vendas
                <Switch checked={w.createRecord} onCheckedChange={(c) => set('createRecord', c)} />
              </label>
            </div>
          </fieldset>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Política de privacidade</CardTitle>
          <CardDescription>Link mostrado abaixo de todos os formulários (LGPD). Use a página de privacidade do site da loja.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input aria-label="Link da política de privacidade" placeholder="https://www.usaparts.com.br/politica-de-privacidade" value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} disabled={!canEdit} />
          <FormError message={error} />
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}

// ---------- Envios ----------

function SubmissionsTab() {
  const [channel, setChannel] = useState<string>(NONE)
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page), pageSize: '50', ...(channel !== NONE ? { channel } : {}) })
  const q = useQuery({ queryKey: ['captura-envios', params.toString()], queryFn: () => api.get<{ total: number; items: Submission[] }>(`/captura/envios?${params}`) })
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / 50)) : 1
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Select
          value={channel}
          onValueChange={(v) => {
            setChannel(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Canal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Todos os canais</SelectItem>
            {(Object.keys(CHANNEL_LABEL) as Submission['channel'][]).map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={5} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Nenhum envio ainda" description="Os envios de formulários, pop-ups e do botão de WhatsApp aparecem aqui." />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Data</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="hidden lg:table-cell">Página</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(s.createdAt)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{String(s.data.name ?? s.data.email ?? '—')}</p>
                    <p className="text-xs text-muted-foreground">{[s.data.email, s.data.phone ? formatPhone(String(s.data.phone)) : null].filter(Boolean).join(' · ')}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {CHANNEL_LABEL[s.channel]}
                    {s.form ? <p className="text-xs text-muted-foreground">{s.form.name}</p> : null}
                  </TableCell>
                  <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground lg:table-cell" title={s.pageUrl ?? ''}>
                    {s.pageUrl ?? '—'}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {s.leadId && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/leads/${s.leadId}`}>Ver lead</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {int.format(q.data.total)} envio(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}
