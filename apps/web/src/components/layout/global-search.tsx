import { MoonIcon, SearchIcon, SunIcon, UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import type { Lead } from '@/lib/leads'
import { visibleNavigation } from '@/lib/navigation'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Busca global (Ctrl+K): telas, ações rápidas e leads/clientes (nome, empresa, e-mail, cidade ou telefone),
 * respeitando o que o perfil pode ver.
 */
export function GlobalSearch({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { can, me } = useAuth()
  const { resolved, setTheme } = useTheme()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  // Espera a pessoa parar de digitar antes de buscar no servidor.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const canLeads = can('leads')
  const leads = useQuery({
    queryKey: ['busca-global', term],
    queryFn: () => api.get<{ items: Pick<Lead, 'id' | 'name' | 'company' | 'phone' | 'email' | 'city' | 'state'>[] }>(`/leads?search=${encodeURIComponent(term)}&pageSize=10`),
    enabled: open && canLeads && term.length >= 2,
    staleTime: 30_000,
  })

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
    setQ('')
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
          <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">Ctrl K</kbd>
        </Button>
      )}
      <CommandDialog open={open} onOpenChange={setOpen} title="Busca global" description="Encontre telas, ações, leads e clientes">
        <Command>
        <CommandInput placeholder={canLeads ? 'Buscar tela, lead ou cliente (nome, empresa, telefone)…' : 'Digite para buscar telas e ações…'} value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{leads.isFetching ? 'Buscando…' : 'Nada encontrado. Confira a grafia ou busque pelo telefone.'}</CommandEmpty>
          {canLeads && term.length >= 2 && (leads.data?.items.length ?? 0) > 0 && (
            <CommandGroup heading="Leads e clientes">
              {leads.data!.items.map((l) => (
                <CommandItem key={l.id} value={`${q} lead ${l.id}`} onSelect={() => go(`/leads/${l.id}`)}>
                  <UserIcon />
                  <span className="min-w-0 flex-1 truncate">
                    {l.name || l.company || l.email || l.phone || 'Sem nome'}
                    <span className="ml-2 text-xs text-muted-foreground">{[l.company && l.name ? l.company : null, l.phone ? formatPhone(l.phone) : null, l.city ? `${l.city}${l.state ? `/${l.state}` : ''}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {visibleNavigation(can, !!me?.role.isSystem).map((group) => (
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
        </Command>
      </CommandDialog>
    </>
  )
}
