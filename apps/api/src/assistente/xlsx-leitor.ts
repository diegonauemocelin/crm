// Leitura de planilha Excel (.xlsx) sem biblioteca pesada: o .xlsx é um zip com XML (como no gerador de arquivos.ts).
import { strFromU8, unzipSync } from 'fflate'

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

/** Texto de um nó <si> ou <is> (junta os trechos <t> de texto formatado). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('')

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export interface SheetData {
  name: string
  /** rows[i] = número da linha (1 = cabeçalho) e as células por coluna. */
  rows: { rowNumber: number; cells: string[] }[]
}

/** Lê as abas da planilha. Erro claro quando o arquivo não é um .xlsx. */
export function readXlsx(buf: Uint8Array): SheetData[] {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('O arquivo não é um Excel (.xlsx) válido.')
  const files = unzipSync(buf)
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : null)
  const wb = get('xl/workbook.xml')
  if (!wb) throw new Error('O arquivo não é um Excel (.xlsx) válido.')
  const rels = get('xl/_rels/workbook.xml.rels') ?? ''
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]))
  // alguns arquivos trazem Target antes de Id
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) target.set(m[2]!, m[1]!)
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
  const sheets: SheetData[] = []
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1]!
    const name = decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? 'Planilha')
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1]
    let path = rid ? target.get(rid) : null
    if (!path) continue
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`
    const xml = get(path)
    if (!xml) continue
    const rows: SheetData['rows'] = []
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNumber = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? rows.length + 1)
      const cells: string[] = []
      for (const c of r[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = c[1]!
        const ref = /\br="([A-Z]+\d+)"/.exec(ca)?.[1]
        const t = /\bt="([^"]+)"/.exec(ca)?.[1]
        const inner = c[2] ?? ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        let value = ''
        if (t === 's') value = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') value = textOf(inner)
        else if (t === 'b') value = v === '1' ? 'VERDADEIRO' : 'FALSO'
        else value = v !== undefined ? decode(v) : ''
        cells[ref ? colIndex(ref) : cells.length] = value
      }
      rows.push({ rowNumber, cells: Array.from(cells, (x) => x ?? '') })
    }
    sheets.push({ name, rows })
  }
  if (!sheets.length) throw new Error('A planilha está vazia.')
  return sheets
}
