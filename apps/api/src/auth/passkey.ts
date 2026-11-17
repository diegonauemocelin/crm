/** Entrar com Face ID / Touch ID / digital (funções puras). */

/** Aparelhos ativados por pessoa. */
export const PASSKEY_MAX = 5

/** Nome curto do aparelho pelo navegador, para a pessoa reconhecer na lista (ex.: "iPhone", "Android", "Windows"). */
export function deviceNameOf(userAgent: string | null | undefined) {
  const ua = userAgent ?? ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return 'Aparelho'
}
