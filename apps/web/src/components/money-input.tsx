import { Input } from '@/components/ui/input'

/** Campo de valor em reais: digita só números e mostra "1.234,56". Guarda o valor como número (ou null). */
export function MoneyInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id?: string
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  invalid?: boolean
}) {
  const shown = value === null ? '' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
      <Input
        id={id}
        inputMode="numeric"
        className="pl-9 text-right tabular-nums"
        value={shown}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 12)
          onChange(digits ? Number(digits) / 100 : null)
        }}
      />
    </div>
  )
}
