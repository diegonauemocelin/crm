import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Horário de acesso do perfil (mesmo formato da API): dias 0 = domingo … 6 = sábado; null = sem acesso no dia. */
export interface LoginHours {
  enabled: boolean
  days: ({ from: string; to: string } | null)[]
}

export const DEFAULT_LOGIN_HOURS: LoginHours = {
  enabled: false,
  days: [null, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '08:00', to: '12:00' }],
}

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
/** Segunda primeiro, como na agenda da empresa. */
const ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Resumo para a lista de perfis (ex.: "Seg a sex 07:00–19:00 · sáb 08:00–12:00"). */
export function loginHoursSummary(h: LoginHours | null | undefined) {
  if (!h?.enabled) return null
  const open = ORDER.filter((d) => h.days[d])
  if (!open.length) return 'Sem acesso em nenhum dia'
  return open.map((d) => `${DAYS[d]!.slice(0, 3).toLowerCase()} ${h.days[d]!.from}–${h.days[d]!.to}`).join(' · ')
}

/** Problema que impede salvar (ex.: hora de fim antes da de início), ou null. */
export function loginHoursProblem(h: LoginHours) {
  if (!h.enabled) return null
  for (const d of ORDER) {
    const w = h.days[d]
    if (w && (!w.from || !w.to || w.to <= w.from)) return `${DAYS[d]}: a hora de saída precisa ser depois da de entrada.`
  }
  return null
}

export function LoginHoursEditor({ value, onChange, disabled }: { value: LoginHours; onChange: (v: LoginHours) => void; disabled?: boolean }) {
  const setDay = (d: number, w: LoginHours['days'][number]) => onChange({ ...value, days: value.days.map((x, i) => (i === d ? w : x)) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <label className="flex items-start justify-between gap-3 text-sm">
        <span>
          Limitar o horário de acesso
          <span className="block text-xs text-muted-foreground">
            Fora do horário, quem tem este perfil não entra no sistema (computador e app do celular) e quem já estava dentro é desconectado. Horário de Brasília.
          </span>
        </span>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ ...value, enabled })} disabled={disabled} />
      </label>
      {value.enabled && (
        <ul className="space-y-1.5">
          {ORDER.map((d) => {
            const w = value.days[d] ?? null
            return (
              <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-28 items-center gap-2">
                  <Switch checked={!!w} onCheckedChange={(on) => setDay(d, on ? { from: '08:00', to: '18:00' } : null)} disabled={disabled} aria-label={`Acesso na ${DAYS[d]}`} />
                  {DAYS[d]}
                </label>
                {w ? (
                  <span className="flex items-center gap-1.5">
                    <Input type="time" value={w.from} onChange={(e) => setDay(d, { ...w, from: e.target.value })} className={cn('h-8 w-28', w.to <= w.from && 'border-destructive')} disabled={disabled} aria-label={`${DAYS[d]}: entrada`} />
                    às
                    <Input type="time" value={w.to} onChange={(e) => setDay(d, { ...w, to: e.target.value })} className={cn('h-8 w-28', w.to <= w.from && 'border-destructive')} disabled={disabled} aria-label={`${DAYS[d]}: saída`} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">Sem acesso</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
