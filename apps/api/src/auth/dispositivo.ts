/**
 * Nome legível do aparelho a partir do User-Agent ("Chrome no Windows", "Safari no iPhone").
 * Só navegador e sistema, sem versão: é o que a pessoa reconhece e é estável entre atualizações
 * (usado para avisar de acesso por aparelho novo). Funções puras (testadas em test/security.spec.ts).
 */

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Android/i, 'Android'],
  [/Windows/i, 'Windows'],
  [/CrOS/i, 'Chromebook'],
  [/Mac OS X|Macintosh/i, 'Mac'],
  [/Linux/i, 'Linux'],
]

// A ordem importa: Edge, Opera e Samsung também dizem "Chrome"; Chrome também diz "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

export interface Device {
  browser: string
  system: string
  /** Chave para comparar aparelhos (navegador + sistema). */
  key: string
  label: string
}

export function deviceOf(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? ''
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? 'sistema desconhecido'
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? (ua ? 'outro navegador' : 'navegador desconhecido')
  const known = SYSTEMS.some(([re]) => re.test(ua)) || BROWSERS.some(([re]) => re.test(ua))
  return { browser, system, key: `${browser}|${system}`, label: known ? `${browser} no ${system}` : 'Aparelho não identificado' }
}

/** Mostra só o começo do IP no e-mail de aviso (o suficiente para reconhecer, sem expor o endereço inteiro). */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return 'desconhecido'
  const v4 = ip.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 2).join('.') + '.x.x'
  return ip.split(':').slice(0, 3).join(':') + ':…'
}
