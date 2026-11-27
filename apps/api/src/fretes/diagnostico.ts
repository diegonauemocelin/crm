// Diagnóstico das tabelas pelos CT-es: junta, por transportadora, os padrões que se repetem na conciliação e diz o que
// ajustar no CRM (modo do ICMS, nome da taxa, cubagem) e o que pedir à transportadora (reajuste, cidades sem tabela,
// taxa não combinada). Sem banco e sem rede (test/fretes-diagnostico.spec.ts).

import { isIcmsName, normName } from './conciliacao'

export interface DiagCte {
  id: string
  number: string | null
  carrierId: string | null
  carrierName: string
  recStatus: string
  recTypes: string[]
  total: number
  expectedTotal: number | null
  difference: number | null
  icms: { rate: number | null; value: number | null } | null
  cityFim: string | null
  ufFim: string | null
  recDetail: {
    reason?: string
    tables?: { table: string; reason: string }[]
    allowed?: number
    lines?: { name: string; expected: number | null; charged: number | null; difference: number; status: string }[]
    notes?: string[]
  } | null
}

/** AJUSTAR: corrigir no CRM. PEDIR: falar com a transportadora. CONFERIR: olhar caso a caso. */
export type DiagAction = 'AJUSTAR' | 'PEDIR' | 'CONFERIR'

export interface DiagFinding {
  code: string
  action: DiagAction
  title: string
  detail: string
  /** Quantos CT-es mostram o problema. */
  count: number
  /** Até 5 CT-es de exemplo (id e número). */
  examples: { id: string; number: string | null }[]
}

export interface DiagCarrier {
  carrierId: string | null
  carrierName: string
  total: number
  conciliados: number
  divergentes: number
  semReferencia: number
  /** Soma das diferenças cobradas acima do esperado. */
  acima: number
  findings: DiagFinding[]
}

const MIN = 3
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const ex = (list: DiagCte[]) => list.slice(0, 5).map((c) => ({ id: c.id, number: c.number }))

