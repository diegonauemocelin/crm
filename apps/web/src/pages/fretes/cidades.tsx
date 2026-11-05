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
        <CoverageSearch />
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

interface Coverage {
  city: string
  uf: string
  cep: string | null
  cepSource: 'informado' | 'regra' | 'consulta' | 'cte' | null
  checked: number
  carriers: {
    carrierId: string
    carrier: string
    tables: { id: string; name: string; modal: string; by: 'CEP' | 'CIDADE' | 'UF'; deadlineMin: number | null; deadlineMax: number | null; restricted: boolean; note: string | null }[]
    region: { code: string; deadlineDays: number | null; businessDays: boolean; pickup: boolean | null; contact: string | null; note: string | null } | null
  }[]
}

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const BY_LABEL = { CEP: 'faixa de CEP', CIDADE: 'cidade', UF: 'estado inteiro' } as const
const days = (a: number | null, b: number | null) => (a === null ? '—' : a === b || b === null ? `${a} dia(s)` : `${a} a ${b} dias`)

/** Busca uma cidade (ou CEP) em todas as transportadoras: quem atende, por qual tabela e em quantos dias. */
function CoverageSearch() {
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [cep, setCep] = useState('')
  const [q, setQ] = useState<string | null>(null)
  const res = useQuery({ queryKey: ['fretes', 'cobertura', q], queryFn: () => api.get<Coverage>(`/fretes/cidades/busca?${q}`), enabled: !!q })
  const d = res.data
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <p className="font-medium">Quem atende uma cidade</p>
          <p className="text-sm text-muted-foreground">Busca em todas as transportadoras ativas: tabelas publicadas e vigentes e cidades atendidas (bases), com o prazo.</p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const p = new URLSearchParams()
            if (cep.replace(/\D/g, '').length === 8) p.set('cep', cep.replace(/\D/g, ''))
            else {
              if (!city.trim() || !uf) return
              p.set('cidade', city.trim())
              p.set('uf', uf)
            }
            setQ(p.toString())
          }}
        >
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="cov-city">Cidade</Label>
            <Input id="cov-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Passo Fundo" />
          </div>
          <div className="w-24 space-y-1.5">
            <Label htmlFor="cov-uf">UF</Label>
            <Select value={uf} onValueChange={setUf}>
              <SelectTrigger id="cov-uf">
                <SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                {UFS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-sm text-muted-foreground">ou</span>
          <div className="w-36 space-y-1.5">
            <Label htmlFor="cov-cep">CEP</Label>
            <Input id="cov-cep" value={cep} onChange={(e) => setCep(e.target.value)} placeholder="00000-000" inputMode="numeric" maxLength={9} />
          </div>
          <Button type="submit" disabled={res.isFetching}>
            <SearchIcon aria-hidden /> Buscar
          </Button>
        </form>
        {res.isFetching && <TableSkeleton rows={3} />}
        {res.error && <ErrorState error={res.error} onRetry={() => res.refetch()} />}
        {d && !res.isFetching && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">
                {d.city}/{d.uf}
              </span>
              {d.cep ? ` · CEP ${d.cep.slice(0, 5)}-${d.cep.slice(5)}${d.cepSource === 'informado' ? '' : ' (CEP de referência da cidade)'}` : ' · sem CEP: tabelas por faixa de CEP só aparecem se você informar um CEP da cidade'}
              {` · ${d.carriers.length} de ${d.checked} transportadora(s) atendem`}
            </p>
            {!d.carriers.length ? (
              <EmptyState icon={MapPinnedIcon} title="Nenhuma transportadora atende esta cidade" description="Nenhuma tabela publicada e vigente nem lista de cidades atendidas inclui o destino." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transportadora</TableHead>
                    <TableHead>Tabela</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Atende por</TableHead>
                    <TableHead>Base / observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.carriers.flatMap((c) => {
                    const rows = c.tables.length ? c.tables : [null]
                    return rows.map((t, i) => (
                      <TableRow key={`${c.carrierId}-${t?.id ?? 'reg'}`}>
                        <TableCell className="font-medium">{i === 0 ? c.carrier : ''}</TableCell>
                        <TableCell className="text-sm">
                          {t ? t.name : <span className="text-muted-foreground">sem tabela vigente</span>}
                          {t?.restricted && <span className="block text-xs font-medium text-destructive">restrição de atendimento</span>}
                        </TableCell>
                        <TableCell className="text-sm">{t ? days(t.deadlineMin, t.deadlineMax) : c.region?.deadlineDays !== null && c.region?.deadlineDays !== undefined ? `${c.region.deadlineDays} dia(s) ${c.region.businessDays ? 'úteis' : 'corridos'}` : '—'}</TableCell>
                        <TableCell className="text-xs">{t ? BY_LABEL[t.by] : 'lista de cidades'}</TableCell>
                        <TableCell className="max-w-md text-xs whitespace-normal text-muted-foreground">
                          {i === 0 && c.region && (
                            <span className="block">
                              Base {c.region.code}
                              {c.region.pickup === false ? ' · somente retirada' : ''}
                              {c.region.contact ? ` · ${c.region.contact}` : ''}
                              {c.region.note ? ` · ${c.region.note}` : ''}
                            </span>
                          )}
                          {t?.note}
                        </TableCell>
                      </TableRow>
                    ))
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
