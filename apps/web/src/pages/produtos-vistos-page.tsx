import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, ExternalLinkIcon, EyeIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Stat } from '@/components/atendimento/dashboard'
import { ProductThumb, SeenBadge, type SeenStatus } from '@/components/catalogo/produtos-vistos'
import { EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { brl, formatPhone, int, pctFmt, todaySP } from '@/lib/atendimento'
import { cn } from '@/lib/utils'

interface Product {
  path: string
  productId: string
  name: string
  brand: string | null
  url: string | null
  image: string | null
  price: number | null
  stock: number | null
  active: boolean
  codes: string[]
  views: number
  visitors: number
  leads: number
  lastAt: string
  carts: number
  bought: number
  cartRate: number | null
}
interface Opportunity {
  leadId: string
  name: string | null
  phone: string | null
  email: string | null
  path: string
  product: string
  image: string | null
  url: string | null
  price: number | null
  stock: number | null
  views: number
  lastAt: string
  status: SeenStatus
}
interface Seen {
  from: string
  to: string
  min: number
  catalogPages: number
  totals: { views: number; visitors: number; leads: number; products: number }
  products: Product[]
  outOfStock: Product[]
  opportunities: Opportunity[]
  canSeeLeads: boolean
}

const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
] as const
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function ProdutosVistosPage() {
  return (
    <RequirePermission module="catalogo">
      <Page />
    </RequirePermission>
  )
}

