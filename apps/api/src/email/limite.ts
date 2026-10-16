/**
 * Recusas temporárias do servidor de e-mail (códigos 4xx: "enviando rápido demais", fila cheia, tente depois).
 * O destinatário não é dado como "não entregue": a campanha espera, diminui o ritmo e tenta de novo. Funções puras.
 */

/** Código SMTP 4xx: recusa temporária (o próprio servidor pede para tentar de novo mais tarde). */
export function isTemporary(code: number | undefined | null) {
  return typeof code === 'number' && code >= 400 && code < 500
}

/** Erro já gravado que começa com o código 4xx (ex.: "452 452 4.7.1 ... slow down"). */
export function isTemporaryText(error: string | null | undefined) {
  return /^4\d\d\b/.test((error ?? '').trim())
}

/** Quantas vezes um mesmo destinatário pode ser recusado temporariamente antes de virar "não entregue". */
export const MAX_TEMP_TRIES = 6

/** Espera depois da recusa, em minutos, crescendo a cada nova recusa seguida: 1, 2, 5, 10 e 15. */
export function backoffMinutes(level: number) {
  return [1, 2, 5, 10, 15][Math.min(Math.max(level, 1), 5) - 1]!
}

/**
 * E-mails por ciclo (a cada 15 s): o menor entre o limite da campanha e o do servidor SMTP (0 = sem limite),
 * dividido pela metade a cada nível de recusa (no mínimo 1).
 */
export function batchSize(ratePerMinute: number, smtpMaxPerMinute: number, level: number, ticksPerMinute = 4) {
  const rate = Math.max(1, smtpMaxPerMinute > 0 ? Math.min(ratePerMinute || 60, smtpMaxPerMinute) : ratePerMinute || 60)
  return Math.max(1, Math.floor(Math.ceil(rate / ticksPerMinute) / 2 ** Math.min(level, 6)))
}
