import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Section, SourceBadge } from '@/components/marketing/blocos'
import { MktPage } from '@/components/marketing/shell'
import { Can, ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmt, type Source } from '@/lib/marketing'

interface Health {
  sources: Source[]
  quality: {
    windowDays: number
    records: number
    identifiedShare: number | null
    adsCampaign: number
    adsOriginOnly: number
    withTouch: number
    sales: number
    salesNoValue: number
    salesEstimatedDate: number
    noState: number
    duplicatePhoneGroups: number
  }
}

interface Rules {
  config: { model: string; windowDays: number; qualifiedRule: string }
  models: Record<string, string>
  windows: number[]
  qualifiedRules: Record<string, string>
  formulas: Record<string, string>
}

const FORMULA_LABEL: Record<string, string> = {
  investimento: 'Investimento total',
  investimentoPlataforma: 'Investimento por plataforma',
  leads: 'Leads gerados',
  qualificados: 'Leads qualificados',
  oportunidades: 'Oportunidades',
  vendas: 'Vendas',
  faturamento: 'Faturamento',
  cpl: 'CPL',
  cplQualificado: 'Custo por lead qualificado',
  cac: 'CAC de mídia',
  conversao: 'Conversão de lead em venda',
  roas: 'ROAS de mídia',
  roi: 'ROI de marketing',
  ticket: 'Ticket médio',
  atendidos: 'Taxa de atendimento',
  semAtendimento: 'Leads sem atendimento',
  perdidas: 'Oportunidades perdidas',
  ctr: 'CTR',
  cpc: 'CPC médio',
  cpm: 'CPM',
  aberturaEmail: 'Taxa de abertura (e-mail)',
  cliqueEmail: 'Taxa de cliques (e-mail)',
}

