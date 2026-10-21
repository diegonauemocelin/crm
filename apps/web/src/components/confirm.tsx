import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useBlocker } from 'react-router'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

/**
 * Confirmação única do sistema: mesma janela, mesmos botões e o nome do que vai ser feito no botão
 * ("Excluir modelo", não "OK"). Ação destrutiva fica em vermelho. Uso: `if (await confirm({...})) remove.mutate(id)`.
 */
export interface ConfirmOptions {
  title: string
  description?: ReactNode
  /** Texto do botão de confirmar: o verbo e o objeto (ex.: "Excluir etiqueta"). */
  confirmLabel: string
  cancelLabel?: string
  /** Padrão: true (vermelho). Use false para confirmações que não apagam nada. */
  destructive?: boolean
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), [])
  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description && <AlertDialogDescription>{pending.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>{pending?.cancelLabel ?? 'Cancelar'}</AlertDialogCancel>
            <AlertDialogAction variant={pending?.destructive === false ? 'default' : 'destructive'} onClick={() => close(true)}>
              {pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm fora do ConfirmProvider')
  return ctx
}

/** Compara o que está na tela com o que veio: só pergunta se algo mudou de verdade. */
export function isDirty(initial: unknown, current: unknown) {
  return JSON.stringify(initial ?? null) !== JSON.stringify(current ?? null)
}

/**
 * Janela ou painel com formulário: fechar (clicar fora, Esc, X ou Cancelar) com dados não salvos pergunta antes.
 * Uso: `const guard = useCloseGuard(dirty, onClose)` → `<Dialog open onOpenChange={(o) => !o && guard()}>` e
 * `<Button onClick={guard}>Cancelar</Button>`.
 */
export function useCloseGuard(dirty: boolean, onClose: () => void, what = 'as alterações') {
  const confirm = useConfirm()
  return useCallback(async () => {
    if (!dirty || (await confirm({ title: 'Descartar alterações?', description: `Você ainda não salvou ${what}. Se fechar agora, o que foi digitado se perde.`, confirmLabel: 'Descartar', cancelLabel: 'Continuar editando' }))) onClose()
  }, [confirm, dirty, onClose, what])
}

/**
 * Editor com alterações não salvas: pergunta antes de ir para outra tela pelo menu e avisa ao fechar ou
 * recarregar a aba do navegador.
 */
export function useUnsavedChangesPrompt(dirty: boolean, what = 'as alterações') {
  const confirm = useConfirm()
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({ title: 'Sair sem salvar?', description: `Você ainda não salvou ${what}. Se sair agora, elas se perdem.`, confirmLabel: 'Sair sem salvar', cancelLabel: 'Continuar editando' }).then((ok) => (ok ? blocker.proceed() : blocker.reset()))
  }, [blocker, confirm, what])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
}
