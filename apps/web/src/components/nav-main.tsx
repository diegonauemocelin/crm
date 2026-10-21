import { ChevronRightIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useNavBadges } from '@/lib/nav-badges'
import { findNavItem, type NavGroup, type NavItem } from '@/lib/navigation'

function Items({ items }: { items: NavItem[] }) {
  const { pathname, search } = useLocation()
  const current = findNavItem(pathname, search)?.item.to
  const isActive = (to: string) => to === current
  const badge = useNavBadges()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.title}>
            <NavLink to={item.to} end={item.to === '/'}>
              <item.icon />
              <span>{item.title}</span>
            </NavLink>
          </SidebarMenuButton>
          {item.phase && <SidebarMenuBadge className="text-xs font-normal text-muted-foreground">Em breve</SidebarMenuBadge>}
          {badge(item.to).n > 0 && (
            <SidebarMenuBadge className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums" aria-label={`${badge(item.to).n} ${badge(item.to).label}`}>
              {badge(item.to).n}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

/** Menu do layout Moderno (adaptado do block sidebar-07 do shadcn/ui). Grupos recolhíveis, com tooltip no modo ícone. */
export function NavMain({ groups }: { groups: NavGroup[] }) {
  return (
    <>
      {groups.map((group, index) =>
        // Primeiro grupo com um item só (Início) fica sem título; os demais são recolhíveis.
        index === 0 && group.items.length === 1 ? (
          <SidebarGroup key={group.title} className="py-1">
            <Items items={group.items} />
          </SidebarGroup>
        ) : (
          <Collapsible key={group.title} defaultOpen className="group/collapsible">
            <SidebarGroup className="py-1">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="w-full">
                  {group.title}
                  <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <Items items={group.items} />
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ),
      )}
    </>
  )
}
