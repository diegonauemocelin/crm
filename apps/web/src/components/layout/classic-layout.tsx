import { ChevronDownIcon, MenuIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { findNavItem, visibleNavigation } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { AlertsBell } from './alerts-bell'
import { SellerLinkWarning } from './seller-link-warning'
import { AppFooter } from './app-footer'
import { BrandMark } from './brand-logo'
import { GlobalSearch } from './global-search'
import { useBreadcrumb } from './modern-layout'
import { ThemeToggle } from './theme-toggle'
import { UserAvatar, UserMenuContent } from './user-menu'

const navText = 'text-[var(--brand-nav-foreground)]'

/**
 * Layout Clássico, inspirado no RD Station: barra superior na cor do menu (whitelabel) com menus suspensos
 * por área, faixa de título da página e conteúdo em largura limitada com espaçamentos mais compactos.
 */
export function ClassicLayout() {
  const { can, me } = useAuth()
  const branding = useBranding()
  const { pathname } = useLocation()
  const groups = visibleNavigation(can)
  const crumbs = useBreadcrumb()
  const activeGroup = findNavItem(pathname)?.group.title
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="layout-classic flex min-h-svh flex-col bg-muted/40">
      <header className="sticky top-0 z-20 shadow-sm" style={{ background: 'var(--brand-nav)' }}>
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className={cn('lg:hidden hover:bg-white/10', navText)} aria-label="Abrir menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{branding.appName}</SheetTitle>
              </SheetHeader>
              <nav className="space-y-4 px-4 pb-6">
                {groups.map((g) => (
                  <div key={g.title}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                    {g.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted', isActive && 'bg-muted font-medium')
                        }
                      >
                        <item.icon className="size-4" />
                        {item.title}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          <Link to="/" className={cn('mr-4 flex items-center gap-2 font-semibold', navText)}>
            <BrandMark onDark className="size-7" />
            <span className="hidden sm:inline">{branding.appName}</span>
          </Link>

          <nav className="hidden flex-1 items-center gap-0.5 lg:flex" aria-label="Menu principal">
            {groups.map((g) =>
              g.items.length === 1 && g.title !== 'Administração' ? (
                <NavLink
                  key={g.title}
                  to={g.items[0]!.to}
                  end={g.items[0]!.to === '/'}
                  className={({ isActive }) =>
                    cn('rounded px-3 py-2 text-sm font-medium opacity-85 hover:bg-white/10 hover:opacity-100', navText, isActive && 'bg-white/15 opacity-100')
                  }
                >
                  {g.items[0]!.title === 'Início' ? 'Início' : g.title}
                </NavLink>
              ) : (
                <DropdownMenu key={g.title}>
                  <DropdownMenuTrigger
                    className={cn(
                      'flex items-center gap-1 rounded px-3 py-2 text-sm font-medium opacity-85 outline-none hover:bg-white/10 hover:opacity-100 data-[state=open]:bg-white/15',
                      navText,
                      activeGroup === g.title && 'bg-white/15 opacity-100',
                    )}
                  >
                    {g.title}
                    <ChevronDownIcon className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-56">
                    {g.items.map((item) => (
                      <DropdownMenuItem key={item.to} asChild>
                        <Link to={item.to}>
                          <item.icon />
                          <span className="flex-1">{item.title}</span>
                          {item.phase && (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              Em breve
                            </Badge>
                          )}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            )}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <GlobalSearch iconOnly className={cn('hover:bg-white/10', navText)} />
            <AlertsBell className={cn('hover:bg-white/10', navText)} />
            <ThemeToggle className={cn('hover:bg-white/10', navText)} />
            {me && (
              <DropdownMenu>
                <DropdownMenuTrigger className={cn('ml-1 flex items-center gap-2 rounded px-1.5 py-1 outline-none hover:bg-white/10', navText)}>
                  <UserAvatar name={me.name} url={me.avatarUrl} className="size-7 rounded-full" />
                  <span className="hidden max-w-32 truncate text-sm xl:inline">{me.name.split(' ')[0]}</span>
                  <ChevronDownIcon className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <UserMenuContent />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <div className="border-b bg-background">
        <div className="mx-auto flex h-11 max-w-[1400px] items-center gap-1.5 px-4 text-sm text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={c.title} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              <span className={i === crumbs.length - 1 ? 'font-medium text-foreground' : undefined}>{c.title}</span>
            </span>
          ))}
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5">
        <SellerLinkWarning />
          <Outlet />
      </main>
      <AppFooter className="bg-background" />
    </div>
  )
}
