/**
 * Relatórios do Marketing Inteligente em Excel (.xlsx) e PDF, sem bibliotecas pesadas: o .xlsx é o XML do Office
 * compactado (fflate) e o PDF é escrito direto (fonte Helvetica, tabelas simples). Funções puras, testadas.
 */
import { zipSync, strToU8 } from 'fflate'
import type { ReportSection } from './config'
import type { PdfImage } from './pdf-imagem'
import type { MarketingService } from './marketing.service'
import type { MarketplacesService } from '../marketplaces/marketplaces.service'

type Analysis = Awaited<ReturnType<MarketingService['analyze']>>
type Email = Awaited<ReturnType<MarketingService['email']>>
type Health = Awaited<ReturnType<MarketingService['health']>>
export type Store = Awaited<ReturnType<MarketingService['store']>>
/** Painel do Mercado Livre Ads (Marketplaces). */
export type MlAds = Awaited<ReturnType<MarketplacesService['mercadoLivre']>>

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
  /** text = texto corrido (resumo da IA), sem tabela. */
  kind?: 'text'
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

/** Cartões do topo do PDF: os seis números que a diretoria olha primeiro. */
export function pdfCards(d: Analysis) {
  const n = (k: K) => (d.now[k] as number | null) ?? null
  const card = (label: string, k: K, kind: Kind, goodUp = true) => ({ label, value: n(k) === null ? '—' : FMT[kind](n(k)!), delta: d.deltas[k] ?? null, goodUp })
  return [card('Investimento em mídia', 'mediaCost', 'brl', false), card('Leads gerados', 'leads', 'int'), card('Vendas', 'sales', 'int'), card('Faturamento', 'revenue', 'brl'), card('Custo por lead', 'cpl', 'brl', false), card('ROAS de mídia', 'roas', 'x')]
}

