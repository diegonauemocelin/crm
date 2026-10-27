/*
 * App no celular: mostra as notificações (mensagem nova no chat) e abre a conversa ao tocar.
 * Não guarda páginas em cache: depois de uma atualização do sistema, o app abre sempre a versão nova.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Sem cache: o navegador busca tudo na rede, como no site. O ouvinte existe para o celular aceitar instalar o app.
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Nova mensagem', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Nova mensagem'
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/api/app/icone.png',
        badge: '/app-badge.png',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: data.url || '/app' },
      })
      // Bolinha no ícone do app: uma por conversa com aviso na bandeja (o app acerta o número ao abrir).
      const shown = await self.registration.getNotifications()
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(shown.length).catch(() => undefined)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/app', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // App já aberto: vai para a conversa nele, em vez de abrir outra janela.
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus()
          w.postMessage({ type: 'abrir', url })
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
