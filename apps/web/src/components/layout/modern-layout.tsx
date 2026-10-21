import { Fragment, useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { AppSidebar } from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { findNavItem } from '@/lib/navigation'
import { useCurrentPageTitle } from '@/lib/page-title'
import { useBranding } from '@/lib/branding'
import { AlertsBell, AttendanceNotifier } from './alerts-bell'
import { SellerLinkWarning } from './seller-link-warning'
import { AppFooter } from './app-footer'
import { TrailHelp } from '@/components/trilha'
import { GlobalSearch } from './global-search'
import { ThemeToggle } from './theme-toggle'
import { ChatNotifier } from '@/lib/chat-alerts'

const EXTRA_TITLES: Record<string, string> = { '/meu-perfil': 'Meu perfil' }

export interface Crumb {
  title: string
  to?: string
}

/** Grupo do menu › tela › registro aberto (quando a tela de detalhe informa o nome). A tela vira link quando há um nível abaixo. */
export function useBreadcrumb(): Crumb[] {
  const { pathname, search } = useLocation()
  const found = findNavItem(pathname, search)
  const record = useCurrentPageTitle(pathname)
  const crumbs: Crumb[] = found ? (found.item.to === '/' ? [{ title: 'Início' }] : [{ title: found.group.title }, { title: found.item.title, to: found.item.to }]) : [{ title: EXTRA_TITLES[pathname] ?? 'Página' }]
  if (record && found && pathname !== found.item.to.split('?')[0]) crumbs.push({ title: record })
  const last = crumbs[crumbs.length - 1]!
  const { appName } = useBranding()
  // Título da aba: a tela (ou o registro) primeiro, para achar a aba certa entre várias abertas. Mantém o "(3)" das conversas não lidas.
  useEffect(() => {
    const unread = /^\(\d+\)\s+/.exec(document.title)?.[0] ?? ''
    document.title = `${unread}${last.title === 'Início' ? '' : `${last.title} · `}${appName}`
  }, [last.title, appName])
  return crumbs
}

/** Layout Moderno: shadcn/ui SidebarProvider + sidebar-07 (recolhível), cabeçalho com breadcrumb e busca. */
export function ModernLayout() {
  const crumbs = useBreadcrumb()
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" aria-label="Recolher ou expandir menu" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink asChild>
                  <Link to="/">Início</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {crumbs
                .filter((c) => c.title !== 'Início')
                .map((c, i, arr) => (
                  <Fragment key={`${i}-${c.title}`}>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem className={i < arr.length - 1 ? 'hidden md:block' : 'min-w-0'}>
                      {i === arr.length - 1 ? (
                        <BreadcrumbPage className="truncate">{c.title}</BreadcrumbPage>
                      ) : c.to ? (
                        <BreadcrumbLink asChild>
                          <Link to={c.to}>{c.title}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <span>{c.title}</span>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
            </BreadcrumbList>
          </Breadcrumb>
          <GlobalSearch />
          <TrailHelp className="size-8" />
          <AlertsBell />
          <ThemeToggle />
        </header>
        <main className="flex-1 p-4 md:p-6">
          <SellerLinkWarning />
          <ChatNotifier />
          <AttendanceNotifier />
          <Outlet />
        </main>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  )
}
