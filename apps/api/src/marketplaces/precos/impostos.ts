/**
 * Impostos aprendidos das NF-e de venda do Mercado Livre (transportador "Mercado Envios"), importadas em Fretes ›
 * Pedidos. Para cada nota: carga efetiva = impostos ÷ valor dos produtos, por item (SKU = cProd e NCM). Na margem vale a
 * taxa do SKU, depois a do NCM, depois a média geral e, por último, a alíquota manual. Funções puras (sem banco).
 *
 * Impostos somados por item: ICMS próprio (vICMS), FCP (vFCP), ICMS-ST e FCP-ST (vICMSST, vFCPST), DIFAL da venda a
 * consumidor de outro estado (vICMSUFDest e vFCPUFDest), IPI (vIPI), PIS (vPIS) e COFINS (vCOFINS). IBS/CBS da reforma
 * (grupo IBSCBS) ficam de fora em 2026: é o ano de teste, compensado com PIS/COFINS. ICMS desonerado e crédito do
 * Simples (vCredICMSSN) também não entram (não são imposto pago na venda).
 */
import { unsafeXml } from '../../fretes/nfe'

const num = (s: string | null) => (s === null || s === '' || !Number.isFinite(Number(s)) ? 0 : Number(s))
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? decode(m[1]!.trim()) : null
}
const block = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? m[1]! : null
}

export interface NfeTaxItem {
  /** cProd da nota, normalizado (o mesmo código do SKU na loja). */
  sku: string
  ncm: string | null
  /** Valor dos produtos do item (vProd − vDesc). */
  value: number
  tax: number
  /** IPI do item (vai por fora: o valor já o inclui). Notas importadas antes da v3.0.18 não têm. */
  ipi?: number
}

export interface NfeTaxNote {
  productsValue: number
  taxValue: number
  items: NfeTaxItem[]
}

/** Código do produto como o CRM compara com o SKU do anúncio: sem espaços nas pontas, maiúsculo. */
export const normSku = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

