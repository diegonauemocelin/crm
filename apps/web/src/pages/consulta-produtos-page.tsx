import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PackageSearchIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { brl, int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface Branch {
  id: number
  name: string
  available: number | null
  price: number | null
  resalePrice: number | null
}
interface Product {
  id: string
  code: string
  name: string
  ean: string | null
  factoryCode: string | null
  integrationCode: string | null
  refs: string[]
  brand: string | null
  groupName: string | null
  subgroupName: string | null
  application: string | null
  usedIn: string | null
  unit: string | null
  stock: number | null
  price: number | null
  resalePrice: number | null
  branches: Branch[]
  stockAt: string
}
interface SearchData {
  total: number
  page: number
  pageSize: number
  sync: { enabled: boolean; lastPingAt: string | null; online?: boolean; lastFullAt: string | null; products: number; usedInConfigured: boolean }
  items: Product[]
}

const FIELDS = [
  ['tudo', 'Todos os campos'],
  ['sku', 'Código (SKU)'],
  ['referencia', 'Código de referência'],
  ['integracao', 'Código de integração'],
  ['fabrica', 'Código de fábrica'],
  ['titulo', 'Título'],
  ['utilizado', 'Utilizado em'],
] as const
const qty = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))

export function ConsultaProdutosPage() {
  return (
    <RequirePermission module="consulta_produtos">
      <Search />
    </RequirePermission>
  )
}

