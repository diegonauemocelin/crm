import { ArrowDownRightIcon, ArrowUpRightIcon, ChevronDownIcon, ChevronRightIcon, CornerLeftDownIcon, FilterIcon, ListIcon, Loader2Icon, MinusIcon, MinusSquareIcon, PlusSquareIcon, XIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { InlineError } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Consulta, type LinhaConsulta, type MedidaInfo, useConsulta } from '@/lib/analises'
import {
  descer,
  type Dim,
  type Filtros,
  filtrosDoDrill,
  formatar,
  juntarFiltros,
  NOME_DIM,
  nivelDoDrill,
  nivelInicialTempo,
  type PassoDrill,
  podeDescer,
  subir,
  textoVariacao,
} from '@/lib/analises-modelo'
import { CALENDARIO, type Visual } from '@/lib/analises-paginas'
import { cn } from '@/lib/utils'
import { useAnalises } from './contexto'

const CORES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

type V<T extends Visual['tipo']> = Extract<Visual, { tipo: T }>

/** Medidas do quadro que a pessoa pode ver (as de fontes sem permissão somem). */
function useMedidas(ids: string[]): MedidaInfo[] {
  const c = useAnalises()
  return ids.map((id) => c.medida(id)).filter((m): m is MedidaInfo => !!m)
}

/** Aviso quando um filtro da página não vale para a fonte (ex.: motivo da perda nos leads). */
function avisos(d: Consulta | undefined, c: ReturnType<typeof useAnalises>): string | null {
  if (!d?.avisos.naoAplica.length) return null
  return d.avisos.naoAplica
    .map((a) => `${c.modelo.fontes.find((f) => f.id === a.fonte)?.nome ?? a.fonte}: o filtro ou recorte ${a.dims.map((x) => NOME_DIM[x]).join(', ')} não se aplica`)
    .join(' · ')
}

