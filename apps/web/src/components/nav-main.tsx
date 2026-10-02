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
import type { NavGroup, NavItem } from '@/lib/navigation'

function Items({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`))
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
          {item.phase && <SidebarMenuBadge className="text-[10px] font-normal opacity-60">Em breve</SidebarMenuBadge>}
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
        index === 0 ? (
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
