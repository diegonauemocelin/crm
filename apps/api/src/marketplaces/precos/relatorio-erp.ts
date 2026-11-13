// Relatório em texto do ERP (ex.: Tcar "Análise de preço e margem - itens integrados ao e-commerce"), com colunas
// alinhadas por espaço: FILIAL SKU DESCRICAO CUSTO MEDIO PRECO VENDA IMPOSTOS VALOR LIQ. LUCRO LIQ. MARGEM % STATUS.
// Vira a tabela da planilha de custos: sku, custo, lucro. Só regras (sem banco); testes em test/precos-relatorio-erp.spec.ts.

const COLS: { key: string; re: RegExp }[] = [
  { key: 'custo', re: /CUSTO/ },
  { key: 'preco', re: /PRE[CÇ]O/ },
  { key: 'impostos', re: /IMPOSTO/ },
  { key: 'liquido', re: /VALOR\s+L[IÍ]Q/ },
  { key: 'lucro', re: /LUCRO/ },
  { key: 'margem', re: /MARGEM/ },
]

const NUM = /^-?[\d.]+(,\d+)?$/

/** É um relatório em texto (não CSV): tem uma linha de cabeçalho com SKU e CUSTO, sem ponto e vírgula nem tabulação. */
export function isErpTextReport(text: string) {
  const head = text.split(/\r?\n/).find((l) => /\bSKU\b/i.test(l) && /CUSTO/i.test(l))
  return !!head && !/[;\t]/.test(head)
}

/** Linhas [sku, custo, lucro] (com cabeçalho) a partir do relatório; linhas sem SKU ou sem números ficam de fora. */
export function erpTextReportRows(text: string): string[][] {
  const lines = text.split(/\r?\n/)
  const hi = lines.findIndex((l) => /\bSKU\b/i.test(l) && /CUSTO/i.test(l))
  if (hi < 0) return []
  const head = lines[hi]!.toUpperCase()
  const numeric = COLS.map((c) => ({ key: c.key, pos: head.search(c.re) })).filter((c) => c.pos >= 0).sort((a, b) => a.pos - b.pos)
  const tokens = head.trim().split(/\s+/)
  const skuIdx = tokens.findIndex((t) => t === 'SKU')
  const out: string[][] = [['sku', 'custo', 'lucro']]
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim() || /^[\s-=]+$/.test(l)) continue
    const t = l.trim().split(/\s+/)
    // Do fim para o começo: status (texto) e os números das colunas numéricas, na ordem do cabeçalho.
    let end = t.length
    while (end > 0 && !NUM.test(t[end - 1]!)) end--
    const nums = t.slice(Math.max(0, end - numeric.length), end)
    if (nums.length !== numeric.length || !nums.every((n) => NUM.test(n))) continue
    const sku = t[skuIdx]
    if (!sku || sku.length > 60) continue
    const val = (k: string) => nums[numeric.findIndex((c) => c.key === k)] ?? ''
    out.push([sku, val('custo'), numeric.some((c) => c.key === 'lucro') ? val('lucro') : ''])
  }
  return out
}
