import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2Icon, Loader2Icon, PlugIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type FreightUnit, maskCep, maskCnpj, useFreightContext } from '@/lib/fretes'

export function FretesFiliaisPage() {
  return (
    <RequirePermission module="fretes_filiais">
      <Filiais />
    </RequirePermission>
  )
}

function Filiais() {
  const ctx = useFreightContext()
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const roles = useMutation({
    mutationFn: () => api.post<{ created: string[]; existing: string[] }>('/fretes/perfis/padrao'),
    onSuccess: (r) => toast.success(r.created.length ? `Perfis criados: ${r.created.join(', ')}. Ajuste em Configurações → Perfis de acesso e vincule aos usuários.` : 'Os perfis prontos já existiam (nada foi alterado).'),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const seed = useMutation({
    mutationFn: () => api.post<{ created: string[]; completed: string[] }>('/fretes/filiais/padrao'),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(r.created.length || r.completed.length ? `Criadas: ${r.created.join(', ') || 'nenhuma'}. Completadas: ${r.completed.join(', ') || 'nenhuma'}.` : 'As quatro unidades já estavam cadastradas.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-4">
      <PageHeader
        title="Filiais"
        description="Dados fiscais e CEP de expedição de cada filial: a origem das cotações. Novas unidades e o acesso de cada pessoa ficam em Configurações (Listas e Usuários)."
        actions={
          <>
            {me?.role.isSystem && (
              <Button variant="outline" onClick={() => roles.mutate()} disabled={roles.isPending}>
                {roles.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Criar perfis prontos de fretes
              </Button>
            )}
            {can('fretes_filiais', 'edit') && ctx.data?.global && (
              <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
                {seed.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Cadastrar as unidades da Usaparts
              </Button>
            )}
          </>
        }
      />
      {ctx.isLoading ? (
        <TableSkeleton />
      ) : ctx.error ? (
        <ErrorState error={ctx.error} onRetry={() => ctx.refetch()} />
      ) : !ctx.data?.units.length ? (
        <EmptyState icon={Building2Icon} title="Nenhuma filial liberada" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ctx.data.units.map((u) => (
            <UnitCard key={u.id} unit={u} editable={can('fretes_filiais', 'edit')} />
          ))}
        </div>
      )}
      <IcmsRates editable={can('fretes_filiais', 'edit') && !!ctx.data?.global} />
      {can('fretes_cte', 'view') && <RecParams editable={can('fretes_cte', 'edit') && !!ctx.data?.global} carriers={ctx.data?.carriers ?? []} />}
      {can('fretes_cte', 'view') && <SefazCapture />}
      {can('fretes_transportadoras', 'view') && <OnlineQuotes />}
      <Integrations />
    </div>
  )
}

function UnitCard({ unit, editable }: { unit: FreightUnit; editable: boolean }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ cnpj: unit.cnpj ? maskCnpj(unit.cnpj) : '', legalName: unit.legalName ?? '', zip: unit.zip ? maskCep(unit.zip) : '', address: unit.address ?? '', city: unit.city ?? '', state: unit.state ?? '' })
  const save = useMutation({
    mutationFn: () => api.patch(`/fretes/filiais/${unit.id}`, { cnpj: f.cnpj || null, legalName: f.legalName || null, zip: f.zip || null, address: f.address || null, city: f.city || null, state: f.state || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(`${unit.name} salva.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {unit.name} {unit.isHeadquarters && <Badge variant="outline">Matriz</Badge>} {!unit.active && <Badge variant="outline">Inativa</Badge>}
        </CardTitle>
        {!unit.zip && <CardDescription className="text-amber-700 dark:text-amber-300">Sem CEP de expedição: a cotação pede o CEP de origem.</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <fieldset disabled={!editable} className="contents">
            <div className="space-y-1.5">
              <Label htmlFor={`u-cnpj-${unit.id}`}>CNPJ</Label>
              <Input id={`u-cnpj-${unit.id}`} value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: maskCnpj(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`u-legal-${unit.id}`}>Razão social</Label>
              <Input id={`u-legal-${unit.id}`} value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`u-zip-${unit.id}`}>CEP de expedição</Label>
              <Input id={`u-zip-${unit.id}`} value={f.zip} onChange={(e) => setF({ ...f, zip: maskCep(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`u-addr-${unit.id}`}>Endereço de origem</Label>
              <Input id={`u-addr-${unit.id}`} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`u-city-${unit.id}`}>Cidade</Label>
              <Input id={`u-city-${unit.id}`} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`u-uf-${unit.id}`}>UF</Label>
              <Input id={`u-uf-${unit.id}`} maxLength={2} className="uppercase" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} />
            </div>
          </fieldset>
          {editable && (
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" size="sm" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/** Situação real das integrações: nenhuma aparece como ligada sem estar. */
const INTEGRATIONS = [
  { name: 'Mercado Livre (Mercado Envios 1 / ME1)', need: 'Usa a conexão do Mercado Livre que o CRM já tem. Falta definir com o comercial quais tabelas valem para a loja oficial e o formato de envio da tabela de frete ao Mercado Livre.' },
  { name: 'Google Shopping (Merchant Center)', need: 'Conta do Merchant Center com acesso de API. O frete dos produtos sai das tabelas marcadas como exclusivas para "Google Shopping".' },
  { name: 'Tcar (ERP): pedidos e notas', need: 'A integração da Tcar já existe para produtos. Falta liberar a consulta de pedidos e notas fiscais expedidas. Fase 3.' },
  { name: 'APIs das transportadoras (rastreamento e cotação on-line)', need: 'Credenciais de cada transportadora que oferecer API.' },
]

interface OnlineView {
  melhorEnvio: { enabled: boolean; hasToken: boolean; email: string; sandbox: boolean; services: number[] }
  correios: { enabled: boolean; user: string; hasAccessCode: boolean; postCard: string; products: { code: string; name: string }[] }
  braspress: { enabled: boolean; user: string; hasPassword: boolean; modal: 'R' | 'A' }
}

/** Cotação online: Melhor Envio (token da conta, escolhendo quais transportadoras aparecem) e Correios (contrato). */
function OnlineQuotes() {
  const { can } = useAuth()
  const editable = can('fretes_transportadoras', 'edit')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'integracoes'], queryFn: () => api.get<OnlineView>('/fretes/integracoes') })
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<OnlineView>('/fretes/integracoes', body),
    onSuccess: (v) => (qc.setQueryData(['fretes', 'integracoes'], v), toast.success('Integração salva.')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = q.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugIcon className="size-4" aria-hidden /> Cotação online: Melhor Envio, Correios e Braspress
        </CardTitle>
        <CardDescription>
          Ligadas, a cotação de frete também consulta essas APIs na hora e mostra os valores junto com as tabelas, para comparar. As chaves ficam criptografadas e nunca voltam para a tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading ? <TableSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
          <>
            <MelhorEnvioForm v={d.melhorEnvio} editable={editable} saving={save.isPending} onSave={(m) => save.mutate({ melhorEnvio: m })} />
            <CorreiosForm v={d.correios} editable={editable} saving={save.isPending} onSave={(c) => save.mutate({ correios: c })} />
            <BraspressForm v={d.braspress} editable={editable} saving={save.isPending} onSave={(b) => save.mutate({ braspress: b })} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MelhorEnvioForm({ v, editable, saving, onSave }: { v: OnlineView['melhorEnvio']; editable: boolean; saving: boolean; onSave: (m: Record<string, unknown>) => void }) {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState(v.email)
  const [sandbox, setSandbox] = useState(v.sandbox)
  const [services, setServices] = useState<number[]>(v.services)
  const list = useQuery({ queryKey: ['fretes', 'melhor-envio', 'servicos', v.hasToken], queryFn: () => api.get<{ id: number; name: string; company: string }[]>('/fretes/integracoes/melhor-envio/servicos'), enabled: v.hasToken })
  const body = (enabled: boolean) => ({ enabled, email, sandbox, services, ...(token.trim() ? { token: token.trim() } : {}) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Melhor Envio</p>
        <Badge variant="outline" className={v.enabled ? 'border-[#0ca30c]/50 text-[#006300] dark:text-[#0ca30c]' : 'text-muted-foreground'}>{v.enabled ? 'Ligado' : v.hasToken ? 'Desligado' : 'Não conectado'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">No painel do Melhor Envio: Integrações › Permissões de acesso › Gerar novo token (marque a permissão de cálculo de frete). Cole o token aqui; ele não aparece de novo.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="me-token">Token {v.hasToken && <span className="text-xs text-muted-foreground">(cadastrado; em branco mantém)</span>}</Label>
          <Input id="me-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="me-email">E-mail da conta (o Melhor Envio pede para identificar o sistema)</Label>
          <Input id="me-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editable} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} disabled={!editable} /> Ambiente de testes (sandbox)
      </label>
      {v.hasToken && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Transportadoras que aparecem na cotação {services.length ? `(${services.length})` : '(todas)'}</p>
          {list.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando os serviços do Melhor Envio…</p>
          ) : list.error ? (
            <p className="text-xs text-destructive">{errorMessage(list.error)}</p>
          ) : (
            <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
              {(list.data ?? []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={!editable} checked={services.includes(s.id)} onChange={(e) => setServices((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                  {s.company} · {s.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => onSave(body(v.enabled))}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onSave(body(!v.enabled))}>
            {v.enabled ? 'Desligar' : 'Salvar e ligar'}
          </Button>
        </div>
      )}
    </div>
  )
}

function CorreiosForm({ v, editable, saving, onSave }: { v: OnlineView['correios']; editable: boolean; saving: boolean; onSave: (c: Record<string, unknown>) => void }) {
  const [user, setUser] = useState(v.user)
  const [code, setCode] = useState('')
  const [card, setCard] = useState(v.postCard)
  const [products, setProducts] = useState(v.products)
  const body = (enabled: boolean) => ({ enabled, user, postCard: card, products: products.filter((p) => p.code.trim() && p.name.trim()), ...(code.trim() ? { accessCode: code.trim() } : {}) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Correios (contrato)</p>
        <Badge variant="outline" className={v.enabled ? 'border-[#0ca30c]/50 text-[#006300] dark:text-[#0ca30c]' : 'text-muted-foreground'}>{v.enabled ? 'Ligado' : v.hasAccessCode ? 'Desligado' : 'Não conectado'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        A API dos Correios não usa a senha do site: use o usuário do Meu Correios e o <b>código de acesso à API</b>, gerado em cws.correios.com.br (Gestão de acesso a API's), e o número do cartão de postagem do contrato.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="co-user">Usuário (Meu Correios)</Label>
          <Input id="co-user" value={user} onChange={(e) => setUser(e.target.value)} disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="co-code">Código de acesso à API {v.hasAccessCode && <span className="text-xs text-muted-foreground">(em branco mantém)</span>}</Label>
          <Input id="co-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="co-card">Cartão de postagem</Label>
          <Input id="co-card" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} disabled={!editable} />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Serviços do contrato (código do produto e nome)</p>
        {products.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input className="w-28" value={p.code} placeholder="03298" onChange={(e) => setProducts((x) => x.map((y, j) => (j === i ? { ...y, code: e.target.value } : y)))} disabled={!editable} aria-label="Código do serviço" />
            <Input className="max-w-xs" value={p.name} placeholder="PAC" onChange={(e) => setProducts((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} disabled={!editable} aria-label="Nome do serviço" />
            {editable && (
              <Button variant="ghost" size="sm" onClick={() => setProducts((x) => x.filter((_, j) => j !== i))}>
                Tirar
              </Button>
            )}
          </div>
        ))}
        {editable && products.length < 10 && (
          <Button variant="outline" size="sm" onClick={() => setProducts((x) => [...x, { code: '', name: '' }])}>
            Adicionar serviço
          </Button>
        )}
        <p className="text-xs text-muted-foreground">Os códigos mais comuns de contrato são 03298 (PAC) e 03220 (SEDEX); confira os do seu contrato no Meu Correios.</p>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => onSave(body(v.enabled))}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onSave(body(!v.enabled))}>
            {v.enabled ? 'Desligar' : 'Salvar e ligar'}
          </Button>
        </div>
      )}
    </div>
  )
}

function BraspressForm({ v, editable, saving, onSave }: { v: OnlineView['braspress']; editable: boolean; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [user, setUser] = useState(v.user)
  const [password, setPassword] = useState('')
  const [modal, setModal] = useState<'R' | 'A'>(v.modal)
  const body = (enabled: boolean) => ({ enabled, user, modal, ...(password.trim() ? { password: password.trim() } : {}) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Braspress</p>
        <Badge variant="outline" className={v.enabled ? 'border-[#0ca30c]/50 text-[#006300] dark:text-[#0ca30c]' : 'text-muted-foreground'}>{v.enabled ? 'Ligado' : v.hasPassword ? 'Desligado' : 'Não conectado'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Usuário e senha da API de cotação, pedidos à Braspress (não é o login do site). A cotação usa o CNPJ da filial de origem e precisa do CPF/CNPJ do destinatário na cotação.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="br-user">Usuário da API</Label>
          <Input id="br-user" value={user} onChange={(e) => setUser(e.target.value)} disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="br-pass">Senha da API {v.hasPassword && <span className="text-xs text-muted-foreground">(em branco mantém)</span>}</Label>
          <Input id="br-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="br-modal">Modal</Label>
          <select id="br-modal" className="h-9 w-full rounded-md border bg-transparent px-2" value={modal} onChange={(e) => setModal(e.target.value === 'A' ? 'A' : 'R')} disabled={!editable}>
            <option value="R">Rodoviário</option>
            <option value="A">Aéreo</option>
          </select>
        </div>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => onSave(body(v.enabled))}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />} Salvar
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onSave(body(!v.enabled))}>
            {v.enabled ? 'Desligar' : 'Salvar e ligar'}
          </Button>
        </div>
      )}
    </div>
  )
}

function Integrations() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugIcon className="size-4" aria-hidden /> Integrações do módulo de fretes
        </CardTitle>
        <CardDescription>Situação atual. O cálculo usa só as tabelas cadastradas aqui; nenhuma integração está sendo simulada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {INTEGRATIONS.map((i) => (
          <div key={i.name} className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 last:border-0 last:pb-0">
            <div className="max-w-2xl">
              <p className="text-sm font-medium">{i.name}</p>
              <p className="text-xs text-muted-foreground">{i.need}</p>
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              Não conectada
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

/** Alíquotas internas de ICMS do frete por UF. A interestadual o sistema calcula pela legislação. */
interface RecSettings {
  valor: number
  percentual: number
  porTransportadora: Record<string, { valor: number; percentual: number }>
  diasSemCte: number
  diasFatura: number
}

const br = (v: number | undefined) => (v === undefined ? '' : String(v).replace('.', ','))
const nb = (v: string) => Number(v.trim().replace(',', '.'))

/** Tolerâncias da conciliação (geral e por transportadora) e prazos dos alertas. */
function RecParams({ editable, carriers }: { editable: boolean; carriers: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'conciliacao', 'parametros'], queryFn: () => api.get<RecSettings>('/fretes/ctes/parametros') })
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const d = q.data
  const values: Record<string, string> =
    draft ??
    (d
      ? {
          valor: br(d.valor),
          percentual: br(d.percentual),
          diasSemCte: String(d.diasSemCte),
          diasFatura: String(d.diasFatura),
          ...Object.fromEntries(carriers.flatMap((c) => [[`v:${c.id}`, br(d.porTransportadora[c.id]?.valor)], [`p:${c.id}`, br(d.porTransportadora[c.id]?.percentual)]])),
        }
      : {})
  const set = (k: string, v: string) => setDraft({ ...values, [k]: v })
  const save = useMutation({
    mutationFn: () => {
      const porTransportadora: RecSettings['porTransportadora'] = {}
      for (const c of carriers) {
        const v = values[`v:${c.id}`]?.trim()
        const p = values[`p:${c.id}`]?.trim()
        if (v || p) porTransportadora[c.id] = { valor: v ? nb(v) : 0, percentual: p ? nb(p) : 0 }
      }
      const body = { valor: nb(values.valor ?? ''), percentual: nb(values.percentual ?? ''), diasSemCte: Number(values.diasSemCte), diasFatura: Number(values.diasFatura), porTransportadora }
      if ([body.valor, body.percentual, body.diasSemCte, body.diasFatura, ...Object.values(porTransportadora).flatMap((t) => [t.valor, t.percentual])].some((x) => !Number.isFinite(x))) throw new Error('Confira os números.')
      return api.put<RecSettings>('/fretes/ctes/parametros', body)
    },
    onSuccess: (r) => {
      qc.setQueryData(['fretes', 'conciliacao', 'parametros'], r)
      setDraft(null)
      toast.success('Parâmetros da conciliação salvos. Valem para os próximos CT-es (use Conciliar de novo nos antigos).')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conciliação de CT-e e alertas</CardTitle>
        <CardDescription>Diferença aceita entre o cobrado e o esperado: vale a maior entre o valor em reais e o percentual. A da transportadora substitui a geral.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="rec-v">Tolerância (R$)</Label>
                <Input id="rec-v" inputMode="decimal" value={values.valor ?? ''} onChange={(e) => set('valor', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-p">Tolerância (%)</Label>
                <Input id="rec-p" inputMode="decimal" value={values.percentual ?? ''} onChange={(e) => set('percentual', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-dc">Alerta sem CT-e após (dias)</Label>
                <Input id="rec-dc" inputMode="numeric" value={values.diasSemCte ?? ''} onChange={(e) => set('diasSemCte', e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-df">Alerta de fatura (dias antes)</Label>
                <Input id="rec-df" inputMode="numeric" value={values.diasFatura ?? ''} onChange={(e) => set('diasFatura', e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
            {carriers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Por transportadora (deixe em branco para usar a geral)</p>
                {carriers.map((c) => (
                  <div key={c.id} className="grid grid-cols-[1fr_7rem_7rem] items-center gap-2 text-sm">
                    <span>{c.name}</span>
                    <Input aria-label={`Tolerância em reais de ${c.name}`} inputMode="decimal" placeholder="R$" value={values[`v:${c.id}`] ?? ''} onChange={(e) => set(`v:${c.id}`, e.target.value)} />
                    <Input aria-label={`Tolerância em % de ${c.name}`} inputMode="decimal" placeholder="%" value={values[`p:${c.id}`] ?? ''} onChange={(e) => set(`p:${c.id}`, e.target.value)} />
                  </div>
                ))}
              </div>
            )}
            {editable && (
              <div className="flex justify-end">
                <Button onClick={() => save.mutate()} disabled={!draft || save.isPending}>
                  {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar parâmetros
                </Button>
              </div>
            )}
          </fieldset>
        )}
        {!editable && <p className="text-xs text-muted-foreground">Só quem tem acesso a todas as filiais e pode editar CT-e altera estes parâmetros.</p>}
      </CardContent>
    </Card>
  )
}

function IcmsRates({ editable }: { editable: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['fretes', 'icms'], queryFn: () => api.get<{ internas: Record<string, number>; origem?: Record<string, { fonte: string; cte?: string | null; data?: string | null; nota?: string | null }> }>('/fretes/icms') })
  const [learned, setLearned] = useState<{ read: number; updated: { uf: string; from: number | null; to: number }[]; ignored: { file: string; reason: string }[] } | null>(null)
  const learn = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('arquivos', f)
      return api.post<{ read: number; updated: { uf: string; from: number | null; to: number }[]; ignored: { file: string; reason: string }[] }>('/fretes/icms/cte', fd)
    },
    onSuccess: (r) => {
      setDraft(null)
      setLearned(r)
      qc.invalidateQueries({ queryKey: ['fretes', 'icms'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const origin = (u: string) => {
    const o = q.data?.origem?.[u]
    if (!o) return null
    return o.fonte === 'cte' ? `Lida do ${o.cte?.length === 44 ? `CT-e ${o.cte.slice(25, 34)}` : (o.cte ?? 'CT-e')}${o.data ? ` em ${o.data.split('-').reverse().join('/')}` : ''}${o.nota ? ` (${o.nota})` : ''}` : `Cadastro manual${o.data ? ` em ${o.data.split('-').reverse().join('/')}` : ''}`
  }
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const values = draft ?? Object.fromEntries(UFS.map((u) => [u, q.data?.internas[u] !== undefined ? String(q.data.internas[u]).replace('.', ',') : '']))
  const save = useMutation({
    mutationFn: () => {
      const internas: Record<string, number | null> = {}
      for (const u of UFS) {
        const v = values[u]!.trim()
        if (!v) continue
        const n = Number(v.replace(',', '.'))
        if (!Number.isFinite(n)) throw new Error(`Alíquota de ${u} inválida.`)
        internas[u] = n
      }
      return api.put('/fretes/icms', { internas })
    },
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['fretes', 'icms'] })
      toast.success('Alíquotas salvas.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ICMS do frete</CardTitle>
        <CardDescription>
          Interestadual: automático pela Resolução do Senado 22/1989 (7% saindo do Sul/Sudeste, menos ES, para Norte, Nordeste, Centro-Oeste e ES; 12% nos demais). Dentro do mesmo estado: a alíquota interna abaixo. UF em branco fica em aberto: o ICMS não é calculado e a cotação avisa. A tabela de frete pode fixar outra alíquota na aba Componentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-9">
          {UFS.map((u) => (
            <label key={u} className="space-y-1 text-xs">
              <span className="font-medium">{u}</span>
              <Input aria-label={`Alíquota interna de ${u}`} title={origin(u) ?? undefined} inputMode="decimal" className="h-8" disabled={!editable} placeholder="aberta" value={values[u]} onChange={(e) => setDraft({ ...values, [u]: e.target.value })} />
              {q.data?.origem?.[u]?.fonte === 'cte' && <span className="block text-[10px] text-muted-foreground">pelo CT-e</span>}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Preencha à mão (contador) ou envie XMLs de CT-e: cada frete dentro de um mesmo estado com ICMS tributado atualiza a alíquota daquela UF (vale o CT-e mais recente). Passe o mouse sobre a alíquota para ver de onde ela veio.
        </p>
        {learned && (
          <div className="rounded-md border p-2 text-xs">
            <p className="font-medium">
              {learned.read} CT-e(s) lido(s). {learned.updated.length ? `Atualizadas: ${learned.updated.map((x) => `${x.uf} ${x.from ?? 'aberta'} → ${x.to}%`).join(', ')}.` : 'Nenhuma alíquota mudou.'}
            </p>
            {learned.ignored.slice(0, 8).map((i, k) => (
              <p key={k} className="text-muted-foreground">
                {i.file}: {i.reason}
              </p>
            ))}
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              {learn.isPending && <Loader2Icon className="size-4 animate-spin" aria-hidden />} Atualizar pelos CT-e (XML)
              <input type="file" multiple className="sr-only" accept=".xml,text/xml,application/xml" onChange={(e) => e.target.files?.length && learn.mutate(e.target.files)} />
            </label>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !draft}>
              {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Salvar alíquotas
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}


interface SefazView {
  headquarters: { id: string; name: string; cnpj: string | null; uf: string | null } | null
  config: {
    cnpj: string
    env: 'PRODUCAO' | 'HOMOLOGACAO'
    ufCode: number
    intervalHours: number
    lookbackDays: number
    hasCertificate: boolean
    certSubject: string | null
    certCnpj: string | null
    certValidTo: string | null
    lastNsu: string
    maxNsu: string | null
    nextAllowedAt: string | null
    lastRunAt: string | null
    lastStatus: string | null
    lastMessage: string | null
  } | null
  runs: { id: string; trigger: string; byName: string | null; startedAt: string; finishedAt: string | null; status: string; message: string | null; documents: number; imported: number; duplicated: number; cancelled: number; skippedOld: number; ignored: number }[]
  intervals: number[]
  maxLookbackDays: number
  lookbackOptions?: number[]
  canManage: boolean
}

const UF_CODES: [string, number][] = [['AC', 12], ['AL', 27], ['AM', 13], ['AP', 16], ['BA', 29], ['CE', 23], ['DF', 53], ['ES', 32], ['GO', 52], ['MA', 21], ['MG', 31], ['MS', 50], ['MT', 51], ['PA', 15], ['PB', 25], ['PE', 26], ['PI', 22], ['PR', 41], ['RJ', 33], ['RN', 24], ['RO', 11], ['RR', 14], ['RS', 43], ['SC', 42], ['SE', 28], ['SP', 35], ['TO', 17]]
const RUN_STATUS: Record<string, string> = { OK: 'Concluída', SEM_DOCUMENTOS: 'Sem CT-e novo', AGUARDANDO: 'SEFAZ pediu pausa', ERRO: 'Erro', RODANDO: 'Em andamento' }
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

/** Captura de CT-e na SEFAZ (Distribuição DF-e) com o certificado A1 da matriz. */
function SefazCapture() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['fretes', 'sefaz'], queryFn: () => api.get<SefazView>('/fretes/sefaz') })
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const d = q.data
  const c = d?.config
  const refresh = (v: SefazView) => qc.setQueryData(['fretes', 'sefaz'], v)
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('arquivo', file!)
      fd.append('senha', password)
      return api.post<SefazView>('/fretes/sefaz/certificado', fd)
    },
    onSuccess: (v) => {
      refresh(v)
      setFile(null)
      setPassword('')
      toast.success('Certificado conferido e guardado.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const save = useMutation({
    mutationFn: (body: Partial<{ env: string; ufCode: number; intervalHours: number; lookbackDays: number }>) => api.put<SefazView>('/fretes/sefaz', body),
    onSuccess: (v) => (refresh(v), toast.success('Configuração salva.')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete<SefazView>('/fretes/sefaz/certificado'),
    onSuccess: (v) => (refresh(v), toast.success('Certificado removido. A busca automática foi desligada.')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const run = useMutation({
    mutationFn: () => api.post<{ status: string; imported: number; documents: number; skippedOld: number; message: string | null }>('/fretes/sefaz/buscar'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['fretes'] })
      if (r.status === 'ERRO') toast.error(`A busca falhou: ${r.message ?? 'erro na SEFAZ'}`)
      else toast.success(`${r.imported} CT-e(s) novo(s) de ${r.documents} documento(s)${r.skippedOld ? `; ${r.skippedOld} fora do período` : ''}.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const restart = useMutation({
    mutationFn: () => api.post<SefazView>('/fretes/sefaz/reler'),
    onSuccess: (v) => (refresh(v), toast.success('Pronto: a próxima busca lê de novo desde o começo do que a SEFAZ guarda. Clique em Buscar agora.')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const days = c?.certValidTo ? Math.floor((new Date(c.certValidTo).getTime() - Date.now()) / 86_400_000) : null
  const waitMin = c?.nextAllowedAt ? Math.ceil((new Date(c.nextAllowedAt).getTime() - Date.now()) / 60_000) : 0
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugIcon className="size-4" aria-hidden /> SEFAZ: captura de CT-e (Distribuição DF-e)
          <Badge variant="outline" className={c?.hasCertificate ? 'border-[#0ca30c]/50 text-[#006300] dark:text-[#0ca30c]' : 'text-muted-foreground'}>
            {c?.hasCertificate ? (c.intervalHours ? `Automática a cada ${c.intervalHours} h` : 'Só manual') : 'Não conectada'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Busca na SEFAZ os CT-es em que a empresa aparece (tomador, remetente, destinatário, expedidor ou recebedor) com o certificado A1 da matriz. O CNPJ da matriz vale para todas as filiais. Os CT-es entram como na importação de XML e já são conciliados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading ? (
          <TableSkeleton rows={3} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          d && (
            <>
              {c?.hasCertificate ? (
                <div className="space-y-1 rounded-md border p-3">
                  <p>
                    <span className="font-medium">{c.certSubject}</span> · CNPJ {maskCnpj(c.certCnpj ?? c.cnpj)}
                  </p>
                  <p className={days !== null && days <= 30 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                    Válido até {c.certValidTo ? new Date(c.certValidTo).toLocaleDateString('pt-BR') : '—'}
                    {days !== null && days <= 30 ? ` · vence em ${days} dia(s): renove e envie o novo` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Último NSU lido {c.lastNsu}
                    {c.maxNsu ? ` de ${c.maxNsu}` : ''} · última busca {fmt(c.lastRunAt)}
                    {c.lastMessage ? ` · ${c.lastMessage}` : ''}
                  </p>
                  {c.maxNsu && BigInt(c.lastNsu || '0') < BigInt(c.maxNsu) && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Ainda há {(BigInt(c.maxNsu) - BigInt(c.lastNsu || '0')).toLocaleString('pt-BR')} documento(s) na SEFAZ para ler (a leitura começa pelos mais antigos). Com a busca automática ligada, o CRM continua sozinho a cada 10 minutos até chegar aos de hoje; sem ela, clique em Buscar agora de novo.
                    </p>
                  )}
                  {d.canManage && c.lastNsu !== '0' && (
                    <p className="text-xs text-muted-foreground">
                      Aumentou os dias e quer os CT-es que ficaram para trás?{' '}
                      <button
                        type="button"
                        className="font-medium underline disabled:opacity-50"
                        disabled={restart.isPending || run.isPending}
                        onClick={() => confirm(`Ler de novo desde o começo do que a SEFAZ guarda? Entram os CT-es emitidos nos últimos ${c.lookbackDays} dia(s); os que já estão no CRM contam como repetidos.`) && restart.mutate()}
                      >
                        Ler de novo desde o começo
                      </button>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Envie o certificado A1 (e-CNPJ) da matriz{d.headquarters ? ` (${d.headquarters.name}${d.headquarters.cnpj ? `, ${maskCnpj(d.headquarters.cnpj)}` : ''})` : ''}. A senha e o arquivo ficam criptografados e nunca voltam para a tela.
                </p>
              )}
              {d.canManage && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (file) upload.mutate()
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-cert">{c?.hasCertificate ? 'Trocar o certificado A1' : 'Certificado A1 (.pfx ou .p12)'}</Label>
                    <Input id="sefaz-cert" type="file" accept=".pfx,.p12" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-72" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-pass">Senha do certificado</Label>
                    <Input id="sefaz-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="w-48" />
                  </div>
                  <Button type="submit" disabled={!file || !password || upload.isPending}>
                    {upload.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Conferir e guardar
                  </Button>
                  {c?.hasCertificate && (
                    <Button type="button" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                      Remover certificado
                    </Button>
                  )}
                </form>
              )}
              {c && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-int">Busca automática</Label>
                    <select id="sefaz-int" className="h-9 w-full rounded-md border bg-transparent px-2" disabled={!d.canManage || save.isPending} value={c.intervalHours} onChange={(e) => save.mutate({ intervalHours: Number(e.target.value) })}>
                      {d.intervals.map((h) => (
                        <option key={h} value={h}>
                          {h ? `A cada ${h} horas` : 'Desligada (só Buscar agora)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-dias">CT-es emitidos nos últimos</Label>
                    <select id="sefaz-dias" className="h-9 w-full rounded-md border bg-transparent px-2" disabled={!d.canManage || save.isPending} value={c.lookbackDays} onChange={(e) => save.mutate({ lookbackDays: Number(e.target.value) })}>
                      {[...new Set([...(d.lookbackOptions ?? Array.from({ length: d.maxLookbackDays }, (_, i) => i + 1)), c.lookbackDays])].sort((a, b) => a - b).map((n) => (
                        <option key={n} value={n}>
                          {n} dia(s)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-uf">UF da matriz</Label>
                    <select id="sefaz-uf" className="h-9 w-full rounded-md border bg-transparent px-2" disabled={!d.canManage || save.isPending} value={c.ufCode} onChange={(e) => save.mutate({ ufCode: Number(e.target.value) })}>
                      {UF_CODES.map(([uf, code]) => (
                        <option key={code} value={code}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sefaz-env">Ambiente</Label>
                    <select id="sefaz-env" className="h-9 w-full rounded-md border bg-transparent px-2" disabled={!d.canManage || save.isPending} value={c.env} onChange={(e) => save.mutate({ env: e.target.value })}>
                      <option value="PRODUCAO">Produção</option>
                      <option value="HOMOLOGACAO">Homologação (testes)</option>
                    </select>
                  </div>
                </div>
              )}
              {c?.hasCertificate && can('fretes_cte', 'create') && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => run.mutate()} disabled={run.isPending || waitMin > 0}>
                    {run.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Buscar agora
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {waitMin > 0 ? `A SEFAZ pede 1 hora entre consultas sem CT-e novo: libera em ${waitMin} minuto(s).` : 'Busca os CT-es novos desde a última consulta.'}
                  </span>
                </div>
              )}
              {d.runs.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium">Últimas buscas</p>
                  <ul className="space-y-1 text-xs">
                    {d.runs.map((r) => (
                      <li key={r.id} className="flex flex-wrap gap-x-3 border-b pb-1 last:border-0">
                        <span>{fmt(r.startedAt)}</span>
                        <span>{r.trigger === 'AUTO' ? 'Automática' : `Manual${r.byName ? ` (${r.byName})` : ''}`}</span>
                        <span className={r.status === 'ERRO' ? 'font-medium text-destructive' : ''}>{RUN_STATUS[r.status] ?? r.status}</span>
                        <span className="text-muted-foreground">
                          {r.documents} documento(s) · {r.imported} novo(s) · {r.duplicated} repetido(s) · {r.cancelled} cancelado(s) · {r.skippedOld} fora do período{r.ignored ? ` · ${r.ignored} evento(s) ou resumo(s) sem uso` : ''}
                        </span>
                        {r.message && <span className="text-muted-foreground">{r.message}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )
        )}
      </CardContent>
    </Card>
  )
}
