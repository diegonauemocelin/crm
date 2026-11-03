import type * as React from 'react'
import { Link } from 'react-router'
import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import { BrandMark } from '@/components/layout/brand-logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { visibleNavigation } from '@/lib/navigation'
import { useSistemaAtual } from '@/lib/sistema-atual'
import { menuDoSistema } from '@/lib/sistemas'
import { SistemaSwitcher } from './layout/sistemas-menu'

/**
 * Sidebar do layout Moderno, baseada no block sidebar-07 (recolhe para ícones). No visual "Por sistema", mostra só o
 * sistema aberto, com a troca de sistema no topo.
 */
export function AppSidebar({ porSistema = false, ...props }: React.ComponentProps<typeof Sidebar> & { porSistema?: boolean }) {
  const { can, me } = useAuth()
  const branding = useBranding()
  const { atual } = useSistemaAtual()
  const groups = visibleNavigation(can, !!me?.role.isSystem)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <BrandMark />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{branding.appName}</span>
                  <span className="truncate text-xs text-muted-foreground">{me?.role.name}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {porSistema && <SistemaSwitcher />}
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={porSistema ? menuDoSistema(groups, atual) : groups} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
