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
  const { can } = useAuth()
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
          can('fretes_filiais', 'edit') &&
          ctx.data?.global && (
            <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              {seed.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Cadastrar as unidades da Usaparts
            </Button>
          )
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
  { name: 'Correios (preço e prazo)', need: 'Contrato com os Correios, cartão de postagem e acesso à API do Correios (CWS). Até lá, a tabela dos Correios pode ser importada como uma tabela de frete comum.' },
  { name: 'Mercado Livre (Mercado Envios 1 / ME1)', need: 'Usa a conexão do Mercado Livre que o CRM já tem. Falta definir com o comercial quais tabelas valem para a loja oficial e o formato de envio da tabela de frete ao Mercado Livre.' },
  { name: 'Google Shopping (Merchant Center)', need: 'Conta do Merchant Center com acesso de API. O frete dos produtos sai das tabelas marcadas como exclusivas para "Google Shopping".' },
  { name: 'SEFAZ: captura de CT-e (distribuição DF-e)', need: 'Certificado digital A1 de cada CNPJ (matriz e filiais) e definição de quem é o tomador. Fase 3 do projeto.' },
  { name: 'Tcar (ERP): pedidos e notas', need: 'A integração da Tcar já existe para produtos. Falta liberar a consulta de pedidos e notas fiscais expedidas. Fase 3.' },
  { name: 'APIs das transportadoras (rastreamento e cotação on-line)', need: 'Credenciais de cada transportadora que oferecer API.' },
]

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

