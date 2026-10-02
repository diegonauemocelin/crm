import type { ReactNode } from 'react'
import { AppFooter } from '@/components/layout/app-footer'
import { BrandMark } from '@/components/layout/brand-logo'
import { useBranding } from '@/lib/branding'

/** Tela dividida: painel da marca (cores e logo do whitelabel) à esquerda e formulário à direita. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const b = useBranding()
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex"
        style={{ background: 'var(--brand-nav)', color: 'var(--brand-nav-foreground)' }}
      >
        <div className="flex items-center gap-3 text-lg font-semibold">
          <BrandMark onDark className="size-10" />
          {b.appName}
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-3xl font-semibold leading-tight">Leads, atendimento e marketing em um só lugar.</p>
          <p className="mt-3 opacity-75">CRM, automação de marketing e acompanhamento de pré e pós-vendas.</p>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'var(--brand)' }}
        />
      </aside>
      <div className="flex flex-col">
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-2 font-semibold lg:hidden">
              <BrandMark />
              {b.appName}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </main>
        <AppFooter linkToUpdates={false} className="border-t-0" />
      </div>
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}
