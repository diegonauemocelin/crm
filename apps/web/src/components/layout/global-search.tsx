import { MoonIcon, SearchIcon, SunIcon, UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useAuth } from '@/lib/auth'
import { visibleNavigation } from '@/lib/navigation'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Busca global (Ctrl+K). Nesta fase navega entre telas e ações rápidas;
 * leads, atendimentos e campanhas entram na busca à medida que os módulos forem entregues.
 */
export function GlobalSearch({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { can } = useAuth()
  const { resolved, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* Um único diálogo; no celular (ou quando pedido) o gatilho vira só o ícone. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Buscar (Ctrl+K)"
        className={cn(iconOnly ? undefined : 'sm:hidden', className)}
      >
        <SearchIcon />
      </Button>
      {!iconOnly && (
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className={cn('hidden h-8 w-56 justify-start gap-2 px-2.5 text-muted-foreground sm:inline-flex', className)}
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left text-sm">Buscar…</span>
          <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">Ctrl K</kbd>
        </Button>
      )}
      <CommandDialog open={open} onOpenChange={setOpen} title="Busca global" description="Encontre telas e ações">
        <CommandInput placeholder="Digite para buscar telas e ações…" />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          {visibleNavigation(can).map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((item) => (
                <CommandItem key={item.to} value={`${group.title} ${item.title}`} onSelect={() => go(item.to)}>
                  <item.icon />
                  {item.title}
                  {item.phase && <CommandShortcut>Em breve</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Ações">
            <CommandItem value="meu perfil conta senha 2fa" onSelect={() => go('/meu-perfil')}>
              <UserIcon />
              Meu perfil
            </CommandItem>
            <CommandItem
              value="alternar tema claro escuro"
              onSelect={() => {
                setTheme(resolved === 'dark' ? 'LIGHT' : 'DARK')
                setOpen(false)
              }}
            >
              {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
              Alternar para modo {resolved === 'dark' ? 'claro' : 'escuro'}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
