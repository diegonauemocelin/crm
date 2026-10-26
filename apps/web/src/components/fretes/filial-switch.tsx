import { Building2Icon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ALL_UNITS, useActiveUnit } from '@/lib/fretes'

/** Seletor da filial ativa do módulo de fretes, no cabeçalho de cada tela. */
export function FilialSwitch({ active }: { active: ReturnType<typeof useActiveUnit> }) {
  const data = active.ctx.data
  if (!data) return null
  if (!data.units.length) return <span className="text-sm text-muted-foreground">Nenhuma filial liberada para você</span>
  return (
    <Select value={active.value} onValueChange={active.set}>
      <SelectTrigger className="w-64" aria-label="Filial ativa">
        <Building2Icon className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {data.global && <SelectItem value={ALL_UNITS}>Todas as filiais (visão global)</SelectItem>}
        {data.units
          .filter((u) => u.active || u.id === active.value)
          .map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
