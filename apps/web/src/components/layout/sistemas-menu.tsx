import {
  BarChart3Icon,
  BrainCircuitIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  HeadsetIcon,
  LayoutGridIcon,
  type LucideIcon,
  MegaphoneIcon,
  SettingsIcon,
  ShoppingCartIcon,
  StoreIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useNavBadges } from '@/lib/nav-badges'
import { useSistemaAtual } from '@/lib/sistema-atual'
import { inicioDoSistema, SISTEMAS } from '@/lib/sistemas'

export const SISTEMA_ICONES: Record<string, LucideIcon> = {
  atendimento: HeadsetIcon,
  dashboards: BarChart3Icon,
  crm: UsersRoundIcon,
  marketing: MegaphoneIcon,
  mi: BrainCircuitIcon,
  ecommerce: ShoppingCartIcon,
  marketplaces: StoreIcon,
  admin: SettingsIcon,
}

/** Avisos somados das telas de um sistema (os mesmos números do menu). */
export function useAvisosDoSistema() {
  const badge = useNavBadges()
  const { grupos } = useSistemaAtual()
  return (id: string) => {
    const s = SISTEMAS.find((x) => x.id === id)
    if (!s) return 0
    return grupos.filter((g) => s.grupos.includes(g.title)).reduce((n, g) => n + g.items.reduce((m, i) => m + badge(i.to).n, 0), 0)
  }
}

/** Troca de sistema no topo do menu lateral (só aparece para quem tem mais de um). */
export function SistemaSwitcher() {
  const { grupos, sistemas, atual } = useSistemaAtual()
  const avisos = useAvisosDoSistema()
  const s = SISTEMAS.find((x) => x.id === atual)
  if (!s || sistemas.length < 2) return null
  const Icon = SISTEMA_ICONES[s.id] ?? LayoutGridIcon
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={`Sistema: ${s.nome}`} className="border bg-background data-[state=open]:bg-sidebar-accent">
              <span className="flex size-8 items-center justify-center rounded-md" style={{ background: 'var(--brand)', color: 'var(--brand-foreground, #0D0D0D)' }}>
                <Icon className="size-4" />
              </span>
              <div className="grid flex-1 text-left leading-tight">
                <span className="text-xs text-muted-foreground">Sistema</span>
                <span className="truncate font-semibold">{s.nome}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Trocar de sistema</DropdownMenuLabel>
            {sistemas.map((x) => {
              const XIcon = SISTEMA_ICONES[x.id] ?? LayoutGridIcon
              const n = avisos(x.id)
              return (
                <DropdownMenuItem key={x.id} asChild>
                  <Link to={inicioDoSistema(grupos, x.id) ?? '/sistemas'}>
                    <XIcon />
                    <span className="flex-1">{x.nome}</span>
                    {n > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular-nums">{n}</span>}
                    {x.id === atual && <CheckIcon className="size-4" />}
                  </Link>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/sistemas">
                <LayoutGridIcon />
                Todos os sistemas
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
