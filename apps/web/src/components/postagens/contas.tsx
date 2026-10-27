import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, LogInIcon, PlusIcon, RefreshCwIcon, SearchIcon, Trash2Icon, UnplugIcon, UsersIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { mediaSrc } from './midias'

export type Network = 'instagram' | 'facebook'
export interface Account {
  id: string
  network: Network
  externalId: string
  name: string
  group: string
  /** Conectada pelo login do Instagram. */
  via?: 'instagram'
}

/** Conexão pelo login do Instagram: app da Meta e as contas conectadas (por ID do Instagram). */
export interface InstagramLoginConfig {
  appId: string
  hasSecret: boolean
  redirectUri: string
  connections: Record<string, { username: string; expiresAt: string; connectedBy: string; lastError: string | null }>
}

/** Login do Instagram: ID e chave do app e o botão de conectar (abre a tela de login do Instagram). */
function InstagramConnect({ ig }: { ig: InstagramLoginConfig }) {
  const qc = useQueryClient()
  const [appId, setAppId] = useState(ig.appId)
  const [secret, setSecret] = useState('')
  const [setup, setSetup] = useState(!ig.appId || !ig.hasSecret)
  useEffect(() => setAppId(ig.appId), [ig.appId])
  const save = useMutation({
    mutationFn: () => api.put('/postagens/instagram/app', { appId: appId.trim(), ...(secret.trim() ? { secret: secret.trim() } : {}) }),
    onSuccess: () => {
      toast.success('App do Instagram salvo.')
      setSecret('')
      setSetup(false)
      void qc.invalidateQueries({ queryKey: ['postagens-config'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>('/postagens/instagram/conectar'),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const ready = !!ig.appId && ig.hasSecret
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <NetBadge n="instagram" className="size-8 rounded-md text-xs" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Conectar pelo login do Instagram</p>
          <p className="text-sm text-muted-foreground">
            Abre a tela do Instagram: entre com o usuário e a senha da conta e autorize. A senha fica só no Instagram; o CRM recebe o acesso para publicar, que é renovado sozinho. Repita para cada conta (a conta precisa ser profissional: Empresa ou Criador de conteúdo).
          </p>
        </div>
        <div className="flex gap-2">
          {ready && (
            <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? <Loader2Icon className="animate-spin" /> : <LogInIcon />} Conectar conta do Instagram
            </Button>
          )}
          {ready && !setup && (
            <Button variant="ghost" onClick={() => setSetup(true)}>
              App do Instagram
            </Button>
          )}
        </div>
      </div>
      {setup && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Em developers.facebook.com, no app da empresa, adicione o produto Instagram › API com login do Instagram. Em Configurar o login da empresa, copie o ID e a chave secreta do app do Instagram e cadastre este endereço de redirecionamento:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{ig.redirectUri}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(ig.redirectUri)
                toast.success('Endereço copiado.')
              }}
            >
              <CopyIcon /> Copiar
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ig-app-id">ID do app do Instagram</Label>
              <Input id="ig-app-id" value={appId} inputMode="numeric" maxLength={25} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ig-app-secret">Chave secreta do app do Instagram</Label>
              <Input id="ig-app-secret" type="password" autoComplete="off" value={secret} maxLength={200} onChange={(e) => setSecret(e.target.value)} placeholder={ig.hasSecret ? 'Guardada (preencha só para trocar)' : ''} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || !appId || (!secret.trim() && !ig.hasSecret)}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Salvar app
            </Button>
            {ready && (
              <Button variant="ghost" onClick={() => setSetup(false)}>
                Fechar
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

/** Volta do login do Instagram: conclui a conexão e volta para a aba Contas. */
export function InstagramRetornoPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const done = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) {
      setError(params.get('error_description') ?? params.get('error_reason') ?? 'O Instagram não devolveu a autorização. Tente conectar de novo.')
      return
    }
    api
      .post<{ username: string }>('/postagens/instagram/retorno', { code, state })
      .then((r) => {
        toast.success(`Instagram conectado${r.username ? `: @${r.username}` : ''}.`)
        navigate('/postagens?aba=contas', { replace: true })
      })
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [params, navigate])
  return (
    <div>
      <PageHeader title="Conectando o Instagram" />
      {error ? (
        <EmptyState
          icon={UnplugIcon}
          title="Não foi possível conectar"
          description={error}
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/postagens?aba=contas">Voltar para as contas</Link>
            </Button>
          }
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Concluindo a conexão...
        </p>
      )}
    </div>
  )
}

/** Marca da rede (o pacote de ícones não tem as logomarcas): IG e f nas cores de cada uma. */
export function NetBadge({ n, className }: { n: Network; className?: string }) {
  return (
    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] leading-none font-bold text-white', n === 'instagram' ? 'bg-gradient-to-tr from-amber-500 via-pink-600 to-purple-600' : 'bg-[#1877f2]', className)} aria-label={n === 'instagram' ? 'Instagram' : 'Facebook'}>
      {n === 'instagram' ? 'IG' : 'f'}
    </span>
  )
}

/** Situação da conexão pelo login do Instagram (embaixo do ID). */
function IgStatus({ c }: { c?: InstagramLoginConfig['connections'][string] }) {
  if (!c) return <p className="mt-1 text-xs text-red-600">Sem conexão: conecte de novo.</p>
  const expired = Date.parse(c.expiresAt) < Date.now()
  return (
    <p className={cn('mt-1 text-xs', expired || c.lastError ? 'text-red-600' : 'text-muted-foreground')} title={c.lastError ?? undefined}>
      {expired ? 'Conexão vencida: conecte de novo.' : c.lastError ? 'Não renovou: conecte de novo.' : `Login do Instagram · renova sozinho (válido até ${new Date(c.expiresAt).toLocaleDateString('pt-BR')})`}
    </p>
  )
}

const groupsOf = (accounts: Account[]) => [...new Set(accounts.map((a) => a.group || 'Geral'))]

/** Escolha das contas da postagem: uma, várias, um grupo inteiro ou todas. */
export function AccountPicker({ accounts, value, onChange, disabled }: { accounts: Account[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  if (!accounts.length) return <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada. Cadastre na aba Contas.</p>
  const all = accounts.every((a) => value.includes(a.id))
  const setMany = (ids: string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((x) => !ids.includes(x)))
  return (
    <div className="space-y-2 rounded-md border p-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={all} onCheckedChange={(v) => setMany(accounts.map((a) => a.id), !!v)} disabled={disabled} /> Todas as contas ({accounts.length})
      </label>
      {groupsOf(accounts).map((g) => {
        const list = accounts.filter((a) => (a.group || 'Geral') === g)
        const on = list.every((a) => value.includes(a.id))
        return (
          <div key={g} className="space-y-1 border-t pt-2">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Checkbox checked={on} onCheckedChange={(v) => setMany(list.map((a) => a.id), !!v)} disabled={disabled} /> Grupo {g}
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
              {list.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={value.includes(a.id)} onCheckedChange={(v) => setMany([a.id], !!v)} disabled={disabled} />
                  <NetBadge n={a.network} /> {a.name}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Aba Contas ----------

export function AccountsTab({ accounts, instagram }: { accounts: Account[]; instagram?: InstagramLoginConfig }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const edit = can('postagens', 'edit')
  const [list, setList] = useState<Account[]>(accounts)
  const [found, setFound] = useState<Account[] | null>(null)
  useEffect(() => setList(accounts), [accounts])
  const dirty = JSON.stringify(list) !== JSON.stringify(accounts)
  const save = useMutation({
    mutationFn: () => api.put<{ accounts: Account[] }>('/postagens/contas', { accounts: list }),
    onSuccess: () => {
      toast.success('Contas salvas.')
      void qc.invalidateQueries({ queryKey: ['postagens-config'] })
      void qc.invalidateQueries({ queryKey: ['postagens-metricas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const discover = useMutation({
    mutationFn: () => api.post<{ found: Account[] }>('/postagens/contas/buscar'),
    onSuccess: (r) => setFound(r.found),
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const groups = groupsOf(list)
  const set = (i: number, patch: Partial<Account>) => setList(list.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  return (
    <div className="space-y-4">
      {edit && instagram && <InstagramConnect ig={instagram} />}
      <p className="text-sm text-muted-foreground">
        Também dá para usar o token da Meta (Configurações › Marketing Inteligente). Cada conta é um Instagram profissional ou uma página do Facebook. A empresa pode ter várias (ex.: a conta oficial e a de cada vendedor). Use os grupos para escolher várias de uma vez nas postagens e para somar as métricas. As contas precisam estar no Gerenciador de Negócios da empresa, atribuídas ao usuário do sistema do token (o Instagram de cada vendedor ligado a uma página).
      </p>
      {edit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => discover.mutate()} disabled={discover.isPending}>
            {discover.isPending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />} Buscar na Meta
          </Button>
          <Button variant="outline" onClick={() => setList([...list, { id: '', network: 'instagram', externalId: '', name: '', group: groups[0] ?? 'Oficial' }])}>
            <PlusIcon /> Adicionar à mão
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Salvar contas
          </Button>
        </div>
      )}
      {found && (
        <Card className="gap-2 p-3">
          <p className="text-sm font-medium">Contas que o token alcança ({found.length})</p>
          {!found.length && <p className="text-sm text-muted-foreground">Nenhuma: atribua as páginas (e o Instagram ligado a elas) ao usuário do sistema no Gerenciador de Negócios.</p>}
          {found.map((a) => {
            const has = list.some((x) => x.network === a.network && x.externalId === a.externalId)
            return (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <NetBadge n={a.network} /> {a.name} <span className="text-xs text-muted-foreground">{a.externalId}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={has} onClick={() => setList([...list, { ...a, group: groups[0] ?? 'Oficial' }])}>
                  {has ? 'Já está na lista' : 'Adicionar'}
                </Button>
              </div>
            )
          })}
        </Card>
      )}
      {!list.length ? (
        <EmptyState icon={UsersIcon} title="Nenhuma conta" description="Use Buscar na Meta para trazer as páginas e os Instagram que o token alcança." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Rede</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>ID na Meta</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a, i) => (
                <TableRow key={`${a.network}-${a.externalId}-${i}`}>
                  <TableCell className="pl-4">
                    <Select value={a.network} onValueChange={(v) => set(i, { network: v as Network })} disabled={!edit || a.via === 'instagram'}>
                      <SelectTrigger className="w-36" aria-label="Rede">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="facebook">Facebook</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input value={a.name} maxLength={80} onChange={(e) => set(i, { name: e.target.value })} disabled={!edit} placeholder="@usuario ou nome da página" aria-label="Nome" />
                  </TableCell>
                  <TableCell>
                    <Input value={a.externalId} maxLength={25} onChange={(e) => set(i, { externalId: e.target.value.replace(/\D/g, '') })} disabled={!edit || a.via === 'instagram'} placeholder="Só números" aria-label="ID na Meta" className="w-48" />
                    {a.via === 'instagram' && <IgStatus c={instagram?.connections[a.externalId]} />}
                  </TableCell>
                  <TableCell>
                    <Input value={a.group} maxLength={40} list="postagens-grupos" onChange={(e) => set(i, { group: e.target.value })} disabled={!edit} placeholder="Ex.: Vendedores" aria-label="Grupo" className="w-40" />
                  </TableCell>
                  <TableCell>
                    {edit && (
                      <Button size="icon" variant="ghost" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={`Tirar ${a.name}`}>
                        <Trash2Icon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <datalist id="postagens-grupos">
            {['Oficial', 'Vendedores', ...groups].filter((g, i, arr) => arr.indexOf(g) === i).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Card>
      )}
    </div>
  )
}

// ---------- Aba Métricas ----------

interface Breakdown {
  key: string
  value: number
}
interface AccountRow extends Account {
  followers: number | null
  posts: number | null
  reach: number | null
  engaged: number | null
  interactions: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  engagement: number | null
  demographics: { age: Breakdown[]; gender: Breakdown[]; city: Breakdown[]; country: Breakdown[] } | null
  warnings: string[]
  error: string | null
}
interface MetricsData {
  at: string
  accounts: AccountRow[]
  groups: { group: string; accounts: number; followers: number | null; reach: number | null; interactions: number | null; engagement: number | null }[]
  posts: { postId: string; title: string; format: string; publishedAt: string | null; mediaId: string | null; accountId: string; account: string; network: Network; group: string; permalink: string | null; metrics: { reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; interactions: number | null } | null; engagement: number | null; error: string | null }[]
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR'))
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR')}%`)
const GENDER: Record<string, string> = { M: 'Homens', F: 'Mulheres', U: 'Não informado' }

function Bars({ title, list, label = (k: string) => k }: { title: string; list: Breakdown[]; label?: (k: string) => string }) {
  const total = list.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {list.map((x) => (
        <div key={x.key} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-xs">
          <span className="truncate">{label(x.key)}</span>
          <span className="h-2 overflow-hidden rounded bg-muted">
            <span className="block h-full rounded bg-[color:var(--brand)]" style={{ width: `${(x.value / total) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">{Math.round((x.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

export function MetricsTab() {
  const [refresh, setRefresh] = useState(0)
  const [group, setGroup] = useState('todos')
  const [selected, setSelected] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['postagens-metricas', refresh], queryFn: () => api.get<MetricsData>(`/postagens/metricas${refresh ? '?atualizar=1' : ''}`), staleTime: 10 * 60_000 })
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  const d = q.data
  const rows = d.accounts.filter((a) => group === 'todos' || a.group === group)
  const demo = d.accounts.find((a) => a.id === selected) ?? rows.find((a) => a.demographics)
  const posts = d.posts.filter((p) => group === 'todos' || p.group === group)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger className="w-48" aria-label="Grupo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os grupos</SelectItem>
            {d.groups.map((g) => (
              <SelectItem key={g.group} value={g.group}>
                {g.group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Últimos 28 dias · atualizado em {formatDateTime(d.at)}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setRefresh((r) => r + 1)} disabled={q.isFetching}>
          {q.isFetching ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Atualizar
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.groups
          .filter((g) => group === 'todos' || g.group === group)
          .map((g) => (
            <Card key={g.group} className="gap-1 p-4">
              <p className="text-xs text-muted-foreground">
                Grupo {g.group} · {g.accounts} conta(s)
              </p>
              <p className="text-2xl font-semibold tabular-nums">{num(g.followers)}</p>
              <p className="text-xs text-muted-foreground">seguidores</p>
              <p className="text-sm">
                Alcance {num(g.reach)} · Interações {num(g.interactions)} · <span className="font-medium">Engajamento {pct(g.engagement)}</span>
              </p>
            </Card>
          ))}
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Conta</TableHead>
              <TableHead>Grupo</TableHead>
              <TableHead className="text-right">Seguidores</TableHead>
              <TableHead className="text-right">Alcance</TableHead>
              <TableHead className="text-right">Interações</TableHead>
              <TableHead className="text-right">Curtidas</TableHead>
              <TableHead className="text-right">Comentários</TableHead>
              <TableHead className="text-right">Salvos</TableHead>
              <TableHead className="text-right">Compart.</TableHead>
              <TableHead className="text-right">Engajamento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id} className={cn('cursor-pointer', demo?.id === a.id && 'bg-muted/50')} onClick={() => setSelected(a.id)}>
                <TableCell className="pl-4">
                  <span className="flex items-center gap-2">
                    <NetBadge n={a.network} /> {a.name}
                  </span>
                  {(a.error || a.warnings.length > 0) && <span className="block max-w-md text-xs whitespace-normal text-amber-700 dark:text-amber-400">{a.error ?? a.warnings.join('; ')}</span>}
                </TableCell>
                <TableCell>{a.group}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.followers)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.reach)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.interactions)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.likes)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.comments)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.saves)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(a.shares)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{pct(a.engagement)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">Engajamento = interações ÷ alcance no período (sem alcance, ÷ seguidores). Clique numa conta do Instagram para ver o perfil dos seguidores.</p>
      {demo?.demographics ? (
        <Card className="gap-3 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <NetBadge n={demo.network} /> Perfil dos seguidores de {demo.name}
          </p>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <Bars title="Idade" list={[...demo.demographics.age].sort((a, b) => a.key.localeCompare(b.key))} />
            <Bars title="Gênero" list={demo.demographics.gender} label={(k) => GENDER[k] ?? k} />
            <Bars title="Cidades" list={demo.demographics.city} />
            <Bars title="Países" list={demo.demographics.country} />
          </div>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Perfil dos seguidores: disponível para contas do Instagram com 100 seguidores ou mais (a Meta não informa o perfil dos seguidores de páginas do Facebook).</p>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Postagens publicadas pelo CRM (últimos 60 dias)</p>
        {!posts.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma ainda.</p>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Postagem</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Alcance</TableHead>
                  <TableHead className="text-right">Curtidas</TableHead>
                  <TableHead className="text-right">Comentários</TableHead>
                  <TableHead className="text-right">Salvos</TableHead>
                  <TableHead className="text-right">Compart.</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((p) => (
                  <TableRow key={`${p.postId}-${p.accountId}`}>
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2">
                        {p.mediaId && <img src={mediaSrc(p.mediaId)} alt="" className="size-9 rounded object-cover" />}
                        <span className="min-w-0">
                          <span className="line-clamp-1 font-medium">{p.title}</span>
                          <span className="text-xs text-muted-foreground">{p.publishedAt ? formatDateTime(p.publishedAt) : ''}</span>
                        </span>
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noreferrer" aria-label="Abrir a publicação" className="text-muted-foreground hover:text-foreground">
                            <ExternalLinkIcon className="size-4" />
                          </a>
                        )}
                      </span>
                      {p.error && <span className="block max-w-md text-xs whitespace-normal text-amber-700 dark:text-amber-400">{p.error}</span>}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <NetBadge n={p.network} /> {p.account}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num(p.metrics?.reach)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(p.metrics?.likes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(p.metrics?.comments)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(p.metrics?.saves)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(p.metrics?.shares)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{pct(p.engagement)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  )
}
