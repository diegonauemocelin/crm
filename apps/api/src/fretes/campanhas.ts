// Campanhas de frete: o que cobrar do cliente em vez do valor da tabela, por transportadora e destino (UF/cidade).
// Só regras (sem banco); testes em test/fretes-campanhas.spec.ts.

export const CAMPAIGNS_KEY = 'fretes.campanhas'

/**
 * PERCENT_NF: o cliente paga um % do valor da nota (ex.: 3% da NF).
 * PERCENT_NF_ACIMA: até um valor de frete da tabela (ex.: o mínimo de R$ 150 da transportadora) o cliente paga a tabela;
 *   acima dele, paga só o % da nota (a empresa paga a diferença).
 * REPASSE: o cliente paga o % da nota que a transportadora cobra (repasse do transporte, ex.: para uma cidade); a
 *   empresa não banca nada, então não fica limitado ao valor da tabela.
 * DESCONTO: desconto de um % sobre o valor da tabela.
 * GRATIS: frete grátis para o cliente.
 * ACRESCIMO: reajuste, o cliente paga a tabela + este % (deixa o frete mais caro num período, para todas ou algumas
 *   transportadoras). Só muda o que cobrar do cliente: a conferência do CT-e segue comparando com a tabela.
 */
export type CampaignMode = 'PERCENT_NF' | 'PERCENT_NF_ACIMA' | 'REPASSE' | 'DESCONTO' | 'GRATIS' | 'ACRESCIMO'

export interface FreightCampaign {
  id: string
  name: string
  active: boolean
  mode: CampaignMode
  /** % (sobre a nota ou de desconto); ignorado no frete grátis. */
  value: number
  /** Transportadoras (ids); vazio = todas. */
  carrierIds: string[]
  /** UFs de destino; vazio = todas. */
  ufs: string[]
  /** Cidades de destino ("Cidade/UF"); vazio = todas as cidades das UFs. */
  cities: string[]
  /** Só a partir deste valor de nota (ex.: frete grátis acima de R$ 1.000); null = qualquer valor. */
  minCargoValue: number | null
  /** PERCENT_NF_ACIMA: o valor do frete da tabela a partir do qual vale o % da nota (ex.: R$ 150). */
  tableAbove: number | null
  /** Vigência (AAAA-MM-DD); null = sem limite. */
  startsOn: string | null
  endsOn: string | null
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null)

/** Limpa o que veio da tela (até 100 campanhas). */
export function cleanCampaigns(raw: unknown, newId: () => string): FreightCampaign[] {
  const list = Array.isArray(raw) ? raw : []
  return list.slice(0, 100).flatMap((x): FreightCampaign[] => {
    const o = (x ?? {}) as Record<string, unknown>
    const name = String(o.name ?? '').trim().slice(0, 80)
    const mode = o.mode === 'PERCENT_NF' || o.mode === 'PERCENT_NF_ACIMA' || o.mode === 'REPASSE' || o.mode === 'DESCONTO' || o.mode === 'GRATIS' || o.mode === 'ACRESCIMO' ? o.mode : null
    if (!name || !mode) return []
    const value = mode === 'GRATIS' ? 0 : Math.min(100, Math.max(0, num(o.value) ?? 0))
    const strs = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, max)))].slice(0, 500) : [])
    const min = num(o.minCargoValue)
    const tableAbove = num(o.tableAbove)
    return [
      {
        id: typeof o.id === 'string' && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : newId(),
        name,
        active: o.active !== false,
        mode,
        value,
        carrierIds: strs(o.carrierIds, 36),
        ufs: strs(o.ufs, 10).map((u) => u.toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u)),
        cities: strs(o.cities, 80),
        minCargoValue: min !== null && min > 0 ? Math.round(min * 100) / 100 : null,
        tableAbove: mode === 'PERCENT_NF_ACIMA' && tableAbove !== null && tableAbove > 0 ? Math.round(tableAbove * 100) / 100 : null,
        startsOn: day(o.startsOn),
        endsOn: day(o.endsOn),
      },
    ]
  })
}

export interface CampaignTarget {
  carrierId: string
  destUf: string | null
  destCity: string | null
  cargoValue: number
  /** AAAA-MM-DD (dia da cotação). */
  date: string
}

