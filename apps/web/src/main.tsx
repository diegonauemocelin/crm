import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { toast } from 'sonner'
import { ConfirmProvider } from './components/confirm'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { ApiError } from './lib/api'
import { registerServiceWorker } from './lib/app-movel'
import { AuthProvider } from './lib/auth'
import { BrandingProvider } from './lib/branding'
import { ThemeProvider } from './lib/theme'

// Mensagem de erro fica mais tempo na tela que a de sucesso: dá tempo de ler o que corrigir.
const showError = toast.error
toast.error = ((message, opts) => showError(message, { duration: 9000, ...opts })) as typeof toast.error

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros de permissão ou sessão não melhoram com nova tentativa.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

// App no celular: notificações e instalação na tela inicial.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrandingProvider>
          <AuthProvider>
            <TooltipProvider delayDuration={400}>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
              <Toaster richColors closeButton position="top-right" />
            </TooltipProvider>
          </AuthProvider>
        </BrandingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
