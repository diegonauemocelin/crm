/**
 * Script de rastreamento colado no site. Pequeno, sem dependências e sem cookies de terceiros:
 * os identificadores ficam em cookies do próprio domínio do site e são números aleatórios (sem dado pessoal).
 *
 * Uso no site (antes do script, opcional):
 *   window.usaCrm = window.usaCrm || function () { (usaCrm.q = usaCrm.q || []).push(arguments) }
 *   usaCrm('consent', true)   // quando o visitante aceitar o banner de cookies (modo "após consentimento")
 *   usaCrm('pageview')        // registrar manualmente uma página (normalmente automático)
 */
export function buildScript(o: { key: string; endpoint: string; requireConsent: boolean; cookieDomains: string[] }) {
  const cfg = JSON.stringify({ k: o.key, e: o.endpoint, c: o.requireConsent, d: o.cookieDomains })
  return `/* CRM - rastreamento do site */
(function (w, d) {
  'use strict';
  var C = ${cfg};
  if (w.__crmTrack) return; w.__crmTrack = 1;
  var nav = w.navigator || {};
  if (nav.globalPrivacyControl === true) return;
  var host = location.hostname, domain = '';
  for (var i = 0; i < C.d.length; i++) { var x = C.d[i]; if (host === x || host.slice(-x.length - 1) === '.' + x) { if (!domain || x.length < domain.length) domain = x; } }
  function rid() {
    var a = new Uint8Array(16); (w.crypto || w.msCrypto).getRandomValues(a);
    var s = ''; for (var j = 0; j < a.length; j++) s += ('0' + a[j].toString(16)).slice(-2); return s;
  }
  function get(n) { var m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function set(n, v, age) {
    d.cookie = n + '=' + encodeURIComponent(v) + '; Max-Age=' + age + '; Path=/; SameSite=Lax' + (domain ? '; Domain=.' + domain : '') + (location.protocol === 'https:' ? '; Secure' : '');
  }
  var consent = !C.c || get('_crm_ok') === '1';
  var lastUrl = null;
  function send() {
    if (!consent) return;
    var url = location.href;
    if (url === lastUrl) return; lastUrl = url;
    var vid = get('_crm_vid'); if (!vid) vid = rid();
    set('_crm_vid', vid, 63072000);
    var sid = get('_crm_sid'), isNew = !sid; if (!sid) sid = rid();
    set('_crm_sid', sid, 1800);
    var lid = null;
    try {
      var u = new URL(url);
      lid = u.searchParams.get('crm_lid');
      if (lid) { u.searchParams.delete('crm_lid'); url = u.toString(); lastUrl = url; if (w.history && history.replaceState) history.replaceState(history.state, '', url); }
    } catch (e) {}
    var body = JSON.stringify({ k: C.k, v: vid, s: sid, n: isNew, u: url, t: (d.title || '').slice(0, 200), r: isNew ? d.referrer || null : null, l: lid });
    try {
      if (nav.sendBeacon && nav.sendBeacon(C.e, body)) return;
    } catch (e) {}
    try { fetch(C.e, { method: 'POST', body: body, mode: 'no-cors', keepalive: true, credentials: 'omit' }); } catch (e) {}
  }
  function api(cmd, arg) {
    if (cmd === 'consent') {
      if (arg === false) { consent = false; set('_crm_ok', '0', 0); set('_crm_vid', '', 0); set('_crm_sid', '', 0); return; }
      consent = true; if (C.c) set('_crm_ok', '1', 31536000); send();
    } else if (cmd === 'pageview') { send(); }
  }
  var q = (w.usaCrm && w.usaCrm.q) || [];
  w.usaCrm = function () { api(arguments[0], arguments[1]); };
  for (var k = 0; k < q.length; k++) api(q[k][0], q[k][1]);
  // Sites que trocam de página sem recarregar (SPA).
  var push = history.pushState;
  if (push) history.pushState = function () { var r = push.apply(this, arguments); setTimeout(send, 0); return r; };
  w.addEventListener('popstate', function () { setTimeout(send, 0); });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', send); else send();
})(window, document);
`
}