/** Impostos de cada item (det) da NF-e. Lança erro se não for uma NF-e. */
export function parseNfeTaxes(raw: string): NfeTaxNote {
  const xml = raw.replace(/^﻿/, '')
  if (unsafeXml(xml)) throw new Error('XML com DOCTYPE/entidades não é aceito.')
  const inf = block(xml, 'infNFe')
  if (!inf) throw new Error('O conteúdo não é um XML de NF-e.')
  const items: NfeTaxItem[] = []
  for (const m of inf.matchAll(/<(?:\w+:)?det(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?det>/g)) {
    const det = m[1]!
    const prod = block(det, 'prod') ?? ''
    const imp = block(det, 'imposto') ?? ''
    const sku = normSku(tag(prod, 'cProd'))
    if (!sku) continue
    // Valor que o cliente paga pelo item, como o "Valor líquido" do ERP: produtos − desconto + IPI (o IPI vai por fora).
    const ipi = num(tag(block(imp, 'IPI') ?? '', 'vIPI'))
    const value = num(tag(prod, 'vProd')) - num(tag(prod, 'vDesc')) + ipi
    const icms = block(imp, 'ICMS') ?? ''
    const dest = block(imp, 'ICMSUFDest') ?? ''
    const tax =
      num(tag(icms, 'vICMS')) +
      num(tag(icms, 'vFCP')) +
      num(tag(icms, 'vICMSST')) +
      num(tag(icms, 'vFCPST')) +
      num(tag(dest, 'vICMSUFDest')) +
      num(tag(dest, 'vFCPUFDest')) +
      ipi +
      num(tag(block(imp, 'PIS') ?? '', 'vPIS')) +
      num(tag(block(imp, 'COFINS') ?? '', 'vCOFINS'))
    const ncm = (tag(prod, 'NCM') ?? '').replace(/\D/g, '')
    items.push({ sku: sku.slice(0, 60), ncm: ncm.length === 8 ? ncm : null, value: round(value, 2), tax: round(tax, 2), ipi: round(ipi, 2) })
  }
  return { productsValue: round(items.reduce((s, i) => s + i.value, 0), 2), taxValue: round(items.reduce((s, i) => s + i.tax, 0), 2), items }
}

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()

/**
 * Venda do Mercado Livre: transportador Mercado Envios ou EBAZAR (empresa de logística do Mercado Livre), CNPJ
 * cadastrado como Mercado Envios, ou "MERCADO LIVRE" nas informações complementares da nota (infCpl).
 */
export function isMercadoEnvios(carrierName: string | null | undefined, carrierCnpj: string | null | undefined, knownCnpjs: readonly string[] = [], infCpl?: string | null) {
  if (carrierName && /MERCADO\s*ENVIOS|EBAZAR/.test(plain(carrierName))) return true
  if (infCpl && /MERCADO\s*LIVRE|MERCADOLIVRE/.test(plain(infCpl))) return true
  return !!carrierCnpj && knownCnpjs.includes(carrierCnpj)
}

/** Informações complementares da NF-e (infAdic/infCpl), para achar "Mercado Livre" escrito na nota. */
export function infCplOf(raw: string): string | null {
  const m = /<(?:\w+:)?infCpl>([\s\S]*?)<\/(?:\w+:)?infCpl>/.exec(raw)
  return m ? m[1]!.slice(0, 5000) : null
}

export interface TaxRate {
  /** Carga efetiva (%) sobre o valor dos produtos. */
  pct: number
  /** Notas que entraram no cálculo. */
  notes: number
  /** IPI (%) sobre o valor sem IPI (o "Bruto" do ERP), quando as notas trazem o IPI. */
  ipiPct?: number
}

export interface TaxRates {
  updatedAt: string
  notes: number
  overall: TaxRate | null
  bySku: Record<string, TaxRate>
  byNcm: Record<string, TaxRate>
}

export const EMPTY_TAX_RATES: TaxRates = { updatedAt: '', notes: 0, overall: null, bySku: {}, byNcm: {} }

/** Médias ponderadas pelo valor: por SKU, por NCM e a geral. Itens sem valor não contam. */
export function aggregateTaxRates(notes: { key: string; items: NfeTaxItem[] }[], now = new Date()): TaxRates {
  type Acc = { v: number; t: number; keys: Set<string>; iv: number; ii: number }
  const acc = (map: Map<string, Acc>, k: string, key: string, i: NfeTaxItem) => {
    const a = map.get(k) ?? { v: 0, t: 0, keys: new Set<string>(), iv: 0, ii: 0 }
    a.v += i.value
    a.t += i.tax
    // IPI só das notas que o trazem separado (importadas a partir da v3.0.18).
    if (typeof i.ipi === 'number' && i.value - i.ipi > 0) {
      a.iv += i.value - i.ipi
      a.ii += i.ipi
    }
    a.keys.add(key)
    map.set(k, a)
  }
  const sku = new Map<string, Acc>()
  const ncm = new Map<string, Acc>()
  const all = new Map<string, Acc>()
  for (const n of notes)
    for (const i of n.items ?? []) {
      if (!(i.value > 0) || !(i.tax >= 0)) continue
      acc(sku, normSku(i.sku), n.key, i)
      if (i.ncm) acc(ncm, i.ncm, n.key, i)
      acc(all, '*', n.key, i)
    }
  const rate = (a: Acc): TaxRate => ({ pct: round((a.t / a.v) * 100, 2), notes: a.keys.size, ...(a.iv > 0 ? { ipiPct: round((a.ii / a.iv) * 100, 2) } : {}) })
  const toObj = (m: Map<string, Acc>) => Object.fromEntries([...m].map(([k, a]) => [k, rate(a)]))
  const overall = all.get('*')
  return { updatedAt: now.toISOString(), notes: overall?.keys.size ?? 0, overall: overall ? rate(overall) : null, bySku: toObj(sku), byNcm: toObj(ncm) }
}

export type TaxSource = 'sku' | 'ncm' | 'geral' | 'manual'

/** Carga de imposto do anúncio: SKU → NCM → média geral → alíquota manual. */
export function taxRateFor(sku: string | null, ncm: string | null, rates: TaxRates | null, manualPct: number | null, useNfe = true): { pct: number | null; source: TaxSource | null; label: string; ipiPct?: number } {
  const plural = (n: number) => `${n} nota${n === 1 ? '' : 's'}`
  if (useNfe && rates) {
    const s = sku ? rates.bySku[normSku(sku)] : undefined
    if (s) return { pct: s.pct, source: 'sku', label: `pelas notas do SKU: ${plural(s.notes)}`, ...(s.ipiPct !== undefined ? { ipiPct: s.ipiPct } : {}) }
    const n = ncm ? rates.byNcm[ncm] : undefined
    if (n) return { pct: n.pct, source: 'ncm', label: `pelo NCM ${ncm}: ${plural(n.notes)}`, ...(n.ipiPct !== undefined ? { ipiPct: n.ipiPct } : {}) }
    if (rates.overall) return { pct: rates.overall.pct, source: 'geral', label: `média geral: ${plural(rates.overall.notes)}` }
  }
  if (manualPct !== null) return { pct: manualPct, source: 'manual', label: 'alíquota manual' }
  return { pct: null, source: null, label: 'sem dado' }
}
