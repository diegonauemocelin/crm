import { DataNotes, Section } from '@/components/marketing/blocos'
import { MktPage } from '@/components/marketing/shell'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cell, type FunnelStage, fmt, hoursText, type Meta, type Timing, useMkt, useMktFilters } from '@/lib/marketing'
import { cn } from '@/lib/utils'

interface FunnelData extends Meta {
  compareBy: string
  mediaStages: boolean
  stages: FunnelStage[]
  previousStages: FunnelStage[]
  biggestDrop: FunnelStage | null
  timings: { firstContact: Timing; opportunity: Timing; sale: Timing }
  compare: { key: string; label: string; stages: FunnelStage[]; timings: { firstContact: Timing } }[]
}

const DIMS = [
  ['canal', 'Plataforma/canal'],
  ['campanha', 'Campanha'],
  ['regiao', 'Região'],
  ['uf', 'Estado'],
  ['vendedor', 'Vendedor'],
  ['filial', 'Filial'],
  ['marca', 'Marca'],
  ['peca', 'Tipo de peça'],
  ['origem', 'Origem do cadastro'],
] as const

const stageValue = (s: FunnelStage) => (s.id === 'faturamento' ? fmt(s.value, 'brl') : fmt(s.value, 'int'))

/** Funil de marketing e vendas: volumes, passagem entre etapas, custo por etapa, tempos e onde mais se perde. */
export function FunilPage() {
  const { params, qs, set } = useMktFilters()
  const dim = params.get('comparar') ?? 'canal'
  const q = useMkt<FunnelData>('funil', `${qs}&comparar=${dim}`)
  const d = q.data
  const max = d ? Math.max(1, ...d.stages.filter((s) => s.id !== 'faturamento').map((s) => s.value)) : 1
  const stageIds = d?.stages.filter((s) => s.id !== 'faturamento').map((s) => s.id) ?? []
  return (
    <MktPage title="Funil e atribuição" description="Do lead à venda, sem contar a mesma pessoa duas vezes. Cada etapa está dentro da anterior." params={params} set={set}>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Section
            title="Funil do período"
            description={d.mediaStages ? 'Impressões e cliques da mídia filtrada, seguidos dos resultados no CRM.' : 'Impressões e cliques aparecem quando o filtro é uma plataforma com investimento conectado (ex.: Google Ads), para não misturar canais.'}
          >
            <ol className="space-y-2 px-4 sm:px-0">
              {d.stages.map((s, i) => {
                const prev = d.previousStages.find((p) => p.id === s.id)
                const isDrop = d.biggestDrop?.id === s.id
                return (
                  <li key={s.id} className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3 sm:grid-cols-[12rem_1fr_9rem]">
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">anterior: {prev ? stageValue(prev) : '—'}</p>
                    </div>
                    <div className="min-w-0">
                      {s.id === 'faturamento' ? (
                        <p className="text-lg font-semibold tabular-nums">{stageValue(s)}</p>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-7 rounded bg-[var(--chart-1)]" style={{ width: `${Math.max(1, (s.value / max) * 100)}%` }} aria-hidden />
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{stageValue(s)}</span>
                        </div>
                      )}
                    </div>
                    <div className={cn('col-span-2 text-xs sm:col-span-1 sm:text-right', isDrop && 'font-medium text-[#b42323] dark:text-[#e66767]')}>
                      {i > 0 && s.passRate !== null && <span>{fmt(s.passRate, 'pct')} da etapa anterior</span>}
                      {isDrop && <span> · maior perda</span>}
                      {s.costPer !== null && <span className="block text-muted-foreground">{fmt(s.costPer, 'brl')} por {s.label.toLowerCase()}</span>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Section>

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['Lead → 1º atendimento', d.timings.firstContact],
                ['Lead → oportunidade', d.timings.opportunity],
                ['Lead → venda', d.timings.sale],
              ] as const
            ).map(([label, t]) => (
              <div key={label} className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{hoursText(t.avgHours)}</p>
                <p className="text-xs text-muted-foreground">
                  média · mediana {hoursText(t.medianHours)} · {t.n} atendimento(s){t.missing ? ` · ${t.missing} sem o dado` : ''}
                </p>
              </div>
            ))}
          </div>

          <Section
            title="Comparar o funil"
            description="As 30 linhas com mais leads. Passagem em % da etapa anterior."
            actions={
              <Select value={dim} onValueChange={(v) => set({ comparar: v })}>
                <SelectTrigger size="sm" className="w-52" aria-label="Comparar por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMS.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      Por {label.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{DIMS.find(([id]) => id === dim)?.[1]}</TableHead>
                  {d.stages
                    .filter((s) => stageIds.includes(s.id) && s.id !== 'impressoes' && s.id !== 'cliques')
                    .map((s) => (
                      <TableHead key={s.id} className="text-right">
                        {s.label}
                      </TableHead>
                    ))}
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="hidden text-right md:table-cell">1º atendimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.compare.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      Sem dados no período.
                    </TableCell>
                  </TableRow>
                )}
                {d.compare.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="max-w-56 truncate font-medium" title={c.label}>
                      {c.label}
                    </TableCell>
                    {c.stages
                      .filter((s) => s.id !== 'impressoes' && s.id !== 'cliques' && s.id !== 'faturamento')
                      .map((s, i) => (
                        <TableCell key={s.id} className="text-right whitespace-nowrap tabular-nums">
                          {fmt(s.value, 'int')}
                          {i > 0 && <span className="block text-xs text-muted-foreground">{cell(s.passRate, 'pct')}</span>}
                        </TableCell>
                      ))}
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{fmt(c.stages.find((s) => s.id === 'faturamento')?.value ?? 0, 'brl')}</TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap md:table-cell">{hoursText(c.timings.firstContact.medianHours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}
