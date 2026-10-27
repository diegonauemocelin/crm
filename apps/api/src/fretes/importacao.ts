// Importação de tabelas de frete (Excel/CSV): cada transportadora manda num formato, então a pessoa mapeia as colunas.
// Aqui: leitura de números e CEPs, sugestão de mapeamento, validação linha a linha e duplicidades. Sem banco e sem rede
// (test/fretes-importacao.spec.ts).

import { RULE_VARIABLES } from './catalogo'
import { cityKey, formatCep, normalizeUf, ufByCep } from './cep'

export const MAX_RULES = 200_000
const MAX_ISSUES = 500

/** Campos do destino e da faixa. Os valores (frete, GRIS...) usam "var:<código>". */
export const BASE_FIELDS = ['cep_start', 'cep_end', 'cep', 'uf', 'city', 'weight_min', 'weight_max', 'deadline', 'restricted', 'note'] as const
export type BaseField = (typeof BASE_FIELDS)[number]

export const FIELD_LABEL: Record<BaseField, string> = {
  cep_start: 'CEP inicial',
  cep_end: 'CEP final',
  cep: 'CEP (único ou 5 dígitos)',
  uf: 'UF de destino',
  city: 'Cidade de destino',
  weight_min: 'Peso inicial (kg)',
  weight_max: 'Peso final (kg)',
  deadline: 'Prazo (dias úteis)',
  restricted: 'Restrição / não atende',
  note: 'Observação',
}

export interface ColumnMap {
  column: number
  /** Campo base ou "var:<código>". */
  field: string
  /** Coluna que é uma faixa de peso ("Até 10 kg"): a linha vira uma regra por faixa. */
  weightMin?: number | null
  weightMax?: number | null
}

export interface ParsedRule {
  line: number
  cepStart: number | null
  cepEnd: number | null
  uf: string | null
  city: string | null
  cityKey: string | null
  weightMin: number
  weightMax: number | null
  deadlineDays: number | null
  restricted: boolean
  values: Record<string, number>
  note: string | null
}

export interface Issue {
  line: number
  level: 'erro' | 'alerta'
  message: string
}

/** "R$ 1.234,56", "0,30%", "12.5", 7 → número. Vazio ou "-": null. Texto que não é número: NaN. */
export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  let s = String(raw).trim()
  if (!s || /^[-–—]+$/.test(s)) return null
  s = s.replace(/r\$|%|\s/gi, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '')
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN
}

/** CEP de 8 dígitos (completa os zeros que o Excel tira) ou prefixo de até 5 dígitos ("89874" = 89874-000 a 89874-999). */
export function parseCepRange(raw: unknown): { start: number; end: number } | null | 'invalido' {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const isNumber = typeof raw === 'number'
  const digits = String(raw).replace(/\D/g, '')
  if (!digits || digits.length > 8) return 'invalido'
  if (!isNumber && digits.length <= 5) {
    const p = Number(digits.padStart(5, '0'))
    return { start: p * 1000, end: p * 1000 + 999 }
  }
  if (isNumber && digits.length <= 5) return { start: Number(digits) * 1000, end: Number(digits) * 1000 + 999 }
  const n = Number(digits.padStart(8, '0'))
  return n ? { start: n, end: n } : 'invalido'
}

const YES = /^(s|sim|x|1|true|verdadeiro|restrito|restricao|nao atende|bloqueado)$/
const NO = /^(n|nao|0|false|falso|)$/

function text(raw: unknown, max = 120) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

