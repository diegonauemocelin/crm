import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, ImageIcon, Loader2Icon, PlugZapIcon, SendIcon, Trash2Icon, UploadIcon, XCircleIcon } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LayoutPicker } from '@/components/layout-picker'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { applyBranding } from '@/lib/branding'
import type { Branding, LayoutMode } from '@/lib/types'
import { FormError } from './auth/auth-layout'

export function SettingsPage() {
  return (
    <RequirePermission module="configuracoes">
      <PageHeader title="Configurações" description="Identidade visual, aparência e servidor de e-mail do sistema." />
      <Tabs defaultValue="marca">
        <TabsList className="mb-4">
          <TabsTrigger value="marca">Identidade visual</TabsTrigger>
          <TabsTrigger value="aparencia">Aparência</TabsTrigger>
          <TabsTrigger value="email">E-mail (SMTP)</TabsTrigger>
        </TabsList>
        <TabsContent value="marca">
          <BrandingTab />
        </TabsContent>
        <TabsContent value="aparencia">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="email">
          <SmtpTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

function useBrandingSettings() {
  return useQuery({ queryKey: ['settings-branding'], queryFn: () => api.get<Branding>('/settings/branding') })
}

type BrandingForm = Omit<Branding, 'logoUrl' | 'logoDarkUrl' | 'faviconUrl'>

function pickForm(b: Branding): BrandingForm {
  const { logoUrl: _l, logoDarkUrl: _d, faviconUrl: _f, ...rest } = b
  return rest
}

function useSaveBranding() {
  const qc = useQueryClient()
  const { can } = useAuth()
  return {
    canEdit: can('configuracoes', 'edit'),
    onSaved: (b: Branding) => {
      qc.setQueryData(['settings-branding'], b)
      qc.setQueryData(['branding'], b)
      void qc.invalidateQueries({ queryKey: ['me'] })
      applyBranding(b)
    },
  }
}

function ColorField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          aria-label={`${label}: seletor`}
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="font-mono" disabled={disabled} />
      </div>
    </div>
  )
}

