import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Opcoes, useAnalisesUrl } from '@/lib/analises'
import { type Comparacao, COMPARACOES, type Dim, DIMS, NOME_DIM, PERIODOS, rotuloChave, VAZIO } from '@/lib/analises-modelo'

const TODOS = '__todos'

/**
 * Filtros da página (ficam no endereço: o link aberto por outra pessoa do CRM mostra a mesma análise, com as
 * permissões dela). Os filtros vindos de cliques nos gráficos (cross-filter) aparecem como etiquetas para tirar.
 */
export function FiltrosAnalises({ opcoes, nomes }: { opcoes: Opcoes | undefined; nomes: Map<string, string> }) {
  const u = useAnalisesUrl()
  const lista = (dim: Dim, label: string, itens: { id: string; nome: string }[]) => {
    const atual = u.filtros[dim]
    const valor = !atual?.length ? TODOS : atual.length === 1 ? atual[0]! : 'varios'
    return (
      <Select value={valor} onValueChange={(x) => u.setFiltro(dim, x === TODOS ? null : x === 'varios' ? atual! : [x])}>
        <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{label}: todos</SelectItem>
          {valor === 'varios' && <SelectItem value="varios">{atual!.length} escolhidos</SelectItem>}
          {valor !== TODOS && valor !== 'varios' && !itens.some((i) => i.id === valor) && <SelectItem value={valor}>{rotuloChave(dim, valor, nomes)}</SelectItem>}
          {itens.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.nome}
            </SelectItem>
          ))}
          <SelectItem value={VAZIO}>{rotuloChave(dim, VAZIO)}</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  const ativos = DIMS.filter((d) => u.filtros[d]?.length)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={u.periodo ?? ''} onValueChange={(x) => x && u.setPeriodo(x)} aria-label="Período" className="flex-wrap">
          {PERIODOS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="px-2.5">
              {p.nome}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 w-36" aria-label="De" value={u.de} max={u.ate} onChange={(e) => e.target.value && e.target.value <= u.ate && u.setDatas(e.target.value, u.ate)} />
          <span className="text-sm text-muted-foreground">até</span>
          <Input type="date" className="h-8 w-36" aria-label="Até" value={u.ate} min={u.de} onChange={(e) => e.target.value && e.target.value >= u.de && u.setDatas(u.de, e.target.value)} />
        </div>
        <Select value={u.comparar} onValueChange={(x) => u.setComparar(x as Comparacao)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Comparar com">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARACOES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                Comparar com: {c.nome.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {opcoes && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {lista('filial', 'Filial', opcoes.filiais)}
          {lista('vendedor', 'Vendedor', opcoes.vendedores)}
          {lista('origem', 'Origem', opcoes.origens)}
          {lista('uf', 'UF', opcoes.ufs.map((x) => ({ id: x, nome: x })))}
        </div>
      )}
      {ativos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros aplicados">
          {ativos.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
              <span className="text-muted-foreground">{NOME_DIM[d]}:</span>
              <span className="max-w-48 truncate font-medium">{u.filtros[d]!.map((x) => rotuloChave(d, x, nomes)).join(', ')}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={`Tirar o filtro ${NOME_DIM[d]}`} onClick={() => u.setFiltro(d, null)}>
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => u.limpar(DIMS)}>
            Limpar filtros
          </Button>
        </div>
      )}
    </div>
  )
}