export const normalizeHeader = (h: unknown) =>
  String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/r\$/g, ' ')
    .replace(/[^a-z0-9.,%/+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Ordem importa: o mais específico primeiro (GRIS mínimo antes de GRIS, frete mínimo antes de frete). */
const HEADER_RULES: [RegExp, string][] = [
  [/^(cep )?(inicial|inicio|ini|de)( cep)?$|^cep (inicial|inicio|ini|de|origem inicial)|^faixa (de )?cep inicial|^faixa inicial/, 'cep_start'],
  [/^(cep )?(final|fim|ate)( cep)?$|^cep (final|fim|ate)|^faixa (de )?cep final|^faixa final/, 'cep_end'],
  [/^cep( destino)?$/, 'cep'],
  [/^(uf|estado)( destino)?$|^destino uf$/, 'uf'],
  [/^(cidade|municipio|localidade|destino|praca)( destino| atendida)?$/, 'city'],
  [/^peso (inicial|de|min|minimo)|^kg (inicial|de)/, 'weight_min'],
  [/^peso (final|ate|max|maximo)|^kg (final|ate)/, 'weight_max'],
  [/prazo|lead ?time|^dias( uteis)?$|transit/, 'deadline'],
  [/restri|nao atende|bloquead/, 'restricted'],
  [/^obs|observ/, 'note'],
  [/frete min|^minimo|valor min|^fm$/, 'var:min_freight'],
  [/excedente|kg adicional|kg extra|^acima|^\+ ?\d/, 'var:over_weight'],
  [/frete valor|frete-valor|^fv$|% ?nf|frete %/, 'var:freight_value'],
  [/frete (por )?kg|r\$ ?\/ ?kg|^\/ ?kg|valor (por )?kg|por kg|^kg$/, 'var:freight_kg'],
  [/frete base/, 'var:base_freight'],
  [/ad ?-?valorem min|adv min/, 'var:advalorem_min'],
  [/ad ?-?valorem|^adv$/, 'var:advalorem'],
  [/^gris ?(%|percentual)/, 'var:gris'],
  [/gris min/, 'var:gris_min'],
  [/^gris|gerenciamento de risco/, 'var:gris'],
  // "PEDÁGIO FRAÇÃO 100 Kg" é o valor do pedágio; a fração (100 kg) fica na fórmula ou numa coluna própria.
  [/pedagio|^ped$/, 'var:toll'],
  [/fracao/, 'var:fraction'],
  [/t ?-?cpf|taxa cpf/, 'var:t_cpf'],
  [/^tas$/, 'var:tas'],
  [/^tda$|dificil acesso/, 'var:tda'],
  [/^trt$/, 'var:trt'],
  [/^tde$/, 'var:tde'],
  [/^tdc$/, 'var:tdc'],
  [/^tec$/, 'var:tec'],
  [/^tce$/, 'var:tce'],
  [/^tcd$/, 'var:tcd'],
  [/suframa/, 'var:suframa'],
  [/taxa (de )?entrega/, 'var:delivery_fee'],
  [/despacho/, 'var:dispatch'],
  [/redespacho/, 'var:redispatch'],
  [/reentrega/, 'var:redelivery'],
  [/devolucao/, 'var:devolution'],
  [/seguro/, 'var:insurance'],
  [/coleta/, 'var:collection'],
  [/aliq.*icms|icms.*(aliq|%)|^icms$/, 'var:icms_aliq'],
  [/^(frete|frete peso|valor|tarifa|valor frete|taxa|taxa fixa|taxa por cte)$/, 'var:freight'],
  [/^quilo$|frete quilo|valor quilo|^kg$/, 'var:freight_kg'],
]

/** Campos que precisam de número: coluna de texto ("CONFORME LEGISLAÇÃO", "De 2 a 6 dias") não é sugerida para eles. */
const NUMERIC = (field: string) => field.startsWith('var:') || field === 'weight_min' || field === 'weight_max' || field === 'deadline'

/** Coluna de faixa de peso: "até 10 kg", "0 a 10 kg", "de 10,01 a 20 kg", "10-20kg". */
export function weightBand(header: unknown): { min: number | null; max: number } | null {
  const h = normalizeHeader(header)
  const num = (s: string) => Number(s.replace(',', '.'))
  let m = /^(?:peso )?ate ?(\d+(?:[.,]\d+)?) ?(?:kg|quilos?|k)\b/.exec(h)
  if (m) return { min: null, max: num(m[1]!) }
  m = /^(?:peso )?(?:de )?(\d+(?:[.,]\d+)?) ?(?:kg )?(?:a|-|ate) ?(\d+(?:[.,]\d+)?) ?(?:kg|quilos?|k)\b/.exec(h)
  if (m) return { min: num(m[1]!), max: num(m[2]!) }
  return null
}

/**
 * Sugestão de mapeamento pelos títulos (e pelas primeiras linhas de dados, quando vierem). Faixas sem início
 * ("até 20 kg") começam onde a anterior terminou.
 */
export function suggestMapping(headers: unknown[], samples: unknown[][] = []): ColumnMap[] {
  const out: ColumnMap[] = []
  const used = new Set<string>()
  const norm = headers.map(normalizeHeader)
  // Prazo em duas colunas (mínimo e máximo de dias): vale o máximo, e "mínimo" não é frete mínimo.
  const daysPair = norm.includes('minimo') && norm.includes('maximo')
  // "GRIS" (R$) ao lado de "GRIS %": o sem % é o mínimo.
  const grisPct = norm.some((h) => /^gris ?(%|percentual)/.test(h))
  const textColumn = (column: number) => {
    const values = samples.map((r) => r?.[column]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 8)
    return values.length > 0 && values.filter((v) => Number.isNaN(parseNumber(v))).length > values.length / 2
  }
  let lastMax = 0
  headers.forEach((raw, column) => {
    const band = weightBand(raw)
    if (band) {
      out.push({ column, field: 'var:freight', weightMin: band.min ?? lastMax, weightMax: band.max })
      lastMax = band.max
      return
    }
    const h = norm[column]!
    if (!h) return
    let field: string | undefined
    if (daysPair && h === 'maximo') field = 'deadline'
    else if (daysPair && h === 'minimo') return
    else if (grisPct && h === 'gris') field = 'var:gris_min'
    else field = HEADER_RULES.find(([re, f]) => re.test(h) && !used.has(f) && !(NUMERIC(f) && textColumn(column)))?.[1]
    if (!field || used.has(field) || (NUMERIC(field) && textColumn(column))) return
    used.add(field)
    out.push({ column, field })
  })
  return out
}

const PERCENT = new Set(RULE_VARIABLES.filter((v) => v.unit === '%').map((v) => v.code))
const VAR_LABEL = new Map(RULE_VARIABLES.map((v) => [v.code, v.label]))
const isVarField = (f: string) => f.startsWith('var:')
export const varCode = (f: string) => f.slice(4)

/** Confere o mapeamento antes de ler a planilha. */
export function checkMapping(mapping: ColumnMap[], columns: number): string[] {
  const errors: string[] = []
  const seen = new Map<string, number>()
  for (const m of mapping) {
    if (!Number.isInteger(m.column) || m.column < 0 || m.column >= columns) errors.push(`Coluna ${m.column + 1} não existe na planilha.`)
    const isBand = m.weightMax !== undefined && m.weightMax !== null
    if (isVarField(m.field)) {
      const code = varCode(m.field)
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(code)) errors.push(`Código de variável inválido: ${code}.`)
      if (isBand) {
        if ((m.weightMin ?? 0) < 0 || m.weightMax! <= (m.weightMin ?? 0)) errors.push(`Faixa de peso inválida na coluna ${m.column + 1}: ${m.weightMin ?? 0} a ${m.weightMax} kg.`)
        continue
      }
    } else if (!(BASE_FIELDS as readonly string[]).includes(m.field)) {
      errors.push(`Campo desconhecido: ${m.field}.`)
    } else if (isBand) errors.push(`Só valores (frete, taxas) podem ser faixa de peso; ${m.field} não.`)
    const prev = seen.get(m.field)
    if (prev !== undefined) errors.push(`${labelOf(m.field)} aparece em duas colunas (${prev + 1} e ${m.column + 1}).`)
    seen.set(m.field, m.column)
  }
  const fields = new Set(mapping.map((m) => m.field))
  if (!fields.has('cep_start') && !fields.has('cep') && !fields.has('uf') && !fields.has('city')) errors.push('Mapeie o destino: CEP inicial e final, CEP, cidade ou UF.')
  if (fields.has('cep_start') !== fields.has('cep_end')) errors.push('Mapeie juntos o CEP inicial e o CEP final.')
  if (!mapping.some((m) => isVarField(m.field))) errors.push('Mapeie ao menos uma coluna de valor (frete, taxas).')
  const bands = mapping.filter((m) => m.weightMax !== undefined && m.weightMax !== null)
  if (bands.length && (fields.has('weight_min') || fields.has('weight_max'))) errors.push('Use faixas de peso em colunas ou colunas de peso inicial/final, não os dois.')
  return errors
}

export const labelOf = (field: string) =>
  isVarField(field) ? (VAR_LABEL.get(varCode(field)) ?? varCode(field)) : (FIELD_LABEL[field as BaseField] ?? field)

/**
 * Lê as linhas com o mapeamento. firstLine = número da linha da planilha da primeira linha de dados (para o relatório).
 * Linhas totalmente vazias são ignoradas; linhas com erro não geram regra.
 */
export function parseRows(rows: unknown[][], mapping: ColumnMap[], firstLine: number) {
  const issues: Issue[] = []
  const rules: ParsedRule[] = []
  let errorLines = 0
  let readLines = 0
  let issueCount = 0
  const push = (i: Issue) => {
    issueCount++
    if (issues.length < MAX_ISSUES) issues.push(i)
  }
  const bandCols = mapping.filter((m) => m.weightMax !== undefined && m.weightMax !== null)
  const plain = mapping.filter((m) => !(m.weightMax !== undefined && m.weightMax !== null))
  const col = (row: unknown[], field: string) => {
    const m = plain.find((x) => x.field === field)
    return m ? row[m.column] : undefined
  }

  rows.forEach((row, idx) => {
    const line = firstLine + idx
    if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) return
    readLines++
    const errs: string[] = []
    const warn = (message: string) => push({ line, level: 'alerta', message })

    let cepStart: number | null = null
    let cepEnd: number | null = null
    const single = col(row, 'cep')
    const a = parseCepRange(col(row, 'cep_start') ?? single)
    const b = parseCepRange(col(row, 'cep_end') ?? single)
    if (a === 'invalido' || b === 'invalido') errs.push('CEP inválido.')
    else if (a && b) {
      cepStart = a.start
      cepEnd = b.end
      if (cepStart > cepEnd) errs.push(`CEP inicial ${formatCep(cepStart)} maior que o final ${formatCep(cepEnd)}.`)
    } else if (a || b) errs.push('Informe o CEP inicial e o final.')

    const ufRaw = text(col(row, 'uf'), 10)
    const uf = ufRaw ? normalizeUf(ufRaw) : null
    if (ufRaw && !uf) errs.push(`UF inválida: ${ufRaw}.`)
    const city = text(col(row, 'city'))
    if (cepStart === null && !uf && !city) errs.push('Linha sem destino (CEP, cidade ou UF).')
    if (city && !uf && cepStart === null) warn(`Cidade ${city} sem UF: pode coincidir com cidade de mesmo nome em outro estado.`)
    if (uf && cepStart !== null) {
      const ufA = ufByCep(String(cepStart).padStart(8, '0'))
      if (ufA && ufA !== uf) warn(`CEP ${formatCep(cepStart)} é de ${ufA}, mas a linha diz ${uf}.`)
    }

    const wMin = parseNumber(col(row, 'weight_min'))
    const wMax = parseNumber(col(row, 'weight_max'))
    if (Number.isNaN(wMin) || Number.isNaN(wMax)) errs.push('Peso inicial/final não é número.')
    else if ((wMin ?? 0) < 0 || (wMax !== null && wMax < 0)) errs.push('Peso negativo.')
    else if (wMax !== null && wMax < (wMin ?? 0)) errs.push(`Peso inicial ${wMin} maior que o final ${wMax}.`)

    const dl = parseNumber(col(row, 'deadline'))
    if (Number.isNaN(dl) || (dl !== null && (dl < 0 || dl > 365))) errs.push('Prazo inválido (dias entre 0 e 365).')

    const rRaw = col(row, 'restricted')
    const rNorm = normalizeHeader(rRaw)
    const restricted = YES.test(rNorm)
    if (rRaw !== undefined && !restricted && !NO.test(rNorm)) warn(`Restrição "${text(rRaw, 30)}" não reconhecida: considerada sem restrição (use Sim/Não).`)

    const shared: Record<string, number> = {}
    for (const m of plain.filter((x) => isVarField(x.field))) {
      const code = varCode(m.field)
      const v = parseNumber(row[m.column])
      if (v === null) continue
      if (Number.isNaN(v)) errs.push(`${labelOf(m.field)}: "${text(row[m.column], 30)}" não é número.`)
      else if (v < 0) errs.push(`${labelOf(m.field)} negativo.`)
      else if (PERCENT.has(code) && v > 100) errs.push(`${labelOf(m.field)} de ${v}% passa de 100%.`)
      else shared[code] = v
    }

    const base = {
      line,
      cepStart,
      cepEnd,
      uf,
      city,
      cityKey: cityKey(city),
      deadlineDays: dl === null || Number.isNaN(dl) ? null : Math.round(dl),
      restricted,
      note: text(col(row, 'note'), 300),
    }
    const out: ParsedRule[] = []
    if (bandCols.length) {
      for (const m of bandCols) {
        const v = parseNumber(row[m.column])
        if (v === null) continue
        if (Number.isNaN(v) || v < 0) {
          errs.push(`Faixa ${m.weightMin ?? 0}–${m.weightMax} kg: "${text(row[m.column], 30)}" não é valor válido.`)
          continue
        }
        out.push({ ...base, weightMin: m.weightMin ?? 0, weightMax: m.weightMax!, values: { ...shared, [varCode(m.field)]: v } })
      }
      if (!out.length && !restricted && !errs.length) errs.push('Nenhuma faixa de peso com valor.')
    } else {
      out.push({ ...base, weightMin: Number.isNaN(wMin) ? 0 : (wMin ?? 0), weightMax: Number.isNaN(wMax) ? null : wMax, values: shared })
      if (!Object.keys(shared).length && !restricted && !errs.length) errs.push('Linha sem nenhum valor (frete ou taxas).')
    }
    if (restricted && !out.length && !errs.length) out.push({ ...base, weightMin: 0, weightMax: null, values: shared })

    if (errs.length) {
      errorLines++
      for (const message of errs) push({ line, level: 'erro', message })
      return
    }
    rules.push(...out)
  })

  // Duplicidades: mesmo destino e mesma faixa de peso. Vale a primeira; as outras são rejeitadas.
  const seen = new Map<string, number>()
  const unique: ParsedRule[] = []
  const rejectedLines = new Set<number>()
  for (const r of rules) {
    const key = `${r.cepStart ?? ''}|${r.cepEnd ?? ''}|${r.uf ?? ''}|${r.cityKey ?? ''}|${r.weightMin}|${r.weightMax ?? ''}`
    const first = seen.get(key)
    if (first !== undefined) {
      if (!rejectedLines.has(r.line)) push({ line: r.line, level: 'erro', message: `Duplicada: mesmo destino e mesma faixa de peso da linha ${first}.` })
      rejectedLines.add(r.line)
      continue
    }
    seen.set(key, r.line)
    unique.push(r)
  }
  // Rejeita a linha inteira quando parte dela é duplicada (evita importar meia linha).
  const finalRules = unique.filter((r) => !rejectedLines.has(r.line))

  // Sobreposição de faixas de CEP diferentes na mesma faixa de peso: vale a mais estreita no cálculo, mas avisa.
  const withCep = finalRules.filter((r) => r.cepStart !== null).sort((x, y) => x.cepStart! - y.cepStart!)
  let overlaps = 0
  for (let i = 1; i < withCep.length && overlaps < 20; i++) {
    const prev = withCep[i - 1]!
    const cur = withCep[i]!
    if (cur.cepStart! <= prev.cepEnd! && (cur.cepStart !== prev.cepStart || cur.cepEnd !== prev.cepEnd) && cur.weightMin === prev.weightMin && cur.weightMax === prev.weightMax) {
      overlaps++
      push({ line: cur.line, level: 'alerta', message: `Faixa de CEP ${formatCep(cur.cepStart)}–${formatCep(cur.cepEnd)} cruza com a da linha ${prev.line}: no cálculo vale a mais estreita.` })
    }
  }

  if (finalRules.length > MAX_RULES) push({ line: 0, level: 'erro', message: `A planilha gera ${finalRules.length} regras; o limite por versão é ${MAX_RULES}.` })
  issues.sort((x, y) => x.line - y.line)
  return {
    rules: finalRules.length > MAX_RULES ? [] : finalRules,
    issues,
    issueCount,
    readLines,
    errorLines: errorLines + rejectedLines.size,
    importedLines: new Set(finalRules.map((r) => r.line)).size,
  }
}