/** Integrações e configurações: saúde das fontes, qualidade dos dados, regras de atribuição e as fórmulas. */
export function IntegracoesPage() {
  const health = useQuery({ queryKey: ['marketing', 'saude'], queryFn: () => api.get<Health>('/marketing/saude') })
  const rules = useQuery({ queryKey: ['marketing', 'regras'], queryFn: () => api.get<Rules>('/marketing/regras') })
  const { can } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState<Rules['config'] | null>(null)
  useEffect(() => {
    if (rules.data && !form) setForm(rules.data.config)
  }, [rules.data, form])
  const save = useMutation({
    mutationFn: (c: Rules['config']) => api.put<Rules>('/marketing/regras', c),
    onSuccess: (r) => {
      qc.setQueryData(['marketing', 'regras'], r)
      void qc.invalidateQueries({ queryKey: ['marketing'] })
      toast.success('Regras salvas. Os painéis já usam as regras novas.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const h = health.data
  const r = rules.data
  const editable = can('mkt_integracoes', 'edit')
  const changed = !!form && !!r && JSON.stringify(form) !== JSON.stringify(r.config)
  return (
    <MktPage module="mkt_integracoes" title="Integrações e configurações" description="Fontes de dados do módulo, qualidade da ligação marketing → CRM e as regras usadas em todos os painéis.">
      {(health.isLoading || rules.isLoading) && <TableSkeleton rows={8} />}
      {health.error && <ErrorState error={health.error} onRetry={() => health.refetch()} />}
      {h && (
        <Section
          title="Fontes de dados"
          description={
            <>
              Situação de cada fonte. As contas que faltam (Meta Ads, TikTok, Search Console e redes sociais) serão conectadas na etapa final, em{' '}
              <Link className="underline" to="/configuracoes">
                Configurações
              </Link>
              , sempre com acesso só de leitura.
            </>
          }
        >
          <ul className="divide-y px-4 sm:px-0">
            {h.sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                  {s.lastSync && <p className="text-xs text-muted-foreground">Último dado: {formatDateTime(s.lastSync)}</p>}
                </div>
                <SourceBadge status={s.status} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {h && (
        <Section title="Qualidade dos dados" description={`Pré-vendas dos últimos ${h.quality.windowDays} dias (${fmt(h.quality.records, 'int')} atendimentos). Nada é corrigido automaticamente: só é mostrado.`}>
          <dl className="grid gap-3 px-4 sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
            {(
              [
                ['Com origem identificada', fmt(h.quality.identifiedShare, 'pct'), 'Campanha do Google, origem "Google" ou visita/conversão com UTM.'],
                ['Google Ads com campanha', fmt(h.quality.adsCampaign, 'int'), 'Clique no anúncio reconhecido pelo rastreamento.'],
                ['Google Ads sem campanha', fmt(h.quality.adsOriginOnly, 'int'), 'Só pela origem do cadastro: o link do anúncio não passou pelo site com o script.'],
                ['Com visita ou conversão rastreada', fmt(h.quality.withTouch, 'int'), 'Fora do Google Ads, com origem/UTM conhecida.'],
                ['Vendas sem valor', `${fmt(h.quality.salesNoValue, 'int')} de ${fmt(h.quality.sales, 'int')}`, 'Ficam fora do faturamento.'],
                ['Vendas com data estimada', `${fmt(h.quality.salesEstimatedDate, 'int')} de ${fmt(h.quality.sales, 'int')}`, 'Sem a data no histórico (importadas): contam na data do lead.'],
                ['Sem estado (UF)', fmt(h.quality.noState, 'int'), 'Ficam como "Não informado" nas quebras por estado e região.'],
                ['Telefones repetidos na base', fmt(h.quality.duplicatePhoneGroups, 'int'), 'Grupos de leads com o mesmo telefone. O módulo conta cada pessoa uma vez pelo lead ligado ao atendimento.'],
              ] as const
            ).map(([label, value, hint]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {rules.error && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
      {r && form && (
        <Section title="Regras de atribuição e qualificação" description="Valem para todos os painéis e relatórios do módulo, e aparecem no rodapé de cada tela. Mudanças ficam na auditoria.">
          <div className="grid gap-4 px-4 sm:grid-cols-3 sm:px-0">
            <div className="space-y-1.5">
              <Label htmlFor="mkt-model">Modelo de atribuição</Label>
              <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })} disabled={!editable}>
                <SelectTrigger id="mkt-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(r.models).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">O clique no anúncio do Google identificado no atendimento sempre vem primeiro, como no painel do Google Ads.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mkt-window">Janela de atribuição</Label>
              <Select value={String(form.windowDays)} onValueChange={(v) => setForm({ ...form, windowDays: Number(v) })} disabled={!editable}>
                <SelectTrigger id="mkt-window" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {r.windows.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      {w} dias antes do contato
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mkt-qualified">Lead qualificado</Label>
              <Select value={form.qualifiedRule} onValueChange={(v) => setForm({ ...form, qualifiedRule: v })} disabled={!editable}>
                <SelectTrigger id="mkt-qualified" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(r.qualifiedRules).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Can module="mkt_integracoes" action="edit">
            <div className="mt-4 flex justify-end gap-2 px-4 sm:px-0">
              <Button variant="ghost" disabled={!changed || save.isPending} onClick={() => setForm(r.config)}>
                Desfazer
              </Button>
              <Button disabled={!changed || save.isPending} onClick={() => save.mutate(form)}>
                Salvar regras
              </Button>
            </div>
          </Can>
        </Section>
      )}

      {r && (
        <Section title="Fórmulas dos indicadores" description="Calculadas num lugar só, no servidor. Taxas aparecem em %; ROAS é um múltiplo (4x = R$ 4 por R$ 1 investido) e não é ROI.">
          <dl className="grid gap-x-6 gap-y-2 px-4 text-sm sm:px-0 lg:grid-cols-2">
            {Object.entries(r.formulas).map(([id, text]) => (
              <div key={id}>
                <dt className="font-medium">{FORMULA_LABEL[id] ?? id}</dt>
                <dd className="text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </MktPage>
  )
}