/** Achados de uma transportadora. */
export function diagnoseCarrier(list: DiagCte[]): DiagFinding[] {
  const out: DiagFinding[] = []
  const reconciled = list.filter((c) => c.recDetail?.lines && c.expectedTotal !== null && c.difference !== null)
  const tolOf = (c: DiagCte) => Math.max(1, (c.icms?.value ?? 0) * 0.05)

  // 1) ICMS cobrado por dentro e a tabela sem somar: a diferença é o próprio ICMS do CT-e.
  const icmsMissing = reconciled.filter((c) => (c.icms?.value ?? 0) > 0 && (c.difference ?? 0) > (c.recDetail?.allowed ?? 0) && Math.abs((c.difference ?? 0) - (c.icms!.value ?? 0)) <= tolOf(c))
  const aboveCount = reconciled.filter((c) => (c.difference ?? 0) > (c.recDetail?.allowed ?? 0)).length
  if (icmsMissing.length >= MIN && icmsMissing.length >= aboveCount * 0.5)
    out.push({ code: 'ICMS_POR_DENTRO', action: 'AJUSTAR', title: 'ICMS cobrado por dentro e a tabela está sem somar', detail: `Em ${icmsMissing.length} CT-e(s) a diferença é exatamente o ICMS cobrado: a transportadora soma o imposto no frete (total ÷ (1 − alíquota)). Na tabela, aba Componentes › Parâmetros da versão, use "Cobrança do ICMS: Somado nos componentes (por dentro)" e publique.`, count: icmsMissing.length, examples: ex(icmsMissing) })

  // 2) O contrário: a tabela soma ICMS e a transportadora não (já inclui na tabela ou não cobra).
  const icmsExtra = reconciled.filter((c) => (c.icms?.value ?? 0) > 0 && (c.difference ?? 0) < -(c.recDetail?.allowed ?? 0) && Math.abs(-(c.difference ?? 0) - (c.icms!.value ?? 0)) <= tolOf(c))
  if (icmsExtra.length >= MIN)
    out.push({ code: 'ICMS_A_MAIS', action: 'AJUSTAR', title: 'A tabela soma ICMS que a transportadora não soma', detail: `Em ${icmsExtra.length} CT-e(s) o esperado fica acima do cobrado no valor do ICMS: a tabela da transportadora já inclui o imposto. Use "Cobrança do ICMS: Destacado, sem somar no total" (ou "Não incide") e publique.`, count: icmsExtra.length, examples: ex(icmsExtra) })

  // 3) Alíquota de ICMS diferente da esperada.
  const rates = new Map<string, DiagCte[]>()
  for (const c of reconciled) for (const n of c.recDetail?.notes ?? []) {
    const m = /esperada ([\d.,]+)%, cobrada ([\d.,]+)%/.exec(n)
    if (m) rates.set(`${c.ufFim ?? '?'}|${m[1]}|${m[2]}`, [...(rates.get(`${c.ufFim ?? '?'}|${m[1]}|${m[2]}`) ?? []), c])
  }
  for (const [k, cs] of rates) {
    if (cs.length < MIN) continue
    const [uf, exp, got] = k.split('|')
    out.push({ code: `ALIQUOTA_${uf}`, action: 'AJUSTAR', title: `Alíquota de ICMS para ${uf}: a tabela usa ${exp}%, o CT-e cobra ${got}%`, detail: `${cs.length} CT-e(s) para ${uf}. Ajuste a alíquota em Fretes › Filiais › ICMS do frete (ou nos parâmetros da versão da tabela).`, count: cs.length, examples: ex(cs) })
  }

  // 4) Taxa cobrada que a tabela não tem. Se no mesmo CT-e há um componente esperado e não cobrado de valor parecido,
  //    é só o nome: "Nomes no CT-e" do componente.
  const extra = new Map<string, { name: string; ctes: DiagCte[]; values: number[]; renamed: Map<string, number> }>()
  for (const c of reconciled) {
    const lines = c.recDetail?.lines ?? []
    for (const l of lines.filter((x) => x.status === 'NAO_PREVISTA' && (x.charged ?? 0) > 0)) {
      const key = normName(l.name)
      if (isIcmsName(key)) continue
      const e = extra.get(key) ?? { name: l.name, ctes: [] as DiagCte[], values: [] as number[], renamed: new Map<string, number>() }
      e.ctes.push(c)
      e.values.push(l.charged!)
      const twin = lines.find((x) => x.status === 'NAO_COBRADA' && (x.expected ?? 0) > 0 && Math.abs((x.expected ?? 0) - l.charged!) <= Math.max(0.5, l.charged! * 0.05))
      if (twin) e.renamed.set(twin.name, (e.renamed.get(twin.name) ?? 0) + 1)
      extra.set(key, e)
    }
  }
  for (const [key, e] of extra) {
    if (e.ctes.length < MIN) continue
    const avg = e.values.reduce((s, v) => s + v, 0) / e.values.length
    const best = [...e.renamed.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] >= e.ctes.length * 0.5)
      out.push({ code: `NOME_${key}`, action: 'AJUSTAR', title: `"${e.name}" no CT-e é o componente "${best[0]}" da tabela`, detail: `Em ${best[1]} CT-e(s) o valor bate com "${best[0]}". Na aba Componentes, escreva "${e.name}" em "Nomes no CT-e" desse componente.`, count: e.ctes.length, examples: ex(e.ctes) })
    else
      out.push({ code: `TAXA_${key}`, action: 'PEDIR', title: `Taxa "${e.name}" cobrada e fora da tabela`, detail: `${e.ctes.length} CT-e(s), em média ${brl(avg)}. Se foi combinada, inclua o componente na tabela; se não, conteste com a transportadora.`, count: e.ctes.length, examples: ex(e.ctes) })
  }

  // 5) Componente cobrado sempre acima (ou abaixo) da tabela: reajuste não informado ou tabela desatualizada.
  const diff = new Map<string, { name: string; ctes: DiagCte[]; ratios: number[] }>()
  for (const c of reconciled) for (const l of c.recDetail?.lines ?? []) {
    if (l.status !== 'DIFERENTE' || !(l.expected && l.expected > 0) || l.charged === null) continue
    const key = normName(l.name)
    if (isIcmsName(key)) continue
    const e = diff.get(key) ?? { name: l.name, ctes: [] as DiagCte[], ratios: [] as number[] }
    e.ctes.push(c)
    e.ratios.push(l.charged / l.expected)
    diff.set(key, e)
  }
  for (const [key, e] of diff) {
    if (e.ctes.length < MIN) continue
    const m = median(e.ratios)
    const up = e.ratios.filter((r) => r > 1).length / e.ratios.length
    if (m > 1.03 && up >= 0.7)
      out.push({ code: `ACIMA_${key}`, action: 'PEDIR', title: `"${e.name}" cobrado ${pct((m - 1) * 100)} acima da tabela`, detail: `Em ${e.ctes.length} CT-e(s), de forma constante: parece reajuste que não chegou ao CRM. Peça a tabela atualizada à transportadora (ou conteste, se não houve reajuste).`, count: e.ctes.length, examples: ex(e.ctes) })
    else if (m < 0.97 && up <= 0.3)
      out.push({ code: `ABAIXO_${key}`, action: 'AJUSTAR', title: `"${e.name}" da tabela está ${pct((1 - m) * 100)} acima do cobrado`, detail: `Em ${e.ctes.length} CT-e(s) a transportadora cobra menos que a tabela do CRM: confira os valores ou a fórmula desse componente.`, count: e.ctes.length, examples: ex(e.ctes) })
  }

  // 6) Componente da tabela que a transportadora nunca cobra.
  const never = new Map<string, { name: string; ctes: DiagCte[] }>()
  for (const c of reconciled) for (const l of c.recDetail?.lines ?? []) {
    if (l.status !== 'NAO_COBRADA' || !(l.expected && l.expected > 0.009)) continue
    const key = normName(l.name)
    if (isIcmsName(key) || extra.has(key)) continue
    const e = never.get(key) ?? { name: l.name, ctes: [] as DiagCte[] }
    e.ctes.push(c)
    never.set(key, e)
  }
  for (const [key, e] of never) {
    if (e.ctes.length < MIN || out.some((f) => f.code.startsWith('NOME_') && f.title.includes(`"${e.name}"`))) continue
    out.push({ code: `NAO_COBRA_${key}`, action: 'AJUSTAR', title: `"${e.name}" está na tabela e a transportadora não cobra`, detail: `Em ${e.ctes.length} CT-e(s). Se ela não cobra mesmo, desligue o componente ou zere o valor; se cobra com outro nome, informe em "Nomes no CT-e".`, count: e.ctes.length, examples: ex(e.ctes) })
  }

  // 7) Peso do CT-e maior que o informado.
  const weight = reconciled.filter((c) => c.recTypes.includes('DIVERGENCIA_PESO'))
  if (weight.length >= MIN)
    out.push({ code: 'PESO', action: 'CONFERIR', title: 'Peso do CT-e maior que o da cotação', detail: `${weight.length} CT-e(s). Confira o peso e as medidas cadastrados dos produtos e o fator de cubagem da tabela (a transportadora pode cobrar pelo cubado).`, count: weight.length, examples: ex(weight) })

  // 8) Sem referência: por que nenhuma tabela calculou.
  const noRef = list.filter((c) => c.recStatus === 'SEM_REFERENCIA')
  const uncovered = noRef.filter((c) => (c.recDetail?.tables ?? []).some((t) => /Destino: /.test(t.reason)))
  if (uncovered.length) {
    const cities = new Map<string, number>()
    for (const c of uncovered) cities.set(`${c.cityFim ?? '?'}/${c.ufFim ?? '?'}`, (cities.get(`${c.cityFim ?? '?'}/${c.ufFim ?? '?'}`) ?? 0) + 1)
    const top = [...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} (${n})`)
    out.push({ code: 'SEM_COBERTURA', action: 'PEDIR', title: 'Destinos sem regra na tabela', detail: `${uncovered.length} CT-e(s) para cidades que a tabela não tem: ${top.join(', ')}. Peça a tabela (ou a lista de regiões) dessas cidades à transportadora.`, count: uncovered.length, examples: ex(uncovered) })
  }
  const expired = noRef.filter((c) => (c.recDetail?.tables ?? []).some((t) => /vencida|Vigência começa/i.test(t.reason)))
  if (expired.length) out.push({ code: 'VENCIDA', action: 'PEDIR', title: 'Tabela vencida na data do CT-e', detail: `${expired.length} CT-e(s). Peça a tabela nova à transportadora ou, se a mesma continua valendo, atualize a vigência.`, count: expired.length, examples: ex(expired) })
  const noTable = noRef.filter((c) => /não tem tabela de frete cadastrada/i.test(c.recDetail?.reason ?? ''))
  if (noTable.length) out.push({ code: 'SEM_TABELA', action: 'AJUSTAR', title: 'Transportadora sem tabela no CRM', detail: `${noTable.length} CT-e(s) sem tabela para comparar. Cadastre e publique a tabela (ou desmarque "Concilia os CT-es" se ela não deve ser conferida).`, count: noTable.length, examples: ex(noTable) })
  const heavy = noRef.filter((c) => !uncovered.includes(c) && (c.recDetail?.tables ?? []).some((t) => /Peso acima do máximo/i.test(t.reason)))
  if (heavy.length) out.push({ code: 'PESO_MAXIMO', action: 'PEDIR', title: 'Peso acima do máximo da tabela', detail: `${heavy.length} CT-e(s) com peso maior que o limite da tabela. Peça a faixa de peso maior (ou o excedente por kg) à transportadora.`, count: heavy.length, examples: ex(heavy) })
  const other = noRef.filter((c) => !uncovered.includes(c) && !expired.includes(c) && !noTable.includes(c) && !heavy.includes(c))
  if (other.length >= MIN) {
    const reasons = new Map<string, DiagCte[]>()
    for (const c of other) reasons.set(c.recDetail?.reason ?? 'Sem motivo', [...(reasons.get(c.recDetail?.reason ?? 'Sem motivo') ?? []), c])
    const [why, cs] = [...reasons.entries()].sort((a, b) => b[1].length - a[1].length)[0]!
    out.push({ code: 'SEM_REFERENCIA', action: 'CONFERIR', title: 'Outros CT-es sem referência', detail: `${other.length} CT-e(s). O motivo mais comum: ${why}`, count: other.length, examples: ex(cs) })
  }
  const order: Record<DiagAction, number> = { AJUSTAR: 0, PEDIR: 1, CONFERIR: 2 }
  return out.sort((a, b) => order[a.action] - order[b.action] || b.count - a.count)
}

/** Diagnóstico de todas as transportadoras (as com mais problemas primeiro). */
export function diagnose(list: DiagCte[]): DiagCarrier[] {
  const by = new Map<string, DiagCte[]>()
  for (const c of list) by.set(c.carrierId ?? `?${c.carrierName}`, [...(by.get(c.carrierId ?? `?${c.carrierName}`) ?? []), c])
  return [...by.values()]
    .map((cs) => ({
      carrierId: cs[0]!.carrierId,
      carrierName: cs[0]!.carrierName,
      total: cs.length,
      conciliados: cs.filter((c) => c.recStatus === 'CONCILIADO').length,
      divergentes: cs.filter((c) => c.recStatus === 'DIVERGENTE').length,
      semReferencia: cs.filter((c) => c.recStatus === 'SEM_REFERENCIA').length,
      acima: Math.round(cs.reduce((s, c) => s + Math.max(0, c.difference ?? 0), 0) * 100) / 100,
      findings: diagnoseCarrier(cs),
    }))
    .sort((a, b) => b.findings.length - a.findings.length || b.acima - a.acima || a.carrierName.localeCompare(b.carrierName))
}
