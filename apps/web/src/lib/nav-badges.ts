import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'
import { useChatAlerts } from './chat-alerts'

export interface SuggestionAlerts {
  unreadReplies: number
  newSuggestions: number
}

/** Avisos das sugestões: respostas novas para mim e, para quem analisa, sugestões novas. */
export function useSuggestionAlerts() {
  return useQuery({ queryKey: ['sugestoes-avisos'], queryFn: () => api.get<SuggestionAlerts>('/sugestoes/avisos'), refetchInterval: 120_000, staleTime: 60_000 })
}

/** Perguntas do Mercado Livre esperando resposta (Assistente ML), para quem atende. */
export function usePendingQuestions() {
  const { can } = useAuth()
  return useQuery({ queryKey: ['assist-pendentes-contagem'], queryFn: () => api.get<{ pending: number }>('/assistente/perguntas/pendentes/contagem'), enabled: can('assist_atendimento'), refetchInterval: 60_000, staleTime: 30_000 })
}

/** Número em destaque ao lado de cada item do menu (conversas não lidas, sugestões...). */
export function useNavBadges() {
  const chat = useChatAlerts().data?.unreadConversations ?? 0
  const s = useSuggestionAlerts().data
  const questions = usePendingQuestions().data?.pending ?? 0
  const counts: Record<string, { n: number; label: string }> = {
    '/chat': { n: chat, label: 'conversas não lidas' },
    '/sugestoes': { n: s?.unreadReplies ?? 0, label: 'sugestões com resposta nova' },
    '/marketplaces/assistente/pendentes': { n: questions, label: 'perguntas para responder' },
    '/sugestoes/analisar': { n: s?.newSuggestions ?? 0, label: 'sugestões novas' },
  }
  return (to: string) => counts[to] ?? { n: 0, label: '' }
}
