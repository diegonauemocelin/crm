/**
 * Assistente de texto do e-mail marketing (Google Gemini). Funções puras: pedidos (prompts) e limpeza da resposta.
 * Só vai para o Google o rascunho que a pessoa escreveu (nunca dados de leads); o texto volta para aprovação.
 */

export type AiAction = 'escrever' | 'melhorar' | 'encurtar' | 'persuasivo' | 'corrigir' | 'assunto' | 'preheader'

export const AI_ACTIONS: Record<AiAction, string> = {
  escrever: 'Escrever a partir de um tema',
  melhorar: 'Melhorar o texto',
  encurtar: 'Deixar mais curto',
  persuasivo: 'Deixar mais persuasivo',
  corrigir: 'Corrigir o português',
  assunto: 'Sugerir assuntos',
  preheader: 'Sugerir pré-cabeçalho',
}

export const AI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'] as const
export type AiModel = (typeof AI_MODELS)[number]

export function systemPrompt(company: string, about: string) {
  return [
    `Você escreve e-mails marketing da empresa ${company}.${about ? ` Sobre a empresa: ${about}` : ''}`,
    'Escreva em português do Brasil, com tom profissional e próximo, frases curtas e claras, sem exageros.',
    'Nunca invente preços, descontos, prazos, estoque, garantias ou condições que não estejam no texto ou no tema.',
    'Mantenha exatamente como estão os marcadores entre chaves, como {primeiro_nome}, {nome} e {email}.',
    'Responda só com o texto pedido: sem comentários, sem aspas em volta e sem markdown (nada de **, #, tabelas ou listas com hífen).',
  ].join(' ')
}

/** Pedido para o Gemini conforme a ação. Retorna null se faltar o texto/tema. */
export function userPrompt(action: AiAction, text: string, topic: string) {
  const t = text.trim().slice(0, 6000)
  const theme = topic.trim().slice(0, 1000)
  switch (action) {
    case 'escrever':
      if (!theme) return null
      return `Escreva o corpo de um e-mail marketing sobre: ${theme}\nUse de 2 a 4 parágrafos curtos, separados por uma linha em branco, e termine com um convite à ação.${t ? `\nAproveite, se fizer sentido, este rascunho:\n${t}` : ''}`
    case 'assunto':
      if (!t && !theme) return null
      return `Sugira 5 assuntos para um e-mail marketing com este conteúdo. Até 60 caracteres cada, que dêem vontade de abrir, sem caixa alta e no máximo 1 emoji. Um por linha, sem numeração.\n\n${t || theme}`
    case 'preheader':
      if (!t && !theme) return null
      return `Sugira 3 textos de pré-cabeçalho (o resumo que aparece ao lado do assunto na caixa de entrada) para este e-mail. Até 90 caracteres cada. Um por linha, sem numeração.\n\n${t || theme}`
    default: {
      if (!t) return null
      const ask = {
        melhorar: 'Melhore a clareza e a fluidez do texto abaixo, mantendo o sentido, o tamanho aproximado e os parágrafos.',
        encurtar: 'Deixe o texto abaixo com cerca de metade do tamanho, mantendo o essencial e o convite à ação.',
        persuasivo: 'Reescreva o texto abaixo de forma mais persuasiva, com benefícios claros e um convite à ação, sem exageros.',
        corrigir: 'Corrija ortografia, gramática e pontuação do texto abaixo. Não mude o estilo nem o conteúdo.',
      }[action]
      return `${ask}${theme ? `\nOrientação: ${theme}` : ''}\n\n${t}`
    }
  }
}

/** Tira markdown e aspas que o modelo às vezes devolve. */
export function cleanAnswer(raw: string) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Opções (assuntos, pré-cabeçalhos): uma por linha. */
export function answerOptions(raw: string, max = 5) {
  return cleanAnswer(raw)
    .split('\n')
    .map((l) => l.replace(/^["“”']+|["“”']+$/g, '').trim())
    .filter(Boolean)
    .slice(0, max)
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Texto do modelo em parágrafos HTML para o editor (escapado: nada do que vem do modelo vira tag). */
export function answerHtml(raw: string) {
  return cleanAnswer(raw)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Mensagem clara para os erros do Gemini. */
export function aiError(status: number, body: unknown) {
  const msg = String((body as { error?: { message?: string } } | null)?.error?.message ?? '')
  if (status === 400 && /api key|API_KEY/i.test(msg)) return 'A chave do Gemini não foi aceita. Confira a chave em E-mail marketing → Configurações.'
  if (status === 403) return 'A chave do Gemini não tem permissão para este modelo. Gere outra chave no Google AI Studio.'
  if (status === 429) return 'Limite do plano gratuito do Gemini atingido. Tente de novo em alguns minutos.'
  if (status === 404) return 'Modelo do Gemini não encontrado. Escolha outro modelo nas configurações.'
  if (status >= 500) return 'O Gemini não respondeu agora. Tente de novo em instantes.'
  return `O Gemini recusou o pedido (${status})${msg ? `: ${msg.slice(0, 160)}` : ''}.`
}
