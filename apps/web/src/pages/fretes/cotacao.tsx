import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalculatorIcon, CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, DownloadIcon, HistoryIcon, Loader2Icon, PlusIcon, PrinterIcon, RefreshCwIcon, SearchIcon, Trash2Icon, TruckIcon } from 'lucide-react'
import { type FormEvent, Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { ResultDetail } from '@/components/fretes/resultado'
import { MoneyInput } from '@/components/money-input'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, dayBr, money } from '@/lib/format'
import { fmtNum, formatCep, maskCep, parseBr, type Quote, QUOTE_STATUS, type QuoteResult, RESULT_STATUS, useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

interface VolumeRow {
  quantity: string
  weight: string
  length: string
  width: string
  height: string
}
const emptyVolume = (): VolumeRow => ({ quantity: '1', weight: '', length: '', width: '', height: '' })

export function FretesCotacaoPage() {
  return (
    <RequirePermission module="fretes_cotacao" action="create">
      <NewQuote />
    </RequirePermission>
  )
}

function NewQuote() {
  const active = useActiveUnit()
  const ctx = active.ctx.data
  const { can } = useAuth()
  const qc = useQueryClient()
  const [unitId, setUnitId] = useState('')
  const [originZip, setOriginZip] = useState('')
  const [destZip, setDestZip] = useState('')
  const [dest, setDest] = useState<{ city: string; uf: string }>({ city: '', uf: '' })
  const [personType, setPersonType] = useState<'PF' | 'PJ'>('PJ')
  const [customerName, setCustomerName] = useState('')
  const [customerDoc, setCustomerDoc] = useState('')
  const [cargoValue, setCargoValue] = useState<number | null>(null)
  const [weight, setWeight] = useState('')
  const [volumes, setVolumes] = useState<VolumeRow[]>([emptyVolume()])
  const [goodsType, setGoodsType] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [allowExpired, setAllowExpired] = useState(false)
  const [noInvoice, setNoInvoice] = useState(false)
  const [expiredReason, setExpiredReason] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)

  // Filial de origem = filial ativa (ou a primeira liberada) e o CEP de expedição dela.
  useEffect(() => {
    if (!ctx || unitId) return
    const u = ctx.units.find((x) => x.id === active.unitId) ?? ctx.units.find((x) => x.id === ctx.defaultUnitId) ?? ctx.units[0]
    if (u) {
      setUnitId(u.id)
      setOriginZip(u.zip ? maskCep(u.zip) : '')
    }
  }, [ctx, unitId, active.unitId])

  const cep = useMutation({
    mutationFn: (c: string) => api.get<{ city: string | null; uf: string | null; found: boolean; source: string }>(`/fretes/cep/${c}`),
    onSuccess: (r) => setDest({ city: r.city ?? '', uf: r.uf ?? '' }),
  })

  const body = () => {
    const vols = volumes
      .map((v) => ({ quantity: Number(v.quantity) || 0, weight: parseBr(v.weight) ?? 0, length: parseBr(v.length) ?? 0, width: parseBr(v.width) ?? 0, height: parseBr(v.height) ?? 0 }))
      .filter((v) => v.quantity > 0 && (v.weight || v.length || v.width || v.height))
    for (const v of vols) if ([v.weight, v.length, v.width, v.height].some((x) => Number.isNaN(x))) throw new Error('Confira os números dos volumes.')
    const w = parseBr(weight)
    if (Number.isNaN(w)) throw new Error('Peso total inválido.')
    return {
      unitId,
      originZip: originZip || null,
      destZip,
      destCity: dest.city || null,
      destUf: dest.uf || null,
      personType,
      customerName: customerName || null,
      customerDoc: customerDoc || null,
      cargoValue: cargoValue ?? 0,
      weight: w,
      volumes: vols,
      goodsType: goodsType || null,
      reference: reference || null,
      notes: notes || null,
      allowExpired,
      expiredReason: allowExpired ? expiredReason : null,
      noInvoice,
    }
  }

  const calc = useMutation({
    mutationFn: async () => api.post<Quote>('/fretes/cotacoes', body()),
    onSuccess: (q) => {
      setQuote(q)
      qc.invalidateQueries({ queryKey: ['fretes', 'cotacoes'] })
      const ok = q.results.filter((r) => r.status === 'OK').length
      toast.success(ok ? `Cotação nº ${q.code} salva: ${ok} opção(ões) calculada(s).` : `Cotação nº ${q.code} salva, mas nenhuma transportadora atende.`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!cargoValue && cargoValue !== 0) return toast.error('Informe o valor da nota fiscal (mercadoria).')
    calc.mutate()
  }

  const setVol = (i: number, k: keyof VolumeRow, v: string) => setVolumes((prev) => prev.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  if (active.ctx.isLoading) return <TableSkeleton />
  if (active.ctx.error) return <ErrorState error={active.ctx.error} onRetry={() => active.ctx.refetch()} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cotação de frete"
        description="Calcula todas as transportadoras com tabela vigente para a origem e o destino. Toda cotação fica salva com a versão de cada tabela usada."
        actions={
          <>
            <FilialSwitch active={active} />
            <Button variant="outline" asChild>
              <Link to="/fretes/cotacoes">
                <HistoryIcon aria-hidden /> Histórico
              </Link>
            </Button>
          </>
        }
      />
      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do envio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="q-unit">Filial de origem</Label>
                <Select
                  value={unitId}
                  onValueChange={(v) => {
                    setUnitId(v)
                    const u = ctx?.units.find((x) => x.id === v)
                    setOriginZip(u?.zip ? maskCep(u.zip) : '')
                  }}
                >
                  <SelectTrigger id="q-unit" className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {ctx?.units.filter((u) => u.active).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-origin">CEP de origem</Label>
                <Input id="q-origin" inputMode="numeric" value={originZip} onChange={(e) => setOriginZip(maskCep(e.target.value))} placeholder="Da filial" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-dest">CEP de destino *</Label>
                <Input
                  id="q-dest"
                  inputMode="numeric"
                  required
                  value={destZip}
                  onChange={(e) => {
                    const v = maskCep(e.target.value)
                    setDestZip(v)
                    if (v.replace(/\D/g, '').length === 8) cep.mutate(v.replace(/\D/g, ''))
                    else setDest({ city: '', uf: '' })
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-city">Cidade / UF de destino</Label>
                <div className="flex gap-2">
                  <Input id="q-city" value={dest.city} onChange={(e) => setDest((d) => ({ ...d, city: e.target.value }))} placeholder={cep.isPending ? 'Buscando…' : 'Pelo CEP'} />
                  <Input aria-label="UF de destino" className="w-16 uppercase" maxLength={2} value={dest.uf} onChange={(e) => setDest((d) => ({ ...d, uf: e.target.value.toUpperCase() }))} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Destinatário</Label>
                <ToggleGroup type="single" variant="outline" value={personType} onValueChange={(v) => v && setPersonType(v as 'PF' | 'PJ')} className="w-full">
                  <ToggleGroupItem value="PJ" className="flex-1">
                    Jurídica
                  </ToggleGroupItem>
                  <ToggleGroupItem value="PF" className="flex-1">
                    Física
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-name">Nome do destinatário</Label>
                <Input id="q-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={160} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-doc" title="Algumas transportadoras cobram TDA/TDE de clientes específicos: com o documento, o sistema confere a lista.">CPF/CNPJ (confere TDA/TDE)</Label>
                <Input id="q-doc" inputMode="numeric" value={customerDoc} onChange={(e) => setCustomerDoc(e.target.value.replace(/[^\d./-]/g, '').slice(0, 18))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-ref">Pedido ou NF de referência</Label>
                <Input id="q-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="q-value">{noInvoice ? 'Valor declarado *' : 'Valor da NF (mercadoria) *'}</Label>
                <MoneyInput id="q-value" value={cargoValue} onChange={setCargoValue} />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={noInvoice} onCheckedChange={(c) => setNoInvoice(c === true)} /> Sem nota fiscal (SVD, com declaração de conteúdo)
                </label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-weight">Peso total (kg)</Label>
                <Input id="q-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ou pelos volumes" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-goods">Tipo de mercadoria</Label>
                <Select value={goodsType || '__none__'} onValueChange={(v) => setGoodsType(v === '__none__' ? '' : v)}>
                  <SelectTrigger id="q-goods" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Qualquer</SelectItem>
                    {ctx?.catalog.goodsTypes.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Volumes (medidas em cm, peso em kg por unidade)</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setVolumes((v) => [...v, emptyVolume()])} disabled={volumes.length >= 50}>
                  <PlusIcon aria-hidden /> Volume
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Qtd.</TableHead>
                      <TableHead>Peso (kg/un)</TableHead>
                      <TableHead>Comprimento</TableHead>
                      <TableHead>Largura</TableHead>
                      <TableHead>Altura</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volumes.map((v, i) => (
                      <TableRow key={i}>
                        {(['quantity', 'weight', 'length', 'width', 'height'] as const).map((k) => (
                          <TableCell key={k} className="py-1">
                            <Input aria-label={`${k} do volume ${i + 1}`} inputMode="decimal" className="h-8" value={v[k]} onChange={(e) => setVol(i, k, e.target.value)} />
                          </TableCell>
                        ))}
                        <TableCell className="py-1">
                          <Button type="button" size="icon" variant="ghost" aria-label={`Remover volume ${i + 1}`} disabled={volumes.length === 1} onClick={() => setVolumes((prev) => prev.filter((_, j) => j !== i))}>
                            <Trash2Icon aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="q-notes">Observações</Label>
              <Textarea id="q-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>

            {can('fretes_tabelas', 'edit') && (
              <div className="rounded-md border border-dashed p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={allowExpired} onCheckedChange={(c) => setAllowExpired(c === true)} /> Liberar tabelas vencidas nesta cotação (fica registrado na auditoria)
                </label>
                {allowExpired && <Textarea className="mt-2" rows={2} placeholder="Justificativa (obrigatória): ex.: transportadora confirmou por e-mail que mantém os preços até a nova tabela." value={expiredReason} onChange={(e) => setExpiredReason(e.target.value)} />}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {quote && (
                <Button type="button" variant="outline" onClick={() => calc.mutate()} disabled={calc.isPending}>
                  <RefreshCwIcon aria-hidden /> Recalcular
                </Button>
              )}
              <Button type="submit" disabled={calc.isPending || !unitId}>
                {calc.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CalculatorIcon aria-hidden />} Calcular fretes
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
      {quote && <QuoteView quote={quote} onChange={setQuote} />}
    </div>
  )
}

function exportCsv(q: Quote) {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
  const esc = (s: string | null | undefined) => (s ? (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s) : '')
  const lines = [['Transportadora', 'Tabela', 'Versão', 'Situação', 'Total', 'Frete peso', 'Demais componentes', 'ICMS', 'Prazo (dias úteis)', 'Entrega prevista', 'Peso taxado', 'Validade da tabela', 'Motivo'].join(';')]
  for (const r of q.results) {
    const fp = r.components.find((c) => c.code === 'FRETE_PESO')?.value ?? null
    const others = r.components.filter((c) => c.code !== 'FRETE_PESO').reduce((s, c) => s + c.value, 0)
    lines.push([esc(r.carrierName), esc(r.tableName), r.versionNumber ?? '', RESULT_STATUS[r.status].label, n(r.total), n(fp), n(r.total === null ? null : Math.round(others * 100) / 100), n(r.icms?.value), r.deadlineDays ?? '', r.deliveryDate ? dayBr(r.deliveryDate) : '', n(r.weights?.taxed), r.validUntil ? dayBr(r.validUntil) : '', esc(r.reason)].join(';'))
  }
  const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: `cotacao-frete-${q.code}.csv` }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Resultado da cotação: comparativo, composição do preço e escolha da transportadora. Usado na tela nova e no histórico. */
export function QuoteView({ quote, onChange }: { quote: Quote; onChange: (q: Quote) => void }) {
  const [sort, setSort] = useState<'preco' | 'prazo'>('preco')
  const [open, setOpen] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<QuoteResult | null>(null)
  const [showAll, setShowAll] = useState(false)
  const ok = quote.results.filter((r) => r.status === 'OK')
  const cheapest = ok.length ? Math.min(...ok.map((r) => r.total!)) : null
  const fastest = ok.filter((r) => r.deadlineDays !== null).length ? Math.min(...ok.filter((r) => r.deadlineDays !== null).map((r) => r.deadlineDays!)) : null
  const rows = useMemo(() => {
    const list = showAll ? quote.results : quote.results.filter((r) => r.status !== 'NAO_APLICAVEL' && r.status !== 'SEM_TABELA')
    return [...list].sort((a, b) => {
      if ((a.status === 'OK') !== (b.status === 'OK')) return a.status === 'OK' ? -1 : 1
      if (sort === 'prazo') return (a.deadlineDays ?? 999) - (b.deadlineDays ?? 999) || (a.total ?? Infinity) - (b.total ?? Infinity)
      return (a.total ?? Infinity) - (b.total ?? Infinity) || (a.deadlineDays ?? 999) - (b.deadlineDays ?? 999)
    })
  }, [quote.results, sort, showAll])
  const hidden = quote.results.length - quote.results.filter((r) => r.status !== 'NAO_APLICAVEL' && r.status !== 'SEM_TABELA').length
  const key = (r: QuoteResult) => r.tableId ?? r.carrierId

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            Cotação nº {quote.code} · {formatCep(quote.originZip)} → {formatCep(quote.destZip)} {quote.destCity ? `(${quote.destCity}/${quote.destUf ?? '—'})` : ''}
          </CardTitle>
          <CardDescription>
            {money(quote.cargoValue)} · peso real {fmtNum(quote.realWeight)} kg · {fmtNum(quote.cubicMeters, 4)} m³ · {quote.personType === 'PF' ? 'pessoa física' : 'pessoa jurídica'} · {dateTime(quote.createdAt)} por {quote.createdByName}
          </CardDescription>
          {quote.expiredAllowedReason && <p className="mt-1 text-xs text-destructive">Tabela vencida liberada: {quote.expiredAllowedReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge variant="outline" className={QUOTE_STATUS[quote.status].className}>
            {QUOTE_STATUS[quote.status].label}
          </Badge>
          <ToggleGroup type="single" variant="outline" size="sm" value={sort} onValueChange={(v) => v && setSort(v as 'preco' | 'prazo')}>
            <ToggleGroupItem value="preco">Menor preço</ToggleGroupItem>
            <ToggleGroupItem value="prazo">Menor prazo</ToggleGroupItem>
          </ToggleGroup>
          <Can module="fretes_cotacao" action="export">
            <Button size="sm" variant="outline" onClick={() => exportCsv(quote)}>
              <DownloadIcon aria-hidden /> Exportar
            </Button>
          </Can>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/fretes/cotacoes/${quote.id}?imprimir=1`}>
              <PrinterIcon aria-hidden /> Comprovante
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!ok.length && <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">Nenhuma transportadora calculou para este destino. Veja os motivos abaixo (sem cobertura, restrição, tabela vencida ou sem tabela).</p>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Transportadora</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden text-right md:table-cell">Frete peso</TableHead>
                <TableHead className="hidden text-right md:table-cell">Taxas</TableHead>
                <TableHead className="hidden text-right lg:table-cell">ICMS</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="hidden lg:table-cell">Peso taxado</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="print:hidden" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOpen = open === key(r)
                const fp = r.components.find((c) => c.code === 'FRETE_PESO')?.value ?? null
                const taxes = r.components.filter((c) => c.code !== 'FRETE_PESO' && !c.skipped).reduce((s, c) => s + c.value, 0)
                const selected = quote.selectedTableId && quote.selectedTableId === r.tableId
                return (
                  <Fragment key={key(r)}>
                    <TableRow className={cn(selected && 'bg-[#006300]/5')}>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="size-7" aria-label={isOpen ? 'Fechar detalhes' : 'Ver composição'} onClick={() => setOpen(isOpen ? null : key(r))} disabled={!r.components.length && !r.reason}>
                          {isOpen ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">
                          {r.quoteName} {selected && <CheckCircle2Icon className="inline size-4 text-[#006300]" aria-label="Escolhida" />}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.tableName ?? '—'}
                          {r.versionNumber ? ` · v${r.versionNumber}` : ''}
                          {r.validUntil ? ` · vale até ${dayBr(r.validUntil)}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(r.total)}
                        {r.total !== null && r.total === cheapest && <span className="block text-[11px] font-normal text-[#006300] dark:text-[#0ca30c]">menor preço</span>}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{money(fp)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{r.total === null ? '—' : money(taxes)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.icms ? money(r.icms.value) : '—'}</TableCell>
                      <TableCell>
                        {r.deadlineDays === null ? '—' : `${r.deadlineDays} dia(s) úteis`}
                        {r.deliveryDate && <span className="block text-xs text-muted-foreground">{dayBr(r.deliveryDate)}</span>}
                        {r.deadlineDays !== null && r.deadlineDays === fastest && r.status === 'OK' && <span className="block text-[11px] text-sky-700 dark:text-sky-300">menor prazo</span>}
                      </TableCell>
                      <TableCell className="hidden tabular-nums lg:table-cell">{r.weights ? `${fmtNum(r.weights.taxed)} kg` : '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={RESULT_STATUS[r.status].className}>
                          {RESULT_STATUS[r.status].label}
                        </Badge>
                        {r.warnings.length > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{r.warnings.length} aviso(s)</span>}
                      </TableCell>
                      <TableCell className="text-right print:hidden">
                        {r.status === 'OK' && quote.status !== 'CANCELADA' && !selected && (
                          <Can module="fretes_cotacao" action="edit">
                            <Button size="sm" variant="outline" onClick={() => setChoosing(r)}>
                              <TruckIcon aria-hidden /> Escolher
                            </Button>
                          </Can>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={9} className="whitespace-normal">
                          <ResultDetail r={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {hidden > 0 && (
          <button type="button" className="mt-2 text-sm text-muted-foreground underline underline-offset-2 print:hidden" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Esconder' : 'Mostrar'} {hidden} tabela(s) que não se aplicam ou transportadoras sem tabela
          </button>
        )}
        {quote.selectionNote && <p className="mt-3 text-sm">Motivo da escolha: {quote.selectionNote}</p>}
      </CardContent>
      {choosing && <ChooseDialog quote={quote} r={choosing} cheapest={cheapest} onClose={() => setChoosing(null)} onDone={onChange} />}
    </Card>
  )
}

function ChooseDialog({ quote, r, cheapest, onClose, onDone }: { quote: Quote; r: QuoteResult; cheapest: number | null; onClose: () => void; onDone: (q: Quote) => void }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const notCheapest = cheapest !== null && r.total !== null && r.total > cheapest + 0.004
  const m = useMutation({
    mutationFn: () => api.post<Quote>(`/fretes/cotacoes/${quote.id}/escolher`, { tableId: r.tableId, note: note || null }),
    onSuccess: (q) => {
      toast.success(`${r.carrierName} escolhida para a cotação nº ${q.code}.`)
      qc.invalidateQueries({ queryKey: ['fretes'] })
      onDone(q)
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Escolher {r.quoteName}</DialogTitle>
          <DialogDescription>
            {money(r.total)} · {r.deadlineDays === null ? 'prazo não informado' : `${r.deadlineDays} dia(s) úteis`}
            {notCheapest && ` · ${money(r.total! - cheapest!)} acima da opção mais barata`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ch-note">{notCheapest ? 'Motivo da escolha (obrigatório)' : 'Observação (opcional)'}</Label>
          <Textarea id="ch-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: prazo menor pedido pelo cliente; transportadora com melhor histórico neste destino." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || (notCheapest && note.trim().length < 5)}>
            {m.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Confirmar escolha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────── Histórico ───────────

interface QuoteRow extends Omit<Quote, 'results'> {
  options: number
  selectedCarrierName: string | null
}

export function FretesCotacoesPage() {
  return (
    <RequirePermission module="fretes_cotacao">
      <QuoteList />
    </RequirePermission>
  )
}

function QuoteList() {
  const active = useActiveUnit()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('__all__')
  const [carrier, setCarrier] = useState('__all__')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ pagina: String(page) })
  if (q) params.set('busca', q)
  if (status !== '__all__') params.set('situacao', status)
  if (carrier !== '__all__') params.set('transportadora', carrier)
  if (active.unitId) params.set('filial', active.unitId)
  const list = useQuery({
    queryKey: ['fretes', 'cotacoes', params.toString()],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; items: QuoteRow[] }>(`/fretes/cotacoes?${params}`),
    placeholderData: keepPreviousData,
    enabled: !!active.ctx.data,
  })
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  return (
    <div className="space-y-4">
      <PageHeader
        title="Histórico de cotações"
        description="Cada cotação guarda as entradas, todas as opções calculadas e a versão de tabela usada."
        actions={
          <>
            <FilialSwitch active={active} />
            <Can module="fretes_cotacao" action="create">
              <Button asChild>
                <Link to="/fretes/cotacao">
                  <CalculatorIcon aria-hidden /> Nova cotação
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(search.trim())
          setPage(1)
        }}
      >
        <div className="relative min-w-60 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Nº, pedido, cliente, cidade ou CEP" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-52" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as situações</SelectItem>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={carrier} onValueChange={(v) => (setCarrier(v), setPage(1))}>
          <SelectTrigger className="w-52" aria-label="Transportadora escolhida">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Qualquer transportadora</SelectItem>
            {active.ctx.data?.carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={CalculatorIcon} title="Nenhuma cotação" description="As cotações calculadas aparecem aqui." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="hidden md:table-cell">Filial</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead className="hidden lg:table-cell">Referência / cliente</TableHead>
                <TableHead className="text-right">Menor valor</TableHead>
                <TableHead>Escolha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/fretes/cotacoes/${r.id}`)}>
                  <TableCell className="font-medium">
                    <Link to={`/fretes/cotacoes/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{dateTime(r.createdAt)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.unitName}</TableCell>
                  <TableCell className="text-sm">
                    {r.destCity ?? formatCep(r.destZip)}
                    {r.destUf ? `/${r.destUf}` : ''}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{[r.reference, r.customerName].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.bestTotal)}
                    <span className="block text-xs text-muted-foreground">{r.options} opção(ões)</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={QUOTE_STATUS[r.status].className}>
                      {r.status === 'SELECIONADA' ? `${r.selectedCarrierName ?? '—'} · ${money(r.selectedTotal)}` : QUOTE_STATUS[r.status].label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{list.data.total} cotação(ões)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="self-center">
                {page} de {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────── Detalhe ───────────

export function FretesCotacaoDetalhePage() {
  return (
    <RequirePermission module="fretes_cotacao">
      <QuoteDetail />
    </RequirePermission>
  )
}

interface Reproduction {
  code: number
  quoteDate: string
  allSame: boolean
  items: { tableId: string; carrierName: string; versionNumber: number; original: number | null; recalculated: number | null; same: boolean; reason: string | null }[]
}

function QuoteDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const print = new URLSearchParams(window.location.search).has('imprimir')
  const q = useQuery({ queryKey: ['fretes', 'cotacao', id], queryFn: () => api.get<Quote>(`/fretes/cotacoes/${id}`) })
  const [repro, setRepro] = useState<Reproduction | null>(null)
  const reproduce = useMutation({ mutationFn: () => api.get<Reproduction>(`/fretes/cotacoes/${id}/reproduzir`), onSuccess: setRepro, onError: (e) => toast.error(errorMessage(e)) })
  const cancel = useMutation({
    mutationFn: () => api.post<Quote>(`/fretes/cotacoes/${id}/cancelar`),
    onSuccess: (d) => {
      qc.setQueryData(['fretes', 'cotacao', id], d)
      qc.invalidateQueries({ queryKey: ['fretes', 'cotacoes'] })
      toast.success('Cotação cancelada.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  useEffect(() => {
    if (print && q.data) setTimeout(() => window.print(), 300)
  }, [print, q.data])
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Cotação de frete nº ${d.code}`}
        description={`${d.unitName ?? ''} · ${dateTime(d.createdAt)}${d.reference ? ` · Ref.: ${d.reference}` : ''}${d.customerName ? ` · ${d.customerName}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" onClick={() => reproduce.mutate()} disabled={reproduce.isPending}>
              {reproduce.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />} Reproduzir com as versões originais
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon aria-hidden /> Imprimir
            </Button>
            {d.status !== 'CANCELADA' && (
              <Can module="fretes_cotacao" action="edit">
                <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                  Cancelar cotação
                </Button>
              </Can>
            )}
          </div>
        }
      />
      {repro && (
        <Card className={cn(repro.allSame ? 'border-[#006300]/40' : 'border-destructive/50')}>
          <CardContent className="space-y-1 py-4 text-sm">
            <p className="font-medium">{repro.allSame ? 'Reprodução confere: os mesmos valores com as versões de tabela da época.' : 'Atenção: a reprodução deu valores diferentes. Verifique a auditoria das tabelas.'}</p>
            {repro.items.map((i) => (
              <p key={i.tableId}>
                {i.carrierName} (v{i.versionNumber}): original {money(i.original)} · recalculado {money(i.recalculated)} {i.reason ? `· ${i.reason}` : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      <QuoteView quote={d} onChange={(n) => qc.setQueryData(['fretes', 'cotacao', id], n)} />
      {d.volumes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volumes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {d.volumes.map((v, i) => (
              <p key={i}>
                {v.quantity} × {fmtNum(v.weight)} kg · {fmtNum(v.length, 1)} × {fmtNum(v.width, 1)} × {fmtNum(v.height, 1)} cm
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {d.notes && <p className="text-sm">Observações: {d.notes}</p>}
    </div>
  )
}
