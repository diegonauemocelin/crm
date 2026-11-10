import { AwardIcon, CheckCircle2Icon, GiftIcon, Loader2Icon, LogOutIcon, StarIcon } from 'lucide-react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Meus pontos: página pública do programa de fidelidade. O cliente entra sem senha (link assinado do e-mail/WhatsApp
 * ou código de 6 dígitos) e vê só os próprios dados. A sessão fica na aba (sessionStorage) e vale 12 horas.
 */

interface PublicConfig {
  enabled: boolean
  company: string
  logoUrl: string | null
  color: string
  title: string
  intro: string
  rules: string
  consent: string
  loginEmail: boolean
  loginWhatsapp: boolean
  levels: { name: string; min: number; benefits: string; color: string }[]
  levelBasis: 'pontos' | 'gasto'
}

interface Me {
  name: string
  email: string | null
  phone: string | null
  needsConsent: boolean
  balance: number
  level: { name: string; color: string; benefits: string } | null
  nextLevel: { name: string; min: number } | null
  levelValue: number
  missing: number
  expiring: { points: number; expiresAt: string }[]
  ledger: { kind: string; points: number; reason: string; createdAt: string; expiresAt: string | null }[]
  rewards: { id: string; name: string; description: string | null; kind: string; pointsCost: number; discountType: string | null; value: number | null; minLevel: string | null; locked: boolean; available: boolean; soldOut: boolean }[]
  redemptions: { id: string; code: string; rewardName: string; kind: string; points: number; status: string; expiresAt: string | null; createdAt: string }[]
  toReview: { orderId: string; code: string; orderedAt: string }[]
  reviewBonus: number
  reviewAspects: boolean
}

class PublicError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SESSION_KEY = 'fidelidade_sessao'
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(SESSION_KEY)
    } catch {
      return null
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(SESSION_KEY, v)
      else sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // navegação privada sem armazenamento: a sessão vale só enquanto a página estiver aberta
    }
  },
}

function csrf() {
  return document.cookie.split('; ').find((c) => c.startsWith('crm_csrf='))?.split('=')[1] ?? ''
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/public/fidelidade${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new PublicError(0, 'Sem conexão. Tente de novo em instantes.')
  }
  const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null
  if (!res.ok) {
    const m = Array.isArray(data?.message) ? data?.message[0] : data?.message
    throw new PublicError(res.status, res.status === 429 ? 'Muitas tentativas seguidas. Aguarde um minuto.' : m && !/^[A-Za-z ]+$/.test(m) ? m : 'Não foi possível concluir. Tente de novo.')
  }
  return data as T
}

const nf = (v: number) => v.toLocaleString('pt-BR')
const day = (v: string) => new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const KIND: Record<string, string> = { GANHO: 'Compra', BONUS: 'Bônus', RESGATE: 'Resgate', EXPIRADO: 'Vencidos', AJUSTE: 'Ajuste', ESTORNO: 'Estorno' }
const STATUS: Record<string, string> = { PENDENTE: 'Disponível', USADO: 'Usado', ENTREGUE: 'Entregue', EXPIRADO: 'Vencido', CANCELADO: 'Cancelado' }

function rewardValue(r: { kind: string; discountType: string | null; value: number | null }) {
  if (r.value === null) return null
  return r.kind === 'DESCONTO' && r.discountType === 'PERCENTUAL' ? `${nf(r.value)}% de desconto` : r.kind === 'CASHBACK' ? `${brl(r.value)} de cashback` : `${brl(r.value)} de desconto`
}

