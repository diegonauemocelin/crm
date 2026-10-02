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

/** Sidebar do layout Moderno, baseada no block sidebar-07 (recolhe para ícones). */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { can, me } = useAuth()
  const branding = useBranding()

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
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={visibleNavigation(can)} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