function Quadro({ titulo, descricao, acoes, children, largura, aviso }: { titulo: string; descricao?: string; acoes?: ReactNode; children: ReactNode; largura?: 1 | 2; aviso?: string | null }) {
  return (
    <Card className={cn('min-w-0 gap-3', largura === 2 && 'lg:col-span-2')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{titulo}</CardTitle>
          {descricao && <CardDescription>{descricao}</CardDescription>}
        </div>
        {acoes}
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {children}
        {aviso && <p className="text-xs text-amber-700 dark:text-amber-400">{aviso}</p>}
      </CardContent>
    </Card>
  )
}

function Carregando({ altura = 'h-48' }: { altura?: string }) {
  return <Skeleton className={cn('w-full', altura)} />
}

/** Caminho do drill-down: volta para qualquer nível clicando nele. */
function Trilha({ topo, drill, onSubir }: { topo: string; drill: PassoDrill[]; onSubir: (i: number) => void }) {
  if (!drill.length) return null
  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="Caminho do detalhamento">
      <button type="button" className="rounded px-1 text-[color:var(--brand)] hover:underline" onClick={() => onSubir(-1)}>
        {topo}
      </button>
      {drill.map((p, i) => (
        <span key={p.dim} className="flex items-center gap-1">
          <ChevronRightIcon className="size-3 text-muted-foreground" />
          {i === drill.length - 1 ? (
            <span className="font-medium">{p.rotulo}</span>
          ) : (
            <button type="button" className="rounded px-1 text-[color:var(--brand)] hover:underline" onClick={() => onSubir(i)}>
              {p.rotulo}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

/** Ações do item clicado: descer um nível, filtrar a página (cross-filter) ou ver os registros. */
function Acoes({ sel, dim, proximo, medida, extra, onDescer, onFechar }: { sel: { chave: string; rotulo: string }; dim: Dim; proximo: Dim | null; medida?: MedidaInfo; extra: Filtros; onDescer: () => void; onFechar: () => void }) {
  const c = useAnalises()
  const ativo = c.filtros[dim]?.length === 1 && c.filtros[dim]![0] === sel.chave
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm" role="group" aria-label={`Ações para ${sel.rotulo}`}>
      <span className="font-medium">{sel.rotulo}</span>
      {proximo && (
        <Button size="sm" variant="outline" onClick={onDescer}>
          <CornerLeftDownIcon /> Ver por {NOME_DIM[proximo].toLowerCase()}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          c.filtrar(dim, sel.chave)
          onFechar()
        }}
      >
        <FilterIcon /> {ativo ? 'Tirar o filtro' : 'Filtrar a página'}
      </Button>
      {medida?.registros && (
        <Button size="sm" variant="outline" onClick={() => c.verRegistros(medida.id, { ...extra, [dim]: [sel.chave] }, `${NOME_DIM[dim]}: ${sel.rotulo}`)}>
          <ListIcon /> Ver registros
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Fechar" onClick={onFechar}>
        <XIcon />
      </Button>
    </div>
  )
}

// ---------- Cartões (KPIs) ----------

function Variacao({ m, comp }: { m: MedidaInfo; comp?: { variacao: number | null; diferenca: number | null } }) {
  const t = textoVariacao(m.formato, comp)
  if (!comp) return null
  if (t.valor === null) return <span className="text-xs text-muted-foreground">{t.texto}</span>
  if (Math.abs(t.valor) < 0.05)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MinusIcon className="size-3" /> igual ao anterior
      </span>
    )
  const sobe = t.valor > 0
  const bom = m.menorMelhor ? !sobe : sobe
  const Icon = sobe ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', bom ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#b42323] dark:text-[#e66767]')}>
      <Icon className="size-3.5" aria-hidden />
      {t.texto}
    </span>
  )
}

const NOME_COMPARACAO = { anterior: 'período anterior', mes_anterior: 'mês anterior', ano_anterior: 'ano anterior' } as const

export function Kpis({ v }: { v: V<'kpis'> }) {
  const c = useAnalises()
  const medidas = useMedidas(v.medidas)
  const q = useConsulta({ de: c.de, ate: c.ate, medidas: medidas.map((m) => m.id), filtros: c.filtros, comparar: c.comparar })
  const linha = q.data?.linhas[0]
  const fora = new Set(q.data?.avisos.naoAplica.map((a) => a.fonte) ?? [])
  if (!medidas.length) return null
  return (
    <div className="space-y-1">
      {q.isError && <InlineError error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {medidas.map((m) => {
          const valor = linha?.valores[m.id]
          const comp = linha?.comparacao?.[m.id]
          const clicavel = m.registros && !fora.has(m.fonte)
          const conteudo = (
            <>
              <p className="text-sm font-medium text-muted-foreground">{m.nome}</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{q.isPending ? <Skeleton className="h-8 w-24" /> : formatar(m.formato, valor)}</p>
              <div className="flex flex-wrap items-center gap-x-2">
                {fora.has(m.fonte) ? (
                  <span className="text-xs text-muted-foreground">o filtro aplicado não vale aqui</span>
                ) : (
                  <>
                    <Variacao m={m} comp={comp} />
                    {comp && comp.anterior !== null && <span className="text-xs text-muted-foreground">antes: {formatar(m.formato, comp.anterior, true)}</span>}
                  </>
                )}
              </div>
            </>
          )
          return clicavel ? (
            <button
              key={m.id}
              type="button"
              title={`${m.descricao} Clique para ver os registros.`}
              onClick={() => c.verRegistros(m.id, {}, '')}
              className="space-y-1 rounded-xl border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:border-[color:var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {conteudo}
            </button>
          ) : (
            <div key={m.id} title={m.descricao} className="space-y-1 rounded-xl border bg-card px-4 py-4 shadow-sm">
              {conteudo}
            </div>
          )
        })}
      </div>
      {q.data?.comparacao && (
        <p className="text-xs text-muted-foreground">
          Comparado com o {NOME_COMPARACAO[q.data.comparacao.tipo]}: {q.data.comparacao.de.split('-').reverse().join('/')} a {q.data.comparacao.ate.split('-').reverse().join('/')}.
        </p>
      )}
    </div>
  )
}

// ---------- Tendência (calendário com drill-down) ----------

export function Tendencia({ v }: { v: V<'tendencia'> }) {
  const c = useAnalises()
  const series = v.series.map((s) => ({ ...s, medidas: s.medidas.filter((id) => c.medida(id)) })).filter((s) => s.medidas.length)
  const [serie, setSerie] = useState(0)
  const [topo, setTopo] = useState<Dim | null>(null)
  const [drill, setDrill] = useState<PassoDrill[]>([])
  const [sel, setSel] = useState<{ chave: string; rotulo: string } | null>(null)
  const inicio = topo ?? nivelInicialTempo(c.de, c.ate)
  const niveis = CALENDARIO.slice(CALENDARIO.indexOf(inicio))
  const nivel = nivelDoDrill(niveis, drill, c.filtros)
  const s = series[Math.min(serie, series.length - 1)]
  const extra = filtrosDoDrill(drill)
  const q = useConsulta({ de: c.de, ate: c.ate, medidas: s?.medidas ?? [], dims: [nivel], filtros: juntarFiltros(c.filtros, extra) }, !!s)
  if (!s) return null
  const medidas = s.medidas.map((id) => c.medida(id)!)
  const dados = (q.data?.linhas ?? []).map((l) => ({ chave: l.chaves[0]!, label: l.rotulos[0]!, ...l.valores }))
  const config: ChartConfig = Object.fromEntries(medidas.map((m, i) => [m.id, { label: m.nome, color: CORES[i % CORES.length] }]))
  const fmt = medidas[0]!.formato
  const proximo = podeDescer(niveis, nivel)
  const mudarTopo = (d: string) => {
    if (!d) return
    setTopo(d as Dim)
    setDrill([])
    setSel(null)
  }
  return (
    <Quadro
      titulo={v.titulo}
      descricao={v.descricao}
      largura={v.largura}
      aviso={avisos(q.data, c)}
      acoes={
        <div className="flex flex-wrap gap-2">
          {series.length > 1 && (
            <ToggleGroup type="single" size="sm" variant="outline" value={String(serie)} onValueChange={(x) => x && (setSerie(Number(x)), setSel(null))} aria-label="Medida do gráfico">
              {series.map((x, i) => (
                <ToggleGroupItem key={x.nome} value={String(i)} className="px-2 text-xs">
                  {x.nome}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <ToggleGroup type="single" size="sm" variant="outline" value={drill.length ? '' : inicio} onValueChange={mudarTopo} aria-label="Agrupar por">
            {CALENDARIO.map((d) => (
              <ToggleGroupItem key={d} value={d} className="px-2 text-xs">
                {NOME_DIM[d]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      }
    >
      <Trilha
        topo={`Por ${NOME_DIM[inicio].toLowerCase()}`}
        drill={drill}
        onSubir={(i) => {
          setDrill(subir(drill, i))
          setSel(null)
        }}
      />
      {q.isError ? (
        <InlineError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Carregando altura="h-64" />
      ) : (
        <ChartContainer config={config} className={cn('aspect-auto h-64 w-full', q.isFetching && 'opacity-60')}>
          <BarChart data={dados} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(x) => formatar(fmt, Number(x), true)} />
            <ChartTooltip content={<ChartTooltipContent formatter={(x, n) => `${config[String(n)]?.label ?? n}: ${formatar(medidas.find((m) => m.id === n)?.formato ?? fmt, Number(x))}`} />} />
            {medidas.map((m) => (
              <Bar
                key={m.id}
                dataKey={m.id}
                fill={`var(--color-${m.id})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                isAnimationActive={false}
                className="cursor-pointer"
                onClick={(_d: unknown, i: number) => {
                  const p = dados[i]
                  if (p) setSel({ chave: p.chave, rotulo: p.label })
                }}
              >
                {dados.map((p) => (
                  <Cell key={p.chave} fillOpacity={sel && sel.chave !== p.chave ? 0.35 : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ChartContainer>
      )}
      {sel && (
        <Acoes
          sel={sel}
          dim={nivel}
          proximo={proximo}
          medida={medidas.find((m) => m.registros)}
          extra={extra}
          onFechar={() => setSel(null)}
          onDescer={() => {
            setDrill(descer(drill, { dim: nivel, ...sel }))
            setSel(null)
          }}
        />
      )}
    </Quadro>
  )
}

// ---------- Barras horizontais (com hierarquia) ----------

export function Barras({ v }: { v: V<'barras'> }) {
  const c = useAnalises()
  const medidas = useMedidas(v.medidas)
  const [drill, setDrill] = useState<PassoDrill[]>([])
  const [sel, setSel] = useState<{ chave: string; rotulo: string } | null>(null)
  const [principal, setPrincipal] = useState(0)
  const nivel = nivelDoDrill(v.hierarquia, drill, c.filtros)
  const extra = filtrosDoDrill(drill)
  const q = useConsulta({ de: c.de, ate: c.ate, medidas: medidas.map((m) => m.id), dims: [nivel], filtros: juntarFiltros(c.filtros, extra), limite: v.limite ?? 15 }, medidas.length > 0)
  if (!medidas.length) return null
  const m = medidas[Math.min(principal, medidas.length - 1)]!
  const linhas = [...(q.data?.linhas ?? [])].sort((a, b) => (b.valores[m.id] ?? -Infinity) - (a.valores[m.id] ?? -Infinity))
  const max = Math.max(0, ...linhas.map((l) => l.valores[m.id] ?? 0))
  const proximo = podeDescer(v.hierarquia, nivel)
  const outras = medidas.filter((x) => x.id !== m.id)
  return (
    <Quadro
      titulo={v.titulo}
      descricao={v.descricao}
      largura={v.largura}
      aviso={avisos(q.data, c)}
      acoes={
        medidas.length > 1 && (
          <ToggleGroup type="single" size="sm" variant="outline" value={String(principal)} onValueChange={(x) => x && setPrincipal(Number(x))} aria-label="Medida das barras">
            {medidas.map((x, i) => (
              <ToggleGroupItem key={x.id} value={String(i)} className="px-2 text-xs">
                {x.nome}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      }
    >
      <Trilha
        topo={`Todas: ${NOME_DIM[v.hierarquia[0]!].toLowerCase()}`}
        drill={drill}
        onSubir={(i) => {
          setDrill(subir(drill, i))
          setSel(null)
        }}
      />
      {q.isError ? (
        <InlineError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Carregando />
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <ul className={cn('space-y-1', q.isFetching && 'opacity-60')}>
          {linhas.map((l) => {
            const val = l.valores[m.id] ?? null
            const ativo = sel?.chave === l.chaves[0]
            return (
              <li key={l.chaves[0]}>
                <button
                  type="button"
                  onClick={() => setSel(ativo ? null : { chave: l.chaves[0]!, rotulo: l.rotulos[0]! })}
                  className={cn('group w-full rounded-md px-2 py-1 text-left hover:bg-muted/60', ativo && 'bg-muted')}
                  aria-pressed={ativo}
                >
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate" title={l.rotulos[0]}>
                      {l.rotulos[0]}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{formatar(m.formato, val)}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${max > 0 && val !== null ? Math.max(1, (val / max) * 100) : 0}%`, background: CORES[0] }} />
                  </div>
                  {outras.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {outras.map((o) => `${o.nome}: ${formatar(o.formato, l.valores[o.id])}`).join(' · ')}
                    </p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {q.data?.temMais && <p className="text-xs text-muted-foreground">Mostrando os {v.limite ?? 15} maiores.</p>}
      {sel && (
        <Acoes
          sel={sel}
          dim={nivel}
          proximo={proximo}
          medida={m.registros ? m : medidas.find((x) => x.registros)}
          extra={extra}
          onFechar={() => setSel(null)}
          onDescer={() => {
            setDrill(descer(drill, { dim: nivel, ...sel }))
            setSel(null)
          }}
        />
      )}
    </Quadro>
  )
}

// ---------- Funil ----------

export function Funil({ v }: { v: V<'funil'> }) {
  const c = useAnalises()
  const passos = useMedidas(v.passos)
  const q = useConsulta({ de: c.de, ate: c.ate, medidas: passos.map((m) => m.id), filtros: c.filtros }, passos.length > 0)
  if (!passos.length) return null
  const val = q.data?.linhas[0]?.valores ?? {}
  const primeiro = val[passos[0]!.id] ?? 0
  return (
    <Quadro titulo={v.titulo} descricao={v.descricao} largura={v.largura} aviso={avisos(q.data, c)}>
      {q.isError ? (
        <InlineError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Carregando />
      ) : (
        <ol className="space-y-2">
          {passos.map((m, i) => {
            const x = val[m.id] ?? null
            const antes = i > 0 ? (val[passos[i - 1]!.id] ?? null) : null
            const largura = primeiro > 0 && x !== null ? Math.max(4, (x / primeiro) * 100) : x === null ? 0 : 100
            return (
              <li key={m.id}>
                <button type="button" disabled={!m.registros || x === null} onClick={() => c.verRegistros(m.id, {}, v.titulo)} className="w-full text-left disabled:cursor-default" title={m.descricao}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{m.nome}</span>
                    <span className="font-semibold tabular-nums">{formatar(m.formato, x)}</span>
                  </div>
                  <div className="mt-1 h-6 w-full rounded bg-muted/50">
                    <div className="mx-auto h-full rounded" style={{ width: `${largura}%`, background: CORES[i % CORES.length] }} />
                  </div>
                  {antes !== null && x !== null && antes > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{formatar('pct', x / antes)} da etapa anterior</p>}
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {passos.length < v.passos.length && <p className="text-xs text-muted-foreground">Algumas etapas não aparecem: seu perfil não tem acesso à fonte delas.</p>}
    </Quadro>
  )
}

// ---------- Matriz com linhas que abrem (+) ----------

function CelulasMatriz({ l, medidas, extra, contexto }: { l: LinhaConsulta; medidas: MedidaInfo[]; extra: Filtros; contexto: string }) {
  const c = useAnalises()
  return (
    <>
      {medidas.map((m) => (
        <TableCell key={m.id} className="text-right tabular-nums">
          {m.registros && l.valores[m.id] ? (
            <button type="button" className="rounded px-1 hover:bg-muted hover:underline" onClick={() => c.verRegistros(m.id, extra, contexto)} title="Ver os registros">
              {formatar(m.formato, l.valores[m.id])}
            </button>
          ) : (
            formatar(m.formato, l.valores[m.id])
          )}
        </TableCell>
      ))}
    </>
  )
}

function LinhasMatriz({ niveis, nivel, pais, medidas, profundidade }: { niveis: readonly Dim[]; nivel: number; pais: Filtros; medidas: MedidaInfo[]; profundidade: number }) {
  const c = useAnalises()
  const dim = niveis[nivel]!
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const q = useConsulta({ de: c.de, ate: c.ate, medidas: medidas.map((m) => m.id), dims: [dim], filtros: juntarFiltros(c.filtros, pais), limite: 200 })
  const temFilho = nivel < niveis.length - 1
  if (q.isError)
    return (
      <TableRow>
        <TableCell colSpan={medidas.length + 1}>
          <InlineError error={q.error} onRetry={() => void q.refetch()} />
        </TableCell>
      </TableRow>
    )
  if (!q.data)
    return (
      <TableRow>
        <TableCell colSpan={medidas.length + 1} className="text-muted-foreground" style={{ paddingLeft: `${profundidade * 20 + 24}px` }}>
          <Loader2Icon className="inline size-4 animate-spin" /> Carregando…
        </TableCell>
      </TableRow>
    )
  if (!q.data.linhas.length)
    return (
      <TableRow>
        <TableCell colSpan={medidas.length + 1} className="text-muted-foreground" style={{ paddingLeft: `${profundidade * 20 + 24}px` }}>
          Sem dados.
        </TableCell>
      </TableRow>
    )
  return (
    <>
      {q.data.linhas.map((l) => {
        const chave = l.chaves[0]!
        const aberto = abertos.has(chave)
        const filtrosLinha = { ...pais, [dim]: [chave] }
        return (
          <LinhaMatriz key={chave} l={l} dim={dim} profundidade={profundidade} aberto={aberto} temFilho={temFilho} medidas={medidas} filtrosLinha={filtrosLinha} onAbrir={() => setAbertos((s) => {
            const n = new Set(s)
            if (n.has(chave)) n.delete(chave)
            else n.add(chave)
            return n
          })}>
            {aberto && temFilho && <LinhasMatriz niveis={niveis} nivel={nivel + 1} pais={filtrosLinha} medidas={medidas} profundidade={profundidade + 1} />}
          </LinhaMatriz>
        )
      })}
    </>
  )
}

function LinhaMatriz({ l, dim, profundidade, aberto, temFilho, medidas, filtrosLinha, onAbrir, children }: { l: LinhaConsulta; dim: Dim; profundidade: number; aberto: boolean; temFilho: boolean; medidas: MedidaInfo[]; filtrosLinha: Filtros; onAbrir: () => void; children: ReactNode }) {
  const c = useAnalises()
  const Icon = aberto ? MinusSquareIcon : PlusSquareIcon
  return (
    <>
      <TableRow className={cn(profundidade > 0 && 'bg-muted/20')}>
        <TableCell className="max-w-64" style={{ paddingLeft: `${profundidade * 20 + 8}px` }}>
          <div className="flex items-center gap-1">
            {temFilho ? (
              <button type="button" onClick={onAbrir} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-expanded={aberto} aria-label={aberto ? `Fechar ${l.rotulos[0]}` : `Abrir ${l.rotulos[0]}`}>
                <Icon className="size-4" />
              </button>
            ) : (
              <span className="inline-block w-5" />
            )}
            <span className="truncate font-medium" title={l.rotulos[0]}>
              {l.rotulos[0]}
            </span>
            <button type="button" onClick={() => c.filtrar(dim, l.chaves[0]!)} className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100" title={`Filtrar a página por ${l.rotulos[0]}`} aria-label={`Filtrar a página por ${l.rotulos[0]}`}>
              <FilterIcon className="size-3.5" />
            </button>
          </div>
        </TableCell>
        <CelulasMatriz l={l} medidas={medidas} extra={filtrosLinha} contexto={`${NOME_DIM[dim]}: ${l.rotulos[0]}`} />
      </TableRow>
      {children}
    </>
  )
}

export function Matriz({ v }: { v: V<'matriz'> }) {
  const c = useAnalises()
  const medidas = useMedidas(v.medidas)
  // Níveis já filtrados na página com um valor só ficam de fora (a matriz começa no de baixo).
  const inicio = v.hierarquia.indexOf(nivelDoDrill(v.hierarquia, [], c.filtros))
  const niveis = v.hierarquia.slice(inicio)
  const total = useConsulta({ de: c.de, ate: c.ate, medidas: medidas.map((m) => m.id), filtros: c.filtros }, medidas.length > 0)
  if (!medidas.length) return null
  return (
    <Quadro titulo={v.titulo} descricao={v.descricao} largura={v.largura} aviso={avisos(total.data, c)}>
      <div className="-mx-6 overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{niveis.map((d) => NOME_DIM[d]).join(' › ')}</TableHead>
              {medidas.map((m) => (
                <TableHead key={m.id} className="text-right" title={m.descricao}>
                  {m.nome}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <LinhasMatriz niveis={niveis} nivel={0} pais={{}} medidas={medidas} profundidade={0} />
            {total.data?.linhas[0] && (
              <TableRow className="border-t-2 font-semibold">
                <TableCell className="pl-6">
                  <span className="inline-flex items-center gap-1">
                    <ChevronDownIcon className="size-4 opacity-0" /> Total
                  </span>
                </TableCell>
                <CelulasMatriz l={total.data.linhas[0]} medidas={medidas} extra={{}} contexto="Total" />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Quadro>
  )
}

export function VisualAnalise({ v }: { v: Visual }) {
  if (v.tipo === 'kpis') return <Kpis v={v} />
  if (v.tipo === 'tendencia') return <Tendencia v={v} />
  if (v.tipo === 'barras') return <Barras v={v} />
  if (v.tipo === 'funil') return <Funil v={v} />
  return <Matriz v={v} />
}