/** As tabelas do relatório (mesmo conteúdo para Excel e PDF), só das partes escolhidas. */
export function reportSheets(d: Analysis, sections: ReportSection[], email: Email | null, health: Health | null, aiSummary: string | null, store: Store | null = null, ml: MlAds | null = null): Sheet[] {
  const has = (k: ReportSection) => sections.includes(k)
  const out: Sheet[] = []
  if (aiSummary && has('resumo_ia')) out.push({ name: 'Resumo do período', kind: 'text', header: ['Resumo do período (gerado por IA a partir dos números agregados)'], rows: aiSummary.split('\n').filter(Boolean).map((l) => [l]), note: 'Texto gerado pela IA a partir dos números agregados do período. Confira os números nas tabelas.' })
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
  if (has('loja') && store) out.push(...storeSheets(store))
  if (has('mercado_livre') && ml) out.push(...mlSheets(ml))
  if (has('recomendacoes')) out.push({ name: 'Recomendações', header: ['Prioridade', 'Confiança', 'Problema', 'Evidência', 'Ação sugerida', 'Como medir', 'Fonte'], rows: d.recommendations.map((r) => [r.priority, r.confidence, r.problem, r.evidence.join(' · '), r.action, r.validate, r.source]) })
  if (has('saude') && health) out.push({ name: 'Saúde dos dados', header: ['Fonte', 'Situação', 'Última atualização', 'Detalhe'], rows: health.sources.map((s) => [s.name, s.status, s.lastAt ? new Date(s.lastAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null, s.detail]) })
  return out
}

/** Mercado Livre Ads: resumo contra o período anterior, campanhas de Product Ads e de Display (as 15 com mais investimento). */
export function mlSheets(ml: MlAds): Sheet[] {
  const a = ml.totals.all
  const none = !a.cost && !a.revenue && !a.clicks
  const note = none
    ? ml.config.connected
      ? 'Sem investimento no Mercado Livre Ads no período.'
      : 'Mercado Livre não conectado (Configurações › Marketplaces): sem dados de publicidade.'
    : 'Receita atribuída pelo Mercado Livre aos anúncios (até 14 dias depois do clique). ROAS = receita ÷ investimento; ACOS = investimento ÷ receita.'
  const row = (label: string, k: 'cost' | 'revenue' | 'roas' | 'acos' | 'clicks' | 'impressions' | 'cpc' | 'units', dk?: keyof typeof a.delta) => [label, a[k], a.before[k], dk ? a.delta[dk] : null]
  const camp = (list: MlAds['campaigns']) =>
    list
      .filter((c) => c.cost || c.revenue)
      .slice(0, 15)
      .map((c) => [c.name, c.status ?? '—', c.cost, c.revenue, c.roas, c.acos, c.clicks, c.units])
  const header = ['Campanha', 'Situação', 'Investimento', 'Receita atribuída', 'ROAS', 'ACOS (%)', 'Cliques', 'Vendas (un.)']
  const kinds: (Kind | null)[] = [null, null, 'brl', 'brl', 'x', 'pct', 'int', 'int']
  const out: Sheet[] = [
    {
      name: 'Mercado Livre Ads',
      header: ['Indicador', 'Período', 'Anterior', 'Variação (%)'],
      rows: [
        row('Investimento', 'cost', 'cost'),
        row('Receita atribuída', 'revenue', 'revenue'),
        row('ROAS', 'roas', 'roas'),
        row('ACOS (%)', 'acos', 'acos'),
        row('Cliques', 'clicks', 'clicks'),
        row('Impressões', 'impressions', 'impressions'),
        row('CPC', 'cpc', 'cpc'),
        row('Vendas pelos anúncios (un.)', 'units'),
      ],
      rowKinds: ['brl', 'brl', 'x', 'pct', 'int', 'int', 'brl', 'int'],
      colKinds: [null, null, null, 'pct'],
      note,
    },
  ]
  const pads = camp(ml.campaigns)
  if (pads.length) out.push({ name: 'ML Ads: campanhas', header, rows: pads, colKinds: kinds })
  const display = camp(ml.display)
  if (display.length) out.push({ name: 'ML Ads: Display', header, rows: display, colKinds: kinds })
  return out
}

/** Loja virtual (Magazord): resumo, valor por canal de venda e produtos mais vendidos. */
export function storeSheets(st: Store): Sheet[] {
  const pending = st.pendingItems ? `${st.pendingItems} pedido(s) do período ainda sem os itens lidos da Magazord: os mais vendidos ficam completos quando a leitura terminar.` : undefined
  return [
    {
      name: 'Loja virtual',
      header: ['Indicador', 'Período', 'Anterior', 'Variação (%)'],
      rows: [
        ['Vendas (pedidos pagos)', st.now.orders, st.before.orders, st.deltas.orders],
        ['Faturamento', st.now.revenue, st.before.revenue, st.deltas.revenue],
        ['Ticket médio', st.now.ticket, st.before.ticket, st.deltas.ticket],
        ['Pedidos pendentes', st.now.pending, st.before.pending, null],
        ['Pedidos cancelados', st.now.canceled, st.before.canceled, null],
      ],
      rowKinds: ['int', 'brl', 'brl', 'int', 'int'],
      colKinds: [null, null, null, 'pct'],
      note: 'Pedidos da Magazord; vendas e faturamento só dos pagos (aprovado, faturado, enviado ou entregue).',
    },
    { name: 'Canais de venda', header: ['Canal', 'Vendas', 'Faturamento', 'Participação (%)'], rows: st.channels.map((c) => [c.name, c.orders, c.revenue, c.share]), colKinds: [null, 'int', 'brl', 'pct'] },
    { name: 'Produtos mais vendidos', header: ['Produto', 'Código', 'Quantidade', 'Pedidos', 'Faturamento'], rows: st.products.map((p) => [p.name, p.sku ?? '—', p.quantity, p.orders, p.revenue]), colKinds: [null, null, 'int', 'int', 'brl'], note: pending },
  ]
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
  /** Nome da empresa (vai no cabeçalho quando não há logo). */
  brandName?: string
  /** Logo da empresa (Configurações › Marca), já preparado para o PDF. */
  logo?: PdfImage | null
  /** Linha com os dados da empresa no rodapé (site, telefone, endereço). */
  info?: string
  /** Cartões com os números principais, no topo da primeira página. */
  cards?: { label: string; value: string; delta: number | null; goodUp: boolean }[]
}

const FMT: Record<Kind, (n: number) => string> = { brl: (n) => brl(n), int: (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), pct: (n) => pct(n), x: (n) => x2(n), num: (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) }
const fmtCell = (v: string | number | null, s: Sheet, col: number, row: number) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  const kind = s.colKinds?.[col] ?? s.rowKinds?.[row] ?? 'num'
  return FMT[kind](v)
}

const hexRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ['', '1d', '4e', 'd8']
  return [m[1], m[2], m[3]].map((h) => parseInt(h!, 16) / 255)
}
const rgbOp = (c: number[]) => c.map((v) => v.toFixed(3)).join(' ')
/** Cor da marca clareada (mistura com branco): fundo dos cartões e do resumo. */
const tint = (c: number[], white: number) => c.map((v) => v + (1 - v) * white)

/**
 * PDF A4 retrato no padrão da marca: faixa na cor da empresa com o logo, cartões dos números principais, títulos
 * com marcador, tabelas com cabeçalho colorido e linhas alternadas, resumo em quadro e rodapé com os dados da empresa.
 */
export function toPdf(doc: PdfDoc): Uint8Array {
  const W = 595
  const H = 842
  const M = 36
  const BOTTOM = 56
  const pages: string[] = []
  let ops: string[] = []
  let y = H - M
  const brandC = hexRgb(doc.color ?? '#1d4ed8')
  const brand = rgbOp(brandC)
  const light = rgbOp(tint(brandC, 0.92))
  const GRAY = '0.42 0.44 0.48'
  const DARK = '0.12 0.14 0.18'
  const WHITE = '1 1 1'
  const text = (s: string, x: number, yy: number, size: number, bold = false, color = DARK) => ops.push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfText(s)}) Tj ET`)
  const rect = (x: number, yy: number, w: number, h: number, color: string) => ops.push(`${color} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`)
  const newPage = () => {
    if (ops.length) pages.push(ops.join('\n'))
    ops = []
    // Páginas seguintes: filete na cor da marca e o nome do relatório.
    rect(0, H - 5, W, 5, brand)
    text(fit(`${doc.brandName ? `${doc.brandName} · ` : ''}${doc.title}`, W - 2 * M, 7.5), M, H - 22, 7.5, false, GRAY)
    y = H - 38
  }
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage()
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

  // ---- Cabeçalho da primeira página ----
  const bandH = 92
  rect(0, H - bandH, W, bandH, brand)
  const boxW = 150
  const boxH = 60
  const boxY = H - bandH + (bandH - boxH) / 2
  if (doc.logo) {
    rect(M, boxY, boxW, boxH, WHITE)
    const scale = Math.min((boxW - 16) / doc.logo.width, (boxH - 12) / doc.logo.height)
    const w = doc.logo.width * scale
    const h = doc.logo.height * scale
    ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(M + (boxW - w) / 2).toFixed(2)} ${(boxY + (boxH - h) / 2).toFixed(2)} cm /Im1 Do Q`)
  } else if (doc.brandName) {
    for (const [i, l] of wrap(doc.brandName, boxW, 15).slice(0, 2).entries()) text(l, M, H - 44 - i * 18, 15, true, WHITE)
  }
  const rightX = M + boxW + 24
  const rightW = W - M - rightX
  text('MARKETING INTELIGENTE', rightX, H - 30, 7.5, true, rgbOp(tint(brandC, 0.75)))
  const titleLines = wrap(doc.title, rightW, 17).slice(0, 2)
  titleLines.forEach((l, i) => text(l, rightX, H - 52 - i * 20, 17, true, WHITE))
  y = H - bandH - 18
  for (const l of wrap(doc.subtitle, W - 2 * M, 8)) {
    text(l, M, y, 8, false, GRAY)
    y -= 11
  }
  y -= 8

  // ---- Cartões dos números principais ----
  if (doc.cards?.length) {
    const cols = 3
    const gap = 10
    const cw = (W - 2 * M - gap * (cols - 1)) / cols
    const ch = 54
    doc.cards.slice(0, 6).forEach((c, i) => {
      const col = i % cols
      if (col === 0) {
        need(ch + gap)
        if (i) y -= gap
      }
      const x = M + col * (cw + gap)
      const top = y
      rect(x, top - ch, cw, ch, light)
      rect(x, top - ch, 3, ch, brand)
      text(fit(c.label.toUpperCase(), cw - 16, 6.8), x + 10, top - 14, 6.8, true, GRAY)
      text(fit(c.value, cw - 16, 14), x + 10, top - 33, 14, true, DARK)
      if (c.delta !== null) {
        const good = c.delta === 0 ? null : (c.delta > 0) === c.goodUp
        const color = good === null ? GRAY : good ? '0.08 0.50 0.24' : '0.73 0.11 0.11'
        text(`${c.delta > 0 ? '+' : c.delta < 0 ? '-' : '='} ${Math.abs(c.delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. anterior`, x + 10, top - 46, 7, false, color)
      } else text('sem comparação', x + 10, top - 46, 7, false, GRAY)
      if (col === cols - 1 || i === Math.min(5, doc.cards!.length - 1)) y -= ch
    })
    y -= 18
  }

  // ---- Seções ----
  const sectionTitle = (name: string) => {
    need(56)
    rect(M, y - 11, 3.5, 13, brand)
    text(name, M + 10, y - 9, 11.5, true, DARK)
    y -= 22
  }
  for (const s of doc.sheets) {
    sectionTitle(s.name)
    if (s.kind === 'text') {
      // Texto corrido (resumo da IA): quadro claro com a barra da marca; "Próximos passos" em negrito.
      const size = 8.5
      const lh = size + 4
      const lines: { t: string; bold: boolean; indent: number }[] = []
      for (const r of s.rows) {
        const raw = String(r[0] ?? '').trim()
        if (!raw) continue
        const bullet = /^[-•*]\s*/.test(raw)
        const t = raw.replace(/^[-•*]\s*/, '')
        const bold = /^(próximos passos|pontos de atenção|destaques)\b/i.test(t) || /:$/.test(t)
        wrap(t, W - 2 * M - 30, size).forEach((l, i) => lines.push({ t: bullet && i === 0 ? `• ${l}` : l, bold, indent: bullet && i > 0 ? 8 : 0 }))
      }
      need(lh + 12)
      rect(M, y - 6, W - 2 * M, 6, light)
      y -= 6
      for (const l of lines) {
        if (y - lh < BOTTOM) {
          newPage()
          rect(M, y - 6, W - 2 * M, 6, light)
          y -= 6
        }
        rect(M, y - lh, W - 2 * M, lh, light)
        rect(M, y - lh, 3, lh, brand)
        text(l.t, M + 14 + l.indent, y - lh + 3.5, size, l.bold, DARK)
        y -= lh
      }
      rect(M, y - 8, W - 2 * M, 8, light)
      rect(M, y - 8, 3, 8, brand)
      y -= 8
      if (s.note) {
        for (const l of wrap(s.note, W - 2 * M, 7)) {
          need(10)
          text(l, M, y - 9, 7, false, GRAY)
          y -= 10
        }
      }
      y -= 16
      continue
    }
    const cols = s.header.length
    const avail = W - 2 * M
    // A 1ª coluna (nomes) fica com mais espaço; as numéricas dividem o resto.
    const first = cols === 1 ? avail : cols >= 9 ? avail * 0.25 : Math.max(avail * 0.34, avail - (cols - 1) * 80)
    const rest = cols > 1 ? (avail - first) / (cols - 1) : 0
    const widths = s.header.map((_, i) => (i === 0 ? first : rest))
    const size = cols > 7 ? 6.5 : 7.5
    const row = (cells: string[], header: boolean, zebra: boolean) => {
      // Texto longo (recomendações) quebra em linhas; tabelas numéricas cortam com reticências.
      const pad = cols >= 9 ? 2.5 : 4
      const wrapped = cells.map((c, i) => (cols <= 2 || (cols >= 7 && i >= 2 && !header) ? wrap(c, widths[i]! - pad * 2, size).slice(0, 6) : [fit(c, widths[i]! - pad * 2, size)]))
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 2.5) + 6
      need(h + (header ? 16 : 0))
      if (header) rect(M, y - h, avail, h, brand)
      else if (zebra) rect(M, y - h, avail, h, '0.965 0.969 0.976')
      let x = M
      wrapped.forEach((lines, i) => {
        const right = i > 0 && cols > 2 && !(cols >= 7) && (header ? true : /^[\d.,R$%x\s—+-]+$/.test(cells[i] ?? ''))
        lines.forEach((ln, li) => text(ln, right ? x + widths[i]! - pad - textWidth(ln, size) : x + pad, y - (li + 1) * (size + 2.5) - 1, size, header, header ? WHITE : DARK))
        x += widths[i]!
      })
      y -= h
    }
    row(s.header, true, false)
    s.rows.slice(0, 400).forEach((r, ri) => {
      // Tabela que continua em outra página repete o cabeçalho.
      const cells = r.map((v, i) => fmtCell(v, s, i, ri))
      if (y - (size + 2.5) * 2 - 6 < BOTTOM) {
        newPage()
        row(s.header, true, false)
      }
      row(cells, false, ri % 2 === 1)
    })
    if (!s.rows.length) {
      need(14)
      text('Sem dados no período.', M + 4, y - 10, 7.5, false, GRAY)
      y -= 14
    }
    ops.push(`${brand} RG 0.8 w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S`)
    if (s.rows.length > 400) {
      need(14)
      text(`E mais ${s.rows.length - 400} linha(s): baixe o Excel para ver tudo.`, M, y - 10, 7.5, false, GRAY)
      y -= 14
    }
    if (s.note) {
      y -= 2
      for (const l of wrap(s.note, W - 2 * M, 7)) {
        need(10)
        text(l, M, y - 9, 7, false, GRAY)
        y -= 10
      }
    }
    y -= 16
  }
  pages.push(ops.join('\n'))

  // Monta o arquivo: catálogo, páginas, fontes padrão (Helvetica), o logo e o conteúdo de cada página.
  const objs: string[] = []
  const add = (s: string) => objs.push(s) // número do objeto = índice + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // páginas, preenchido depois
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const stream = (dict: string, data: Buffer) => `<< ${dict} /Length ${data.length} >>\nstream\n${data.toString('latin1')}\nendstream`
  let imageRef = ''
  if (doc.logo) {
    let smaskId = 0
    if (doc.logo.smask) {
      add(stream(doc.logo.smask.dict, doc.logo.smask.data))
      smaskId = objs.length
    }
    add(stream(doc.logo.image.dict.replace('{SMASK}', String(smaskId)), doc.logo.image.data))
    imageRef = ` /XObject << /Im1 ${objs.length} 0 R >>`
  }
  const kids: number[] = []
  pages.forEach((content, i) => {
    const foot = [
      `${brand} RG 0.6 w ${M} 40 m ${W - M} 40 l S`,
      ...(doc.info ? [`BT ${DARK} rg /F2 7 Tf ${M} 29 Td (${pdfText(fit(doc.info, W - 2 * M - 70, 7))}) Tj ET`] : []),
      `BT ${GRAY} rg /F1 6.5 Tf ${M} ${doc.info ? 19 : 27} Td (${pdfText(fit(doc.footer, W - 2 * M - 70, 6.5))}) Tj ET`,
      `BT ${GRAY} rg /F1 7 Tf ${W - M - 58} 29 Td (${pdfText(`página ${i + 1} de ${pages.length}`)}) Tj ET`,
    ].join('\n')
    const body = Buffer.from(`${content}\n${foot}`, 'latin1')
    add(stream('', body))
    const contentId = objs.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imageRef} >> /Contents ${contentId} 0 R >>`)
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
