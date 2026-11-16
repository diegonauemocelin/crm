/**
 * Busca de leads com IA: Claude (pesquisa na web da Anthropic) ou Gemini (pesquisa do Google, há plano gratuito). As
 * duas devolvem a lista de empresas no mesmo formato (ferramenta registrar_empresas ou JSON), validado depois.
 */
import Anthropic from '@anthropic-ai/sdk'
import { REGISTRAR_TOOL, SYSTEM_PROMPT } from './prospeccao'

export type AiProvider = 'claude' | 'gemini'

export interface AiSearchResult {
  /** { empresas: [...] } como a IA registrou (validado por prospectsFromAi). */
  input: unknown
  model: string
  /** Para o custo: tokens e pesquisas na web. */
  inputTokens: number
  outputTokens: number
  webSearches: number
  /** Links que a pesquisa leu (Gemini traz no groundingMetadata). */
  sources: string[]
}

const CLAUDE_MAX_TURNS = 6

/** Claude com a ferramenta de pesquisa na web e a ferramenta registrar_empresas (o resultado vem nela). */
export async function claudeSearch(apiKey: string, model: string, userContent: string, maxSearches: number): Promise<AiSearchResult> {
  const client = new Anthropic({ apiKey, timeout: 10 * 60_000 })
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches, user_location: { type: 'approximate', country: 'BR' } },
    REGISTRAR_TOOL,
  ] as unknown as Anthropic.Beta.BetaToolUnion[]
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userContent }]
  let inputTokens = 0
  let outputTokens = 0
  let webSearches = 0
  const fallback = !model.startsWith('claude-haiku')
  for (let turn = 0; turn < CLAUDE_MAX_TURNS; turn++) {
    const msg = await client.beta.messages.create({
      model,
      max_tokens: 32000,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      output_config: { effort: 'medium' },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0)
    outputTokens += msg.usage.output_tokens
    webSearches += (msg.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0
    if (msg.stop_reason === 'refusal') throw new Error('A IA recusou esta busca.')
    const reg = (msg.content as { type: string; name?: string; input?: unknown }[]).find((b) => b.type === 'tool_use' && b.name === REGISTRAR_TOOL.name)
    if (reg) return { input: reg.input, model: msg.model, inputTokens, outputTokens, webSearches, sources: [] }
    // A pesquisa na web pode pausar um turno longo: continua de onde parou.
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
    if (msg.stop_reason === 'pause_turn') continue
    messages.push({ role: 'user', content: 'Agora chame a ferramenta registrar_empresas com a lista final.' })
  }
  throw new Error('A IA não devolveu a lista de empresas. Tente de novo com uma busca mais específica.')
}

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Gemini com a pesquisa do Google (grounding); a lista vem em JSON no texto. */
export async function geminiSearch(apiKey: string, models: string[], userContent: string): Promise<AiSearchResult> {
  const prompt = `${SYSTEM_PROMPT.replace('No fim, chame a ferramenta registrar_empresas uma vez com a lista', 'No fim, responda SOMENTE com um JSON { "empresas": [...] }')}

Formato de cada empresa no JSON: {"nome","cnpj","segmento","cidade","uf","endereco","site","instagram","telefones":[{"numero","fonte"}],"emails":[{"email","fonte"}],"nota","motivo","fontes":[]}.

${userContent}`
  let last = ''
  for (const model of models) {
    let res: Response
    try {
      res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 16384 } }),
        signal: AbortSignal.timeout(5 * 60_000),
      })
    } catch (e) {
      last = `sem conexão com o Gemini (${(e as Error).message})`
      continue
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
      candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[]; webSearchQueries?: string[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      modelVersion?: string
    }
    if (!res.ok) {
      last = `${model}: ${data.error?.message ?? `HTTP ${res.status}`}`
      // Chave inválida ou sem permissão: não adianta tentar outro modelo.
      if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`O Gemini recusou: ${data.error?.message ?? res.status}`)
      continue
    }
    const cand = data.candidates?.[0]
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const json = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    let input: unknown
    try {
      input = JSON.parse(json)
    } catch {
      last = `${model}: resposta sem JSON válido`
      continue
    }
    const sources = (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web?.uri ?? '').filter((u) => /^https:\/\//.test(u)).slice(0, 30)
    return { input, model: data.modelVersion ?? model, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0, webSearches: cand?.groundingMetadata?.webSearchQueries?.length ?? 0, sources }
  }
  throw new Error(`O Gemini não respondeu (${last || 'sem modelos'}). No plano gratuito há limite de buscas por dia; tente mais tarde ou use o Claude.`)
}

/** Custo aproximado em US$ (Claude: tokens + US$ 10 por mil pesquisas; Gemini no plano gratuito: 0). */
export function searchCost(provider: AiProvider, model: string, r: Pick<AiSearchResult, 'inputTokens' | 'outputTokens' | 'webSearches'>) {
  if (provider === 'gemini') return 0
  const price: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] }
  const [i, o] = price[model.replace(/-\d{8}$/, '')] ?? price['claude-opus-5-5']!
  return Math.round(((r.inputTokens * i + r.outputTokens * o) / 1_000_000 + r.webSearches * 0.01) * 100) / 100
}
