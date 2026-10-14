import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from './api'
import { useAuth } from './auth'

export interface ChatAlerts {
  unreadConversations: number
  unreadMessages: number
  latest: { conversationId: string; name: string; preview: string | null; at: string | null } | null
  dueReminders: { id: string; conversationId: string; name: string; note: string | null; dueAt: string; notified: boolean }[]
  upcomingReminders: number
}

const SOUND_KEY = 'crm-chat-som'

/** Som dos avisos (preferência deste navegador). */
export function soundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}
export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // Sem armazenamento (aba anônima): fica ligado.
  }
}

/** Dois toques curtos, gerados pelo navegador (sem arquivo de som). */
export function beep() {
  if (!soundOn()) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = i ? 1046 : 784
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.17)
    })
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // Navegador sem áudio liberado ainda (precisa de um clique na página antes): só o aviso visual.
  }
}

/** Notificação do sistema (só com permissão dada no Chat). Clicar leva para a conversa. */
export function systemNotify(title: string, body: string, onClick: () => void, tag: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, tag, icon: '/favicon.ico' })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  } catch {
    // Alguns navegadores só permitem notificação pelo service worker: fica o aviso na tela.
  }
}

/** Não lidas e lembretes vencidos, consultados a cada 20 s (também com a aba em segundo plano). */
export function useChatAlerts() {
  const { can } = useAuth()
  return useQuery({
    queryKey: ['chat-alertas'],
    queryFn: () => api.get<ChatAlerts>('/chat/alertas'),
    enabled: can('chat'),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    staleTime: 10_000,
  })
}

/**
 * Avisos do chat em qualquer tela: mensagem nova (som, aviso na tela e notificação do navegador) e lembrete de
 * retorno no horário (fica na tela até a pessoa abrir, adiar ou fechar). O título da aba mostra as não lidas.
 */
export function ChatNotifier() {
  const alerts = useChatAlerts()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const lastAt = useRef<string | null | undefined>(undefined)
  const lastCount = useRef(0)
  const shown = useRef(new Set<string>())
  const d = alerts.data

  // Contador no título da aba.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s+/, '')
    document.title = d && d.unreadConversations > 0 ? `(${d.unreadConversations}) ${base}` : base
  }, [d?.unreadConversations])

  // Mensagem nova: só quando aumenta (a primeira consulta só guarda o estado).
  useEffect(() => {
    if (!d) return
    const at = d.latest?.at ?? null
    if (lastAt.current !== undefined && d.latest && at && at !== lastAt.current && d.unreadMessages > lastCount.current) {
      const open = () => navigate(`/chat?conversa=${d.latest!.conversationId}`)
      beep()
      const onChat = pathname === '/chat'
      if (document.hidden || !onChat) systemNotify(`WhatsApp: ${d.latest.name}`, d.latest.preview ?? 'Nova mensagem', open, `chat-${d.latest.conversationId}`)
      if (!onChat) toast(`Nova mensagem de ${d.latest.name}`, { description: d.latest.preview ?? undefined, action: { label: 'Abrir', onClick: open }, duration: 8000 })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    }
    lastAt.current = at
    lastCount.current = d.unreadMessages
  }, [d, navigate, pathname, qc])

  // Lembretes vencidos que ainda não apareceram.
  useEffect(() => {
    if (!d) return
    for (const r of d.dueReminders.filter((x) => !x.notified && !shown.current.has(x.id))) {
      shown.current.add(r.id)
      const open = () => navigate(`/chat?conversa=${r.conversationId}`)
      beep()
      systemNotify(`Lembrete: ${r.name}`, r.note ?? 'Hora de retornar a conversa no WhatsApp.', open, `lembrete-${r.id}`)
      toast(`Lembrete de retorno: ${r.name}`, {
        description: r.note ?? 'Hora de retornar a conversa no WhatsApp.',
        duration: Infinity,
        action: { label: 'Abrir conversa', onClick: open },
        cancel: {
          label: 'Adiar 1 h',
          onClick: () => void api.post(`/chat/lembretes/${r.id}/adiar`, { minutes: 60 }).then(() => qc.invalidateQueries({ queryKey: ['chat-alertas'] })),
        },
      })
      void api.post(`/chat/lembretes/${r.id}/avisado`).catch(() => undefined)
    }
  }, [d, navigate, qc])

  return null
}