function ImageSlot({ slot, label, hint, url, onSaved, disabled }: { slot: string; label: string; hint: string; url: string | null; onSaved: (b: Branding) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    if (file.size > 1024 * 1024) {
      toast.error('Arquivo maior que 1 MB.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      onSaved(await api.post<Branding>(`/settings/branding/${slot}`, form))
      toast.success(`${label} atualizado.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      onSaved(await api.post<Branding>(`/settings/branding/${slot}/remove`))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <div className={`flex size-14 shrink-0 items-center justify-center rounded-md border ${slot === 'logo-dark' ? 'bg-zinc-900' : 'bg-muted/40'}`}>
        {url ? <img src={url} alt={label} className="max-h-12 max-w-12 object-contain" /> : <ImageIcon className="size-5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => input.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        Enviar
      </Button>
      {url && (
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={busy || disabled} onClick={remove} aria-label={`Remover ${label}`}>
          <Trash2Icon />
        </Button>
      )}
    </div>
  )
}

function BrandingTab() {
  const query = useBrandingSettings()
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <TableSkeleton rows={5} />
  return <BrandingEditor data={query.data} />
}

function BrandingEditor({ data }: { data: Branding }) {
  const { canEdit, onSaved } = useSaveBranding()
  const [form, setForm] = useState<BrandingForm>(() => pickForm(data))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (f: BrandingForm) => api.put<Branding>('/settings/branding', f),
    onSuccess: (b) => {
      onSaved(b)
      toast.success('Identidade visual salva.')
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const set = <K extends keyof BrandingForm>(k: K, v: BrandingForm[K]) => setForm({ ...form, [k]: v })

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setError(null)
            save.mutate(form)
          }}
        >
          <CardHeader>
            <CardTitle>Marca</CardTitle>
            <CardDescription>Nome, cores e textos exibidos em todo o sistema e nos e-mails enviados por ele.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="b-name">Nome do sistema</Label>
              <Input id="b-name" required maxLength={60} value={form.appName} onChange={(e) => set('appName', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-short">Nome curto</Label>
              <Input id="b-short" required maxLength={30} value={form.shortName} onChange={(e) => set('shortName', e.target.value)} disabled={!canEdit} />
            </div>
            <ColorField id="b-primary" label="Cor principal (botões e destaques)" value={form.primaryColor} onChange={(v) => set('primaryColor', v)} disabled={!canEdit} />
            <ColorField id="b-nav" label="Cor do menu (layout Clássico e login)" value={form.sidebarColor} onChange={(v) => set('sidebarColor', v)} disabled={!canEdit} />
            <div className="space-y-2">
              <Label htmlFor="b-title">Título da tela de login</Label>
              <Input id="b-title" maxLength={80} value={form.loginTitle} onChange={(e) => set('loginTitle', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-sub">Subtítulo da tela de login</Label>
              <Input id="b-sub" maxLength={160} value={form.loginSubtitle} onChange={(e) => set('loginSubtitle', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-support">E-mail de suporte (opcional)</Label>
              <Input id="b-support" type="email" maxLength={200} value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Imagens</CardTitle>
          <CardDescription>PNG, JPG, WEBP ou ICO de até 1 MB. SVG não é aceito por segurança.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ImageSlot slot="logo" label="Logo" hint="Fundo claro. Ideal: quadrado, 256×256." url={data.logoUrl} onSaved={onSaved} disabled={!canEdit} />
          <ImageSlot slot="logo-dark" label="Logo para fundo escuro" hint="Usado no menu escuro e no modo escuro." url={data.logoDarkUrl} onSaved={onSaved} disabled={!canEdit} />
          <ImageSlot slot="favicon" label="Favicon" hint="Ícone da aba do navegador. 64×64 ou ICO." url={data.faviconUrl} onSaved={onSaved} disabled={!canEdit} />
        </CardContent>
      </Card>
    </div>
  )
}

function AppearanceTab() {
  const query = useBrandingSettings()
  const { canEdit, onSaved } = useSaveBranding()
  const [layout, setLayout] = useState<LayoutMode | null>(null)
  const [allow, setAllow] = useState<boolean | null>(null)

  const save = useMutation({
    mutationFn: (b: Branding) => api.put<Branding>('/settings/branding', { ...pickForm(b), defaultLayout: layout ?? b.defaultLayout, allowLayoutChoice: allow ?? b.allowLayoutChoice }),
    onSuccess: (b) => {
      onSaved(b)
      toast.success('Aparência salva.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <TableSkeleton rows={3} />
  const b = query.data

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Layout padrão</CardTitle>
        <CardDescription>Como o sistema aparece para quem ainda não escolheu um layout em Meu perfil.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <LayoutPicker value={layout ?? b.defaultLayout} onChange={setLayout} disabled={!canEdit} />
        <label className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm">
          <span>
            <span className="font-medium">Permitir que cada usuário escolha o próprio layout</span>
            <span className="block text-muted-foreground">Desligado: todos usam o layout padrão acima.</span>
          </span>
          <Switch checked={allow ?? b.allowLayoutChoice} onCheckedChange={setAllow} disabled={!canEdit} />
        </label>
      </CardContent>
      {canEdit && (
        <CardFooter>
          <Button onClick={() => save.mutate(b)} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

interface SmtpView {
  host: string
  port: number
  security: 'ssl' | 'starttls' | 'none'
  username: string
  fromName: string
  fromEmail: string
  replyTo: string
  maxPerMinute: number
  hasPassword: boolean
}

type TestResult = { ok: boolean; message: string } | null

function SmtpTab() {
  const query = useQuery({ queryKey: ['settings-smtp'], queryFn: () => api.get<SmtpView>('/settings/smtp') })
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <TableSkeleton rows={5} />
  return <SmtpEditor initial={query.data} />
}

function SmtpEditor({ initial }: { initial: SmtpView }) {
  const { me, can } = useAuth()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const [form, setForm] = useState<SmtpView>(initial)
  const [password, setPassword] = useState('')
  const [testTo, setTestTo] = useState(me?.email ?? '')
  const [result, setResult] = useState<TestResult>(null)
  const [busy, setBusy] = useState<'save' | 'conn' | 'mail' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof SmtpView>(k: K, v: SmtpView[K]) => setForm({ ...form, [k]: v })
  const payload = () => {
    const { hasPassword: _h, ...rest } = form
    return { ...rest, ...(password ? { password } : {}) }
  }

  const run = async (kind: 'conn' | 'mail') => {
    setBusy(kind)
    setResult(null)
    try {
      const res =
        kind === 'conn'
          ? await api.post<TestResult>('/settings/smtp/test-connection', payload())
          : await api.post<TestResult>('/settings/smtp/test-email', { ...payload(), to: testTo })
      setResult(res)
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const saved = await api.put<SmtpView>('/settings/smtp', payload())
      qc.setQueryData(['settings-smtp'], saved)
      setForm(saved)
      setPassword('')
      toast.success('Servidor de e-mail salvo.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle>Servidor de envio (SMTP)</CardTitle>
            <CardDescription>Usado para convites, recuperação de senha e, nas próximas fases, para as campanhas de e-mail marketing.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-4">
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <span className="flex-1">Usa a hospedagem de e-mail da Locaweb?</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, host: 'email-ssl.com.br', port: 465, security: 'ssl' })}
                >
                  Preencher dados da Locaweb
                </Button>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_10rem]">
              <div className="space-y-2">
                <Label htmlFor="s-host">Servidor</Label>
                <Input id="s-host" required placeholder="email-ssl.com.br" value={form.host} onChange={(e) => set('host', e.target.value.trim())} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-port">Porta</Label>
                <Input id="s-port" type="number" required min={1} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-sec">Segurança</Label>
                <Select value={form.security} onValueChange={(v) => set('security', v as SmtpView['security'])} disabled={!canEdit}>
                  <SelectTrigger id="s-sec" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssl">SSL/TLS (465)</SelectItem>
                    <SelectItem value="starttls">STARTTLS (587)</SelectItem>
                    <SelectItem value="none">Nenhuma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="s-user">Usuário</Label>
                <Input id="s-user" autoComplete="off" placeholder="contato@usaparts.com.br" value={form.username} onChange={(e) => set('username', e.target.value.trim())} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-pass">Senha</Label>
                <Input
                  id="s-pass"
                  type="password"
                  autoComplete="new-password"
                  placeholder={form.hasPassword ? '•••••••• (mantida)' : ''}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">Guardada criptografada. Deixe em branco para manter a atual.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-fromname">Nome do remetente</Label>
                <Input id="s-fromname" placeholder="USA Parts" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-from">E-mail do remetente</Label>
                <Input id="s-from" type="email" required value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value.trim())} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-reply">Responder para (opcional)</Label>
                <Input id="s-reply" type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value.trim())} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-rate">Limite de envios por minuto</Label>
                <Input id="s-rate" type="number" min={0} value={form.maxPerMinute} onChange={(e) => set('maxPerMinute', Number(e.target.value))} disabled={!canEdit} />
                <p className="text-xs text-muted-foreground">0 = sem limite.</p>
              </div>
            </div>
            <FormError message={error} />
          </CardContent>
          {canEdit && (
            <CardFooter className="mt-4">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' && <Loader2Icon className="animate-spin" />}
                Salvar
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Testar</CardTitle>
            <CardDescription>Os testes usam os dados do formulário, mesmo antes de salvar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button type="button" variant="outline" className="w-full" disabled={busy !== null || !form.host} onClick={() => run('conn')}>
              {busy === 'conn' ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
              Testar conexão
            </Button>
            <div className="space-y-2">
              <Label htmlFor="s-to">Enviar e-mail de teste para</Label>
              <div className="flex gap-2">
                <Input id="s-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <Button type="button" disabled={busy !== null || !testTo || !form.host} onClick={() => run('mail')}>
                  {busy === 'mail' ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Enviar
                </Button>
              </div>
            </div>
            {result && (
              <p
                role="status"
                className={`flex gap-2 rounded-md border p-3 text-sm ${result.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-destructive/40 bg-destructive/10'}`}
              >
                {result.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
                {result.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
