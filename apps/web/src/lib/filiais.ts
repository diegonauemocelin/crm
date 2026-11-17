import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** Sugestão de filial pelo DDD do contato (mesma regra de apps/api/src/whatsapp/filiais.ts): só sinaliza no chat. */
export interface FilialRule {
  name: string
  ddds: string[]
  color: string
}

export const FILIAL_COLOR_CLASS: Record<string, string> = {
  azul: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
  verde: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  laranja: 'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200',
  roxo: 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200',
  rosa: 'border-pink-300 bg-pink-100 text-pink-800 dark:border-pink-700 dark:bg-pink-950 dark:text-pink-200',
  ciano: 'border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
}

export function useFiliais() {
  return useQuery({ queryKey: ['chat-filiais'], queryFn: () => api.get<{ rules: FilialRule[]; colors: string[] }>('/chat/filiais'), staleTime: 10 * 60_000 })
}

/** DDD do telefone brasileiro (+55DD...), ou null. */
export function dddOf(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) return null
  const d = digits.slice(2, 4)
  return /^[1-9][1-9]$/.test(d) ? d : null
}

export function filialOf(phone: string | null | undefined, rules: FilialRule[] | undefined) {
  const ddd = dddOf(phone)
  if (!ddd || !rules) return null
  const rule = rules.find((r) => r.ddds.includes(ddd))
  return rule ? { ...rule, ddd } : null
}
