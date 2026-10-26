import { useMutation, useQueryClient } from '@tanstack/react-query'
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
