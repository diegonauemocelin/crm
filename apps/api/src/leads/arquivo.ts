/**
 * Leitura de planilhas enviadas pelo usuário: CSV/TSV em UTF-8, UTF-16 (o "Texto Unicode" do Excel) ou Windows-1252,
 * XLSX, e qualquer um deles compactado em gzip (o navegador compacta antes de enviar).
 */
import { gunzipSync } from 'node:zlib'
import { readSheet } from 'read-excel-file/node'

const MAX_UNCOMPRESSED = 60 * 1024 * 1024

export function isGzip(buf: Buffer) {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

export function isXlsx(buf: Buffer) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

/** Descompacta com limite de tamanho (proteção contra "zip bomb"). */
export function maybeGunzip(buf: Buffer): Buffer {
  if (!isGzip(buf)) return buf
  try {
    return gunzipSync(buf, { maxOutputLength: MAX_UNCOMPRESSED })
  } catch {
    throw new Error('Arquivo compactado inválido ou grande demais (limite de 60 MB descompactado).')
  }
}

export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(buf)
}

/** Descobre o separador pela primeira linha: tabulação, ponto e vírgula ou vírgula. */
export function detectDelimiter(text: string): string {
  const first = text.split('\n', 1)[0] ?? ''
  const counts: [string, number][] = [
    ['\t', (first.match(/\t/g) ?? []).length],
    [';', (first.match(/;/g) ?? []).length],
    [',', (first.match(/,/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/** Converte o arquivo em linhas de texto, descartando linhas totalmente vazias. */
export async function readTable(raw: Buffer): Promise<string[][]> {
  const buf = maybeGunzip(raw)
  let rows: string[][]
  if (isXlsx(buf)) {
    const data = await readSheet(buf)
    rows = data.map((r) => r.map(cellToString))
  } else {
    const text = decodeText(buf)
    rows = parseDelimited(text, detectDelimiter(text))
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}