/** A campanha vale para esta cotação? Cidade: "Cidade/UF" ou só o nome (compara sem acento e sem caixa). */
export function campaignApplies(c: FreightCampaign, t: CampaignTarget): boolean {
  if (!c.active) return false
  if (c.startsOn && t.date < c.startsOn) return false
  if (c.endsOn && t.date > c.endsOn) return false
  if (c.minCargoValue !== null && t.cargoValue < c.minCargoValue) return false
  if (c.carrierIds.length && !c.carrierIds.includes(t.carrierId)) return false
  const uf = (t.destUf ?? '').toUpperCase()
  if (c.ufs.length && !c.ufs.includes(uf)) return false
  if (c.cities.length) {
    const city = fold(t.destCity ?? '')
    const ok = c.cities.some((x) => {
      const [name, cUf] = x.split('/')
      return fold(name ?? '') === city && (!cUf || fold(cUf) === uf)
    })
    if (!ok) return false
  }
  return true
}

/** Quanto cobrar do cliente pela campanha (nunca mais que o valor da tabela, menos no repasse e no acréscimo). */
export function campaignPrice(c: Pick<FreightCampaign, 'mode' | 'value'>, tableTotal: number, cargoValue: number): number {
  if (c.mode === 'ACRESCIMO') return Math.round(Math.max(0, tableTotal * (1 + c.value / 100)) * 100) / 100
  // Repasse: o % que a transportadora cobra, sem limite pela tabela (a empresa não banca a diferença).
  if (c.mode === 'REPASSE') return Math.round(Math.max(0, (cargoValue * c.value) / 100) * 100) / 100
  const v = c.mode === 'GRATIS' ? 0 : c.mode === 'PERCENT_NF' || c.mode === 'PERCENT_NF_ACIMA' ? (cargoValue * c.value) / 100 : tableTotal * (1 - c.value / 100)
  return Math.round(Math.min(tableTotal, Math.max(0, v)) * 100) / 100
}

/** Descrição curta para a tela: "3% da nota", "10% de desconto", "Frete grátis". */
export function campaignLabel(c: Pick<FreightCampaign, 'mode' | 'value'> & { tableAbove?: number | null }) {
  const pct = `${c.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  const above = c.mode === 'PERCENT_NF_ACIMA' && c.tableAbove ? ` (frete acima de ${c.tableAbove.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` : ''
  return (c.mode === 'GRATIS' ? 'Frete grátis' : c.mode === 'ACRESCIMO' ? `acréscimo de ${pct} na tabela` : c.mode === 'REPASSE' ? `${pct} da nota (repasse da transportadora)` : c.mode === 'PERCENT_NF' || c.mode === 'PERCENT_NF_ACIMA' ? `${pct} da nota` : `${pct} de desconto`) + above
}

/**
 * Campanha que vale para a cotação; null se nenhuma. Promoções (desconto, % da nota, grátis, repasse) têm prioridade e
 * vale a melhor para o cliente; sem promoção, vale o maior acréscimo (reajuste) em vigor.
 */
export function bestCampaign(list: FreightCampaign[], t: CampaignTarget, tableTotal: number) {
  const promos = list.filter((c) => c.mode !== 'ACRESCIMO')
  const promo = pickCampaign(promos, t, tableTotal, 'min')
  if (promo) return promo
  return pickCampaign(
    list.filter((c) => c.mode === 'ACRESCIMO'),
    t,
    tableTotal,
    'max',
  )
}

function pickCampaign(list: FreightCampaign[], t: CampaignTarget, tableTotal: number, want: 'min' | 'max') {
  let best: { campaign: FreightCampaign; price: number } | null = null
  for (const c of list) {
    if (!campaignApplies(c, t)) continue
    // Até o valor escolhido, vale a tabela (ex.: até R$ 150 o cliente paga o frete mínimo da transportadora).
    if (c.mode === 'PERCENT_NF_ACIMA' && tableTotal <= (c.tableAbove ?? 0)) continue
    const price = campaignPrice(c, tableTotal, t.cargoValue)
    if (!best || (want === 'min' ? price < best.price : price > best.price)) best = { campaign: c, price }
  }
  // Repasse e acréscimo: a empresa não paga diferença (desconto zero).
  return best && { id: best.campaign.id, name: best.campaign.name, mode: best.campaign.mode, label: campaignLabel(best.campaign), customerPrice: best.price, discount: best.campaign.mode === 'REPASSE' || best.campaign.mode === 'ACRESCIMO' ? 0 : Math.max(0, Math.round((tableTotal - best.price) * 100) / 100) }
}
