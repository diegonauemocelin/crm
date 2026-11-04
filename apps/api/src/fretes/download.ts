import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** IP de rede interna, da própria máquina ou reservado: o CRM não busca nada nesses endereços. */
export function privateIp(ip: string) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase()
    if (v.startsWith('::ffff:')) return privateIp(v.slice(7))
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
  }
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/**
 * Baixa um arquivo público por https (lista de cidades no site da transportadora). Recusa endereço de rede interna,
 * redirecionamento e arquivo maior que o limite.
 */
export async function downloadPublic(url: string, maxBytes: number): Promise<Buffer> {
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('o endereço precisa ser https://')
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true })
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('endereço não permitido')
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'CRM-fretes/1.0' } })
  if (!res.ok) throw new Error(`o site respondeu ${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > maxBytes) throw new Error('arquivo grande demais')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error('arquivo grande demais')
  return buf
}
