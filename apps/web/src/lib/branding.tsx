import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { api } from './api'
import type { Branding } from './types'

export const FALLBACK_BRANDING: Branding = {
  appName: 'CRM',
  shortName: 'CRM',
  primaryColor: '#1d4ed8',
  sidebarColor: '#0f1e3d',
  loginTitle: 'Bem-vindo de volta',
  loginSubtitle: 'Acesse sua conta para continuar.',
  defaultLayout: 'MODERN',
  allowLayoutChoice: true,
  supportEmail: '',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
}

const BrandingContext = createContext<Branding>(FALLBACK_BRANDING)

/** Texto legível (preto ou branco) sobre a cor informada, pela luminância relativa (WCAG). */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#ffffff'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h!, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.4 ? '#111827' : '#ffffff'
}

/** Aplica a identidade visual configurada: cores, título da aba e favicon. */
export function applyBranding(b: Branding) {
  const root = document.documentElement.style
  root.setProperty('--brand', b.primaryColor)
  root.setProperty('--brand-foreground', contrastText(b.primaryColor))
  root.setProperty('--brand-nav', b.sidebarColor)
  root.setProperty('--brand-nav-foreground', contrastText(b.sidebarColor))
  document.title = b.appName
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = b.faviconUrl ?? '/favicon.svg'
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/public/branding'),
    staleTime: 5 * 60_000,
  })
  const branding = data ?? FALLBACK_BRANDING
  useEffect(() => applyBranding(branding), [branding])
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  return useContext(BrandingContext)
}
