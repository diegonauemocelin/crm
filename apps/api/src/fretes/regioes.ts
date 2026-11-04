// Planilha "Regiões" do sistema de frete da transportadora: código da região (PR1, SC3...), descrição, cidades pelo
// código do IBGE, prazo (dias úteis ou corridos) e os dias da semana com entrega. A tabela de preço por região usa
// o código; aqui só a leitura, sem banco e sem rede (test/fretes-regioes.spec.ts).

import { normalizeHeader } from './importacao'
import { cityKey } from './cep'
import { IBGE_MUNICIPIOS } from './ibge-municipios'

/** Os 2 primeiros dígitos do código IBGE do município são o estado. */
const IBGE_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
export const ufByIbge = (ibge: string) => IBGE_UF[ibge.slice(0, 2)] ?? null

let ibgeIndex: Map<string, string> | null = null
/** Código do IBGE pela cidade e UF (nome sem acento, maiúsculas ou minúsculas). Null quando não é município (ex.: bairro). */
export function ibgeByCity(uf: string, city: string): string | null {
  if (!ibgeIndex) {
    ibgeIndex = new Map()
    for (const [code, name] of Object.entries(IBGE_MUNICIPIOS)) {
      const k = cityKey(name)
      const u = ufByIbge(code)
      if (k && u) {
        ibgeIndex.set(`${u}|${k}`, code)
        // Também sem espaços e apóstrofos ("Dias d'Ávila" = "DIAS D AVILA" = "DIASDAVILA").
        ibgeIndex.set(`${u}|#${k.replace(/[^a-z0-9]/g, '')}`, code)
      }
    }
  }
  const k = cityKey(city)
  if (!k) return null
  return ibgeIndex.get(`${uf}|${k}`) ?? ibgeIndex.get(`${uf}|#${k.replace(/[^a-z0-9]/g, '')}`) ?? null
}

/**
 * Tabela HTML (como o "Baixar cidades atendidas" do site da transportadora, que devolve um .xls em HTML) → linhas e
 * colunas de texto, para ler com as mesmas regras das planilhas.
 */
export function htmlTableRows(html: string): string[][] {
  const decode = (t: string) =>
    t
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, ' ')
      .trim()
  const rows: string[][] = []
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1] ?? ''))
    if (cells.length) rows.push(cells)
  }
  return rows
}

const WEEKDAYS: [RegExp, string][] = [
  [/^seg/, 'SEG'],
  [/^ter/, 'TER'],
  [/^qua/, 'QUA'],
  [/^qui/, 'QUI'],
  [/^sex/, 'SEX'],
  [/^sab/, 'SAB'],
  [/^dom/, 'DOM'],
]

export interface ParsedRegion {
  code: string
  ibge: string | null
  city: string
  cityKey: string
  uf: string
  deadlineDays: number | null
  businessDays: boolean
  weekdays: string[]
  /** Lista de cidades atendidas (formato com a base responsável): coleta na cidade, contato da base e observações. */
  pickup?: boolean | null
  contact?: string | null
  note?: string | null
}

/** Aba com os nomes das cidades pelo código do IBGE (Nome_UF, Nome_Municipio, Código Município Completo). */
export function parseIbgeSheet(rows: unknown[][]): Map<string, string> | null {
  const h = (rows[0] ?? []).map(normalizeHeader)
  const cName = h.findIndex((x) => /municipio|cidade/.test(x) && !/codigo/.test(x))
  const cCode = h.findIndex((x) => /codigo|ibge/.test(x))
  if (cName < 0 || cCode < 0) return null
  const map = new Map<string, string>()
  for (const r of rows.slice(1)) {
    const code = String(r?.[cCode] ?? '').replace(/\D/g, '')
    const name = String(r?.[cName] ?? '').trim()
    if (code.length === 7 && name) map.set(code, name)
  }
  return map.size ? map : null
}

/** É a planilha de regiões? (cabeçalho com Código, Cidades e Prazo). */
export function regionHeaderIndex(rows: unknown[][]) {
  return rows.slice(0, 10).findIndex((r) => {
    const h = (r ?? []).map(normalizeHeader)
    return h.some((x) => x === 'codigo' || x === 'regiao' || x === 'codigo regiao') && h.some((x) => /^cidades?$|ibge/.test(x)) && h.some((x) => /prazo/.test(x))
  })
}

/** Lista de cidades atendidas com a base responsável (Cidade, Estado/UF e Base), como a do site da transportadora. */
export function baseListHeaderIndex(rows: unknown[][]) {
  return rows.slice(0, 15).findIndex((r) => {
    const h = (r ?? []).map(normalizeHeader)
    return h.some((x) => /^(cidade|municipio)$/.test(x)) && h.some((x) => /^(estado|uf)$/.test(x)) && h.some((x) => /^base|unidade (responsavel|de entrega)|filial responsavel/.test(x))
  })
}

const UF_SUFFIX = /\s*[-/(]\s*([A-Za-z]{2})\s*\)?\s*$/

/**
 * Lê a lista de cidades atendidas no formato "Cidade, Estado, Base responsável, Endereço, Responsável, Telefone, Coleta,
 * Observações": a base responsável vira o código da região (a unidade que faz a entrega). Sem prazo nesse formato.
 */
