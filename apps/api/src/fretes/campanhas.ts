// Campanhas de frete: o que cobrar do cliente em vez do valor da tabela, por transportadora e destino (UF/cidade).
// Só regras (sem banco); testes em test/fretes-campanhas.spec.ts.

export const CAMPAIGNS_KEY = 'fretes.campanhas'

/**
 * PERCENT_NF: o cliente paga um % do valor da nota (ex.: 3% da NF).
 * DESCONTO: desconto de um % sobre o valor da tabela.
 * GRATIS: frete grátis para o cliente.
 */
export type CampaignMode = 'PERCENT_NF' | 'DESCONTO' | 'GRATIS'

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
    const mode = o.mode === 'PERCENT_NF' || o.mode === 'DESCONTO' || o.mode === 'GRATIS' ? o.mode : null
    if (!name || !mode) return []
    const value = mode === 'GRATIS' ? 0 : Math.min(100, Math.max(0, num(o.value) ?? 0))
    const strs = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, max)))].slice(0, 500) : [])
    const min = num(o.minCargoValue)
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

/** Quanto cobrar do cliente pela campanha (nunca mais que o valor da tabela). */
export function campaignPrice(c: FreightCampaign, tableTotal: number, cargoValue: number): number {
  const v = c.mode === 'GRATIS' ? 0 : c.mode === 'PERCENT_NF' ? (cargoValue * c.value) / 100 : tableTotal * (1 - c.value / 100)
  return Math.round(Math.min(tableTotal, Math.max(0, v)) * 100) / 100
}

/** Descrição curta para a tela: "3% da nota", "10% de desconto", "Frete grátis". */
export function campaignLabel(c: Pick<FreightCampaign, 'mode' | 'value'>) {
  const pct = `${c.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  return c.mode === 'GRATIS' ? 'Frete grátis' : c.mode === 'PERCENT_NF' ? `${pct} da nota` : `${pct} de desconto`
}

/** Melhor campanha para o cliente (menor valor cobrado) entre as que valem; null se nenhuma. */
export function bestCampaign(list: FreightCampaign[], t: CampaignTarget, tableTotal: number) {
  let best: { campaign: FreightCampaign; price: number } | null = null
  for (const c of list) {
    if (!campaignApplies(c, t)) continue
    const price = campaignPrice(c, tableTotal, t.cargoValue)
    if (!best || price < best.price) best = { campaign: c, price }
  }
  return best && { id: best.campaign.id, name: best.campaign.name, label: campaignLabel(best.campaign), customerPrice: best.price, discount: Math.round((tableTotal - best.price) * 100) / 100 }
}
