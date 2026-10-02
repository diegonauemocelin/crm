import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { ApiError } from './lib/api'
import { AuthProvider } from './lib/auth'
import { BrandingProvider } from './lib/branding'
import { ThemeProvider } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros de permissão ou sessão não melhoram com nova tentativa.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrandingProvider>
          <AuthProvider>
            <TooltipProvider>
              <App />
              <Toaster richColors closeButton position="top-right" />
            </TooltipProvider>
          </AuthProvider>
        </BrandingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
