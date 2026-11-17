/**
 * IA no chat do WhatsApp (funções puras): pedido de transcrição de áudio e de resposta sugerida ao Gemini, e a leitura
 * das respostas. O Gemini é o do plano gratuito do Google, com a chave já cadastrada no CRM.
 */

export const TRANSCRIBE_KEY = 'whatsapp_transcricao'
/** Áudio maior que isto não é transcrito (o Gemini aceita até 20 MB por pedido com o arquivo junto). */
export const TRANSCRIBE_MAX_BYTES = 15 * 1024 * 1024

/** Tipo do áudio para o Gemini (o WhatsApp manda "audio/ogg; codecs=opus"). */
export function audioMime(mime: string | null | undefined) {
  const m = (mime ?? '').split(';')[0]!.trim().toLowerCase()
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'audio/mp3'
  if (['audio/ogg', 'audio/wav', 'audio/aac', 'audio/flac', 'audio/aiff', 'audio/mp4'].includes(m)) return m === 'audio/mp4' ? 'audio/aac' : m
  return 'audio/ogg'
}

export const TRANSCRIBE_PROMPT =
  'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado (sem resumir, sem comentar). Códigos de peças, números e nomes como foram ditos. Se não houver fala, responda apenas: [sem fala]'

/** Texto da transcrição (limpo); null quando não há fala. */
export function cleanTranscript(text: string) {
  const t = text.trim().replace(/^["“]|["”]$/g, '').trim()
  if (!t || /^\[?sem fala\]?\.?$/i.test(t)) return null
  return t.slice(0, 4000)
}

export interface ChatLine {
  fromMe: boolean
  text: string
}

/** Pedido de resposta sugerida: a conversa recente e o que a empresa sabe (base de conhecimento e aplicações). */
export function suggestPrompt(d: { company: string; agent: string; client: string | null; lines: ChatLine[]; knowledge: string[]; products: string[] }) {
  const convo = d.lines.map((l) => `${l.fromMe ? 'Atendente' : 'Cliente'}: ${l.text}`).join('\n')
  return `Você ajuda um atendente de ${d.company} a responder um cliente no WhatsApp. Escreva a PRÓXIMA mensagem do atendente (${d.agent}).

Regras:
- Português do Brasil, cordial e direto, curta (até 4 frases), como no WhatsApp.
- Use só o que está na conversa e nas informações da empresa abaixo. NÃO invente preço, prazo, estoque, frete, garantia nem compatibilidade de peça. Se o cliente pediu algo que não está aqui, diga que vai verificar ou faça a pergunta que falta (marca, modelo, série ou código da peça).
- Não use o nome do cliente se ele não aparece na conversa.

Informações da empresa (base de conhecimento):
${d.knowledge.length ? d.knowledge.map((k) => `- ${k}`).join('\n') : '- (nenhuma cadastrada)'}

Produtos e aplicações relacionados à conversa:
${d.products.length ? d.products.map((p) => `- ${p}`).join('\n') : '- (nenhum encontrado)'}

Conversa (mais antiga primeiro):
${convo}

Responda SOMENTE com o texto da mensagem, sem aspas e sem explicação.`
}

/** Palavras da conversa para achar artigos e produtos relacionados (códigos e termos de 4+ letras). */
export function searchTerms(lines: ChatLine[], max = 12) {
  const stop = new Set(['para', 'voce', 'você', 'esse', 'essa', 'isso', 'aqui', 'como', 'qual', 'quanto', 'tenho', 'quero', 'preciso', 'obrigado', 'bom', 'dia', 'tarde', 'noite', 'olá', 'tudo', 'bem', 'pode', 'favor', 'sim', 'não', 'nao', 'ainda', 'mais', 'muito', 'então', 'entao', 'também', 'tambem', 'pois', 'onde', 'quando', 'sobre'])
  const out = new Map<string, number>()
  for (const l of lines.filter((x) => !x.fromMe).slice(-6)) {
    // Códigos de peça ficam inteiros (207-60-71182, 600.311.8270).
    for (const w of l.text.toLowerCase().match(/[a-z0-9à-ú]+(?:[-./][a-z0-9]+)*/gi) ?? []) {
      if (w.length < 4 || stop.has(w)) continue
      out.set(w, (out.get(w) ?? 0) + (/\d/.test(w) ? 3 : 1))
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w)
}

/** Sugestão limpa (sem aspas e sem "Atendente:" na frente). */
export function cleanSuggestion(text: string) {
  return text.trim().replace(/^(atendente|resposta)\s*:\s*/i, '').replace(/^["“]|["”]$/g, '').trim().slice(0, 1500)
}
