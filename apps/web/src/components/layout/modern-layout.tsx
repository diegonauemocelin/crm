import { Fragment } from 'react'
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
import { AppFooter } from './app-footer'
import { GlobalSearch } from './global-search'
import { ThemeToggle } from './theme-toggle'

const EXTRA_TITLES: Record<string, string> = { '/meu-perfil': 'Meu perfil' }

export function useBreadcrumb() {
  const { pathname } = useLocation()
  const found = findNavItem(pathname)
  if (found) return found.item.to === '/' ? [{ title: 'Início' }] : [{ title: found.group.title }, { title: found.item.title, to: found.item.to }]
  return [{ title: EXTRA_TITLES[pathname] ?? 'Página' }]
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
                  <Fragment key={c.title}>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem className={i < arr.length - 1 ? 'hidden md:block' : undefined}>
                      {i === arr.length - 1 ? <BreadcrumbPage>{c.title}</BreadcrumbPage> : <span>{c.title}</span>}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
            </BreadcrumbList>
          </Breadcrumb>
          <GlobalSearch />
          <ThemeToggle />
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  )
}
