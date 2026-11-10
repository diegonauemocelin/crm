// Confronto NF-e × CT-e: as notas que o CT-e transporta (infDoc) contra os XMLs das notas importados no CRM. Valor da
// carga, peso, volumes, destino, transportadora e quem paga o frete (CIF/FOB × tomador). Sem banco e sem rede
// (test/fretes-confronto.spec.ts).

export interface NfeTolerance {
  /** Peso: vale a maior folga entre % do peso das notas e kg. */
  pesoPercentual: number
  pesoKg: number
  /** Valor da carga em reais. */
  valor: number
}
export const DEFAULT_NFE_TOLERANCE: NfeTolerance = { pesoPercentual: 2, pesoKg: 1, valor: 1 }

export interface CteSide {
  nfeKeys: string[]
  /** Valor total cobrado no CT-e (frete). */
  total?: number | null
  cargoValue: number | null
  weight: number | null
  volumes: number | null
  ufFim: string | null
  cityFim: string | null
  emitCnpj: string | null
  tomadorDoc: string | null
}
export interface NfeSide {
  key: string
  number: number | string | null
  value: number | null
  grossWeight: number | null
  volumes: number | null
  destUf: string | null
  destCity: string | null
  carrierCnpj: string | null
  freightMode: string | null
  emitCnpj: string | null
  destCnpj: string | null
  /** Frete destacado na nota (vFrete). */
  freightValue?: number | null
}

export type CheckStatus = 'OK' | 'DIVERGENTE' | 'SEM_DADO'
export interface Check {
  code: 'NOTAS' | 'VALOR' | 'FRETE' | 'PESO' | 'VOLUMES' | 'DESTINO' | 'TRANSPORTADORA' | 'TOMADOR'
  /** O que foi conferido. */
  name: string
  status: CheckStatus
  /** Frase para a tela quando diverge (ou por que não deu para conferir). */
  label: string | null
  nfe: string | number | null
  cte: string | number | null
}
export interface Confrontation {
  /** SEM_CHAVE: CT-e sem nota; SEM_NOTA: nenhuma nota importada; DIVERGENTE: alguma conferência falhou. */
  status: 'OK' | 'DIVERGENTE' | 'SEM_NOTA' | 'SEM_CHAVE'
  notes: { key: string; number: string | null; found: boolean }[]
  checks: Check[]
  divergences: string[]
}

