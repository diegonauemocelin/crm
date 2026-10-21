import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CameraIcon, Loader2Icon, MonitorIcon, MoonIcon, ShieldCheckIcon, SunIcon } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { LayoutPicker } from '@/components/layout-picker'
import { UserAvatar } from '@/components/layout/user-menu'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/page'
import { type Session, SessionsList } from '@/components/sessions-list'
import { TwoFactorSetup } from '@/components/two-factor-setup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import type { LayoutMode, Me, ScreenModel, ThemeMode } from '@/lib/types'
import { FormError } from './auth/auth-layout'
import { PasswordRules } from './auth/password-pages'

export function ProfilePage() {
  const { me, can } = useAuth()
  if (!me) return null
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Meu perfil" description="Seus dados, aparência e segurança da conta." />
      <ProfileCard me={me} />
      {can('chat', 'create') && <ChatNameCard me={me} />}
      <AppearanceCard me={me} />
      <PasswordCard />
      <TwoFactorCard me={me} />
      <SessionsCard />
    </div>
  )
}

/** Nome nas mensagens enviadas pelo CRM no WhatsApp (quando o número assina as mensagens). */
function ChatNameCard({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(me.chatSignature ?? '')
  const [busy, setBusy] = useState(false)
  const first = me.name.trim().split(/\s+/)[0] ?? ''
  // Mesma limpeza do servidor (cleanSignature): sem formatação do WhatsApp, uma linha, até 40 letras.
  const label = value.replace(/[*_~`\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[:\s]+$/, '').slice(0, 40) || first
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      qc.setQueryData(['me'], await api.patch<Me>('/me/profile', { name: me.name, chatSignature: value.trim() || null }))
      toast.success('Nome nas mensagens salvo.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>Seu nome nas mensagens do WhatsApp</CardTitle>
          <CardDescription>Aparece no começo de cada mensagem que você envia pelo CRM, para o cliente saber com quem fala. Em branco, vai o seu primeiro nome.</CardDescription>
        </CardHeader>
        <CardContent className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="p-chat-name">Como aparecer</Label>
            <Input id="p-chat-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} placeholder={`Ex.: ${first || 'Diego'} - Vendas`} />
            <p className="text-xs text-muted-foreground">Até 40 letras. Só vale nos números que assinam as mensagens (Configurações → Números de WhatsApp).</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Como o cliente vê</p>
            <div className="w-fit max-w-full rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-xs dark:bg-[#005c4b] dark:text-[#e9edef]">
              <p className="font-bold break-words">{label}:</p>
              <p>Olá! Temos o filtro em estoque.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={busy || value.trim() === (me.chatSignature ?? '')}>
            {busy && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function ProfileCard({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [name, setName] = useState(me.name)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      qc.setQueryData(['me'], await api.patch<Me>('/me/profile', { name }))
      toast.success('Dados salvos.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const uploadAvatar = async (f: File) => {
    if (f.size > 1024 * 1024) return toast.error('Imagem maior que 1 MB.')
    const form = new FormData()
    form.append('file', f)
    try {
      qc.setQueryData(['me'], await api.post<Me>('/me/avatar', form))
      toast.success('Foto atualizada.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <form onSubmit={saveName}>
        <CardHeader>
          <CardTitle>Dados pessoais</CardTitle>
          <CardDescription>
            {me.email} · perfil {me.role.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="relative w-fit">
            <UserAvatar name={me.name} url={me.avatarUrl} className="size-20 rounded-full text-xl" />
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-muted"
              aria-label="Trocar foto"
            >
              <CameraIcon className="size-4" />
            </button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="p-name" required>Nome</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
          </div>
          <Button type="submit" disabled={busy || name.trim() === me.name}>
            {busy && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardContent>
      </form>
    </Card>
  )
}

function AppearanceCard({ me }: { me: Me }) {
  const qc = useQueryClient()
  const { theme, setTheme } = useTheme()

  const savePref = async (body: { layout?: LayoutMode; theme?: ThemeMode; screens?: ScreenModel }) => {
    try {
      qc.setQueryData(['me'], await api.patch<Me>('/me/preferences', body))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>
          {me.allowLayoutChoice ? 'Escolha um dos 4 modelos (layout e telas) e o tema. A preferência vale em qualquer computador.' : 'O administrador definiu um layout único para todos. Você ainda pode escolher o tema.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <LayoutPicker value={{ layout: me.layout, screens: me.screens ?? 'ATUAL' }} onChange={(m) => savePref(m)} disabled={!me.allowLayoutChoice} />
        <div>
          <p className="mb-2 text-sm font-medium">Tema</p>
          <RadioGroup
            value={theme}
            onValueChange={(v) => {
              setTheme(v as ThemeMode)
              void savePref({ theme: v as ThemeMode })
            }}
            className="flex flex-wrap gap-4"
          >
            {[
              { v: 'LIGHT', label: 'Claro', icon: SunIcon },
              { v: 'DARK', label: 'Escuro', icon: MoonIcon },
              { v: 'SYSTEM', label: 'Automático', icon: MonitorIcon },
            ].map((o) => (
              <label key={o.v} className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value={o.v} />
                <o.icon className="size-4 text-muted-foreground" />
                {o.label}
              </label>
            ))}
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setError('As senhas não conferem.')
    setBusy(true)
    setError(null)
    try {
      await api.post('/me/password', { currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Senha alterada. As sessões em outros dispositivos foram encerradas.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Senha</CardTitle>
          <CardDescription>Ao trocar a senha, você continua conectado aqui e é desconectado dos outros dispositivos.</CardDescription>
        </CardHeader>
        <CardContent className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="pw-current" required>Senha atual</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-next" required>Nova senha</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm" required>Confirme a nova senha</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <PasswordRules />
            <div className="mt-3">
              <FormError message={error} />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={busy || !current || !next || !confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Alterar senha
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function TwoFactorCard({ me }: { me: Me }) {
  const { refresh } = useAuth()
  const [setupOpen, setSetupOpen] = useState(false)
  // Com o 2FA ativo, reconfigurar pede a senha antes (o servidor confere de novo).
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/2fa/setup', { password })
      setConfirmed(password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/2fa/disable', { password })
      await refresh()
      setDisableOpen(false)
      setPassword('')
      toast.success('2FA desativado.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Verificação em duas etapas (2FA)
          {me.totpEnabled ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Desativada</Badge>}
        </CardTitle>
        <CardDescription>
          Além da senha, pede um código do aplicativo autenticador do celular. {me.role.require2fa && 'Obrigatória para o seu perfil.'}
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        {me.totpEnabled ? (
          <>
            <Button variant="outline" onClick={() => setSetupOpen(true)}>
              <ShieldCheckIcon /> Reconfigurar e gerar novos códigos
            </Button>
            {!me.role.require2fa && (
              <Button variant="ghost" onClick={() => setDisableOpen(true)}>
                Desativar
              </Button>
            )}
          </>
        ) : (
          <Button onClick={() => setSetupOpen(true)}>
            <ShieldCheckIcon /> Ativar 2FA
          </Button>
        )}
      </CardFooter>

      <Dialog
        open={setupOpen}
        onOpenChange={(o) => {
          setSetupOpen(o)
          if (!o) {
            setConfirmed(null)
            setPassword('')
            setError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar 2FA</DialogTitle>
            <DialogDescription>Ao concluir, o autenticador anterior e os códigos de recuperação antigos deixam de valer.</DialogDescription>
          </DialogHeader>
          {setupOpen && me.totpEnabled && !confirmed ? (
            <form onSubmit={confirmPassword} className="space-y-4">
              <p className="text-sm text-muted-foreground">Por segurança, confirme sua senha para trocar o aplicativo autenticador.</p>
              <Input type="password" autoComplete="current-password" aria-label="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              <FormError message={error} />
              <DialogFooter>
                <Button type="submit" disabled={busy || !password}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  Continuar
                </Button>
              </DialogFooter>
            </form>
          ) : (
            setupOpen && (
              <TwoFactorSetup
                password={confirmed ?? undefined}
                onDone={async () => {
                  await refresh()
                  setSetupOpen(false)
                  setConfirmed(null)
                  setPassword('')
                  toast.success(me.totpEnabled ? '2FA reconfigurado.' : '2FA ativado.')
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={disable} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Desativar 2FA</DialogTitle>
              <DialogDescription>Sua conta ficará protegida apenas pela senha. Confirme com sua senha.</DialogDescription>
            </DialogHeader>
            <Input type="password" autoComplete="current-password" aria-label="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDisableOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !password}>
                {busy && <Loader2Icon className="animate-spin" />}
                Desativar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function SessionsCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['me-sessoes'], queryFn: () => api.get<Session[]>('/me/sessoes') })
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const revoke = async (s: Session) => {
    const ok = await confirm({
      title: `Desconectar ${s.device}?`,
      description: 'A conta sai desse aparelho na hora. Para voltar a usar o sistema nele, será preciso entrar de novo com e-mail e senha.',
      confirmLabel: 'Desconectar aparelho',
    })
    if (!ok) return
    setBusy(s.id)
    try {
      await api.delete(`/me/sessoes/${s.id}`)
      toast.success(`${s.device} desconectado.`)
      await qc.invalidateQueries({ queryKey: ['me-sessoes'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const revokeOthers = async () => {
    const ok = await confirm({
      title: `Desconectar ${others} outro(s) aparelho(s)?`,
      description: 'A conta sai de todos os aparelhos, menos deste. Em cada um deles, será preciso entrar de novo com e-mail e senha.',
      confirmLabel: 'Desconectar outros aparelhos',
    })
    if (!ok) return
    setBusy('outros')
    try {
      await api.post('/me/sessoes/encerrar-outras')
      toast.success('Os outros aparelhos foram desconectados.')
      await qc.invalidateQueries({ queryKey: ['me-sessoes'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const others = (q.data ?? []).filter((s) => !s.current).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparelhos conectados</CardTitle>
        <CardDescription>
          Onde sua conta está aberta agora. Se não reconhecer algum, desconecte e troque a senha. Você recebe um e-mail quando a conta é acessada por um aparelho novo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data ? <SessionsList sessions={q.data} onRevoke={(s) => void revoke(s)} busyId={busy} /> : <TableSkeleton rows={2} />}
      </CardContent>
      {others > 0 && (
        <CardFooter>
          <Button variant="outline" onClick={() => void revokeOthers()} disabled={busy !== null}>
            {busy === 'outros' && <Loader2Icon className="animate-spin" />}
            Desconectar todos os outros ({others})
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
