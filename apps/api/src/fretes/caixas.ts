/**
 * Caixas de embalagem da empresa e a sugestão de caixa para a cotação (funções puras, testadas em
 * test/fretes-caixas.spec.ts). Com vários produtos, o sistema sugere a menor caixa cadastrada em que tudo cabe, para a
 * cotação usar a medida real do volume (as transportadoras cobram pelo peso cubado).
 *
 * A conta é uma estimativa: cada produto precisa caber na caixa em alguma posição e a soma dos volumes dos produtos não
 * pode passar do aproveitamento da caixa (padrão 80%, sobra para o encaixe e o calço). Quem embala confere.
 */

export const BOXES_KEY = 'fretes_caixas'
export const BOXES_MAX = 50
/** Quanto do volume interno da caixa dá para ocupar de fato (encaixe e proteção). */
export const DEFAULT_FILL = 0.8

export interface FreightBox {
  id: string
  name: string
  /** Medidas internas (cm). */
  length: number
  width: number
  height: number
  /** Peso da caixa vazia (kg), somado ao dos produtos. */
  tare: number
  /** Peso máximo que a caixa aguenta (kg); null = sem limite. */
  maxWeight: number | null
  active: boolean
}

export interface PackItem {
  quantity: number
  /** Peso por unidade (kg) e medidas (cm). */
  weight: number
  length: number
  width: number
  height: number
}

const num = (v: unknown, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 1000) / 1000 : null
}

/** Lê e limpa a lista vinda da tela: nome e as três medidas obrigatórios. */
export function cleanBoxes(input: unknown, newId: () => string): FreightBox[] {
  if (!Array.isArray(input)) return []
  const out: FreightBox[] = []
  for (const raw of input.slice(0, BOXES_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : ''
    const length = num(r.length, 500)
    const width = num(r.width, 500)
    const height = num(r.height, 500)
    if (!name || !length || !width || !height) continue
    out.push({
      id: typeof r.id === 'string' && /^[\w-]{6,60}$/.test(r.id) ? r.id : newId(),
      name,
      length,
      width,
      height,
      tare: num(r.tare, 100) ?? 0,
      maxWeight: num(r.maxWeight, 10_000),
      active: r.active !== false,
    })
  }
  return out
}

const sorted = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => y - x) as [number, number, number]

/** O item cabe na caixa em alguma posição (maior com maior, do meio com do meio, menor com menor). */
export function fitsIn(item: { length: number; width: number; height: number }, box: { length: number; width: number; height: number }) {
  const i = sorted(item.length, item.width, item.height)
  const b = sorted(box.length, box.width, box.height)
  return i[0] <= b[0] && i[1] <= b[1] && i[2] <= b[2]
}

const volume = (x: { length: number; width: number; height: number }) => x.length * x.width * x.height

/**
 * Menor caixa (pelo volume) em que todos os itens cabem: cada um cabe numa posição, a soma dos volumes cabe no
 * aproveitamento e o peso não passa do máximo. Sem caixa única, sugere várias da maior que caiba cada item.
 */
export function suggestBox(items: PackItem[], boxes: FreightBox[], fill = DEFAULT_FILL) {
  const list = items.filter((i) => i.quantity > 0 && i.length > 0 && i.width > 0 && i.height > 0)
  if (!list.length) return { status: 'SEM_MEDIDAS' as const, reason: 'Os produtos precisam de comprimento, largura e altura para sugerir a caixa.' }
  const active = boxes.filter((b) => b.active).sort((a, b) => volume(a) - volume(b))
  if (!active.length) return { status: 'SEM_CAIXAS' as const, reason: 'Nenhuma caixa cadastrada. Cadastre as caixas em "Caixas".' }
  const itemsVolume = list.reduce((s, i) => s + volume(i) * i.quantity, 0)
  const itemsWeight = list.reduce((s, i) => s + i.weight * i.quantity, 0)
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  for (const b of active) {
    if (!list.every((i) => fitsIn(i, b))) continue
    if (itemsVolume > volume(b) * fill) continue
    const weight = itemsWeight + b.tare
    if (b.maxWeight !== null && weight > b.maxWeight) continue
    return { status: 'OK' as const, box: b, count: 1, weight: r3(weight), occupancy: Math.round((itemsVolume / volume(b)) * 100) }
  }
  // Não coube numa só: várias da maior caixa onde cabe cada item (pelo volume e pelo peso, o que exigir mais).
  const big = [...active].reverse().find((b) => list.every((i) => fitsIn(i, b)))
  if (!big) return { status: 'NAO_CABE' as const, reason: 'Algum produto é maior que todas as caixas cadastradas: digite a medida do volume.' }
  const byVolume = Math.ceil(itemsVolume / (volume(big) * fill))
  const byWeight = big.maxWeight !== null && big.maxWeight > big.tare ? Math.ceil(itemsWeight / (big.maxWeight - big.tare)) : 1
  const count = Math.max(1, byVolume, byWeight)
  return { status: 'VARIAS' as const, box: big, count, weight: r3(itemsWeight / count + big.tare), occupancy: Math.round((itemsVolume / (volume(big) * count)) * 100) }
}