export function parseBaseList(rows: unknown[][]) {
  const hi = baseListHeaderIndex(rows)
  if (hi < 0) return null
  const h = rows[hi]!.map(normalizeHeader)
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cCity = col(/^(cidade|municipio)$/)
  const cUf = col(/^(estado|uf)$/)
  const cBase = col(/^base|unidade (responsavel|de entrega)|filial responsavel/)
  const cIbge = col(/ibge/)
  const cAddr = col(/^endereco/)
  const cWho = col(/^responsavel|^contato/)
  const cPhone = col(/^telefone|^fone/)
  const cPick = col(/^coleta/)
  const cNote = col(/^obs/)
  const cDays = col(/prazo/)
  const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
  const out: ParsedRegion[] = []
  let invalid = 0
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const uf = str(r, cUf).toUpperCase().slice(0, 2)
    // "Paraíso - TO" e "ANAPOLIS  (GO)": o estado no nome sai.
    const city = str(r, cCity).replace(UF_SUFFIX, (m, x: string) => (x.toUpperCase() === uf ? '' : m)).replace(/\s+/g, ' ').trim()
    const key = cityKey(city)
    const base = str(r, cBase).replace(/\s+/g, ' ').toUpperCase().slice(0, 40)
    if (!city || !key || !/^[A-Z]{2}$/.test(uf) || !base) {
      invalid++
      continue
    }
    const ibgeRaw = str(r, cIbge).replace(/\D/g, '')
    // Sem a coluna do IBGE (ou com o código interno da transportadora): o código vem do nome da cidade e da UF.
    const ibge = ibgeRaw.length === 7 && ufByIbge(ibgeRaw) === uf ? ibgeRaw : (ibgeByCity(uf, city) ?? '')
    const days = Number(str(r, cDays).replace(',', '.'))
    const pick = normalizeHeader(str(r, cPick))
    const contact = [str(r, cAddr), str(r, cWho), str(r, cPhone)].filter(Boolean).join(' · ').slice(0, 300)
    out.push({
      code: base,
      ibge: ibge.length === 7 ? ibge : null,
      city: city.slice(0, 120),
      cityKey: key,
      uf,
      deadlineDays: str(r, cDays) !== '' && Number.isFinite(days) && days >= 0 && days <= 365 ? Math.round(days) : null,
      businessDays: true,
      weekdays: [],
      pickup: pick ? /^(s|sim|x|1)/.test(pick) : null,
      contact: contact || null,
      note: str(r, cNote).slice(0, 500) || null,
    })
  }
  return { regions: out, invalid }
}

/**
 * Lê a aba de regiões. Uma linha pode ter várias cidades ("4100103,4100400"): vira uma região por cidade. O nome da
 * cidade vem da aba do IBGE quando há; sem ela, da descrição (que é o nome da cidade quando a linha tem uma só).
 */
export function parseRegionsSheet(rows: unknown[][], ibgeNames?: Map<string, string> | null) {
  const hi = regionHeaderIndex(rows)
  if (hi < 0) return parseBaseList(rows)
  const h = rows[hi]!.map(normalizeHeader)
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cCode = col(/^(codigo|regiao|codigo regiao)$/)
  const cDesc = col(/^descricao|^nome/)
  const cCities = col(/^cidades?$|ibge/)
  const cDays = col(/prazo/)
  const cKind = col(/^tipo/)
  const dayCols = WEEKDAYS.map(([re, d]) => [h.findIndex((x) => re.test(x)), d] as const).filter(([i]) => i >= 0)
  const out: ParsedRegion[] = []
  let invalid = 0
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const code = String(r[cCode] ?? '').trim().toUpperCase().slice(0, 40)
    const ibges = String(r[cCities] ?? '')
      .split(/[,;\s]+/)
      .map((x) => x.replace(/\D/g, ''))
      .filter((x) => x.length === 7)
    const desc = cDesc >= 0 ? String(r[cDesc] ?? '').trim() : ''
    const days = Number(String(r[cDays] ?? '').replace(',', '.'))
    const kind = cKind >= 0 ? normalizeHeader(r[cKind]) : ''
    const weekdays = dayCols.filter(([i]) => /^(x|s|sim|1)$/i.test(String(r[i] ?? '').trim())).map(([, d]) => d)
    if (!code || !ibges.length) {
      invalid++
      continue
    }
    for (const ibge of ibges) {
      const uf = ufByIbge(ibge)
      const city = ibgeNames?.get(ibge) ?? (ibges.length === 1 ? desc : '')
      const key = cityKey(city)
      if (!uf || !city || !key) {
        invalid++
        continue
      }
      out.push({
        code,
        ibge,
        city: city.slice(0, 120),
        cityKey: key,
        uf,
        deadlineDays: Number.isFinite(days) && days >= 0 && days <= 365 && String(r[cDays] ?? '').trim() !== '' ? Math.round(days) : null,
        businessDays: !/^c/.test(kind),
        weekdays,
      })
    }
  }
  return { regions: out, invalid }
}