export function MeusPontosPage() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [cfgError, setCfgError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(() => store.get())
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewOrder, setReviewOrder] = useState<string | null>(() => {
    const v = new URLSearchParams(window.location.search).get('avaliar')
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null
  })

  const logout = useCallback((message?: string) => {
    store.set(null)
    setToken(null)
    setMe(null)
    if (message) setNotice(message)
  }, [])

  const load = useCallback(
    async (t: string) => {
      try {
        setMe(await call<Me>('GET', '/eu', undefined, t))
      } catch (e) {
        if (e instanceof PublicError && e.status === 401) logout(e.message)
        else setNotice((e as Error).message)
      }
    },
    [logout],
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const c = await call<PublicConfig>('GET', '/config')
        if (!alive) return
        setCfg(c)
        // Link do e-mail/WhatsApp: troca pela sessão e tira o token do endereço.
        const url = new URL(window.location.href)
        const link = url.searchParams.get('t')
        let t = store.get()
        if (link) {
          url.searchParams.delete('t')
          window.history.replaceState(null, '', url.pathname + url.search)
          try {
            t = (await call<{ token: string }>('POST', '/link', { token: link })).token
            store.set(t)
            setToken(t)
          } catch (e) {
            setNotice((e as Error).message)
          }
        }
        if (t) await load(t)
      } catch (e) {
        setCfgError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [load])

  const style = { '--fid': cfg?.color || '#1d4ed8' } as CSSProperties

  return (
    <div className="min-h-svh bg-muted/40" style={style}>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {cfg?.logoUrl ? <img src={cfg.logoUrl} alt={cfg.company} className="h-9 max-w-40 object-contain" /> : <AwardIcon className="size-7" style={{ color: 'var(--fid)' }} />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{cfg?.title ?? 'Programa de fidelidade'}</h1>
            {cfg?.company && <p className="truncate text-xs text-muted-foreground">{cfg.company}</p>}
          </div>
          {me && (
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              <LogOutIcon /> Sair
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {notice && <p className="rounded-md border bg-background p-3 text-sm">{notice}</p>}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : cfgError ? (
          <p className="text-sm text-muted-foreground">{cfgError}</p>
        ) : !cfg?.enabled ? (
          <Card>
            <CardContent className="py-6 text-sm">O programa de fidelidade não está ativo no momento.</CardContent>
          </Card>
        ) : !token || !me ? (
          <Login
            cfg={cfg}
            onLogged={async (t) => {
              store.set(t)
              setToken(t)
              setNotice(null)
              await load(t)
            }}
          />
        ) : me.needsConsent ? (
          <Consent
            cfg={cfg}
            me={me}
            onAccept={async () => {
              try {
                await call('POST', '/consentimento', {}, token)
                await load(token)
              } catch (e) {
                setNotice((e as Error).message)
              }
            }}
          />
        ) : reviewOrder && me.toReview.some((o) => o.orderId === reviewOrder) ? (
          <Review
            order={me.toReview.find((o) => o.orderId === reviewOrder)!}
            me={me}
            token={token}
            onDone={async () => {
              await load(token)
            }}
            onClose={() => setReviewOrder(null)}
          />
        ) : (
          <Dashboard cfg={cfg} me={me} token={token} onChange={() => load(token)} onReview={setReviewOrder} onLeft={() => logout('Você saiu do programa de fidelidade. Não vai mais receber mensagens dele.')} />
        )}
      </main>
    </div>
  )
}

function Login({ cfg, onLogged }: { cfg: PublicConfig; onLogged: (token: string) => Promise<void> }) {
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const what = cfg.loginEmail && cfg.loginWhatsapp ? 'e-mail ou celular (WhatsApp)' : cfg.loginWhatsapp ? 'celular (WhatsApp)' : 'e-mail'
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>{cfg.intro}</CardDescription>
      </CardHeader>
      <CardContent>
        {!sent ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => setSent((await call<{ message: string }>('POST', '/codigo', { contact: contact.trim() })).message))
            }}
          >
            <div>
              <Label htmlFor="fid-contato">Seu {what}</Label>
              <Input id="fid-contato" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" required maxLength={200} />
            </div>
            <p className="text-xs text-muted-foreground">Use o mesmo {what} das suas compras na loja virtual. Enviamos um código de 6 dígitos; não há senha.</p>
            <Button type="submit" className="w-full" disabled={busy || contact.trim().length < 5} style={{ background: 'var(--fid)' }}>
              {busy && <Loader2Icon className="animate-spin" />}
              Receber código
            </Button>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => onLogged((await call<{ token: string }>('POST', '/entrar', { contact: contact.trim(), code: code.trim() })).token))
            }}
          >
            <p className="text-sm">{sent}</p>
            <div>
              <Label htmlFor="fid-codigo">Código</Label>
              <Input id="fid-codigo" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6} style={{ background: 'var(--fid)' }}>
              {busy && <Loader2Icon className="animate-spin" />}
              Entrar
            </Button>
            <Button type="button" variant="link" className="w-full" onClick={() => (setSent(null), setCode(''))}>
              Usar outro contato ou pedir outro código
            </Button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

