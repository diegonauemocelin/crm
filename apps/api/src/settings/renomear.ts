/**
 * Trocar o nome da empresa nos textos salvos (Configurações › Identidade): onde o nome aparece e como trocar.
 * Funções puras (testadas em test/renomear.spec.ts).
 */

/** Textos da empresa que podem mudar. Conversas, histórico, auditoria e campanhas já enviadas ficam como foram. */
export interface RenameTarget {
  key: string
  label: string
  table: string
  /** Colunas de texto e de JSON (no JSON, só os valores de texto mudam; as chaves nunca). */
  text: string[]
  json: string[]
  /** Filtro extra (SQL fixo, sem dado do usuário). */
  where?: string
}

export const RENAME_TARGETS: RenameTarget[] = [
  { key: 'config', label: 'Configurações (identidade, e-mail, WhatsApp, alertas...)', table: 'tenant_settings', text: [], json: ['value'] },
  { key: 'unidades', label: 'Unidades', table: 'units', text: ['name'], json: [] },
  { key: 'listas', label: 'Listas de cadastro (origens, marcas, motivos...)', table: 'lookup_items', text: ['name'], json: [] },
  { key: 'formularios', label: 'Formulários da Captura', table: 'capture_forms', text: ['name', 'submitLabel', 'successMessage', 'consentText', 'originName'], json: ['fields', 'design'] },
  { key: 'popups', label: 'Pop-ups da Captura', table: 'capture_popups', text: ['name', 'title', 'text'], json: ['design'] },
  { key: 'botoes', label: 'Botões de WhatsApp da Captura', table: 'capture_whatsapps', text: ['name', 'buttonText', 'title', 'subtitle', 'message', 'originName'], json: [] },
  { key: 'campanhas', label: 'Campanhas de e-mail ainda não enviadas', table: 'email_campaigns', text: ['name', 'subject', 'preheader', 'fromName'], json: ['blocks'], where: `"status" NOT IN ('ENVIADA', 'ENVIANDO')` },
  { key: 'segmentos', label: 'Segmentos de e-mail', table: 'email_segments', text: ['name'], json: [] },
  { key: 'automacoes', label: 'Automações', table: 'automations', text: ['name', 'description'], json: ['trigger', 'steps'] },
  { key: 'respostas', label: 'Respostas rápidas do chat', table: 'whatsapp_quick_replies', text: ['title', 'text'], json: [] },
  { key: 'numeros', label: 'Nomes dos números de WhatsApp', table: 'whatsapp_numbers', text: ['name'], json: [] },
  { key: 'etiquetas', label: 'Etiquetas do chat', table: 'whatsapp_labels', text: ['name'], json: [] },
  { key: 'relatorios', label: 'Relatórios salvos', table: 'saved_reports', text: ['name', 'description'], json: [] },
  { key: 'campos', label: 'Campos personalizados dos leads', table: 'custom_field_defs', text: ['label'], json: [] },
]

/**
 * Padrão do nome antigo: sem diferenciar maiúsculas, com espaço ou hífen valendo como separador ("USA Parts",
 * "USA-Parts", "usa  parts"), e só como palavra inteira (não pega "usaparts.com.br" ao procurar "USA Parts").
 */
export function namePattern(from: string) {
  const words = from.trim().split(/[\s-]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return null
  const body = words.join('[\\s-]+')
  // Nunca dentro de endereço: site (usaparts.com.br), e-mail (@usaparts), caminho (/usaparts) ou nome com hífen.
  const start = '(?<![\\p{L}\\p{N}_.@/-])'
  const end = '(?![\\p{L}\\p{N}_@/-]|\\.[\\p{L}\\p{N}])'
  return new RegExp(`${start}${body}${end}`, 'giu')
}

/** Troca no texto; o nome escrito todo em maiúsculas ("USA PARTS") vira o novo em maiúsculas ("USAPARTS"). */
export function renameText(text: string, re: RegExp, to: string) {
  return text.replace(re, (m) => (m === m.toUpperCase() && m !== m.toLowerCase() && to !== to.toUpperCase() ? to.toUpperCase() : to))
}

/** Troca só nos valores de texto do JSON (chaves e números ficam). Devolve quantos textos mudaram. */
export function renameJson(value: unknown, re: RegExp, to: string): { value: unknown; changes: number } {
  let changes = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const n = renameText(v, re, to)
      if (n !== v) changes++
      return n
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { value: walk(value), changes }
}

/** Nomes aceitos: texto comum, sem aspas, barras ou quebras (vão para dentro de textos e de JSON). */
export function validNames(from: string, to: string): string | null {
  const f = from.trim()
  const t = to.trim()
  if (f.length < 3) return 'Escreva o nome antigo (pelo menos 3 letras).'
  if (!t) return 'Escreva o nome novo.'
  if ([f, t].some((s) => /["\\<>\u0000-\u001f]/.test(s) || s.length > 80)) return 'Use só letras, números, espaços e pontuação simples (até 80 caracteres).'
  if (f.toLowerCase() === t.toLowerCase() && f === t) return 'O nome novo é igual ao antigo.'
  return null
}
