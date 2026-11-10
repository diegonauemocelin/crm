/**
 * Marketing › Web Push (notificações no navegador para quem visita a loja virtual). Regras puras, sem Nest: validação
 * da campanha, horário de envio, porcentagens, regra de quando perguntar de novo, o arquivo do service worker que vai na
 * raiz da loja e o trecho do script do site que pede a permissão.
 */
import { createHmac } from 'node:crypto'

export const TITLE_MAX = 70
export const MESSAGE_MAX = 140
export const NAME_MAX = 80
export const BUTTON_MAX = 25
export const URL_MAX = 1000

/** Arquivo que a loja publica na raiz do domínio (https://loja/crm-push-sw.js). */
export const SW_FILE = 'crm-push-sw.js'
/** Texto que o CRM procura no arquivo publicado para saber que é o certo. */
export const SW_MARKER = 'CRM Web Push service worker v1'

/** Chave nas configurações da empresa (a do app no celular é "web_push": não mexer). */
export const SETTINGS_KEY = 'site_push'

export interface PromptSettings {
  title: string
  text: string
  allowLabel: string
  denyLabel: string
  /** Segundos na página antes de mostrar a caixa. */
  delaySec: number
  /** Depois de "Agora não", quantos dias até perguntar de novo. */
  askAgainDays: number
  color: string
}

export interface SitePushSettings {
  enabled: boolean
  /** Endereço da loja (https://www.exemplo.com.br): onde o arquivo do service worker precisa estar. */
  siteUrl: string
  prompt: PromptSettings
  /** Par de chaves VAPID só do site (a privada criptografada). Criado na primeira vez. */
  publicKey?: string
  privateKeyEnc?: string
}

export const DEFAULT_PROMPT: PromptSettings = {
  title: 'Receba nossas ofertas e novidades',
  text: 'Ative as notificações para saber primeiro das promoções, lançamentos e avisos da loja. Você pode desativar quando quiser.',
  allowLabel: 'Permitir',
  denyLabel: 'Agora não',
  delaySec: 8,
  askAgainDays: 7,
  color: '#1d4ed8',
}

export const DEFAULT_SETTINGS: SitePushSettings = { enabled: false, siteUrl: '', prompt: DEFAULT_PROMPT }

const HEX = /^#[0-9a-fA-F]{6}$/

/** Junta o que veio salvo com os padrões, conferindo cada campo da caixa de permissão. */
export function cleanPrompt(p: Partial<PromptSettings> | null | undefined): PromptSettings {
  const s = (v: unknown, max: number, fb: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb)
  const n = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fb)
  return {
    title: s(p?.title, 80, DEFAULT_PROMPT.title),
    text: s(p?.text, 220, DEFAULT_PROMPT.text),
    allowLabel: s(p?.allowLabel, 25, DEFAULT_PROMPT.allowLabel),
    denyLabel: s(p?.denyLabel, 25, DEFAULT_PROMPT.denyLabel),
    delaySec: n(p?.delaySec, 0, 300, DEFAULT_PROMPT.delaySec),
    askAgainDays: n(p?.askAgainDays, 1, 365, DEFAULT_PROMPT.askAgainDays),
    color: typeof p?.color === 'string' && HEX.test(p.color) ? p.color : DEFAULT_PROMPT.color,
  }
}

