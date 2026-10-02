import { useSearchParams } from 'react-router'
import { AtendimentoDashboard } from '@/components/atendimento/dashboard'
import { RecordsList } from '@/components/atendimento/records-list'
import { PageHeader, RequirePermission } from '@/components/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Kind, KIND_INFO } from '@/lib/atendimento'

/** Mesma estrutura para Pré-Vendas e Pós-Vendas, com filtros independentes. */
export function AtendimentoPage({ kind }: { kind: Kind }) {
  const info = KIND_INFO[kind]
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') === 'dashboard' ? 'dashboard' : 'lista'

  return (
    <RequirePermission module={info.module}>
      <PageHeader
        title={info.title}
        description={
          kind === 'PRE_VENDAS'
            ? 'Leads recebidos no WhatsApp e demais canais antes da compra: repasse ao vendedor, retorno e resultado.'
            : 'Atendimentos a clientes após a compra: suporte, recompra e resultado.'
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(v === 'dashboard' ? { aba: 'dashboard' } : {})
          setParams(next, { replace: true })
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="lista">Atendimentos</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="lista">
          <RecordsList key={kind} kind={kind} />
        </TabsContent>
        <TabsContent value="dashboard">
          <AtendimentoDashboard key={kind} kind={kind} />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

export function PreVendasPage() {
  return <AtendimentoPage kind="PRE_VENDAS" />
}

export function PosVendasPage() {
  return <AtendimentoPage kind="POS_VENDAS" />
}
