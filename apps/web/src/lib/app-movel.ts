import { api } from './api'

/**
 * App no celular (PWA): instalado na tela inicial ele abre direto no chat do celular (/app), sem o menu do sistema.
 * As notificações de mensagem nova chegam pelo service worker (public/sw.js), mesmo com o app fechado.
 */

/** Aberto pelo ícone da tela inicial (e não pelo navegador). */
export function isInstalledApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isAndroid = () => /Android/i.test(navigator.userAgent)

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}

/** O app pode receber notificação neste aparelho? (no iPhone, só instalado na tela inicial, iOS 16.4 ou mais novo) */
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
}

export type PushState = 'indisponivel' | 'bloqueado' | 'ligado' | 'desligado'

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'indisponivel'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado'
}

function keyBytes(base64: string) {
  const s = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Liga as notificações: pede a permissão (tem que ser num toque da pessoa) e inscreve o aparelho. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Este aparelho não recebe notificações por aqui. No iPhone, instale o app na tela inicial primeiro.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('As notificações foram bloqueadas. Libere nas configurações do celular (Notificações) e tente de novo.')
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  const { publicKey } = await api.get<{ publicKey: string }>('/app/push/chave')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await api.post('/app/push/inscricao', { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api.post('/app/push/cancelar', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe()
}

/** Ao entrar, o aparelho que já tinha notificação ligada passa a ser deste usuário (celular compartilhado). */
export async function refreshPushOwner() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await api.post('/app/push/inscricao', { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }).catch(() => undefined)
}