/** Endereço https sem usuário/senha; devolve normalizado ou null. */
export function httpsUrl(raw: unknown, max = URL_MAX): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > max) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Endereço da loja: só a origem (https://host), sem caminho. Recusa IP e localhost. */
export function siteOrigin(raw: unknown): string | null {
  const v = typeof raw === 'string' && raw.trim() && !/^https?:\/\//i.test(raw.trim()) ? `https://${raw.trim()}` : raw
  const u = httpsUrl(v, 200)
  if (!u) return null
  const host = new URL(u).hostname.toLowerCase()
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local')) return null
  return `https://${host}`
}

export interface CampaignInput {
  name: string
  title: string
  message: string
  url: string
  buttonLabel?: string | null
}

/** Rascunho só precisa do nome; enviar e agendar precisam de tudo certo. Devolve a primeira falha ou null. */
export function campaignError(c: CampaignInput, forSending: boolean): string | null {
  const name = c.name?.trim() ?? ''
  if (!name) return 'Dê um nome ao web push (só aparece aqui no CRM).'
  if (name.length > NAME_MAX) return `O nome pode ter até ${NAME_MAX} caracteres.`
  const title = c.title?.trim() ?? ''
  const message = c.message?.trim() ?? ''
  if (title.length > TITLE_MAX) return `O título pode ter até ${TITLE_MAX} caracteres.`
  if (message.length > MESSAGE_MAX) return `A mensagem pode ter até ${MESSAGE_MAX} caracteres.`
  if (c.buttonLabel != null && c.buttonLabel.trim().length > BUTTON_MAX) return `O texto do botão pode ter até ${BUTTON_MAX} caracteres.`
  if (c.url?.trim() && !httpsUrl(c.url)) return 'A URL precisa começar com https:// (ex.: https://www.loja.com.br/ofertas).'
  if (!forSending) return null
  if (!title) return 'Escreva o título da notificação.'
  if (!message) return 'Escreva a mensagem da notificação.'
  if (!c.url?.trim()) return 'Informe a URL que abre ao clicar na notificação.'
  if (c.buttonLabel != null && !c.buttonLabel.trim()) return 'Escreva o texto do botão ou desligue "Usar botão".'
  return null
}

/**
 * Data e hora de Brasília (AAAA-MM-DD e HH:mm) em UTC. O Brasil não tem horário de verão desde 2019: -03:00 fixo.
 */
export function saoPauloToUtc(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time}:00-03:00`)
  if (Number.isNaN(d.getTime())) return null
  // 2026-02-31 vira março no Date: confere se o dia continua o mesmo.
  const back = new Date(d.getTime() - 3 * 3_600_000).toISOString()
  return back.slice(0, 10) === date && back.slice(11, 16) === time ? d : null
}

/** Agendamento aceito: no futuro (com 1 minuto de folga) e em até 1 ano. */
export function scheduleError(at: Date, now: Date): string | null {
  if (at.getTime() < now.getTime() - 60_000) return 'Escolha uma data e hora no futuro.'
  if (at.getTime() > now.getTime() + 366 * 86_400_000) return 'Agende para no máximo um ano à frente.'
  return null
}

export function isDue(c: { status: string; scheduledAt: Date | null }, now: Date) {
  return c.status === 'AGENDADO' && !!c.scheduledAt && c.scheduledAt.getTime() <= now.getTime()
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

/** Entregas sobre os disparos; cliques sobre as entregas (ou sobre os disparos, enquanto nenhuma entrega voltou). */
export function statsOf(c: { sent: number; delivered: number; clicks: number }) {
  return { deliveredPct: pct(c.delivered, c.sent), clickPct: pct(c.clicks, c.delivered || c.sent) }
}

// ---------- Inscrição vinda do navegador ----------

/** Serviços de notificação dos navegadores (Chrome/Edge/Opera, Firefox, Safari, Windows). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]

export function pushEndpointOk(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > URL_MAX) return false
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname.toLowerCase()))
  } catch {
    return false
  }
}

function b64urlBytes(v: unknown): Buffer | null {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(v) || v.length > 200) return null
  return Buffer.from(v.replace(/=+$/, ''), 'base64url')
}

/** Chave do navegador: ponto P-256 sem compressão (65 bytes, começa em 0x04) e segredo de 16 bytes. */
export function subscriptionKeysOk(p256dh: unknown, auth: unknown) {
  const p = b64urlBytes(p256dh)
  const a = b64urlBytes(auth)
  return !!p && p.length === 65 && p[0] === 4 && !!a && a.length === 16
}

export interface SubscribeBody {
  k: string
  endpoint: string
  p256dh: string
  auth: string
  /** Visitante do rastreamento (_crm_vid), quando há. */
  v: string | null
}

/** Corpo do POST da inscrição (chega como texto, sem pré-verificação de CORS). Qualquer coisa fora do esperado: null. */
export function parseSubscribe(raw: unknown): SubscribeBody | null {
  let p: Record<string, unknown>
  try {
    p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  if (typeof p.k !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(p.k)) return null
  if (!pushEndpointOk(p.endpoint)) return null
  if (!subscriptionKeysOk(p.p256dh, p.auth)) return null
  const v = typeof p.v === 'string' && /^[0-9a-f]{32}$/.test(p.v) ? p.v : null
  return { k: p.k, endpoint: p.endpoint, p256dh: p.p256dh as string, auth: p.auth as string, v }
}

/** Corpo do cancelamento: chave do site e o endereço da inscrição. */
export function parseUnsubscribe(raw: unknown): { k: string; endpoint: string } | null {
  try {
    const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
    if (!p || typeof p.k !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(p.k) || !pushEndpointOk(p.endpoint)) return null
    return { k: p.k, endpoint: p.endpoint }
  } catch {
    return null
  }
}

// ---------- Links de entrega e clique ----------

/** Assinatura do par campanha + inscrito (o "u" dos links): conta entrega e clique só de quem recebeu de verdade. */
export function signDelivery(key: string | Buffer, campaignId: string, subscriberId: string) {
  const sig = createHmac('sha256', key).update(`${campaignId}:${subscriberId}`).digest('base64url').slice(0, 22)
  return `${subscriberId}.${sig}`
}

export function verifyDelivery(key: string | Buffer, campaignId: string, u: unknown): string | null {
  if (typeof u !== 'string' || u.length > 80) return null
  const [sub] = u.split('.')
  if (!sub || !/^[0-9a-f-]{36}$/.test(sub)) return null
  const expected = signDelivery(key, campaignId, sub)
  if (expected.length !== u.length) return null
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0 ? sub : null
}

/**
 * Link da campanha com a origem "webpush" (aparece assim no rastreamento do site e no GA4). UTMs que a pessoa já pôs
 * no link são mantidas.
 */
export function withUtm(url: string, name: string) {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('utm_source')) {
      const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      u.searchParams.set('utm_source', 'crm')
      u.searchParams.set('utm_medium', 'webpush')
      if (slug) u.searchParams.set('utm_campaign', slug)
    }
    return u.toString()
  } catch {
    return url
  }
}

export interface PushPayload {
  title: string
  body: string
  icon: string | null
  image: string | null
  url: string
  button: string | null
  /** O service worker avisa aqui quando a notificação aparece (Entregas). */
  shown: string
  tag: string
}

/** Conteúdo cifrado que vai para cada navegador (limite do serviço de notificação: ~4 KB). */
export function buildPayload(p: PushPayload) {
  return JSON.stringify({
    title: p.title.slice(0, TITLE_MAX),
    body: p.body.slice(0, MESSAGE_MAX),
    icon: p.icon,
    image: p.image,
    url: p.url,
    button: p.button ? p.button.slice(0, BUTTON_MAX) : null,
    shown: p.shown,
    tag: p.tag,
  })
}

// ---------- Navegador: service worker e caixa de permissão ----------

/**
 * Arquivo crm-push-sw.js, publicado na raiz da loja. Mostra a notificação, avisa a entrega, abre o link no clique e,
 * quando o navegador troca a inscrição sozinho, inscreve de novo.
 */
export function buildServiceWorker(o: { apiBase: string; siteKey: string }) {
  const cfg = JSON.stringify({ api: o.apiBase, k: o.siteKey })
  return `/* ${SW_MARKER} - notificações da loja enviadas pelo CRM. Publique na raiz do site: /${SW_FILE} */
var CRM = ${cfg};
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  if (!data || !data.title) return;
  var opts = { body: data.body || '', data: { url: data.url || '/' }, tag: data.tag || undefined };
  if (data.icon) opts.icon = data.icon;
  if (data.image) opts.image = data.image;
  if (data.button) opts.actions = [{ action: 'abrir', title: data.button }];
  var shown = data.shown ? fetch(data.shown, { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true }).catch(function () {}) : null;
  event.waitUntil(Promise.all([self.registration.showNotification(data.title, opts), shown]));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url;
  if (url) event.waitUntil(self.clients.openWindow(url));
});
self.addEventListener('pushsubscriptionchange', function (event) {
  var old = event.oldSubscription;
  var key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then(function (sub) {
    var j = sub.toJSON(), keys = j.keys || {};
    var post = function (path, body) { return fetch(CRM.api + path, { method: 'POST', body: JSON.stringify(body), credentials: 'omit' }); };
    return Promise.all([
      post('/api/public/webpush/inscrever', { k: CRM.k, endpoint: j.endpoint, p256dh: keys.p256dh, auth: keys.auth }),
      old.endpoint ? post('/api/public/webpush/cancelar', { k: CRM.k, endpoint: old.endpoint }) : null
    ]);
  }).catch(function () {}));
});
`
}

/**
 * Regra da caixa de permissão (roda no navegador; testada como texto). "until" é o momento em que pode perguntar de
 * novo, gravado quando o visitante clica em "Agora não".
 */
export const PROMPT_RULE_JS = `function wpShouldAsk(perm, until, now) {
    if (perm !== 'default') return false;
    var u = Number(until) || 0;
    return !u || now >= u;
  }`

/**
 * Trecho do script do site (dentro do rastreamento: usa w, d, C, nav e get). Só pede a permissão quando o navegador
 * ainda não respondeu e o visitante não clicou em "Agora não" há pouco. Tudo montado com textContent (sem innerHTML).
 */
export const PUSH_JS = `
  // ---------- Web Push da loja ----------
  var WP = null, WP_BASE = C.e.slice(0, Math.max(0, C.e.indexOf('/api/public/')));
  function wpStore(k, v) { try { if (v === undefined) return w.localStorage.getItem(k); w.localStorage.setItem(k, v); } catch (e) { return null; } }
  ${PROMPT_RULE_JS}
  function wpKey(s) {
    var b = (s + '==='.slice(0, (4 - s.length % 4) % 4)).split('-').join('+').split('_').join('/');
    var r = w.atob(b), a = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i);
    return a;
  }
  function wpSend(sub) {
    var j = sub.toJSON ? sub.toJSON() : {}, keys = j.keys || {};
    var body = { k: C.k, endpoint: j.endpoint || sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, v: get('_crm_vid') || null };
    return fetch(WP_BASE + '/api/public/webpush/inscrever', { method: 'POST', body: JSON.stringify(body), credentials: 'omit', keepalive: true })
      .then(function () { wpStore('_crm_wp_sync', String(Date.now())); });
  }
  function wpActive(reg) {
    return new Promise(function (ok) {
      var sw = reg.installing || reg.waiting;
      if (reg.active || !sw) return ok(reg);
      sw.addEventListener('statechange', function () { if (sw.state === 'activated') ok(reg); });
    });
  }
  function wpRegister() {
    var sw = nav.serviceWorker, file = '/' + WP.sw;
    return sw.getRegistrations().then(function (list) {
      var other = false;
      for (var i = 0; i < list.length; i++) {
        var a = list[i].active || list[i].waiting || list[i].installing;
        var url = a ? String(a.scriptURL).split('?')[0] : '';
        if (url.slice(-file.length) === file) return list[i];
        if (list[i].scope === location.origin + '/') other = true;
      }
      // A loja já tem um service worker na raiz: o do CRM fica num escopo próprio para não substituir o dela.
      return sw.register(file, { scope: other ? '/crm-push/' : '/' });
    });
  }
  function wpSubscribe() {
    return wpRegister().then(wpActive).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) {
        return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wpKey(WP.key) });
      });
    }).then(wpSend).catch(function () {});
  }
  function wpLater() { wpStore('_crm_wp_until', String(Date.now() + WP.prompt.askAgainDays * 864e5)); }
  function wpAsk() {
    // Safari antigo só chama a função; os outros devolvem a promessa (e alguns fazem as duas coisas): responde uma vez.
    var answered = false;
    var done = function (perm) { if (answered) return; answered = true; if (perm === 'granted') wpSubscribe(); else if (perm !== 'denied') wpLater(); };
    try { var r = w.Notification.requestPermission(done); if (r && r.then) r.then(done); } catch (e) {}
  }
  function wpPrompt() {
    if (w.Notification.permission !== 'default' || !d.body) return;
    var p = WP.prompt, host = d.createElement('div'), root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var color = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#1d4ed8';
    var st = d.createElement('style');
    st.textContent = ':host{all:initial}*{box-sizing:border-box}'
      + '.b{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483001;width:420px;max-width:calc(100vw - 24px);background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;display:flex;gap:12px;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
      + '.b img{width:48px;height:48px;border-radius:10px;object-fit:cover;flex:none}.b strong{display:block;font-size:15px;margin-bottom:4px}.b p{margin:0 0 12px;color:#334155}'
      + '.r{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.r button{font:inherit;font-weight:600;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155}.r button.y{border:0;color:#fff}';
    root.appendChild(st);
    var box = d.createElement('div'); box.className = 'b'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', p.title);
    if (WP.icon) { var img = d.createElement('img'); img.src = WP.icon; img.alt = ''; box.appendChild(img); }
    var body = d.createElement('div'), t = d.createElement('strong'), tx = d.createElement('p'), row = d.createElement('div');
    t.textContent = p.title; tx.textContent = p.text; row.className = 'r';
    var no = d.createElement('button'), yes = d.createElement('button');
    no.type = 'button'; yes.type = 'button'; no.textContent = p.denyLabel; yes.textContent = p.allowLabel; yes.className = 'y'; yes.style.background = color;
    row.appendChild(no); row.appendChild(yes); body.appendChild(t); body.appendChild(tx); body.appendChild(row); box.appendChild(body); root.appendChild(box);
    var close = function () { if (host.parentNode) host.parentNode.removeChild(host); };
    no.addEventListener('click', function () { close(); wpLater(); });
    yes.addEventListener('click', function () { close(); wpAsk(); });
    d.body.appendChild(host);
  }
  function startPush() {
    if (w.__crmPush || typeof fetch !== 'function' || !nav.serviceWorker || !w.PushManager || !w.Notification || location.protocol !== 'https:') return;
    w.__crmPush = 1;
    var perm = w.Notification.permission, now = Date.now();
    var ask = wpShouldAsk(perm, wpStore('_crm_wp_until'), now);
    // Já permitiu: confere a inscrição uma vez por dia (e liga ao lead, se o visitante foi identificado depois).
    var sync = perm === 'granted' && now - (Number(wpStore('_crm_wp_sync')) || 0) > 864e5;
    if (!ask && !sync) return;
    fetch(WP_BASE + '/api/public/webpush/config?k=' + encodeURIComponent(C.k), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg || !cfg.enabled || !cfg.key || (cfg.host && cfg.host !== location.hostname)) return;
        WP = cfg;
        if (sync) wpSubscribe();
        else setTimeout(wpPrompt, Math.max(0, Number(cfg.prompt.delaySec) || 0) * 1000);
      })
      .catch(function () {});
  }
`
