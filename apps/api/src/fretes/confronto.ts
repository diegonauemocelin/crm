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
}

export type CheckStatus = 'OK' | 'DIVERGENTE' | 'SEM_DADO'
export interface Check {
  code: 'NOTAS' | 'VALOR' | 'PESO' | 'VOLUMES' | 'DESTINO' | 'TRANSPORTADORA' | 'TOMADOR'
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
  const mode = first.freightMode
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
