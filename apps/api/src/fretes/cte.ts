// Leitura do XML do CT-e (modelo 57): dados da prestação, componentes e ICMS. Serve para aprender a alíquota interna de
// cada UF e, na fase de conciliação, para comparar com a cotação. Não valida assinatura nem situação na SEFAZ: um XML
// lido aqui não é tratado como documento fiscal válido. Sem banco e sem rede (test/fretes-cte.spec.ts).

export interface CteData {
  key: string | null
  number: string | null
  series: string | null
  issuedAt: string | null
  emitCnpj: string | null
  ufIni: string | null
  ufFim: string | null
  cityIni: string | null
  cityFim: string | null
  cfop: string | null
  emitName: string | null
  senderDoc: string | null
  recipientDoc: string | null
  recipientName: string | null
  /** Documento de quem paga o frete (tomador). */
  tomadorDoc: string | null
  destZip: string | null
  cargoValue: number | null
  /** Peso para o frete: peso base de cálculo, senão aferido, senão bruto (kg). */
  weight: number | null
  nfeKeys: string[]
  protocol: string | null
  protocolStatus: string | null
  total: number | null
  components: { name: string; value: number }[]
  icms: { cst: string | null; rate: number | null; base: number | null; value: number | null; baseReduction: number | null; group: string | null }
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? m[1]!.trim() : null
}
const block = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? m[1]! : null
}
const num = (s: string | null) => (s === null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s))

/** Lê o XML do CT-e (ou do cteProc). Lança erro se não parecer um CT-e. */
export function parseCteXml(raw: string): CteData {
  const xml = raw.replace(/^﻿/, '')
  const inf = block(xml, 'infCte')
  if (!inf || !block(inf, 'ide')) throw new Error('O arquivo não é um XML de CT-e.')
  const ide = block(inf, 'ide')!
  const id = /<(?:\w+:)?infCte[^>]*\bId="CTe(\d{44})"/.exec(xml)?.[1] ?? tag(xml, 'chCTe')
  const emit = block(inf, 'emit') ?? ''
  const vPrest = block(inf, 'vPrest') ?? ''
  const components = [...vPrest.matchAll(/<(?:\w+:)?Comp>([\s\S]*?)<\/(?:\w+:)?Comp>/g)].map((m) => ({ name: tag(m[1]!, 'xNome') ?? '', value: num(tag(m[1]!, 'vComp')) ?? 0 }))
  const doc = (b: string | null) => (b ? (tag(b, 'CNPJ') ?? tag(b, 'CPF')) : null)
  const rem = block(inf, 'rem')
  const dest = block(inf, 'dest')
  const parties: Record<string, string | null> = { '0': doc(rem), '1': doc(block(inf, 'exped')), '2': doc(block(inf, 'receb')), '3': doc(dest) }
  const toma3 = block(ide, 'toma3') ?? block(ide, 'toma03')
  const toma4 = block(ide, 'toma4') ?? block(ide, 'toma04')
  const tomaCode = toma3 ? tag(toma3, 'toma') : null
  const tomadorDoc = toma4 ? doc(toma4) : tomaCode !== null ? (parties[tomaCode] ?? null) : null
  const infCarga = block(inf, 'infCarga') ?? ''
  const quants = [...infCarga.matchAll(/<(?:\w+:)?infQ>([\s\S]*?)<\/(?:\w+:)?infQ>/g)].map((m) => ({ unit: tag(m[1]!, 'cUnid'), kind: (tag(m[1]!, 'tpMed') ?? '').toUpperCase(), q: num(tag(m[1]!, 'qCarga')) }))
  const kg = quants.filter((q) => q.unit === '01' && q.q !== null && q.q > 0)
  const pick = (re: RegExp) => kg.find((q) => re.test(q.kind))?.q ?? null
  const weight = pick(/BASE|CALC/) ?? pick(/AFERIDO/) ?? pick(/BRUTO/) ?? kg[0]?.q ?? null
  const nfeKeys = [...inf.matchAll(/<(?:\w+:)?chave>(\d{44})<\/(?:\w+:)?chave>/g)].map((m) => m[1]!)
  const prot = block(xml, 'infProt')
  const imp = block(inf, 'imp') ?? ''
  const icmsBlock = block(imp, 'ICMS') ?? ''
  const group = /<(?:\w+:)?(ICMS\w+)>/.exec(icmsBlock)?.[1] ?? null
  return {
    key: id,
    number: tag(ide, 'nCT'),
    series: tag(ide, 'serie'),
    issuedAt: tag(ide, 'dhEmi'),
    emitCnpj: tag(emit, 'CNPJ'),
    ufIni: tag(ide, 'UFIni'),
    ufFim: tag(ide, 'UFFim'),
    cityIni: tag(ide, 'xMunIni'),
    cityFim: tag(ide, 'xMunFim'),
    cfop: tag(ide, 'CFOP'),
    emitName: tag(emit, 'xNome'),
    senderDoc: parties['0'] ?? null,
    recipientDoc: parties['3'] ?? null,
    recipientName: dest ? tag(dest, 'xNome') : null,
    tomadorDoc,
    destZip: dest ? (tag(block(dest, 'enderDest') ?? '', 'CEP') ?? null) : null,
    cargoValue: num(tag(infCarga, 'vCarga')),
    weight,
    nfeKeys: [...new Set(nfeKeys)],
    protocol: prot ? tag(prot, 'nProt') : null,
    protocolStatus: prot ? tag(prot, 'cStat') : null,
    total: num(tag(vPrest, 'vTPrest')),
    components,
    icms: {
      group,
      cst: tag(icmsBlock, 'CST'),
      rate: num(tag(icmsBlock, 'pICMS')),
      base: num(tag(icmsBlock, 'vBC')),
      value: num(tag(icmsBlock, 'vICMS')),
      baseReduction: num(tag(icmsBlock, 'pRedBC')),
    },
  }
}

