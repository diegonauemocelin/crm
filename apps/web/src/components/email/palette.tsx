import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { InlineError } from '@/components/page'
import { api } from '@/lib/api'
import { useBranding } from '@/lib/branding'

/** Paleta clássica de e-mail: tons neutros para texto, cores de destaque e fundos claros para faixas. */
export const CLASSIC_COLORS = [
  '#111827', '#374151', '#6b7280', '#9ca3af', '#1d4ed8', '#2563eb', '#0ea5e9', '#16a34a', '#15803d',
  '#dc2626', '#b91c1c', '#ea580c', '#f59e0b', '#ca8a04', '#7c3aed', '#db2777', '#f3f4f6', '#ffffff',
]
const RECENT_KEY = 'crm-email-cores-recentes'
const HEX = /^#[0-9a-f]{6}$/i

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 8) : []
  } catch {
    return []
  }
}

/**
 * Cores para os seletores do editor: a da marca, as mais usadas nos e-mails da empresa (contadas no servidor),
 * as últimas escolhidas neste computador e a paleta clássica.
 */
export function useEmailPalette() {
  const branding = useBranding()
  const brand = HEX.test(branding.primaryColor) ? branding.primaryColor.toLowerCase() : '#1d4ed8'
  const used = useQuery({ queryKey: ['email-cores'], queryFn: () => api.get<string[]>('/email/cores'), staleTime: 5 * 60_000 })
  const [recent, setRecent] = useState<string[]>(readRecent)
  const remember = useCallback((c: string | undefined) => {
    if (!c || !HEX.test(c)) return
    setRecent((r) => {
      const next = [c.toLowerCase(), ...r.filter((x) => x !== c.toLowerCase())].slice(0, 8)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Sem armazenamento (aba anônima): só nesta tela.
      }
      return next
    })
  }, [])
  // Marca + mais usadas, sem repetir.
  const top = [brand, ...(used.data ?? []).filter((c) => c !== brand)].slice(0, 9)
  return { brand, top, recent: recent.filter((c) => !top.includes(c)), classic: CLASSIC_COLORS, remember, error: used.error, retry: () => void used.refetch() }
}

export function Swatches({ colors, onPick, size = 'md', label }: { colors: string[]; onPick: (c: string) => void; size?: 'sm' | 'md'; label?: string }) {
  if (!colors.length) return null
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <div className="flex flex-wrap gap-1">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={size === 'sm' ? 'size-5 rounded border' : 'size-7 rounded-md border'}
            style={{ background: c }}
            aria-label={`Usar a cor ${c}`}
            title={c}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </div>
  )
}

/** Aviso discreto quando não deu para buscar as cores mais usadas (a marca e a paleta continuam disponíveis). */
export function PaletteError({ palette }: { palette: Pick<ReturnType<typeof useEmailPalette>, 'error' | 'retry'> }) {
  return palette.error ? <InlineError error={palette.error} onRetry={palette.retry} /> : null
}
