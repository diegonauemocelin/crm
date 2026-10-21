/**
 * Relatórios do Marketing Inteligente em Excel (.xlsx) e PDF, sem bibliotecas pesadas: o .xlsx é o XML do Office
 * compactado (fflate) e o PDF é escrito direto (fonte Helvetica, tabelas simples). Funções puras, testadas.
 */
import { zipSync, strToU8 } from 'fflate'
import type { ReportSection } from './config'
import type { MarketingService } from './marketing.service'

type Analysis = Awaited<ReturnType<MarketingService['analyze']>>
type Email = Awaited<ReturnType<MarketingService['email']>>
type Health = Awaited<ReturnType<MarketingService['health']>>

type Kind = 'brl' | 'int' | 'pct' | 'x' | 'num'
export interface Sheet {
  name: string
  header: string[]
  rows: (string | number | null)[][]
  note?: string
  /** Formato de cada coluna no PDF (no Excel vão os números puros). */
  colKinds?: (Kind | null)[]
  /** Formato por linha (tabela de indicadores: cada linha é uma medida diferente). */
  rowKinds?: Kind[]
}

const brl = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const x2 = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`)
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

type K = keyof Analysis['now']
const KPIS: [string, K, 'brl' | 'int' | 'pct' | 'x'][] = [
  ['Investimento em mídia', 'mediaCost', 'brl'],
  ['Custo total de marketing', 'totalCost', 'brl'],
  ['Leads gerados', 'leads', 'int'],
  ['Leads qualificados', 'qualified', 'int'],
  ['Oportunidades', 'opportunities', 'int'],
  ['Vendas', 'sales', 'int'],
  ['Vendas atribuídas ao marketing', 'mktSales', 'int'],
  ['Faturamento (Pré-Vendas)', 'revenue', 'brl'],
  ['Faturamento atribuído ao marketing', 'mktRevenue', 'brl'],
  ['Custo por lead', 'cpl', 'brl'],
  ['Custo por lead qualificado', 'cpql', 'brl'],
  ['CAC', 'cac', 'brl'],
  ['Conversão lead → venda (%)', 'conversionRate', 'pct'],
  ['ROAS de mídia', 'roas', 'x'],
  ['ROI estimado (%)', 'roi', 'pct'],
  ['Ticket médio', 'ticket', 'brl'],
  ['Leads atendidos (%)', 'attendedRate', 'pct'],
  ['Leads sem atendimento (%)', 'notAttendedRate', 'pct'],
  ['Oportunidades perdidas (%)', 'lostRate', 'pct'],
]

const BREAK: [ReportSection, string, keyof Analysis, string, boolean][] = [
  ['plataformas', 'Plataformas', 'byPlatform', 'Plataforma', true],
  ['campanhas', 'Campanhas', 'byCampaign', 'Campanha', true],
  ['vendedores', 'Vendedores', 'bySeller', 'Vendedor', false],
  ['regioes', 'Regiões', 'byRegion', 'Região', false],
  ['regioes', 'Estados', 'byState', 'Estado', false],
  ['marcas', 'Marcas', 'byBrand', 'Marca', false],
  ['categorias', 'Tipos de peça', 'byPartType', 'Tipo de peça', false],
  ['origens', 'Origens', 'byOrigin', 'Origem', false],
]

/** As tabelas do relatório (mesmo conteúdo para Excel e PDF), só das partes escolhidas. */
export function reportSheets(d: Analysis, sections: ReportSection[], email: Email | null, health: Health | null, aiSummary: string | null): Sheet[] {
  const has = (k: ReportSection) => sections.includes(k)
  const out: Sheet[] = []
  if (aiSummary && has('resumo_ia')) out.push({ name: 'Resumo', header: ['Resumo do período (gerado por IA a partir dos números agregados)'], rows: aiSummary.split('\n').filter(Boolean).map((l) => [l]) })
  if (has('kpis')) {
    out.push({
      name: 'Indicadores',
      header: ['Indicador', 'Período', 'Anterior', 'Variação (%)'],
      rows: KPIS.map(([label, k]) => [label, (d.now[k] as number | null) ?? null, (d.before[k] as number | null) ?? null, d.deltas[k] ?? null]),
      rowKinds: KPIS.map(([, , kind]) => kind),
      colKinds: [null, null, null, 'pct'],
      note: `ROI estimado com margem de ${d.rules.marginPct}%. Atribuição: ${d.rules.attribution.model === 'primeiro' ? 'primeiro toque' : 'último toque'}, janela de ${d.rules.attribution.windowDays} dias.`,
    })
  }
  for (const [sec, name, key, label, cost] of BREAK) {
    if (!has(sec)) continue
    const rows = d[key] as Analysis['byCampaign']
    out.push({
      name,
      header: [label, ...(cost ? ['Investido', 'Cliques'] : []), 'Leads', 'Qualificados', 'Vendas', 'Faturamento', 'Conversão (%)', ...(cost ? ['CPL', 'ROAS'] : [])],
      rows: rows.map((r) => [r.name, ...(cost ? [r.mediaCost, r.clicks] : []), r.leads, r.qualified, r.sales, r.revenue, r.conversionRate, ...(cost ? [r.cpl, r.roas] : [])]),
      colKinds: [null, ...(cost ? (['brl', 'int'] as Kind[]) : []), 'int', 'int', 'int', 'brl', 'pct', ...(cost ? (['brl', 'x'] as Kind[]) : [])],
    })
  }
  if (has('funil')) out.push({ name: 'Funil', header: ['Etapa', 'Volume', 'Passagem (%)'], rows: [...d.funnel.steps.map((s) => [s.label, s.value, s.rate]), ['Faturamento', d.funnel.revenue, null]], rowKinds: [...d.funnel.steps.map((): Kind => 'int'), 'brl'], colKinds: [null, null, 'pct'] })
  if (has('email') && email) out.push({ name: 'E-mail', header: ['Campanha', 'Enviados', 'Abertura registrada (%)', 'Cliques (%)', 'Descadastros (%)', 'Vendas', 'Faturamento'], rows: email.campaigns.map((c) => [c.name, c.sent, c.openRate, c.clickRate, c.unsubRate, c.orders, c.revenue]), colKinds: [null, 'int', 'pct', 'pct', 'pct', 'int', 'brl'], note: 'Abertura registrada pode ser maior que a real (privacidade do Apple Mail).' })
  if (has('recomendacoes')) out.push({ name: 'Recomendações', header: ['Prioridade', 'Confiança', 'Problema', 'Evidência', 'Ação sugerida', 'Como medir', 'Fonte'], rows: d.recommendations.map((r) => [r.priority, r.confidence, r.problem, r.evidence.join(' · '), r.action, r.validate, r.source]) })
  if (has('saude') && health) out.push({ name: 'Saúde dos dados', header: ['Fonte', 'Situação', 'Última atualização', 'Detalhe'], rows: health.sources.map((s) => [s.name, s.status, s.lastAt ? new Date(s.lastAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null, s.detail]) })
  return out
}

// ---------- Excel (.xlsx) ----------

const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
const sheetName = (s: string, used: Set<string>) => {
  let base = s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha'
  for (let i = 2; used.has(base); i++) base = `${base.slice(0, 28)} ${i}`
  used.add(base)
  return base
}

export function toXlsx(sheets: Sheet[], title: string): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s) => sheetName(s.name, used))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Marketing Inteligente</dc:creator></cp:coreProperties>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // Estilo 1 = cabeçalho em negrito.
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  }
  sheets.forEach((s, i) => {
    const rows = [s.header, ...s.rows, ...(s.note ? [[], [s.note]] : [])]
    const body = rows
      .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, `${colName(ci)}${ri + 1}`, ri === 0)).join('')}</row>`)
      .join('')
    const widths = s.header.map((h, ci) => Math.min(60, Math.max(10, h.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[ci] ?? '').length + 2))))
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`,
    )
  })
  return zipSync(files, { level: 6 })
}

function cell(v: string | number | null | undefined, ref: string, header: boolean) {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${header ? ' s="1"' : ''}><v>${v}</v></c>`
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(v)).slice(0, 32000)}</t></is></c>`
}

// ---------- PDF ----------

/** Caracteres fora do Latin-1 que a fonte padrão do PDF (WinAnsi) tem em outra posição. */
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }
const REPLACE: Record<string, string> = { '→': '->', '▲': '+', '▼': '-', '·': '·', '≈': '~', '×': 'x', '÷': '/', '✅': '', '⚠': '!', '❌': 'x', '⏸': '' }
function pdfText(s: string) {
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const r = REPLACE[ch]
    const c = r !== undefined ? r : ch
    for (const x of c) {
      const code = x.charCodeAt(0)
      const b = WIN[x] ?? (code < 256 ? code : 63)
      out += b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 32 ? ' ' : String.fromCharCode(b)
    }
  }
  return out
}
/** Largura aproximada do texto em Helvetica (média por caractere), para cortar o que não cabe na coluna. */
const textWidth = (s: string, size: number) => [...s].reduce((w, c) => w + (/[ilI.,:;'|!]/.test(c) ? 0.28 : /[mwMW@%]/.test(c) ? 0.85 : /[A-Z0-9]/.test(c) ? 0.66 : 0.52), 0) * size
function fit(s: string, width: number, size: number) {
  if (textWidth(s, size) <= width) return s
  let t = s
  while (t.length > 1 && textWidth(`${t}…`, size) > width) t = t.slice(0, -1)
  return `${t}…`
}

export interface PdfDoc {
  title: string
  subtitle: string
  sheets: Sheet[]
  footer: string
  color?: string
}

const FMT: Record<Kind, (n: number) => string> = { brl: (n) => brl(n), int: (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), pct: (n) => pct(n), x: (n) => x2(n), num: (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) }
const fmtCell = (v: string | number | null, s: Sheet, col: number, row: number) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  const kind = s.colKinds?.[col] ?? s.rowKinds?.[row] ?? 'num'
  return FMT[kind](v)
}

/** PDF A4 retrato com título, tabelas (quebra de página automática) e rodapé com as fontes. */
export function toPdf(doc: PdfDoc): Uint8Array {
  const W = 595
  const H = 842
  const M = 36
  const pages: string[] = []
  let ops: string[] = []
  let y = H - M
  const rgb = (hex: string) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ['', '1d', '4e', 'd8']
    return [m[1], m[2], m[3]].map((h) => (parseInt(h!, 16) / 255).toFixed(3)).join(' ')
  }
  const brand = rgb(doc.color ?? '#1d4ed8')
  const text = (s: string, x: number, yy: number, size: number, bold = false, color = '0 0 0') => ops.push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfText(s)}) Tj ET`)
  const newPage = () => {
    if (ops.length) pages.push(ops.join('\n'))
    ops = []
    y = H - M
  }
  const need = (h: number) => {
    if (y - h < M + 20) newPage()
  }
  const wrap = (s: string, width: number, size: number) => {
    const words = s.split(/\s+/)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (textWidth(next, size) > width && cur) {
        lines.push(cur)
        cur = w
      } else cur = next
    }
    if (cur) lines.push(cur)
    return lines
  }
  text('MARKETING INTELIGENTE', M, y, 8, true, brand)
  y -= 18
  for (const l of wrap(doc.title, W - 2 * M, 16)) {
    text(l, M, y, 16, true)
    y -= 20
  }
  for (const l of wrap(doc.subtitle, W - 2 * M, 8.5)) {
    text(l, M, y, 8.5, false, '0.4 0.4 0.45')
    y -= 12
  }
  y -= 6
  for (const s of doc.sheets) {
    need(60)
    text(s.name, M, y, 12, true, brand)
    y -= 16
    const cols = s.header.length
    const avail = W - 2 * M
    // A 1ª coluna (nomes) fica com mais espaço; as numéricas dividem o resto.
    const first = cols === 1 ? avail : Math.max(avail * 0.34, avail - (cols - 1) * 62)
    const rest = cols > 1 ? (avail - first) / (cols - 1) : 0
    const widths = s.header.map((_, i) => (i === 0 ? first : rest))
    const size = cols > 7 ? 6.5 : 7.5
    const row = (cells: string[], bold: boolean) => {
      // Texto longo (recomendações) quebra em linhas; tabelas numéricas cortam com reticências.
      const wrapped = cells.map((c, i) => (cols <= 2 || (cols >= 7 && i >= 2 && !bold) ? wrap(c, widths[i]! - 4, size).slice(0, 6) : [fit(c, widths[i]! - 4, size)]))
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 2.5) + 3
      need(h)
      let x = M
      wrapped.forEach((lines, i) => {
        const right = i > 0 && !bold && cols > 2 && /^[\d.,R$%x\s—-]+$/.test(cells[i] ?? '') && !(cols >= 7)
        lines.forEach((ln, li) => text(ln, right ? x + widths[i]! - 2 - textWidth(ln, size) : x + 2, y - (li + 1) * (size + 2.5) + 2, size, bold))
        x += widths[i]!
      })
      y -= h
      ops.push(`0.88 0.89 0.92 RG 0.4 w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S`)
    }
    row(s.header, true)
    s.rows.slice(0, 400).forEach((r, ri) => row(r.map((v, i) => fmtCell(v, s, i, ri)), false))
    if (s.rows.length > 400) {
      need(14)
      text(`E mais ${s.rows.length - 400} linha(s): baixe o Excel para ver tudo.`, M, y - 10, 7.5, false, '0.4 0.4 0.45')
      y -= 14
    }
    if (s.note) {
      for (const l of wrap(s.note, W - 2 * M, 7.5)) {
        need(11)
        text(l, M, y - 10, 7.5, false, '0.4 0.4 0.45')
        y -= 11
      }
    }
    y -= 14
  }
  newPage()
  // Monta o arquivo: catálogo, páginas, fontes padrão (Helvetica) e o conteúdo de cada página.
  const objs: string[] = []
  const add = (s: string) => objs.push(s) // número do objeto = índice + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // páginas, preenchido depois
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  pages.forEach((content, i) => {
    const footer = `BT 0.55 0.55 0.6 rg /F1 6.5 Tf ${M} 20 Td (${pdfText(`${doc.footer} · página ${i + 1} de ${pages.length}`)}) Tj ET`
    const stream = `${content}\n${footer}`
    add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    const contentId = objs.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`)
    kids.push(objs.length)
  })
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

export const periodLabel = (from: string, to: string) => (from === to ? day(from) : `${day(from)} a ${day(to)}`)
