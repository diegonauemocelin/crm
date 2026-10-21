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

/** Luminância relativa (WCAG) de uma cor #RRGGBB; null se não for uma cor válida. */
export function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h!, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contraste WCAG entre duas cores (1 a 21). Texto normal pede 4,5; ícones e bordas, 3. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a) ?? 0
  const lb = luminance(b) ?? 1
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Texto legível (preto ou branco) sobre a cor informada, pela luminância relativa (WCAG). */
export function contrastText(hex: string): string {
  const lum = luminance(hex)
  if (lum === null) return '#ffffff'
  return lum > 0.4 ? '#111827' : '#ffffff'
}

/** Aplica a identidade visual configurada: cores, título da aba e favicon. */
export function applyBranding(b: Branding) {
  const root = document.documentElement.style
  root.setProperty('--brand', b.primaryColor)
  root.setProperty('--brand-foreground', contrastText(b.primaryColor))
  const identity = b.brandColor || b.primaryColor
  root.setProperty('--brand-identity', identity)
  root.setProperty('--brand-identity-foreground', contrastText(identity))
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
