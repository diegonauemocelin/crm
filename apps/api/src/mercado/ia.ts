/** Gemini (plano gratuito do Google) com a pesquisa do Google: o texto da resposta e os links que ele leu. */
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function geminiGrounded(apiKey: string, models: string[], prompt: string, images: { mime: string; data: string }[] = []): Promise<{ text: string; sources: string[]; model: string }> {
  let last = ''
  for (const model of models) {
    let res: Response
    try {
      res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }),
        signal: AbortSignal.timeout(3 * 60_000),
      })
    } catch (e) {
      last = (e as Error).message
      continue
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
      candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[]
      modelVersion?: string
    }
    if (!res.ok) {
      last = data.error?.message ?? `HTTP ${res.status}`
      if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`O Gemini recusou: ${last}`)
      continue
    }
    const cand = data.candidates?.[0]
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const sources = (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web?.uri ?? '').filter((u) => /^https:\/\//.test(u)).slice(0, 20)
    return { text, sources, model: data.modelVersion ?? model }
  }
  throw new Error(`O Gemini não respondeu (${last || 'sem modelos'}). No plano gratuito há limite por dia; tente mais tarde.`)
}

/** Claude com a pesquisa na web da Anthropic: o texto final da resposta e os links citados. */
export async function claudeGrounded(apiKey: string, model: string, prompt: string): Promise<{ text: string; sources: string[]; model: string }> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, timeout: 10 * 60_000 })
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12, user_location: { type: 'approximate', country: 'BR' } }] as unknown as Parameters<typeof client.messages.create>[0]['tools']
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: prompt }]
  const sources = new Set<string>()
  for (let turn = 0; turn < 6; turn++) {
    const msg = await client.messages.create({ model, max_tokens: 16000, tools, messages } as Parameters<typeof client.messages.create>[0] & { stream?: false })
    if (msg.stop_reason === 'refusal') throw new Error('A IA recusou esta análise.')
    for (const b of msg.content as { type: string; content?: unknown; citations?: { url?: string }[] }[]) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content as { url?: string }[]) if (r.url?.startsWith('https://')) sources.add(r.url)
      for (const c of b.citations ?? []) if (c.url?.startsWith('https://')) sources.add(c.url)
    }
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content })
      continue
    }
    const text = (msg.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    return { text, sources: [...sources].slice(0, 20), model: msg.model }
  }
  throw new Error('A IA não terminou a análise. Tente de novo.')
}
