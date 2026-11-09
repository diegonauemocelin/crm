/**
 * Endereço para o log sem os códigos de acesso que vão no caminho (webhook do WhatsApp, chaves da Meta e do Google Ads,
 * links públicos de postagens e de descadastro): o trecho do código vira "***".
 */
const SECRET_PATHS: RegExp[] = [
  /^(\/api\/webhooks\/whatsapp\/)[^/?#]+/,
  /^(\/api\/webhooks\/meta\/)[^/?#]+/,
  /^(\/api\/webhooks\/google-ads\/campanhas\/)[^/?#]+/,
  /^(\/api\/public\/postagens\/)[^/?#]+/,
  /^(\/api\/public\/descadastro\/)[^/?#]+/,
]

export function maskUrl(url: string): string {
  for (const re of SECRET_PATHS) if (re.test(url)) return url.replace(re, '$1***')
  return url
}
