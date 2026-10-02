import { useBranding } from '@/lib/branding'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/** Logo configurado no whitelabel; sem logo, mostra as iniciais sobre a cor da marca. */
export function BrandMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const b = useBranding()
  const { resolved } = useTheme()
  const src = (onDark || resolved === 'dark') && b.logoDarkUrl ? b.logoDarkUrl : b.logoUrl
  if (src) return <img src={src} alt={b.appName} className={cn('size-8 rounded-md object-contain', className)} />
  const initials = b.shortName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <div
      className={cn('flex size-8 items-center justify-center rounded-md text-sm font-bold', className)}
      style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
      aria-hidden
    >
      {initials}
    </div>
  )
}
