import { ClockIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { num, pct } from '@/lib/marketing'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const SLOTS = [0, 3, 6, 9, 12, 15, 18, 21]

export interface TimeCell {
  weekday: number
  slot: number
  label: string
  posts: number
  avgReach: number | null
  avgEngagement: number
  engagementRate: number | null
}
export interface OnlinePeaks {
  byHour: number[]
  peaks: { hour: number; value: number }[]
  byWeekday: { weekday: number; label: string; total: number; peakHour: number | null }[]
  bestDay: string
}

const hh = (h: number) => `${String(h).padStart(2, '0')}h`
/** Cor do quadradinho: mais forte = maior valor (a escala vai do menor ao maior do próprio mapa). */
const shade = (v: number, max: number) => (max > 0 && v > 0 ? { backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.round(12 + (v / max) * 78)}%, transparent)` } : undefined)

/** Melhores horários: o pico do público online (quando a rede informa) e o desempenho das próprias publicações. */
export function BestTimes({ title = 'Melhores horários para postar', network, cells, best, online, peaks, recommendations, basedOnPosts }: {
  title?: string
  network?: string
  cells: TimeCell[]
  best: TimeCell[]
  online?: number[][] | null
  peaks?: OnlinePeaks | null
  recommendations?: string[]
  basedOnPosts?: number
}) {
  const metric = (c: TimeCell) => c.avgReach ?? c.avgEngagement
  const max = Math.max(0, ...cells.map(metric))
  const byKey = new Map(cells.map((c) => [`${c.weekday}|${c.slot}`, c]))
  const onlineMax = online ? Math.max(0, ...online.flat()) : 0
  const recs = recommendations ?? best.map((b) => `${b.label} (média de ${b.avgReach !== null ? `${num(b.avgReach)} de alcance` : `${num(b.avgEngagement)} interações`} em ${b.posts} publicações)`)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClockIcon className="size-4" /> {title}
          {network && <span className="text-sm font-normal text-muted-foreground">· {network}</span>}
        </CardTitle>
        <CardDescription>
          Horário de Brasília. {online ? 'O público online vem do Instagram (últimos 30 dias); ' : ''}o desempenho vem das publicações dos últimos 90 dias
          {basedOnPosts !== undefined ? ` (${num(basedOnPosts)} publicações)` : ''}. Faixa com menos de 2 publicações não entra na sugestão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm font-medium">Sugestão</p>
          {recs.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-sm">
              {recs.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Ainda não há publicações suficientes para sugerir um horário. Continue postando em horários variados: a sugestão aparece sozinha.</p>
          )}
          {peaks && <p className="text-xs text-muted-foreground">Dia com o público mais ativo: {peaks.bestDay}.</p>}
        </div>

        {online && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Quando os seguidores estão online</p>
            <div className="overflow-x-auto">
              <table className="text-xs text-muted-foreground">
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="w-5 font-normal">
                        {h % 3 === 0 ? h : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {online.map((row, d) => (
                    <tr key={WEEKDAYS[d]}>
                      <td className="pr-2">{WEEKDAYS[d]}</td>
                      {row.map((v, h) => (
                        <td key={h} className="p-0.5">
                          <div className="size-4 rounded-sm bg-muted" style={shade(v, onlineMax)} title={`${WEEKDAYS[d]} ${hh(h)}: ${num(v)} seguidores online em média`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Desempenho das publicações por dia e faixa de horário</p>
          {cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem publicações sincronizadas nos últimos 90 dias.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th />
                    {SLOTS.map((s) => (
                      <th key={s} className="px-1 font-normal">
                        {hh(s)}–{hh(s + 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((w, d) => (
                    <tr key={w}>
                      <td className="pr-2 text-muted-foreground">{w}</td>
                      {SLOTS.map((s) => {
                        const c = byKey.get(`${d}|${s}`)
                        return (
                          <td key={s} className="p-0.5">
                            <div
                              className="flex h-8 min-w-14 items-center justify-center rounded-md bg-muted/40 tabular-nums"
                              style={c ? shade(metric(c), max) : undefined}
                              title={c ? `${c.label}: ${c.posts} publicação(ões) · ${c.avgReach !== null ? `alcance médio ${num(c.avgReach)} · ` : ''}engajamento médio ${num(c.avgEngagement)}${c.engagementRate !== null ? ` (${pct(c.engagementRate)})` : ''}` : 'Sem publicações nesta faixa'}
                            >
                              {c ? num(metric(c)) : ''}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground">Número no quadro: {cells.some((c) => c.avgReach !== null) ? 'alcance médio por publicação' : 'interações médias por publicação'}. Passe o mouse para ver os detalhes.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
