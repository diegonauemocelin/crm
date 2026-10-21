/**
 * Formatos do sistema num lugar só: dinheiro, números, porcentagem e datas sempre do mesmo jeito em todas as
 * telas, e datas/horas sempre no horário de Brasília (não no do computador de quem abre).
 */
const TZ = 'America/Sao_Paulo'
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlShort = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const dateShortFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: TZ })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })

type N = number | null | undefined
const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))

export const money = (v: N) => (empty(v) ? '—' : brlFmt.format(v!))
export const moneyShort = (v: number) => brlShort.format(v)
export const num = (v: N) => (empty(v) ? '—' : intFmt.format(v!))
/** Valor que já está em % (12,5 = 12,5%). */
export const pct = (v: N) => (empty(v) ? '—' : `${v!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
/** Parte de um total, em %. */
export const pctOf = (part: number, of: number) => (of ? pct((part / of) * 100) : '—')

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v))
/** 21/10/2026 (horário de Brasília). */
export const dateShort = (v: string | Date | null | undefined) => (v ? dateShortFmt.format(toDate(v)) : '—')
/** 21/10/2026 14:30 (horário de Brasília). */
export const dateTime = (v: string | Date | null | undefined) => (v ? dateTimeFmt.format(toDate(v)) : '—')
/** 14:30 (horário de Brasília). */
export const time = (v: string | Date | null | undefined) => (v ? timeFmt.format(toDate(v)) : '—')
/** Dia AAAA-MM-DD → 21/10/2026 (sem mexer no fuso: é um dia, não um instante). */
export const dayBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Hoje em Brasília, AAAA-MM-DD (com deslocamento em dias). */
export function todaySP(offsetDays = 0) {
  return new Date(Date.now() - 3 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
}
