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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { useNavBadges } from '@/lib/nav-badges'
import { findNavItem, type NavGroup, type NavItem } from '@/lib/navigation'

/** Itens seguidos com o mesmo submenu (section) ficam juntos; os demais, sozinhos. */
export function bySection(items: NavItem[]): ({ item: NavItem } | { section: string; items: NavItem[] })[] {
  const out: ({ item: NavItem } | { section: string; items: NavItem[] })[] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (!item.section) out.push({ item })
    else if (last && 'section' in last && last.section === item.section) last.items.push(item)
    else out.push({ section: item.section, items: [item] })
  }
  return out
}

/** Submenu recolhível (ex.: Marketplaces › Shopee): abre sozinho quando a tela atual está nele. */
function Section({ title, items, current }: { title: string; items: NavItem[]; current: string | undefined }) {
  const Icon = items[0]!.icon
  return (
    <Collapsible asChild defaultOpen={items.some((i) => i.to === current)} className="group/section">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={title}>
            <Icon />
            <span>{title}</span>
            <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/section:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.to}>
                <SidebarMenuSubButton asChild isActive={item.to === current}>
                  <NavLink to={item.to}>
                    <span>{item.title}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function Items({ items }: { items: NavItem[] }) {
  const { pathname, search } = useLocation()
  const current = findNavItem(pathname, search)?.item.to
  const isActive = (to: string) => to === current
  const badge = useNavBadges()
  return (
    <SidebarMenu>
      {bySection(items).map((entry) => {
        if ('section' in entry) return <Section key={`s-${entry.section}`} title={entry.section} items={entry.items} current={current} />
        const { item } = entry
        return (
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
        )
      })}
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