function Consent({ cfg, me, onAccept }: { cfg: PublicConfig; me: Me; onAccept: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Olá, {me.name}!</CardTitle>
        <CardDescription>{cfg.intro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap rounded-md border bg-muted/50 p-3 text-sm">{cfg.consent}</p>
        {cfg.rules && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{cfg.rules}</p>}
        <Button className="w-full" disabled={busy} style={{ background: 'var(--fid)' }} onClick={async () => (setBusy(true), await onAccept(), setBusy(false))}>
          {busy && <Loader2Icon className="animate-spin" />}
          Concordo e quero ver meus pontos
        </Button>
      </CardContent>
    </Card>
  )
}

function Section({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Dashboard({ cfg, me, token, onChange, onReview, onLeft }: { cfg: PublicConfig; me: Me; token: string; onChange: () => Promise<void>; onReview: (orderId: string) => void; onLeft: () => void }) {
  const [code, setCode] = useState<{ code: string; rewardName: string; kind: string; expiresAt: string | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const progress = me.nextLevel ? Math.min(100, Math.round((me.levelValue / Math.max(1, me.nextLevel.min)) * 100)) : 100
  const unit = cfg.levelBasis === 'gasto' ? 'em compras' : 'pontos'
  const redeem = async (id: string, name: string, cost: number) => {
    if (!window.confirm(`Trocar ${nf(cost)} pontos por "${name}"?`)) return
    setBusy(id)
    setError(null)
    try {
      setCode(await call('POST', '/resgatar', { rewardId: id }, token))
      await onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const leave = async () => {
    if (!window.confirm('Sair do programa? Você para de ganhar pontos e de receber mensagens dele. Seus pontos atuais ficam guardados, mas não poderá usá-los enquanto estiver fora.')) return
    try {
      await call('POST', '/sair', {}, token)
      onLeft()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      <Card className="overflow-hidden">
        <div className="h-1.5" style={{ background: 'var(--fid)' }} />
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Olá, {me.name}! Seu saldo</p>
            <p className="text-4xl font-bold tabular-nums" style={{ color: 'var(--fid)' }}>
              {nf(me.balance)}
            </p>
            <p className="text-sm text-muted-foreground">pontos</p>
            {me.expiring.length > 0 && <p className="mt-2 text-xs text-amber-700">{me.expiring.map((e) => `${nf(e.points)} pontos vencem em ${day(e.expiresAt)}`).join('; ')}</p>}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Seu nível</p>
            <p className="text-xl font-semibold" style={{ color: me.level?.color }}>
              {me.level?.name ?? '—'}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
              <div className="h-full rounded" style={{ width: `${progress}%`, background: 'var(--fid)' }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{me.nextLevel ? `Faltam ${cfg.levelBasis === 'gasto' ? brl(me.missing) : nf(me.missing)} ${unit} nos últimos 12 meses para ${me.nextLevel.name}` : 'Você está no nível mais alto. Parabéns!'}</p>
            {me.level?.benefits && <p className="mt-2 text-sm">{me.level.benefits}</p>}
          </div>
        </CardContent>
      </Card>

      {code && (
        <Card className="border-emerald-300">
          <CardContent className="space-y-2 py-5 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2Icon className="size-4 text-emerald-600" /> Resgate feito: {code.rewardName}
            </p>
            <p className="text-2xl font-bold tracking-wider">{code.code}</p>
            <p className="text-muted-foreground">
              {code.kind === 'BRINDE' ? 'Informe este código ao seu vendedor ou na loja para retirar o brinde.' : 'Informe este código ao vendedor na próxima compra: ele aplica o valor no pedido.'}
              {code.expiresAt ? ` Vale até ${day(code.expiresAt)}.` : ''}
            </p>
          </CardContent>
        </Card>
      )}
      {error && <p className="rounded-md border border-destructive/40 bg-background p-3 text-sm text-destructive">{error}</p>}

      {me.toReview.length > 0 && (
        <Section title="Avalie suas compras" description={me.reviewBonus ? `Cada avaliação vale ${nf(me.reviewBonus)} pontos.` : undefined}>
          <ul className="space-y-2">
            {me.toReview.map((o) => (
              <li key={o.orderId} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Pedido {o.code} <span className="text-muted-foreground">({day(o.orderedAt)})</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onReview(o.orderId)}>
                  <StarIcon /> Avaliar
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Prêmios" description="Troque seus pontos. Desconto e cashback geram um código para usar na próxima compra com o vendedor.">
        {me.rewards.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {me.rewards.map((r) => (
              <div key={r.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3">
                <div>
                  <p className="flex items-center gap-1.5 font-medium">
                    <GiftIcon className="size-4" style={{ color: 'var(--fid)' }} />
                    {r.name}
                  </p>
                  {rewardValue(r) && <p className="text-sm">{rewardValue(r)}</p>}
                  {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                  {r.minLevel && <p className="text-xs text-muted-foreground">A partir do nível {r.minLevel}</p>}
                </div>
                {r.kind === 'BENEFICIO' ? (
                  <p className="text-xs text-muted-foreground">Benefício do nível{r.locked ? '' : ': já é seu'}.</p>
                ) : (
                  <Button size="sm" disabled={!r.available || busy === r.id} onClick={() => redeem(r.id, r.name, r.pointsCost)} style={r.available ? { background: 'var(--fid)' } : undefined}>
                    {busy === r.id && <Loader2Icon className="animate-spin" />}
                    {r.soldOut ? 'Esgotado' : r.locked ? 'Nível acima do seu' : `${nf(r.pointsCost)} pontos`}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum prêmio disponível agora.</p>
        )}
      </Section>

      {me.redemptions.length > 0 && (
        <Section title="Meus resgates">
          <ul className="space-y-2 text-sm">
            {me.redemptions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5">{r.code}</code>
                <span>{r.rewardName}</span>
                <span className="text-muted-foreground">
                  {STATUS[r.status] ?? r.status}
                  {r.status === 'PENDENTE' && r.expiresAt ? ` até ${day(r.expiresAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Extrato">
        {me.ledger.length ? (
          <ul className="divide-y text-sm">
            {me.ledger.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p>{e.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {day(e.createdAt)} · {KIND[e.kind] ?? e.kind}
                    {e.expiresAt ? ` · vence em ${day(e.expiresAt)}` : ''}
                  </p>
                </div>
                <span className={`tabular-nums font-medium ${e.points < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {e.points > 0 ? '+' : ''}
                  {nf(e.points)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ainda sem movimentos.</p>
        )}
      </Section>

      <Section title="Níveis" description={cfg.levelBasis === 'gasto' ? 'Pelo valor comprado nos últimos 12 meses.' : 'Pelos pontos ganhos nos últimos 12 meses.'}>
        <ul className="space-y-2 text-sm">
          {cfg.levels.map((l) => (
            <li key={l.name}>
              <span className="font-medium" style={{ color: l.color }}>
                {l.name}
              </span>{' '}
              <span className="text-muted-foreground">a partir de {cfg.levelBasis === 'gasto' ? brl(l.min) : `${nf(l.min)} pontos`}</span>
              {l.benefits && <p className="text-xs text-muted-foreground">{l.benefits}</p>}
            </li>
          ))}
        </ul>
        {cfg.rules && <p className="mt-4 whitespace-pre-wrap text-xs text-muted-foreground">{cfg.rules}</p>}
      </Section>

      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Entrou como {me.email ?? me.phone ?? me.name}. Só você vê estes dados.
        </span>
        <button type="button" className="underline" onClick={leave}>
          Sair do programa
        </button>
      </div>
    </>
  )
}

function Scale({ max, min = 1, value, onChange, label }: { max: number; min?: number; value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`size-9 rounded-md border text-sm font-medium transition-colors ${value === v ? 'text-white' : 'bg-background hover:bg-muted'}`}
          style={value === v ? { background: 'var(--fid)', borderColor: 'var(--fid)' } : undefined}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function Review({ order, me, token, onDone, onClose }: { order: { orderId: string; code: string }; me: Me; token: string; onDone: () => Promise<void>; onClose: () => void }) {
  const [stars, setStars] = useState<number | null>(null)
  const [nps, setNps] = useState<number | null>(null)
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ bonus: number; thanks: string; google: { url: string; text: string } | null } | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      setDone(await call('POST', `/avaliacao/${order.orderId}`, { stars, nps, comment: comment.trim() || undefined, aspects }, token))
      await onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (done) {
    return (
      <Section title="Avaliação enviada">
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2">
            <CheckCircle2Icon className="size-4 text-emerald-600" /> {done.thanks}
          </p>
          {done.bonus > 0 && <p>Você ganhou {nf(done.bonus)} pontos.</p>}
          {done.google && (
            <div className="rounded-md border p-3">
              <p>{done.google.text}</p>
              <a href={done.google.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium underline" style={{ color: 'var(--fid)' }}>
                Avaliar no Google
              </a>
            </div>
          )}
          <Button variant="outline" onClick={onClose}>
            Ver meus pontos
          </Button>
        </div>
      </Section>
    )
  }
  return (
    <Section title={`Como foi o pedido ${order.code}?`} description={me.reviewBonus ? `Leva menos de um minuto e vale ${nf(me.reviewBonus)} pontos.` : undefined}>
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Sua nota para a compra (estrelas)</Label>
          <div className="flex gap-1" role="radiogroup" aria-label="Estrelas">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={stars === v} aria-label={`${v} estrela(s)`} onClick={() => setStars(v)}>
                <StarIcon className={`size-8 ${stars !== null && v <= stars ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>De 0 a 10, quanto você recomendaria a nossa loja a um amigo ou colega?</Label>
          <Scale min={0} max={10} value={nps} onChange={setNps} label="Recomendação de 0 a 10" />
        </div>
        {me.reviewAspects && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(['produto', 'entrega', 'atendimento'] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label className="capitalize">{k} (opcional)</Label>
                <Scale max={5} value={aspects[k] ?? null} onChange={(v) => setAspects((a) => ({ ...a, [k]: v }))} label={k} />
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="fid-coment">Quer contar mais? (opcional)</Label>
          <Textarea id="fid-coment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={stars === null || nps === null || busy} onClick={submit} style={{ background: 'var(--fid)' }}>
            {busy && <Loader2Icon className="animate-spin" />}
            Enviar avaliação
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Agora não
          </Button>
        </div>
      </div>
    </Section>
  )
}
