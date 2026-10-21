import { dateTime } from './format'
/** Último contato do script do Google Ads (Ferramentas → Scripts), como a API devolve. */
export interface ScriptStatus {
  lastCallAt?: string
  lastError?: string | null
  campaignsSyncedAt?: string | null
}

/** O script roda 1 vez por dia: investimento mais velho que isto quer dizer que ele parou ou foi recusado. */
export const SCRIPT_STALE_HOURS = 36

const fmt = (iso: string) => dateTime(iso)

/**
 * Diagnóstico do investimento do Google Ads: diz por que o valor investido não chega.
 * - o CRM recusou o último envio (mostra o erro);
 * - o script chamou, mas sem o investimento (é o script antigo, só com os nomes);
 * - o script não chama há mais de 36 h (não está programado "Diariamente" ou está com erro no Google Ads).
 * Devolve null quando está tudo em dia.
 */
export function scriptDiagnosis(costSyncedAt: string | null, s: ScriptStatus | undefined, now = Date.now()): string | null {
  const stale = (iso: string | null | undefined) => !iso || now - Date.parse(iso) > SCRIPT_STALE_HOURS * 3_600_000
  if (!stale(costSyncedAt)) return null
  const lastCall = [s?.lastCallAt, s?.campaignsSyncedAt].filter((x): x is string => !!x).sort().pop() ?? null
  const since = costSyncedAt ? `desde ${fmt(costSyncedAt)}` : 'ainda'
  if (s?.lastCallAt && s.lastError && !stale(s.lastCallAt)) return `O script do Google Ads mandou dados em ${fmt(s.lastCallAt)}, mas o CRM recusou: ${s.lastError}`
  if (lastCall && !stale(lastCall)) return `O script do Google Ads está rodando (último contato em ${fmt(lastCall)}), mas não manda o investimento ${since}: é o script antigo, só com os nomes das campanhas. Troque pelo código novo.`
  return `O script do Google Ads não manda dados ${since}${lastCall ? ` (último contato em ${fmt(lastCall)})` : ''}. No Google Ads, em Ferramentas → Ações em massa → Scripts, confira se o script do CRM está com Frequência “Diariamente” e veja o Histórico da última execução (se pedir, autorize de novo).`
}
