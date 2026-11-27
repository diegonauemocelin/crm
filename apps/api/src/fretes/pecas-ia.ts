// Leitura do print do orçamento com IA (Gemini + pesquisa do Google): itens, medidas e peso de cada peça pela
// referência. Sem banco e sem rede (test/fretes-pecas-ia.spec.ts).

export interface PartFromImage {
  referencia: string
  descricao: string
  quantidade: number
  /** cm */
  comprimento: number | null
  largura: number | null
  altura: number | null
  /** kg por unidade */
  peso: number | null
  /** Site onde achou a medida, ou null quando estimada. */
  fonte: string | null
  estimado: boolean
}

export const PARTS_AI_PROMPT = `Você é o assistente de embalagem de uma distribuidora de peças para máquinas pesadas (Brasil).

A imagem é o print de um orçamento. Faça, nesta ordem:
1. Leia de cada item: código de referência da peça (ex.: 172448-82950), descrição e quantidade (coluna Qtde). Ignore preço, impostos e totais.
2. Para cada código, pesquise na internet a medida da peça (comprimento, largura e altura em cm) e o peso (kg por unidade). Busque pelo código entre aspas + descrição + marca (ex.: "172448-82950" tooth Yanmar). Converta para cm e kg (1 pol = 2,54 cm; 1 lb = 0,4536 kg). Se for kit, use a medida do kit inteiro.
3. Se não achar medida confiável, NÃO invente com certeza: dê uma estimativa razoável pelo tipo de peça e marque "estimado": true. Nunca afirme compatibilidade, preço ou estoque.

Responda SOMENTE com um JSON neste formato (números com ponto decimal, sem texto fora do JSON):
{"itens":[{"referencia":"172448-82950","descricao":"UNHA MINI ESCAVADEIRA","quantidade":3,"comprimento":17,"largura":8,"altura":7,"peso":1.2,"fonte":"site.com.br ou null","estimado":true}]}`

const num = (v: unknown, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 1000) / 1000 : null
}
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : v === null || v === undefined ? '' : String(v).slice(0, max))

/** Lê a resposta da IA (JSON, às vezes dentro de ```json ou com texto em volta). */
export function parsePartsAi(raw: string): PartFromImage[] {
  const m = /\{[\s\S]*\}/.exec(raw.replace(/```(?:json)?/g, ''))
  if (!m) throw new Error('A IA não conseguiu ler o orçamento. Envie um print mais nítido, com o código, a descrição e a quantidade.')
  let data: { itens?: unknown }
  try {
    data = JSON.parse(m[0]) as { itens?: unknown }
  } catch {
    throw new Error('A IA não conseguiu ler o orçamento. Tente de novo.')
  }
  const items = (Array.isArray(data.itens) ? (data.itens as Record<string, unknown>[]) : [])
    .slice(0, 60)
    .map((i) => {
      const dims = [num(i.comprimento, 600), num(i.largura, 600), num(i.altura, 600)]
      const peso = num(i.peso, 5000)
      const fonte = text(i.fonte, 200)
      return {
        referencia: text(i.referencia, 60),
        descricao: text(i.descricao, 120),
        quantidade: Math.max(1, Math.min(9999, Math.round(num(i.quantidade, 9999) ?? 1))),
        comprimento: dims[0]!,
        largura: dims[1]!,
        altura: dims[2]!,
        peso,
        fonte: fonte && !/^(null|estimado|-)$/i.test(fonte) ? fonte : null,
        // Sem medida completa ou sem fonte: tratar como estimado (medir antes de despachar).
        estimado: i.estimado === true || dims.some((d) => d === null) || peso === null || !fonte || /^(null|estimado)$/i.test(fonte),
      }
    })
    .filter((i) => i.referencia || i.descricao)
  if (!items.length) throw new Error('Nenhum item encontrado no print. Confira se aparecem o código, a descrição e a quantidade.')
  return items
}

/** Tipo da imagem pelos bytes (PNG, JPEG ou WEBP); null para outros arquivos. */
export function imageMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}
