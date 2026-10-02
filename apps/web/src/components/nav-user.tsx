import { ChevronsUpDownIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { UserAvatar, UserMenuContent } from '@/components/layout/user-menu'
import { useAuth } from '@/lib/auth'

export function NavUser() {
  const { isMobile } = useSidebar()
  const { me } = useAuth()
  if (!me) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <UserAvatar name={me.name} url={me.avatarUrl} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{me.name}</span>
                <span className="truncate text-xs text-muted-foreground">{me.role.name}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
            <UserMenuContent />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
