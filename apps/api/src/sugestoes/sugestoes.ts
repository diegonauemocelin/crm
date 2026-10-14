/** Situações de uma sugestão de melhoria, na ordem em que normalmente acontecem. */
export const SUGGESTION_STATUS = ['NOVA', 'ANALISE', 'PLANEJADA', 'APLICADA', 'RECUSADA'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUS)[number]

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  NOVA: 'Nova',
  ANALISE: 'Em análise',
  PLANEJADA: 'Planejada',
  APLICADA: 'Aplicada',
  RECUSADA: 'Não será feita',
}

/** Texto livre de uma linha ou de vários parágrafos: sem caracteres de controle, espaços aparados, com limite. */
export function cleanText(raw: string | null | undefined, max: number, multiline = false) {
  const s = (raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.slice(0, max).trim()
}
