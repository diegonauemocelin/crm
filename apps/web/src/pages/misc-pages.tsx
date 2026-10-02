import { CompassIcon, ConstructionIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { EmptyState, PageHeader, RequirePermission } from '@/components/page'
import { Button } from '@/components/ui/button'
import { findNavItem } from '@/lib/navigation'

/** Módulos do roadmap ainda não entregues: mostram em que fase chegam. */
export function ComingSoonPage() {
  const { pathname } = useLocation()
  const found = findNavItem(pathname)
  const item = found?.item
  const content = (
    <>
      <PageHeader title={item?.title ?? 'Em breve'} />
      <EmptyState
        icon={ConstructionIcon}
        title="Módulo em desenvolvimento"
        description={item?.phase ? `Este módulo chega na Fase ${item.phase} do roteiro de implantação.` : 'Este módulo chega nas próximas fases.'}
        action={
          <Button asChild variant="outline">
            <Link to="/">Ver roteiro na tela inicial</Link>
          </Button>
        }
      />
    </>
  )
  return item?.module ? <RequirePermission module={item.module}>{content}</RequirePermission> : content
}

export function NotFoundPage() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Página não encontrada"
      description="O endereço pode ter mudado ou não existe."
      action={
        <Button asChild>
          <Link to="/">Ir para o início</Link>
        </Button>
      }
    />
  )
}