export type RateLearning =
  | { ok: true; uf: string; rate: number; key: string | null; issuedAt: string | null; note: string | null }
  | { ok: false; reason: string; key: string | null }

/**
 * Alíquota interna a aprender do CT-e: só frete dentro do mesmo estado com ICMS tributado (CST 00) ou com redução de
 * base (CST 20, vira a alíquota efetiva). Isento, substituição tributária, Simples Nacional e interestadual não servem.
 */
export function internalRateFrom(c: CteData): RateLearning {
  if (!c.ufIni || !c.ufFim) return { ok: false, reason: 'CT-e sem UF de início e fim.', key: c.key }
  if (c.ufIni !== c.ufFim) return { ok: false, reason: `Frete interestadual (${c.ufIni} → ${c.ufFim}): a alíquota interestadual vem da legislação.`, key: c.key }
  const { cst, rate, baseReduction } = c.icms
  if (rate === null || rate <= 0) return { ok: false, reason: `Sem alíquota de ICMS no CT-e (${c.icms.group ?? 'grupo desconhecido'}${cst ? `, CST ${cst}` : ''}).`, key: c.key }
  if (cst === '00') return { ok: true, uf: c.ufIni, rate, key: c.key, issuedAt: c.issuedAt, note: null }
  if (cst === '20' && baseReduction !== null) {
    const eff = Math.round(rate * (1 - baseReduction / 100) * 100) / 100
    return { ok: true, uf: c.ufIni, rate: eff, key: c.key, issuedAt: c.issuedAt, note: `${rate}% com redução de base de ${baseReduction}%` }
  }
  return { ok: false, reason: `CST ${cst ?? '—'}: não é tributação normal, não serve de referência.`, key: c.key }
}

/** Evento de cancelamento do CT-e (procEventoCTe, tipo 110111): devolve a chave cancelada. Outro XML: null. */
export function parseCteCancel(raw: string): { key: string; protocol: string | null } | null {
  const ev = block(raw, 'infEvento')
  if (!ev || tag(ev, 'tpEvento') !== '110111') return null
  const key = tag(ev, 'chCTe')
  return key && /^\d{44}$/.test(key) ? { key, protocol: tag(block(ev, 'evCancCTe') ?? ev, 'nProt') } : null
}
