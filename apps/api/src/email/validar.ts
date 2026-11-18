/**
 * Validação de e-mail dos leads (funções puras; a consulta ao DNS fica no serviço). Um e-mail inválido não entra no
 * e-mail marketing nem nas automações de e-mail: evita devolução, que derruba a reputação do domínio que envia.
 */

/** Domínios de e-mail grandes e os erros de digitação mais comuns (o domínio digitado errado não existe ou não é o dele). */
const TYPO: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gmail.com.br': 'gmail.com',
  'gmail.br': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmsil.com': 'gmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmaill.com': 'hotmail.com',
  'hotamil.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yahoo.com.b': 'yahoo.com.br',
  'yahho.com.br': 'yahoo.com.br',
  'bol.com': 'bol.com.br',
  'uol.com': 'uol.com.br',
  'terra.com': 'terra.com.br',
  'icloud.con': 'icloud.com',
  'iclod.com': 'icloud.com',
}

/** E-mails "de mentira" que o cliente digita para passar do formulário. */
const FAKE_LOCAL = /^(teste?|test|naotem|nao[-_.]?tem|semail|sem[-_.]?e?mail|naopossui|nenhum|xxx+|aaa+|asd+|qwe+|abc|email|e-?mail|a|x|0+|1+|123+|n)$/i
const FAKE_DOMAIN = /^(teste?|test|exemplo|example|email|e-?mail|xxx+|aaa+|asd+|naotem|sememail|abc)\.(com|com\.br|br)$/i

export type EmailCheck = { ok: true; domain: string } | { ok: false; reason: string; suggestion?: string }

/** O que dá para saber sem consultar a internet: formato, e-mail de mentira e domínio grande digitado errado. */
export function checkEmailText(raw: string | null | undefined): EmailCheck {
  const email = String(raw ?? '').trim().toLowerCase()
  if (!email) return { ok: false, reason: 'E-mail vazio.' }
  if (email.length > 254) return { ok: false, reason: 'E-mail longo demais.' }
  const at = email.lastIndexOf('@')
  if (at <= 0 || email.indexOf('@') !== at) return { ok: false, reason: 'Formato inválido (precisa de um @).' }
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { ok: false, reason: 'Formato inválido antes do @.' }
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) || domain.includes('..')) return { ok: false, reason: 'Domínio inválido (depois do @).' }
  if (TYPO[domain]) return { ok: false, reason: `Provável erro de digitação: o certo seria ${local}@${TYPO[domain]}.`, suggestion: `${local}@${TYPO[domain]}` }
  if (FAKE_DOMAIN.test(domain) || (FAKE_LOCAL.test(local) && /^(gmail|hotmail|outlook|yahoo|uol|bol|terra|icloud)\./.test(domain))) return { ok: false, reason: 'E-mail de mentira (preenchido só para passar do cadastro).' }
  return { ok: true, domain }
}

/** Resultado da consulta ao DNS: o domínio recebe e-mail (MX ou, sem MX, um endereço), não existe, ou não deu para saber. */
export type DomainMail = 'RECEBE' | 'NAO_EXISTE' | 'SEM_EMAIL' | 'INCERTO'

/** Erros do DNS que dizem que o domínio não existe ou não tem o registro (os outros são falha de rede: tenta depois). */
export function dnsMeaning(code: string | undefined): 'NAO_EXISTE' | 'SEM_REGISTRO' | 'INCERTO' {
  if (code === 'ENOTFOUND') return 'NAO_EXISTE'
  if (code === 'ENODATA') return 'SEM_REGISTRO'
  return 'INCERTO'
}

export function domainReason(d: Exclude<DomainMail, 'RECEBE' | 'INCERTO'>, domain: string) {
  return d === 'NAO_EXISTE' ? `O domínio ${domain} não existe.` : `O domínio ${domain} não recebe e-mail.`
}
