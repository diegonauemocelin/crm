import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useChatAlerts } from './chat-alerts'

export interface SuggestionAlerts {
  unreadReplies: number
  newSuggestions: number
}

/** Avisos das sugestões: respostas novas para mim e, para quem analisa, sugestões novas. */
export function useSuggestionAlerts() {
  return useQuery({ queryKey: ['sugestoes-avisos'], queryFn: () => api.get<SuggestionAlerts>('/sugestoes/avisos'), refetchInterval: 120_000, staleTime: 60_000 })
}

/** Número em destaque ao lado de cada item do menu (conversas não lidas, sugestões...). */
export function useNavBadges() {
  const chat = useChatAlerts().data?.unreadConversations ?? 0
  const s = useSuggestionAlerts().data
  const counts: Record<string, { n: number; label: string }> = {
    '/chat': { n: chat, label: 'conversas não lidas' },
    '/sugestoes': { n: s?.unreadReplies ?? 0, label: 'sugestões com resposta nova' },
    '/sugestoes/analisar': { n: s?.newSuggestions ?? 0, label: 'sugestões novas' },
  }
  return (to: string) => counts[to] ?? { n: 0, label: '' }
}
