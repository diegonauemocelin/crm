/**
 * Regras puras da integração com a loja virtual Magazord (testadas em test/magazord.spec.ts):
 * situação dos pedidos, leitura de clientes e carrinhos e mensagem de recuperação.
 * API: https://docs-v2.api.magazord.com.br (Basic Auth com token + senha do usuário WebService).
 */
import { normalizePhone } from '../atendimento/br'

/** Situações do pedido (tabela "Definição dos dados" da Magazord). */
const PAID = new Set([4, 5, 6, 7, 8, 12, 19, 23, 27, 29, 30])
const CANCELED = new Set([2, 14, 24, 26])

export type OrderGroup = 'pago' | 'pendente' | 'cancelado' | 'outro'

export function orderGroup(code: number): OrderGroup {
  if (PAID.has(code)) return 'pago'
  if (CANCELED.has(code)) return 'cancelado'
  if ([1, 3, 13, 15, 18].includes(code)) return 'pendente'
  return 'outro'
}

/** Só endereços da Magazord (evita que o painel seja usado para o servidor chamar outro lugar). */
export function cleanBaseUrl(input: string): string | null {
  let u: URL
  try {
    u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.magazord\.com\.br$/.test(host)) return null
  return `https://${host}`
}

export interface MagazordPessoa {
  id: number | string
  tipo?: number
  nome?: string | null
  nomeFantasia?: string | null
  email?: string | null
  dataCadastro?: string | null
  pessoaContato?: { tipo?: number; contato?: string | null }[] | null
  pessoaEndereco?: { cidadeNome?: string | null; estadoSigla?: string | null }[] | null
}

export interface CustomerData {
  externalId: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  city: string | null
  state: string | null
  registeredAt: Date | null
}

/** Datas da Magazord vêm sem fuso ("2024-07-29" ou "2024-07-29 10:00:00"): são horário de Brasília. */
export function parseMzDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v)
  if (!m) return null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Formato que a API espera nos filtros de carrinho ("2024-03-21 22:00:38", horário de Brasília). */
export function mzDateTime(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

/** Cliente da loja -> dados do lead. CPF/CNPJ não é lido nem guardado (não é necessário para o marketing). */
export function customerFrom(p: MagazordPessoa): CustomerData {
  const email = p.email?.trim().toLowerCase() || null
  let phone: string | null = null
  for (const c of p.pessoaContato ?? []) {
    const v = c?.contato?.trim()
    if (!v || v.includes('@')) continue
    const n = normalizePhone(v)
    // Celular (9 dígitos) tem preferência: é o que funciona no WhatsApp.
    if (n && (!phone || (/^\+55\d{2}9/.test(n) && !/^\+55\d{2}9/.test(phone)))) phone = n
  }
  const addr = (p.pessoaEndereco ?? []).find((a) => a?.cidadeNome || a?.estadoSigla) ?? null
  const juridica = p.tipo === 2
  return {
    externalId: String(p.id),
    name: p.nome?.trim() || null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone,
    company: juridica ? p.nomeFantasia?.trim() || p.nome?.trim() || null : null,
    city: addr?.cidadeNome?.trim() || null,
    state: addr?.estadoSigla?.trim().toUpperCase().slice(0, 2) || null,
    registeredAt: parseMzDate(p.dataCadastro),
  }
}

export interface CartItem {
  code: string
  name: string
  qty: number
  image: string | null
  url: string | null
}

/** Nome legível a partir do endereço da página do produto ("filtro-de-combustivel-re539465"). */
export function nameFromUrl(url: string | null | undefined, code: string) {
  if (!url) return code
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    const text = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim()
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : code
  } catch {
    return code
  }
}

export function cartItems(itens: { codigo_produto?: string | null; quantidade?: number | null; midia_url?: string | null; url_pagina?: string | null }[] | null | undefined): CartItem[] {
  const safe = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u.slice(0, 500) : null)
  return (itens ?? []).slice(0, 50).map((i) => {
    const code = String(i?.codigo_produto ?? '').slice(0, 60)
    return { code, name: nameFromUrl(i?.url_pagina, code).slice(0, 160), qty: Math.max(1, Number(i?.quantidade) || 1), image: safe(i?.midia_url), url: safe(i?.url_pagina) }
  })
}

/** Mensagem de WhatsApp para recuperar o carrinho. Variáveis: {nome}, {produtos}, {link}, {cupom}. */
export function cartMessage(template: string, v: { name: string | null; items: CartItem[]; link: string | null; coupon: string }) {
  const first = v.name?.trim().split(/\s+/)[0] ?? ''
  const products = v.items.length ? (v.items.length > 2 ? `${v.items.slice(0, 2).map((i) => i.name).join(', ')} e mais ${v.items.length - 2}` : v.items.map((i) => i.name).join(' e ')) : 'os produtos'
  return template
    .replaceAll('{nome}', first)
    .replaceAll('{produtos}', products)
    .replaceAll('{link}', v.link ?? '')
    .replaceAll('{cupom}', v.coupon)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export const DEFAULT_CART_MESSAGE =
  'Olá, {nome}! Aqui é da USA Parts. Vi que você deixou {produtos} no carrinho. Posso te ajudar a finalizar? Use o cupom {cupom} para ganhar um desconto: {link}'