function Page() {
  const [preset, setPreset] = useState<string>('30')
  const [range, setRange] = useState<[string, string]>([todaySP(-29), todaySP()])
  const [min, setMin] = useState('2')
  const qs = new URLSearchParams({ de: range[0], ate: range[1], min }).toString()
  const q = useQuery({ queryKey: ['produtos-vistos', qs], queryFn: () => api.get<Seen>(`/catalogo/vistos?${qs}`), placeholderData: keepPreviousData })
  return (
    <div>
      <PageHeader
        title="Produtos vistos na loja"
        description="Pelo rastreamento do site: os produtos mais vistos, a procura por produtos sem estoque e os leads que viram e ainda não compraram."
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preset}
            onValueChange={(v) => {
              if (!v) return
              setPreset(v)
              const pr = PRESETS.find((x) => x.id === v)
              if (pr) setRange(pr.range() as [string, string])
            }}
            aria-label="Período"
          >
            {PRESETS.map((pr) => (
              <ToggleGroupItem key={pr.id} value={pr.id} className="px-3">
                {pr.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-1">
            <Input type="date" className="h-8 w-36" aria-label="De" value={range[0]} max={range[1]} onChange={(e) => e.target.value && (setPreset(''), setRange([e.target.value, range[1]]))} />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" className="h-8 w-36" aria-label="Até" value={range[1]} min={range[0]} onChange={(e) => e.target.value && (setPreset(''), setRange([range[0], e.target.value]))} />
          </div>
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && <Body d={q.data} min={min} setMin={setMin} />}
      </div>
    </div>
  )
}

function Body({ d, min, setMin }: { d: Seen; min: string; setMin: (v: string) => void }) {
  if (!d.catalogPages) {
    return (
      <EmptyState
        icon={EyeIcon}
        title="Catálogo ainda sem produtos"
        description="Os produtos vistos aparecem quando o catálogo da Magazord estiver copiado (Configurações → Integrações → Magazord) e o rastreamento estiver instalado na loja."
      />
    )
  }
  const t = d.totals
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visualizações de produtos" value={int.format(t.views)} delta={null} hint="páginas de produto abertas no período" />
        <Stat label="Visitantes" value={int.format(t.visitors)} delta={null} hint="navegadores diferentes" />
        <Stat label="Leads identificados" value={int.format(t.leads)} delta={null} hint={t.visitors ? `${pctFmt.format(t.leads / t.visitors)} dos visitantes` : undefined} />
        <Stat label="Produtos vistos" value={int.format(t.products)} delta={null} hint={`de ${int.format(d.catalogPages)} produtos no catálogo`} />
      </div>

      {d.outOfStock.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangleIcon className="size-4 text-amber-600" /> Procurados e sem estoque
            </CardTitle>
            <CardDescription>Clientes estão abrindo estes produtos, mas a loja está sem estoque: vale repor ou avisar quem procurou.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.outOfStock.map((p) => (
                <li key={p.path} className="flex items-center gap-3 py-2">
                  <ProductThumb image={p.image} name={p.name} />
                  <ProductName p={p} />
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {int.format(p.views)} <span className="text-xs text-muted-foreground">visualizações · {int.format(p.visitors)} pessoas</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Section title="Mais vistos" description="Produtos com mais visualizações no período. “Carrinho” conta os carrinhos da loja com o produto no mesmo período.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <Num>Visualizações</Num>
              <Num className="hidden md:table-cell">Pessoas</Num>
              <Num className="hidden md:table-cell">Leads</Num>
              <Num>Carrinhos</Num>
              <Num>Comprados</Num>
              <Num className="hidden lg:table-cell">Estoque</Num>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.products.length === 0 && <Empty cols={7} />}
            {d.products.map((p) => (
              <TableRow key={p.path}>
                <TableCell className="max-w-96">
                  <div className="flex items-center gap-3">
                    <ProductThumb image={p.image} name={p.name} />
                    <ProductName p={p} />
                  </div>
                </TableCell>
                <Num>{int.format(p.views)}</Num>
                <Num className="hidden md:table-cell">{int.format(p.visitors)}</Num>
                <Num className="hidden md:table-cell">{int.format(p.leads)}</Num>
                <Num>
                  {int.format(p.carts)}
                  {p.cartRate !== null && p.carts > 0 && <span className="block text-xs text-muted-foreground">{pctFmt.format(p.cartRate)} de quem viu</span>}
                </Num>
                <Num>{int.format(p.bought)}</Num>
                <Num className="hidden lg:table-cell">{p.stock === null ? '—' : p.stock <= 0 ? <span className="text-destructive">sem estoque</span> : int.format(p.stock)}</Num>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {d.canSeeLeads && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Viram e não compraram</CardTitle>
              <CardDescription>Leads identificados que abriram o produto e ainda não compraram. Quem está com o produto no carrinho aparece primeiro. Bom ponto de partida para um contato pelo WhatsApp.</CardDescription>
            </div>
            <Select value={min} onValueChange={setMin}>
              <SelectTrigger size="sm" className="w-48" aria-label="Mínimo de visualizações">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['1', '2', '3', '5'].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m === '1' ? 'Viu ao menos 1 vez' : `Viu ${m} vezes ou mais`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Produto</TableHead>
                  <Num>Vezes</Num>
                  <TableHead className="hidden md:table-cell">Última vez</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.opportunities.length === 0 && <Empty cols={5} />}
                {d.opportunities.map((o) => (
                  <TableRow key={`${o.leadId}-${o.path}`}>
                    <TableCell className="max-w-48">
                      <Link to={`/leads/${o.leadId}`} className="block truncate font-medium hover:underline">
                        {o.name || o.email || 'Lead sem nome'}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{o.phone ? formatPhone(o.phone) : o.email}</span>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <span className="block truncate text-sm">{o.product}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.price !== null ? brl.format(o.price) : ''}
                        {o.stock !== null && o.stock <= 0 ? ' · sem estoque' : ''}
                      </span>
                    </TableCell>
                    <Num>{int.format(o.views)}</Num>
                    <TableCell className="hidden text-sm whitespace-nowrap md:table-cell">{when(o.lastAt)}</TableCell>
                    <TableCell>
                      <SeenBadge status={o.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {d.opportunities.length >= 300 && <p className="px-4 pt-2 text-xs text-muted-foreground">Mostrando os 300 primeiros. Aumente o mínimo de visualizações ou diminua o período.</p>}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Como contamos: uma visualização é uma abertura da página do produto no site com o rastreamento do CRM (visitantes que recusaram cookies ou ativaram o “não rastrear” não entram). Variações do mesmo produto contam juntas. O lead só aparece depois de identificado (formulário, link de e-mail do CRM ou compra).
      </p>
    </>
  )
}

function ProductName({ p }: { p: Pick<Product, 'name' | 'url' | 'price' | 'brand' | 'active'> }) {
  return (
    <div className="min-w-0 flex-1">
      {p.url ? (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-medium hover:underline">
          <span className="truncate">{p.name}</span>
          <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      ) : (
        <p className="truncate text-sm font-medium">{p.name}</p>
      )}
      <p className="truncate text-xs text-muted-foreground">
        {[p.brand, p.price !== null ? brl.format(p.price) : null, p.active ? null : 'fora da loja'].filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-0 sm:px-6">{children}</CardContent>
    </Card>
  )
}

function Num({ children, className }: { children?: ReactNode; className?: string }) {
  return <TableCell className={cn('text-right whitespace-nowrap tabular-nums', className)}>{children}</TableCell>
}

function Empty({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">
        Sem dados no período.
      </TableCell>
    </TableRow>
  )
}
