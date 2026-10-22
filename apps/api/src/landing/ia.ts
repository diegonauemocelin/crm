/**
 * IA das landing pages (Gemini, a mesma chave do e-mail marketing): sugere estruturas, monta a página em blocos e
 * melhora o texto de um bloco. A resposta é JSON e passa pela mesma limpeza dos blocos da tela (cleanBlocks), então
 * a IA nunca cria campo ou tipo de bloco que não exista. Funções puras (testadas em test/landing.spec.ts).
 */
import { BLOCKS, type FieldDef } from './blocos'

export interface LpBrief {
  /** O que a página deve conseguir (ex.: "captar orçamentos de filtros Komatsu PC200 vindos do Google Ads"). */
  goal: string
  audience?: string
  offer?: string
  /** Canal de tráfego principal (Google Ads, Meta, e-mail...). */
  channel?: string
  language?: 'pt' | 'es'
}

export interface LpOutline {
  title: string
  angle: string
  blocks: string[]
}

export function lpSystem(company: string, about: string) {
  return [
    `Você é redator e especialista em landing pages de alta conversão da empresa ${company}.`,
    about ? `Sobre a empresa: ${about}` : '',
    'Regras obrigatórias:',
    '- Nunca invente preço, desconto, prazo de entrega, estoque, garantia, compatibilidade de peça, números da empresa ou depoimentos. Onde for preciso um dado assim, escreva um marcador entre colchetes, ex.: [Prazo confirmado pelo Comercial].',
    '- Textos curtos, diretos e concretos, para quem compra peças de máquinas pesadas (frotistas, mecânicos, construtoras, revendas).',
    '- Título com o benefício principal; botões com verbo de ação (ex.: "Pedir orçamento").',
    '- Responda somente com JSON válido, sem comentários e sem markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Lista dos blocos e campos para a IA (o mesmo catálogo da tela). */
export function blockCatalog() {
  const field = (f: FieldDef): string =>
    f.type === 'list'
      ? `${f.key}: lista (até ${f.maxItems}) de {${(f.item ?? []).map(field).join('; ')}}`
      : f.type === 'select' || f.type === 'icon'
        ? `${f.key}: um de ${(f.options ?? []).map((o) => `"${o.value}"`).join(', ')}`
        : f.type === 'image' || f.type === 'form' || f.type === 'whatsapp' || f.type === 'datetime'
          ? `${f.key}: deixe ""`
          : `${f.key}: texto até ${f.max ?? 200} caracteres`
  return BLOCKS.map((b) => `- "${b.type}" (${b.label}): ${b.description}${b.variants ? ` variant: um de ${b.variants.map((v) => `"${v.value}"`).join(', ')}.` : ''} Campos: ${b.fields.map(field).join('; ')}.`).join('\n')
}

const briefText = (b: LpBrief) =>
  [`Objetivo: ${b.goal}`, b.audience ? `Público: ${b.audience}` : '', b.offer ? `Oferta ou condição (informada pela empresa): ${b.offer}` : '', b.channel ? `Tráfego principal: ${b.channel}` : '', `Idioma da página: ${b.language === 'es' ? 'espanhol' : 'português do Brasil'}`]
    .filter(Boolean)
    .join('\n')

export function outlinePrompt(b: LpBrief) {
  return `${briefText(b)}

Blocos disponíveis:
${BLOCKS.map((x) => `- ${x.type}: ${x.label}`).join('\n')}

Sugira 3 estruturas diferentes de landing page para esse objetivo (ex.: uma mais curta e direta para anúncio de busca, uma mais completa, uma com foco em WhatsApp). Toda estrutura começa com "hero" e precisa ter "formulario" ou "whatsapp".
Responda no formato: {"opcoes":[{"titulo":"nome curto da estrutura","angulo":"por que funciona, em uma frase","blocos":["hero","numeros","beneficios","formulario","faq"]}]}`
}

export function pagePrompt(b: LpBrief, o: LpOutline) {
  return `${briefText(b)}

Estrutura escolhida: ${o.title} (${o.angle})
Blocos, nesta ordem: ${o.blocks.join(', ')}

Catálogo dos blocos e campos:
${blockCatalog()}

Escreva a página completa. Para cada bloco use "type", "variant" (quando houver), "background" (um de "padrao", "suave", "destaque", "escuro"; alterne para separar as seções e use "destaque" na chamada final) e os campos do catálogo. Botões: "action" = "formulario" (padrão), "whatsapp" ou "link".
Responda no formato: {"seo":{"title":"até 60 caracteres","description":"até 155 caracteres"},"blocks":[{...}]}`
}

export function improvePrompt(block: Record<string, unknown>, instruction: string) {
  const def = BLOCKS.find((b) => b.type === block.type)
  return `Bloco "${def?.label ?? String(block.type)}" de uma landing page, em JSON:
${JSON.stringify(block)}

Pedido: ${instruction || 'Melhore os textos para converter mais: mais claros, mais curtos e com o benefício na frente.'}
Mantenha "id", "type", "variant", "background", imagens, formId, whatsappId, "action" e "url". Mude só os textos. Não invente dados (use [colchetes] onde faltar).
Responda só com o bloco em JSON, no mesmo formato.`
}

/** Tira o JSON da resposta (às vezes vem entre ```json ... ```). */
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = t.search(/[[{]/)
  if (start < 0) return null
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
}

const TYPES = new Set(BLOCKS.map((b) => b.type))

export function parseOutlines(text: string): LpOutline[] {
  const j = parseJson(text) as { opcoes?: unknown } | null
  const list = Array.isArray(j?.opcoes) ? j.opcoes : []
  return list
    .map((o) => {
      const r = o as { titulo?: unknown; angulo?: unknown; blocos?: unknown }
      const blocks = (Array.isArray(r.blocos) ? r.blocos : []).map(String).filter((t) => TYPES.has(t)).slice(0, 14)
      return { title: String(r.titulo ?? '').slice(0, 80), angle: String(r.angulo ?? '').slice(0, 240), blocks }
    })
    .filter((o) => o.title && o.blocks.includes('hero') && (o.blocks.includes('formulario') || o.blocks.includes('whatsapp')))
    .slice(0, 3)
}