const fold = (s: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const root = (d: string | null) => (d && /^\d{14}$/.test(d) ? d.slice(0, 8) : null)
const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000
const MODE_LABEL: Record<string, string> = { '0': 'CIF (emitente)', '1': 'FOB (destinatário)', '2': 'terceiros', '3': 'próprio (remetente)', '4': 'próprio (destinatário)', '9': 'sem frete' }

const brl = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Por que o frete da nota não é comparado com o CT-e (frete que não é CIF). */
export function freightModeNote(mode: string | null): string {
  if (mode === '1') return 'Frete FOB: pago pelo destinatário'
  if (mode === '9') return 'Nota sem frete'
  if (!mode) return 'A nota não informa a modalidade do frete.'
  return `Frete por conta de ${MODE_LABEL[mode] ?? mode}: não compara com o CT-e`
}

/**
 * Frete da nota × CT-e cobrado (soma dos CT-es do pedido), só no CIF:
 * MAIOR (verde) quando a nota cobre o CT-e além da folga, MENOR (vermelho) quando a nota é menor, IGUAL dentro da
 * folga; NAO_CIF (FOB, sem frete, terceiros), SEM_NOTA (sem XML importado) e SEM_CTE ficam sem cor. Nota CIF sem
 * vFrete conta como frete zero.
 */
export type FreightCompareKind = 'MAIOR' | 'MENOR' | 'IGUAL' | 'SEM_CTE' | 'NAO_CIF' | 'SEM_NOTA'
export interface FreightCompare {
  kind: FreightCompareKind
  /** Frete da nota (vFrete), quando há nota. */
  nfe: number | null
  /** Total dos CT-es. */
  cte: number | null
  /** Nota − CT-e (positivo: a nota cobre o CT-e). */
  diff: number | null
  label: string | null
}
export function compareFreight(nf: { freightMode: string | null; freightValue: number | null } | null, cteTotal: number | null, tolerance = DEFAULT_NFE_TOLERANCE.valor): FreightCompare {
  if (!nf) return { kind: 'SEM_NOTA', nfe: null, cte: cteTotal, diff: null, label: null }
  const value = nf.freightValue
  if (nf.freightMode !== '0') return { kind: 'NAO_CIF', nfe: value, cte: cteTotal, diff: null, label: freightModeNote(nf.freightMode) }
  const nfe = r2(value ?? 0)
  if (cteTotal === null) return { kind: 'SEM_CTE', nfe, cte: null, diff: null, label: 'Sem CT-e' }
  const diff = r2(nfe - cteTotal)
  if (diff > tolerance) return { kind: 'MAIOR', nfe, cte: cteTotal, diff, label: `Frete da nota cobre o CT-e (+${brl(diff)})` }
  if (diff < -tolerance) return { kind: 'MENOR', nfe, cte: cteTotal, diff, label: `Frete da nota menor que o CT-e (−${brl(diff)})` }
  return { kind: 'IGUAL', nfe, cte: cteTotal, diff, label: diff === 0 ? 'Frete da nota igual ao CT-e' : `Frete da nota igual ao CT-e (diferença de ${brl(diff)}, dentro da folga)` }
}

/** Filtro da lista de pedidos: a nota CIF maior ou menor que o CT-e (além da folga). */
export type FreightFilter = 'NOTA_MAIOR' | 'NOTA_MENOR'
export function matchesFreightFilter(c: FreightCompare, f: FreightFilter | null | undefined): boolean {
  if (!f) return true
  return f === 'NOTA_MAIOR' ? c.kind === 'MAIOR' : c.kind === 'MENOR'
}

/** Confronta um CT-e com os XMLs das notas que ele cita. */
export function confrontNfeCte(cte: CteSide, nfes: NfeSide[], tol: NfeTolerance = DEFAULT_NFE_TOLERANCE): Confrontation {
  const keys = [...new Set(cte.nfeKeys)]
  const byKey = new Map(nfes.map((n) => [n.key, n]))
  const notes = keys.map((k) => ({ key: k, number: byKey.get(k)?.number != null ? String(byKey.get(k)!.number) : String(Number(k.slice(25, 34))), found: byKey.has(k) }))
  if (!keys.length) return { status: 'SEM_CHAVE', notes, checks: [], divergences: ['CT-e sem chave de NF-e'] }
  const found = keys.map((k) => byKey.get(k)).filter((n): n is NfeSide => !!n)
  if (!found.length) return { status: 'SEM_NOTA', notes, checks: [], divergences: [keys.length > 1 ? 'Notas não encontradas' : 'Nota não encontrada'] }
  const missing = keys.length - found.length
  const all = missing === 0
  const checks: Check[] = []
  checks.push({ code: 'NOTAS', name: 'Notas do CT-e', status: all ? 'OK' : 'DIVERGENTE', label: all ? null : `${missing === 1 ? 'Nota não encontrada' : `${missing} notas não encontradas`} (importe o XML)`, nfe: found.length, cte: keys.length })

  const incomplete = 'Faltam notas: não dá para somar.'
  // Valor da carga = soma do valor das notas.
  const values = found.map((n) => n.value)
  if (!all || cte.cargoValue === null || values.some((v) => v === null)) {
    checks.push({ code: 'VALOR', name: 'Valor da carga', status: 'SEM_DADO', label: !all ? incomplete : 'Sem valor no CT-e ou na nota.', nfe: null, cte: cte.cargoValue })
  } else {
    const sum = r2(values.reduce<number>((s, v) => s + v!, 0))
    const diff = r2(cte.cargoValue - sum)
    checks.push({ code: 'VALOR', name: 'Valor da carga', status: Math.abs(diff) > tol.valor ? 'DIVERGENTE' : 'OK', label: Math.abs(diff) > tol.valor ? (diff > 0 ? 'Valor da carga maior que o das notas' : 'Valor da carga menor que o das notas') : null, nfe: sum, cte: cte.cargoValue })
  }

  // Frete: o destacado nas notas (vFrete) × o total cobrado no CT-e. Só no CIF (emitente paga) faz sentido: a nota
  // cobrir o CT-e é bom; a nota menor que o CT-e é frete pago pela empresa e não repassado.
  const mode = found[0]!.freightMode
  const freights = found.map((n) => n.freightValue ?? null)
  const nfFreight = all ? r2(freights.reduce<number>((s, f) => s + (f ?? 0), 0)) : null
  const FRETE = 'Frete (nota × CT-e)'
  if (!all) checks.push({ code: 'FRETE', name: FRETE, status: 'SEM_DADO', label: incomplete, nfe: null, cte: cte.total ?? null })
  else if (mode !== '0') checks.push({ code: 'FRETE', name: FRETE, status: 'SEM_DADO', label: freightModeNote(mode), nfe: nfFreight, cte: cte.total ?? null })
  else if (cte.total == null) checks.push({ code: 'FRETE', name: FRETE, status: 'SEM_DADO', label: 'Sem valor no CT-e.', nfe: nfFreight, cte: null })
  else {
    const c = compareFreight({ freightMode: mode, freightValue: nfFreight }, cte.total, tol.valor)
    checks.push({ code: 'FRETE', name: FRETE, status: c.kind === 'MENOR' ? 'DIVERGENTE' : 'OK', label: c.label, nfe: nfFreight, cte: cte.total })
  }

  // Peso: o do CT-e (cobrado) contra o peso bruto das notas.
  const weights = found.map((n) => n.grossWeight)
  if (!all || cte.weight === null || weights.some((w) => w === null)) {
    checks.push({ code: 'PESO', name: 'Peso (kg)', status: 'SEM_DADO', label: !all ? incomplete : 'Sem peso no CT-e ou peso bruto na nota.', nfe: null, cte: cte.weight })
  } else {
    const sum = r3(weights.reduce<number>((s, w) => s + w!, 0))
    const allowed = Math.max(tol.pesoKg, (sum * tol.pesoPercentual) / 100)
    const diff = r3(cte.weight - sum)
    checks.push({ code: 'PESO', name: 'Peso (kg)', status: Math.abs(diff) > allowed ? 'DIVERGENTE' : 'OK', label: Math.abs(diff) > allowed ? (diff > 0 ? 'Peso cobrado maior que o da nota' : 'Peso cobrado menor que o da nota') : null, nfe: sum, cte: cte.weight })
  }

  // Volumes: só quando os dois informam.
  const vols = found.map((n) => n.volumes)
  if (!all || cte.volumes === null || vols.some((v) => v === null)) {
    checks.push({ code: 'VOLUMES', name: 'Volumes', status: 'SEM_DADO', label: !all ? incomplete : 'O CT-e ou a nota não informa volumes.', nfe: null, cte: cte.volumes })
  } else {
    const sum = vols.reduce<number>((s, v) => s + v!, 0)
    checks.push({ code: 'VOLUMES', name: 'Volumes', status: sum === cte.volumes ? 'OK' : 'DIVERGENTE', label: sum === cte.volumes ? null : 'Volumes diferentes da nota', nfe: sum, cte: cte.volumes })
  }

  // Destino: UF e cidade da nota (destinatário) × fim da prestação do CT-e.
  const dests = [...new Set(found.map((n) => `${n.destUf ?? ''}|${fold(n.destCity)}`))]
  const first = found[0]!
  const nfDest = first.destUf ? `${first.destCity ?? ''}/${first.destUf}` : null
  if (!first.destUf || !cte.ufFim) {
    checks.push({ code: 'DESTINO', name: 'Destino', status: 'SEM_DADO', label: 'Sem UF de destino na nota ou no CT-e.', nfe: nfDest, cte: cte.ufFim ? `${cte.cityFim ?? ''}/${cte.ufFim}` : null })
  } else {
    const same = dests.length === 1 && first.destUf === cte.ufFim && (!first.destCity || !cte.cityFim || fold(first.destCity) === fold(cte.cityFim))
    checks.push({ code: 'DESTINO', name: 'Destino', status: same ? 'OK' : 'DIVERGENTE', label: same ? null : 'Destino diferente da nota', nfe: nfDest, cte: `${cte.cityFim ?? ''}/${cte.ufFim}` })
  }

  // Transportadora da nota (transporta) × emitente do CT-e: mesma empresa (raiz do CNPJ).
  const carriers = [...new Set(found.map((n) => root(n.carrierCnpj)).filter(Boolean))]
  if (!carriers.length || !root(cte.emitCnpj)) {
    checks.push({ code: 'TRANSPORTADORA', name: 'Transportadora', status: 'SEM_DADO', label: 'A nota não informa a transportadora.', nfe: null, cte: cte.emitCnpj })
  } else {
    const ok = carriers.length === 1 && carriers[0] === root(cte.emitCnpj)
    checks.push({ code: 'TRANSPORTADORA', name: 'Transportadora', status: ok ? 'OK' : 'DIVERGENTE', label: ok ? null : 'Transportadora diferente da nota', nfe: found.map((n) => n.carrierCnpj).find(Boolean) ?? null, cte: cte.emitCnpj })
  }

  // Quem paga: CIF (0) = o emitente da nota é o tomador; FOB (1) = o destinatário é o tomador.
  const tomRoot = root(cte.tomadorDoc)
  const modeLabel = mode ? (MODE_LABEL[mode] ?? mode) : null
  if (mode === '0' && tomRoot && root(first.emitCnpj)) {
    const ok = tomRoot === root(first.emitCnpj)
    checks.push({ code: 'TOMADOR', name: 'Quem paga o frete', status: ok ? 'OK' : 'DIVERGENTE', label: ok ? null : 'Frete CIF na nota, mas o tomador do CT-e é outro', nfe: modeLabel, cte: cte.tomadorDoc })
  } else if (mode === '1' && tomRoot) {
    const dest = root(first.destCnpj)
    const ok = dest ? tomRoot === dest : tomRoot !== root(first.emitCnpj)
    checks.push({ code: 'TOMADOR', name: 'Quem paga o frete', status: ok ? 'OK' : 'DIVERGENTE', label: ok ? null : 'Frete FOB na nota, mas o tomador do CT-e não é o destinatário', nfe: modeLabel, cte: cte.tomadorDoc })
  } else {
    checks.push({ code: 'TOMADOR', name: 'Quem paga o frete', status: 'SEM_DADO', label: mode ? `Frete por conta de ${modeLabel}: não confere o tomador.` : 'A nota não informa a modalidade do frete.', nfe: modeLabel, cte: cte.tomadorDoc })
  }

  const divergences = checks.filter((c) => c.status === 'DIVERGENTE').map((c) => c.label!)
  return { status: divergences.length ? 'DIVERGENTE' : 'OK', notes, checks, divergences }
}
