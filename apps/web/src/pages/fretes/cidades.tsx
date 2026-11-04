import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { MapPinnedIcon, SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { CarrierRegions, RecipientFees } from '@/pages/fretes/transportadoras'

interface CityRow {
  code: string
  ibge: string | null
  city: string
  uf: string
  deadlineDays: number | null
  businessDays: boolean
  weekdays: string[]
  pickup: boolean | null
  contact: string | null
  note: string | null
}

/** Fretes › Cidades atendidas: por transportadora, as bases de entrega com as cidades, o prazo e as listas de taxas. */
export function FretesCidadesPage() {
  const [params, setParams] = useSearchParams()
  const carriers = useQuery({ queryKey: ['fretes', 'transportadoras', '', 'active'], queryFn: () => api.get<{ id: string; name: string }[]>('/fretes/transportadoras?situacao=active') })
  const carrierId = params.get('transportadora') ?? carriers.data?.[0]?.id ?? null
  return (
    <RequirePermission module="fretes_transportadoras">
      <div className="space-y-4">
        <PageHeader
          title="Cidades atendidas"
          description="Por transportadora: as bases de entrega (regiões) com as cidades que atendem, o prazo e os dias de entrega, e as listas de taxas por destinatário (TDA, TDE, TDC, TVD). Valem para todas as tabelas da transportadora."
        />
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="cid-transp">Transportadora</Label>
          <Select value={carrierId ?? ''} onValueChange={(v) => setParams({ transportadora: v })}>
            <SelectTrigger id="cid-transp" className="w-full">
              <SelectValue placeholder={carriers.isLoading ? 'Carregando…' : 'Escolha a transportadora'} />
            </SelectTrigger>
            <SelectContent>
              {(carriers.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {carriers.data && !carriers.data.length && <EmptyState icon={MapPinnedIcon} title="Nenhuma transportadora ativa" description="Cadastre a transportadora em Fretes › Transportadoras." />}
        {carrierId && <CitiesPanel carrierId={carrierId} />}
      </div>
    </RequirePermission>
  )
}

/** Importação das regiões e das listas, e a lista das cidades atendidas com busca. */
export function CitiesPanel({ carrierId }: { carrierId: string }) {
  const { can } = useAuth()
  const editable = can('fretes_transportadoras', 'edit')
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <CarrierRegions carrierId={carrierId} editable={editable} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <RecipientFees carrierId={carrierId} editable={editable} />
          </CardContent>
        </Card>
      </div>
      <CityTable carrierId={carrierId} />
    </div>
  )
}

const DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

function CityTable({ carrierId }: { carrierId: string }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => (setQ(search.trim()), setPage(1)), 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => setPage(1), [carrierId])
  const qs = new URLSearchParams({ ...(q ? { busca: q } : {}), pagina: String(page) })
  const list = useQuery({ queryKey: ['fretes', 'regioes', carrierId, 'cidades', qs.toString()], queryFn: () => api.get<{ total: number; page: number; rows: CityRow[] }>(`/fretes/transportadoras/${carrierId}/regioes/cidades?${qs}`), placeholderData: keepPreviousData })
  const d = list.data
  const pages = d ? Math.max(1, Math.ceil(d.total / 100)) : 1
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Cidades atendidas{d ? ` (${d.total.toLocaleString('pt-BR')})` : ''}</p>
          <label className="relative block w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cidade, UF, base (PR1) ou código IBGE" className="pl-9" aria-label="Buscar cidade atendida" />
          </label>
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={6} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !d?.rows.length ? (
          <EmptyState icon={MapPinnedIcon} title={q ? 'Nenhuma cidade encontrada' : 'Nenhuma cidade atendida'} description={q ? 'Confira a busca.' : 'Importe a planilha Regiões da transportadora (acima).'} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cidade</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>Base de entrega</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Dias de entrega</TableHead>
                  <TableHead>Atendimento</TableHead>
                  <TableHead className="hidden md:table-cell">IBGE</TableHead>
                  <TableHead>Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((r) => (
                  <TableRow key={`${r.code}-${r.ibge}-${r.city}`}>
                    <TableCell className="font-medium">{r.city}</TableCell>
                    <TableCell>{r.uf}</TableCell>
                    <TableCell>{r.code}</TableCell>
                    <TableCell>{r.deadlineDays === null ? '—' : `${r.deadlineDays} dia(s) ${r.businessDays ? 'úteis' : 'corridos'}`}</TableCell>
                    <TableCell className="text-xs">{r.weekdays.length === 0 ? '—' : r.weekdays.length >= 5 && DAYS.slice(0, 5).every((x) => r.weekdays.includes(x)) ? 'Todos os dias úteis' : r.weekdays.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(', ')}</TableCell>
                    <TableCell className="text-xs">
                      {r.pickup === null ? '—' : r.pickup ? 'Coleta e entrega' : <span className="font-medium text-amber-700 dark:text-amber-300">Somente retirada</span>}
                      {r.contact && <span className="block text-muted-foreground">{r.contact}</span>}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{r.ibge ?? '—'}</TableCell>
                    <TableCell className="max-w-md text-xs whitespace-normal text-muted-foreground">{r.note ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span>
                  Página {page} de {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
