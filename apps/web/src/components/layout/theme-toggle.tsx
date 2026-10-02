import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme()
  const next = resolved === 'dark' ? 'LIGHT' : 'DARK'
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-8', className)}
      aria-label={resolved === 'dark' ? 'Usar modo claro' : 'Usar modo escuro'}
      onClick={() => {
        setTheme(next)
        void api.patch('/me/preferences', { theme: next }).catch(() => undefined)
      }}
    >
      {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
