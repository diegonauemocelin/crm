/** Gemini (plano gratuito do Google) com a pesquisa do Google: o texto da resposta e os links que ele leu. */
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function geminiGrounded(apiKey: string, models: string[], prompt: string): Promise<{ text: string; sources: string[]; model: string }> {
  let last = ''
  for (const model of models) {
    let res: Response
    try {
      res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }),
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
