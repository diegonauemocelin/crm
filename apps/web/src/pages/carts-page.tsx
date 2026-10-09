import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, CreditCardIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon, MessageCircleIcon, SearchIcon, ShoppingCartIcon, StoreIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, int, waDigits } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { type Cart, CONTACT_LABEL, type CartPage, type ContactStatus } from '@/lib/rastreamento'

const VIEWS = [
  { id: 'abandonados', label: 'Carrinhos abandonados' },
  { id: 'checkout', label: 'Checkout iniciado' },
  { id: 'recuperados', label: 'Recuperados' },
  { id: 'todos', label: 'Todos' },
] as const
type View = (typeof VIEWS)[number]['id']

const ALL = '__all__'
const CONTACT_TONE: Record<ContactStatus, string> = {
  PENDENTE: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  CONTATADO: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300',
  RECUPERADO: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  PERDIDO: 'text-muted-foreground',
}

export function CartsPage() {
  return (
    <RequirePermission module="carrinhos">
      <Carts />
    </RequirePermission>
  )
}

function Carts() {
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const view = (params.get('view') as View | null) ?? 'abandonados'
  const page = Number(params.get('page') ?? '1')
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [editing, setEditing] = useState<Cart | null>(null)

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== search.trim()) set('search', search.trim() || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const query = new URLSearchParams({ view, page: String(page), pageSize: '30' })
  for (const k of ['search', 'contactStatus']) {
    const v = params.get(k)
    if (v) query.set(k, v)
  }
  const q = useQuery({ queryKey: ['carts', query.toString()], queryFn: () => api.get<CartPage>(`/loja/carrinhos?${query}`), placeholderData: keepPreviousData })

  const download = async () => {
    const e = new URLSearchParams(query)
    e.delete('page')
    e.delete('pageSize')
    const res = await fetch(`/api/loja/carrinhos/exportar?${e}`, { credentials: 'same-origin' })
    if (!res.ok) return toast.error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha ao exportar.')
    const url = URL.createObjectURL(await res.blob())
    Object.assign(document.createElement('a'), { href: url, download: `carrinhos-${view}-${new Date().toISOString().slice(0, 10)}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  const data = q.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <PageHeader
        title="Carrinhos e checkout"
        description="Clientes da loja virtual que colocaram produtos no carrinho ou começaram o checkout e não compraram. Chame no WhatsApp com o link do carrinho e um cupom, ou exporte a lista para campanhas."
        actions={
          can('carrinhos', 'export') && (
            <Button variant="outline" onClick={() => void download()}>
              <DownloadIcon /> Exportar lista
            </Button>
          )
        }
      />

      <Tabs value={view} onValueChange={(v) => set('view', v === 'abandonados' ? null : v)}>
        <TabsList className="mb-4 h-auto flex-wrap">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.id} value={v.id}>
              {v.label}
              {v.id !== 'todos' && data?.counts[v.id] !== undefined && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{int.format(data.counts[v.id])}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar carrinhos" />
        </div>
        <Select value={params.get('contactStatus') ?? ALL} onValueChange={(v) => set('contactStatus', v === ALL ? null : v)}>
          <SelectTrigger className="w-44" aria-label="Situação do contato">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Qualquer contato</SelectItem>
            {(Object.keys(CONTACT_LABEL) as ContactStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {CONTACT_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <TableSkeleton rows={5} />
      ) : !data.configured && data.total === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="Loja virtual ainda não conectada"
          description="Ligue a integração com a Magazord em Configurações → Loja virtual para trazer os carrinhos, pedidos e clientes da loja."
          action={
            can('configuracoes', 'edit') && (
              <Button asChild>
                <Link to="/configuracoes?aba=loja">Configurar</Link>
              </Button>
            )
          }
        />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ShoppingCartIcon} title="Nenhum carrinho aqui" description="Quando um cliente identificado deixar produtos no carrinho, ele aparece nesta lista." />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((c) => (
              <CartCard key={c.id} cart={c} onEdit={() => setEditing(c)} canEdit={can('carrinhos', 'edit')} />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {int.format(data.total)} carrinho(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => set('page', String(page - 1))} aria-label="Página anterior">
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" disabled={page >= totalPages} onClick={() => set('page', String(page + 1))} aria-label="Próxima página">
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </>
      )}

      {editing && <ContactDialog cart={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CartCard({ cart: c, onEdit, canEdit }: { cart: Cart; onEdit: () => void; canEdit: boolean }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copiado.`)
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }
  const wa = c.customerPhone ? `https://wa.me/${waDigits(c.customerPhone)}?text=${encodeURIComponent(c.message)}` : null
  const store = c.status === 3 ? 'Comprado' : c.status === 2 ? 'Abandonado' : 'Aberto'
  return (
    <Card className="py-4">
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,15rem)]">
        <div className="min-w-0 space-y-0.5">
          {c.leadId ? (
            <Link to={`/leads/${c.leadId}`} className="block truncate font-medium hover:underline">
              {c.customerName ?? c.customerEmail ?? 'Cliente'}
            </Link>
          ) : (
            <p className="truncate font-medium">{c.customerName ?? c.customerEmail ?? 'Cliente'}</p>
          )}
          {c.customerEmail && <p className="truncate text-sm text-muted-foreground">{c.customerEmail}</p>}
          {c.customerPhone && <p className="text-sm text-muted-foreground">{formatPhone(c.customerPhone)}</p>}
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className={CONTACT_TONE[c.contactStatus]}>
              {CONTACT_LABEL[c.contactStatus]}
            </Badge>
            {c.checkoutStarted && (
              <Badge variant="outline">
                <CreditCardIcon /> Checkout iniciado
              </Badge>
            )}
          </div>
        </div>

        <ul className="min-w-0 space-y-2">
          {c.items.slice(0, 4).map((i) => (
            <li key={`${i.code}-${i.name}`} className="flex items-center gap-3">
              {i.image ? <img src={i.image} alt="" className="size-10 shrink-0 rounded border object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <div className="size-10 shrink-0 rounded border bg-muted" />}
              <div className="min-w-0">
                {i.url ? (
                  <a href={i.url} target="_blank" rel="noreferrer noopener" className="line-clamp-1 text-sm hover:underline">
                    {i.name}
                  </a>
                ) : (
                  <p className="line-clamp-1 text-sm">{i.name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {i.qty} un. · cód. {i.code}
                </p>
              </div>
            </li>
          ))}
          {c.items.length > 4 && <li className="text-xs text-muted-foreground">e mais {c.items.length - 4} produto(s)</li>}
          {c.contactNote && <li className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">“{c.contactNote}”{c.contactedBy ? ` — ${c.contactedBy}` : ''}</li>}
        </ul>

        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Última atividade: <span className="text-foreground">{formatDateTime(c.lastActivityAt)}</span>
          </p>
          <p className="text-muted-foreground">
            Na loja: <span className="text-foreground">{store}</span>
            {c.orderCode ? ` · pedido ${c.orderCode}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {wa && (
              <Button size="sm" asChild>
                <a href={wa} target="_blank" rel="noreferrer noopener">
                  <MessageCircleIcon /> WhatsApp
                </a>
              </Button>
            )}
            {c.checkoutUrl && (
              <Button size="sm" variant="outline" onClick={() => void copy(c.checkoutUrl!, 'Link do carrinho')}>
                <CopyIcon /> Link
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void copy(c.message, 'Mensagem')}>
              <CopyIcon /> Mensagem
            </Button>
            {c.checkoutUrl && (
              <Button size="sm" variant="ghost" asChild>
                <a href={c.checkoutUrl} target="_blank" rel="noreferrer noopener" aria-label="Abrir carrinho na loja">
                  <ExternalLinkIcon />
                </a>
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={onEdit}>
                Registrar contato
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ContactDialog({ cart, onClose }: { cart: Cart; onClose: () => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<ContactStatus>(cart.contactStatus === 'PENDENTE' ? 'CONTATADO' : cart.contactStatus)
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: () => api.patch(`/loja/carrinhos/${cart.id}`, { contactStatus: status, note: note.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['carts'] })
      toast.success('Contato registrado.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Contato com {cart.customerName ?? 'o cliente'}</DialogTitle>
            <DialogDescription>Fica registrado no carrinho e na linha do tempo do lead. Se ele comprar depois do contato, o carrinho vira “Recuperado” sozinho.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-status">Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ContactStatus)}>
                <SelectTrigger id="c-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTACT_LABEL) as ContactStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {CONTACT_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-note">Observação</Label>
              <Textarea id="c-note" rows={3} maxLength={1000} placeholder="Ex.: mandei o cupom VOLTA10, vai finalizar hoje." value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
