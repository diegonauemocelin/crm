/**
 * Venda adicional nas respostas do Mercado Livre: outros anúncios da loja para a mesma máquina.
 * Ex.: pediu o filtro de ar primário da JCB JS200 → indica o filtro de ar secundário e o filtro de óleo da JS200.
 */
import type { AiResult, AssistContext } from './ia'
import { codeKey, itemCodes, norm, searchTokens } from './texto'

type Row = { id: string; title: string | null; status: string | null; availableQuantity?: number | null; sellerSku?: string | null; partNumber?: string | null; attributes?: unknown }
export type Complement = AssistContext['anuncios_complementares'][number]

const BRANDS = new Set('caterpillar cat komatsu volvo hyundai jcb john deere case new holland xcmg liugong sany kawasaki isuzu yanmar perkins cummins bobcat doosan randon fiat allis michigan'.split(' '))
const UNIT = /^\d+(mm|cm|m|kg|g|v|w|l|ml|un|pc|pcs|pol|cv|hp)$/
const QUALIFIERS = new Set('kit original paralela paralelo novo nova jogo par unidade compativel aplicacao linha amarela retroescavadeira escavadeira carregadeira trator motoniveladora'.split(' '))

/**
 * Tokens com cara de modelo de máquina: letras e até 4 dígitos (JS200, 320D, D6T, EC210), sem medidas. Modelo curto
 * (3C, 4C) só logo depois da marca ("JCB 3C"), para não pegar qualquer sigla.
 */
export function modelTokens(text: unknown) {
  const words = norm(text).replace(/[^a-z0-9]+/g, ' ').split(' ')
  const short = new Set(words.filter((w, i) => /^\d[a-z]$/.test(w) && BRANDS.has(words[i - 1] ?? '')))
  return searchTokens(text).filter((w) => /[a-z]/.test(w) && /\d/.test(w) && (w.length >= 3 || short.has(w)) && w.length <= 10 && (w.match(/\d/g)?.length ?? 0) <= 4 && !UNIT.test(w))
}

/** Tipo do produto pelo título: as primeiras palavras antes da marca e do modelo ("filtro ar primario"). */
export function productKey(title: unknown) {
  const out: string[] = []
  for (const w of searchTokens(title)) {
    if (/\d/.test(w) || BRANDS.has(w)) break
    if (!QUALIFIERS.has(w)) out.push(w)
    if (out.length === 3) break
  }
  return out
}

/**
 * Anúncios ativos da loja com o mesmo modelo de máquina no título, de outro tipo de produto.
 * Modelo: o citado na pergunta; sem modelo na pergunta, o do título do anúncio perguntado.
 * Ordem: mais parecido com o produto pedido (filtro de ar → outro filtro de ar → outro filtro), com estoque antes.
 */
export function titleComplements(question: string, item: Row | null, rows: Row[], storeItems: Set<string>, skip: Set<string>, limit = 8): Complement[] {
  const own = item ? itemCodes(item) : { ref: new Set<string>(), oem: new Set<string>() }
  const notCode = (w: string) => !own.ref.has(codeKey(w)) && !own.oem.has(codeKey(w))
  let models = modelTokens(question).filter(notCode)
  if (!models.length && item) models = modelTokens(item.title).filter(notCode)
  if (!models.length) return []
  const baseKey = productKey(item?.title ?? question)
  const baseStr = baseKey.join(' ')
  const found: { c: Complement; key: string; score: number }[] = []
  for (const r of rows) {
    if (r.id === item?.id || skip.has(r.id) || !storeItems.has(r.id) || r.status !== 'active') continue
    const words = new Set(searchTokens(r.title))
    const hit = models.filter((m) => words.has(m))
    if (!hit.length) continue
    const key = productKey(r.title)
    const keyStr = key.join(' ')
    if (!keyStr || keyStr === baseStr) continue
    let score = hit.length + (Number(r.availableQuantity) > 0 ? 1 : 0)
    if (key[0] && key[0] === baseKey[0]) score += 4
    score += key.slice(1).filter((w) => baseKey.includes(w)).length * 2
    found.push({ key: keyStr, score, c: { id: r.id, titulo: r.title, codigo: [...itemCodes(r).ref][0] ?? '', sistema: null, aplicacao_confirmada: `${hit.map((m) => m.toUpperCase()).join(', ')} (conforme o título do anúncio)` } })
  }
  found.sort((a, b) => b.score - a.score)
  const keys = new Set<string>()
  const out: Complement[] = []
  for (const f of found) {
    if (keys.has(f.key)) continue
    keys.add(f.key)
    out.push(f.c)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Garante a venda adicional na resposta: se a resposta foi "responder" e ainda cabe, acrescenta os complementares
 * (até o máximo das Configurações) que o motor não ofereceu, sem passar do tamanho máximo da resposta.
 */
export function addComplements(r: AiResult, context: AssistContext, s: { upsell_enabled: boolean; max_complementary: number; max_answer_chars: number }): AiResult {
  const max = Math.max(0, Math.floor(Number(s.max_complementary) || 0))
  if (!s.upsell_enabled || !max || r.decision !== 'responder' || !r.answer.trim()) return r
  const links = new Set(context.anuncios_com_link_permitido ?? [])
  const inAnswer = new Set([...r.answer.matchAll(/\{\{LINK:([A-Z]{3}\d+)\}\}/g)].map((m) => m[1]))
  const offered = (context.anuncios_complementares ?? []).filter((c) => inAnswer.has(c.id))
  const pick = (context.anuncios_complementares ?? []).filter((c) => !inAnswer.has(c.id) && links.has(c.id)).slice(0, max - offered.length)
  if (!pick.length) return { ...r, complementary_item_ids: [...new Set([...r.complementary_item_ids, ...offered.map((c) => c.id)])] }
  // o marcador vira o link do anúncio (~70 caracteres)
  const size = (t: string) => t.replace(/\{\{LINK:[A-Z]{3}\d+\}\}/g, 'x'.repeat(70)).length
  const limit = Math.min(Number(s.max_answer_chars) || 1200, 2000)
  const head = '\n\nAproveite e confira também, para a mesma máquina:'
  let text = r.answer.trim()
  const added: string[] = []
  for (const c of pick) {
    const line = `\n• ${norm(c.titulo) ? c.titulo : c.id}: {{LINK:${c.id}}}`
    const next = `${text}${added.length ? '' : head}${line}`
    if (size(next) > limit) break
    text = next
    added.push(c.id)
  }
  if (!added.length) return r
  return { ...r, answer: text, complementary_item_ids: [...new Set([...r.complementary_item_ids, ...offered.map((c) => c.id), ...added])] }
}
