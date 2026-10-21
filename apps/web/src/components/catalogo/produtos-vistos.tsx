import { useQuery } from '@tanstack/react-query'
import { EyeIcon, ImageOffIcon } from 'lucide-react'
import { InlineError } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { brl } from '@/lib/atendimento'
import { dateShort } from '@/lib/format'
import { cn } from '@/lib/utils'

export type SeenStatus = 'viu' | 'carrinho' | 'comprou'
export const SEEN_STATUS: Record<SeenStatus, { label: string; className: string }> = {
  viu: { label: 'Só viu', className: '' },
  carrinho: { label: 'No carrinho', className: 'border-amber-500/50 text-amber-700 dark:text-amber-400' },
  comprou: { label: 'Comprou', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
}

export function SeenBadge({ status }: { status: SeenStatus }) {
  return (
    <Badge variant="outline" className={cn('font-normal', SEEN_STATUS[status].className)}>
      {SEEN_STATUS[status].label}
    </Badge>
  )
}

export function ProductThumb({ image, name }: { image: string | null; name: string }) {
  return image ? (
    <img src={image} alt="" loading="lazy" className="size-10 shrink-0 rounded border bg-white object-contain" />
  ) : (
    <div className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted" aria-label={`Sem imagem de ${name}`}>
      <ImageOffIcon className="size-4 text-muted-foreground" />
    </div>
  )
}

interface Item {
  path: string
  name: string
  image: string | null
  url: string | null
  price: number | null
  stock: number | null
  active: boolean
  views: number
  firstAt: string
  lastAt: string
  status: SeenStatus
}

/** Produtos da loja que o lead viu no site (aba "Site" da ficha): ajuda o vendedor a saber o que oferecer. */
export function LeadProductsSeen({ leadId, className }: { leadId: string; className?: string }) {
  const q = useQuery({ queryKey: ['lead-produtos-vistos', leadId], queryFn: () => api.get<{ items: Item[] }>(`/catalogo/vistos/leads/${leadId}`) })
  const items = q.data?.items ?? []
  if (q.isError)
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <EyeIcon className="size-4 text-muted-foreground" /> Produtos que viu na loja
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InlineError error={q.error} onRetry={() => void q.refetch()} />
        </CardContent>
      </Card>
    )
  if (!items.length) return null
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <EyeIcon className="size-4 text-muted-foreground" /> Produtos que viu na loja
        </CardTitle>
        <CardDescription>Páginas de produtos do catálogo visitadas por este lead, das mais recentes para as mais antigas.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.path} className="flex items-center gap-3 py-2">
              <ProductThumb image={p.image} name={p.name} />
              <div className="min-w-0 flex-1">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline">
                    {p.name}
                  </a>
                ) : (
                  <p className="truncate text-sm font-medium">{p.name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {p.views === 1 ? 'Viu 1 vez' : `Viu ${p.views} vezes`} · última em {dateShort(p.lastAt)}
                  {p.price !== null ? ` · ${brl.format(p.price)}` : ''}
                  {p.stock !== null && p.stock <= 0 ? ' · sem estoque' : ''}
                  {!p.active ? ' · fora da loja' : ''}
                </p>
              </div>
              <SeenBadge status={p.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