function Search() {
  const { can } = useAuth()
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [field, setField] = useState<string>('tudo')
  const [inStock, setInStock] = useState(false)
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => (setTerm(text.trim()), setPage(1)), 300)
    return () => clearTimeout(t)
  }, [text])
  const qs = new URLSearchParams({ ...(term ? { busca: term } : {}), campo: field, ...(inStock ? { estoque: 'true' } : {}), pagina: String(page) }).toString()
  const q = useQuery({ queryKey: ['tcar-produtos', qs], queryFn: () => api.get<SearchData>(`/tcar/produtos?${qs}`), placeholderData: keepPreviousData })
  const d = q.data
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1
  const updating = useLiveStock(d)
  return (
    <div>
      <PageHeader
        title="Consulta de produtos"
        description={
          d?.sync.lastFullAt
            ? `Produtos da Tcar: ${int.format(d.sync.products)} peças. Estoque e preço da última cópia (${formatDateTime(d.sync.lastFullAt)}); use “Atualizar” para conferir uma peça na hora.`
            : 'Busque peças da Tcar por código, referência, título ou aplicação, com estoque e preço.'
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" autoFocus placeholder="Código, referência, título, marca…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar produto" />
          </div>
          <Select value={field} onValueChange={(v) => (setField(v), setPage(1))}>
            <SelectTrigger className="w-52" aria-label="Buscar em">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELDS.map(([k, l]) => (
                <SelectItem key={k} value={k} disabled={k === 'utilizado' && !d?.sync.usedInConfigured}>
                  {l}
                  {k === 'utilizado' && !d?.sync.usedInConfigured ? ' (em breve)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Switch checked={inStock} onCheckedChange={(v) => (setInStock(v), setPage(1))} aria-label="Só com estoque" /> Só com estoque
          </label>
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && !d.sync.products && (
          <EmptyState
            icon={PackageSearchIcon}
            title="Ainda sem produtos da Tcar"
            description={d.sync.enabled ? 'A integração está ligada: a cópia começa no próximo contato do servidor da Tcar.' : 'A integração com a Tcar ainda não foi ligada.'}
            action={
              can('configuracoes', 'edit') ? (
                <Button asChild variant="outline">
                  <Link to="/configuracoes?secao=tcar">Configurar a Tcar</Link>
                </Button>
              ) : undefined
            }
          />
        )}
        {d && d.sync.products > 0 && d.sync.enabled && d.sync.online === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400">A Tcar está sem contato agora: o estoque mostrado é o da última cópia ({d.sync.lastPingAt ? `último contato ${formatDateTime(d.sync.lastPingAt)}` : 'sem contato ainda'}).</p>
        )}
        {d && d.sync.products > 0 && (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="hidden lg:table-cell">Códigos</TableHead>
                  <TableHead className="hidden xl:table-cell">{d.sync.usedInConfigured ? 'Utilizado em' : 'Aplicação'}</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum produto encontrado{inStock ? ' com estoque' : ''}.
                    </TableCell>
                  </TableRow>
                )}
                {d.items.map((p) => (
                  <ProductRow key={p.id} p={p} usedIn={d.sync.usedInConfigured} updating={updating.has(p.code)} />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        {d && pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground tabular-nums">{int.format(d.total)} produtos</span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {page} de {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Estoque na hora: a cada busca, pede à Tcar as primeiras peças do resultado e acompanha as respostas
 * (chegam no próximo contato da Tcar, em poucos segundos). Devolve os códigos ainda em atualização.
 */
function useLiveStock(d: SearchData | undefined) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Map<string, string>>(new Map())
  const asked = useRef('')
  const codes = d?.sync.online ? d.items.slice(0, 10).map((p) => p.code) : []
  const key = codes.join('|')
  // Pede quando o resultado muda (nova busca ou página).
  useEffect(() => {
    if (!key || key === asked.current) return
    asked.current = key
    const t = setTimeout(() => {
      api
        .post<{ online: boolean; pending: { code: string; actionId: string }[] }>('/tcar/produtos/atualizar', { codes: key.split('|') })
        .then((r) => setPending(new Map(r.pending.map((x) => [x.code, x.actionId]))))
        .catch(() => undefined)
    }, 400)
    return () => clearTimeout(t)
  }, [key])
  // Acompanha até 1 minuto; a cada resposta, recarrega a lista.
  useEffect(() => {
    if (!pending.size) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      const ids = [...pending.values()]
      api
        .get<{ id: string; status: string }[]>(`/tcar/acoes?ids=${ids.join(',')}`)
        .then((rows) => {
          const done = new Set(rows.filter((r) => r.status === 'OK' || r.status === 'ERRO').map((r) => r.id))
          if (!done.size && tries < 30) return
          if (rows.some((r) => r.status === 'OK' && done.has(r.id))) void qc.invalidateQueries({ queryKey: ['tcar-produtos'] })
          setPending((cur) => (tries >= 30 ? new Map() : new Map([...cur].filter(([, id]) => !done.has(id)))))
        })
        .catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [pending, qc])
  return new Set(pending.keys())
}

function ProductRow({ p, usedIn, updating }: { p: Product; usedIn: boolean; updating: boolean }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  // Segundos de espera da consulta manual (a Tcar pode levar até 1 minuto): mostrados ao lado do estoque.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => {
      clearInterval(timer)
      setElapsed(0)
    }
  }, [busy])
  // "Atualizar": a Tcar responde no próximo contato (alguns segundos); acompanha até 1 minuto.
  const refresh = async () => {
    setBusy(true)
    try {
      const { actionId } = await api.post<{ actionId: string }>(`/tcar/produtos/${encodeURIComponent(p.code)}/atualizar`)
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const a = await api.get<{ status: string; error: string | null }>(`/tcar/acoes/${actionId}`)
        if (a.status === 'OK') {
          await qc.invalidateQueries({ queryKey: ['tcar-produtos'] })
          toast.success(`Estoque de ${p.code} atualizado pela Tcar.`)
          return
        }
        if (a.status === 'ERRO') return void toast.error(a.error ?? 'A Tcar não conseguiu consultar a peça.')
      }
      toast.error('A Tcar não respondeu em 1 minuto. O servidor dela está ligado?')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const codes = [p.factoryCode && `Fábrica ${p.factoryCode}`, p.integrationCode && `Integração ${p.integrationCode}`].filter(Boolean) as string[]
  return (
    <TableRow>
      <TableCell className="max-w-96">
        <p className="font-medium break-words">{p.name}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{p.code}</span>
          {[p.brand, p.groupName, p.subgroupName].filter(Boolean).length ? ` · ${[p.brand, p.groupName, p.subgroupName].filter(Boolean).join(' · ')}` : ''}
        </p>
        {/* No celular, os códigos aparecem embaixo do nome. */}
        <p className="mt-0.5 text-xs text-muted-foreground lg:hidden">{[...codes, ...p.refs.slice(0, 3)].join(' · ')}</p>
      </TableCell>
      <TableCell className="hidden max-w-72 lg:table-cell">
        <div className="space-y-1 text-xs">
          {codes.map((c) => (
            <p key={c} className="font-mono">
              {c}
            </p>
          ))}
          {p.refs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {p.refs.map((r) => (
                <Badge key={r} variant="secondary" className="font-mono text-xs font-normal">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden max-w-60 text-sm xl:table-cell">{(usedIn ? p.usedIn : p.application) ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {p.branches.length > 1 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={cn('font-medium tabular-nums underline decoration-dotted underline-offset-4', (p.stock ?? 0) <= 0 && 'text-destructive')} title="Ver por filial">
                {qty(p.stock)} {p.unit ?? ''}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-1 text-sm">
              <p className="mb-1 text-xs font-medium">Estoque disponível por filial</p>
              {p.branches.map((b) => (
                <div key={b.id} className="flex justify-between gap-2">
                  <span className="truncate">{b.name}</span>
                  <span className={cn('tabular-nums', (b.available ?? 0) <= 0 && 'text-destructive')}>{qty(b.available)}</span>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        ) : (
          <span className={cn('font-medium tabular-nums', (p.stock ?? 0) <= 0 && 'text-destructive')}>
            {qty(p.stock)} {p.unit ?? ''}
          </span>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-1 whitespace-normal">
              <Loader2Icon className="size-3 animate-spin" /> Consultando a Tcar… {elapsed}s · pode levar até 1 minuto
            </span>
          ) : updating ? (
            <span className="inline-flex items-center gap-1">
              <Loader2Icon className="size-3 animate-spin" /> atualizando…
            </span>
          ) : Date.now() - Date.parse(p.stockAt) < 5 * 60_000 ? (
            'atualizado agora'
          ) : (
            formatDateTime(p.stockAt)
          )}
        </p>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        <p className="font-medium">{p.price === null ? '—' : brl.format(p.price)}</p>
        {p.resalePrice !== null && <p className="text-xs text-muted-foreground">revenda {brl.format(p.resalePrice)}</p>}
      </TableCell>
      <TableCell>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => void refresh()} disabled={busy} aria-label={`Atualizar estoque de ${p.code} na Tcar`} title="Atualizar estoque e preço agora (consulta a Tcar)">
          {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
        </Button>
      </TableCell>
    </TableRow>
  )
}
